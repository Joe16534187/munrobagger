/* Munro Bagger — v1 prototype */
const STORE_KEY = 'munro-bagged-v1';
const TOTAL = 282;

/* ---------- state ---------- */
let bagged = loadBagged();              // { [id]: 'YYYY-MM-DD' }
let munroById = {};                      // id -> feature
let routesByMunro = {};                  // id -> [route]
let routeIds = new Set();                // munro ids that have routes
let selectedId = null;
let activeRouteId = null;                // currently drawn route

function loadBagged() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}
function saveBagged() { localStorage.setItem(STORE_KEY, JSON.stringify(bagged)); }

/* ---------- map ---------- */
const map = new maplibregl.Map({
  container: 'map',
  center: [-4.7, 57.1],
  zoom: 6.1,
  maxZoom: 15,
  style: {
    version: 8,
    sources: {
      topo: {
        type: 'raster',
        // Esri World Topographic — reliable, keyless, no aggressive rate limiting (unlike OpenTopoMap).
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Map: Esri, USGS, NGA, NASA · Data: © OpenStreetMap contributors · Munros: DoBIH'
      }
    },
    layers: [{ id: 'topo', type: 'raster', source: 'topo' }]
  }
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

map.on('load', async () => {
  map.resize();   // guard against the map initialising before styles.css sizes #map (CSS/JS load race)
  const [munros, routeData] = await Promise.all([
    fetch('munro-app/data/munros.geojson').then(r => r.json()),
    fetch('munro-app/data/routes.json').then(r => r.json())
  ]);

  munros.features.forEach(f => { munroById[f.properties.id] = f; });
  routeData.routes.forEach(rt => {
    rt.munro_ids.forEach(id => {
      (routesByMunro[id] ||= []).push(rt);
      routeIds.add(id);
    });
  });

  // Munro points
  map.addSource('munros', { type: 'geojson', data: munros, promoteId: 'id' });

  // MapLibre paint can't read CSS vars, so resolve them to concrete colours here.
  const css = getComputedStyle(document.documentElement);
  const cAccent = css.getPropertyValue('--accent').trim() || '#1f7a4d';
  const cTodo = css.getPropertyValue('--todo').trim() || '#4b6b8a';

  map.addLayer({
    id: 'munro-dots',
    type: 'circle',
    source: 'munros',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.4, 9, 6, 12, 9],
      'circle-color': ['case', ['boolean', ['feature-state', 'bagged'], false], cAccent, cTodo],
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hasroutes'], false], 2.2, 1.2],
      'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hasroutes'], false], '#c88a2a', '#ffffff'],
      'circle-opacity': 0.95
    }
  });

  // seed feature-state
  routeIds.forEach(id => map.setFeatureState({ source: 'munros', id }, { hasroutes: true }));
  Object.keys(bagged).forEach(id => map.setFeatureState({ source: 'munros', id: Number(id) }, { bagged: true }));

  // selected-route line
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#c88a2a', 'line-width': 4, 'line-dasharray': [2, 1.4] }  // dashed = provisional
  });

  wireInteractions();
  updateCounter();
});

/* ---------- interactions ---------- */
function wireInteractions() {
  map.on('click', 'munro-dots', (e) => selectMunro(e.features[0].properties.id));
  map.on('mouseenter', 'munro-dots', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'munro-dots', () => map.getCanvas().style.cursor = '');

  let hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
  map.on('mousemove', 'munro-dots', (e) => {
    const p = e.features[0].properties;
    hoverPopup.setLngLat(e.lngLat).setHTML(`<strong>${p.name}</strong><br>${Math.round(p.height_m)} m`).addTo(map);
  });
  map.on('mouseleave', 'munro-dots', () => hoverPopup.remove());

  document.getElementById('panel-close').onclick = closePanel;

  document.querySelectorAll('#filter button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#filter button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      applyFilter(b.dataset.filter);
    };
  });

  const exportBtn = document.getElementById('export-btn');
  const exportMenu = document.getElementById('export-menu');
  exportBtn.onclick = () => exportMenu.hidden = !exportMenu.hidden;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu')) exportMenu.hidden = true;
  });
  exportMenu.querySelectorAll('button').forEach(b => {
    b.onclick = () => { doExport(b.dataset.export); exportMenu.hidden = true; };
  });
}

function applyFilter(kind) {
  if (kind === 'all') { map.setFilter('munro-dots', null); return; }
  const ids = Object.keys(bagged).map(Number);
  if (kind === 'bagged') map.setFilter('munro-dots', ['in', ['get', 'id'], ['literal', ids]]);
  else map.setFilter('munro-dots', ['!', ['in', ['get', 'id'], ['literal', ids]]]);
}

/* ---------- selection panel ---------- */
function selectMunro(id, keepRouteId = null) {
  if (id !== selectedId) activeRouteId = null;   // switching hills resets the drawn route
  else activeRouteId = keepRouteId;
  selectedId = id;
  const p = munroById[id].properties;
  const routes = routesByMunro[id] || [];
  const done = bagged[id];

  const panel = document.getElementById('panel');
  const body = document.getElementById('panel-body');
  document.getElementById('hint').style.display = 'none';

  body.innerHTML = `
    <div class="p-title">${p.name}</div>
    <div class="p-sub">Grid ${p.grid_ref} · OS 1:50k sheet ${p.map_50k}</div>

    <div class="stat-row two">
      <div class="stat"><div class="k">Height</div><div class="v">${Math.round(p.height_m)}<small> m</small> · ${Math.round(p.height_ft)}<small> ft</small></div></div>
      <div class="stat"><div class="k">Rank</div><div class="v">#${heightRank(id)}</div></div>
    </div>

    ${renderTick(id, done)}

    <div class="routes-head">
      <h3>Routes up</h3><span class="n">${routes.length ? routes.length + ' route' + (routes.length > 1 ? 's' : '') : ''}</span>
    </div>
    ${routes.length ? routes.map(renderRoute).join('') : renderNoRoutes(p.name)}
  `;

  panel.hidden = false;
  wirePanel(id);

  if (activeRouteId) {
    // re-render kept a route selected (e.g. after ticking) — redraw its line, don't move the map
    const rt = (routesByMunro[id] || []).find(r => r.id === activeRouteId);
    if (rt) map.getSource('route').setData({ type: 'Feature', geometry: rt.geometry, properties: {} });
  } else {
    clearRoute();
    map.flyTo({ center: munroById[id].geometry.coordinates, zoom: Math.max(map.getZoom(), 10), speed: 0.8, padding: { right: 380 } });
  }
}

function renderTick(id, done) {
  const today = todayStr();
  if (done) {
    return `<div class="tick-box done">
      <div class="done-note">
        <div><span class="chk">✓ Bagged</span> <span style="color:var(--ink-soft)">on ${fmtDate(done)}</span></div>
        <button class="btn btn-ghost" data-untick>Remove</button>
      </div></div>`;
  }
  return `<div class="tick-box">
    <label>Bag this Munro — pick the date you climbed it</label>
    <div class="field">
      <input type="date" id="tick-date" value="${today}" max="${today}"
             onclick="this.showPicker && this.showPicker()" onfocus="this.showPicker && this.showPicker()">
      <button class="btn btn-primary" data-tick>✓ Bag it</button>
    </div></div>`;
}

function renderRoute(rt) {
  const gs = rt.geometry_status;
  const dot = gs === 'derived' ? 'ok' : gs === 'derived-approx' ? 'approx' : 'none';
  const dotTitle = gs === 'derived' ? 'Derived from mapped paths'
    : gs === 'derived-approx' ? 'Derived; approach approximate' : 'No mapped path';
  const dist = rt.distance_km != null ? `<span><b>${rt.distance_km}</b> km</span>` : `<span class="muted">dist n/a</span>`;
  const time = rt.time_h != null ? `<span>~<b>${rt.time_h}</b> h</span>` : '';
  return `<div class="route ${gs === 'no-path' ? 'route-nopath' : ''}" data-route="${rt.id}">
    <div class="r-top">
      <div class="r-name">${rt.name}</div>
      <span class="dot ${dot}" title="${dotTitle}"></span>
    </div>
    <div class="r-stats">
      ${dist}
      <span><b>${rt.ascent_m}</b> m ascent</span>
      ${time}
      <span>${rt.type}</span>
    </div>
    <div class="grade-note"><em>${rt.grade}</em></div>
  </div>`;
}

function renderNoRoutes(name) {
  const q = encodeURIComponent(name + ' munro');
  return `<div class="empty">No routes sourced yet for this hill.<br>
    Route derivation runs across all 282 once the style is signed off.<br><br>
    Meanwhile: <a href="https://www.walkhighlands.co.uk/munros/?s=${q}" target="_blank" rel="noopener">find it on Walkhighlands ↗</a></div>`;
}

function wirePanel(id) {
  const body = document.getElementById('panel-body');
  const tick = body.querySelector('[data-tick]');
  if (tick) tick.onclick = () => {
    const d = body.querySelector('#tick-date').value || todayStr();
    bagged[id] = d; saveBagged();
    map.setFeatureState({ source: 'munros', id }, { bagged: true });
    updateCounter(); reapplyFilter(); selectMunro(id, activeRouteId);
  };
  const untick = body.querySelector('[data-untick]');
  if (untick) untick.onclick = () => {
    delete bagged[id]; saveBagged();
    map.setFeatureState({ source: 'munros', id }, { bagged: false });
    updateCounter(); reapplyFilter(); selectMunro(id, activeRouteId);
  };
  body.querySelectorAll('[data-route]').forEach(el => {
    el.onclick = () => {
      body.querySelectorAll('.route').forEach(r => r.classList.remove('active'));
      el.classList.add('active');
      activeRouteId = el.dataset.route;
      showRoute((routesByMunro[id] || []).find(r => r.id === activeRouteId));
    };
  });
  // restore a previously-selected route after a tick/untick re-render
  if (activeRouteId) {
    const el = body.querySelector(`[data-route="${activeRouteId}"]`);
    if (el) el.classList.add('active');
  }
}

function showRoute(rt) {
  if (!rt.geometry) { clearRoute(); return; }   // no-path routes have no line to draw
  map.getSource('route').setData({ type: 'Feature', geometry: rt.geometry, properties: {} });
  const approx = rt.geometry_status === 'derived-approx';
  map.setPaintProperty('route-line', 'line-color', approx ? '#c88a2a' : '#1f7a4d');
  map.setPaintProperty('route-line', 'line-dasharray', approx ? [2, 1.4] : [1]);
  const coords = rt.geometry.coordinates;
  const b = coords.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(b, { padding: { top: 80, bottom: 80, left: 80, right: 400 }, maxZoom: 14 });
}
function clearRoute() { if (map.getSource('route')) map.getSource('route').setData({ type: 'FeatureCollection', features: [] }); }

function closePanel() {
  document.getElementById('panel').hidden = true;
  document.getElementById('hint').style.display = '';
  selectedId = null; clearRoute();
}

/* ---------- counter & filter helpers ---------- */
function updateCounter() {
  const n = Object.keys(bagged).length;
  document.getElementById('count-done').textContent = n;
  const pct = Math.round((n / TOTAL) * 100);
  document.getElementById('count-pct').textContent = pct + '%';
  document.getElementById('bar-fill').style.width = pct + '%';
}
function reapplyFilter() {
  const active = document.querySelector('#filter button.active');
  if (active) applyFilter(active.dataset.filter);
}

let _rankCache = null;
function heightRank(id) {
  if (!_rankCache) {
    const sorted = Object.values(munroById).sort((a, b) => b.properties.height_m - a.properties.height_m);
    _rankCache = {}; sorted.forEach((f, i) => _rankCache[f.properties.id] = i + 1);
  }
  return _rankCache[id];
}

/* ---------- export ---------- */
function doExport(kind) {
  const rows = Object.entries(bagged).map(([id, date]) => {
    const p = munroById[id].properties;
    return { id: Number(id), name: p.name, height_m: p.height_m, grid_ref: p.grid_ref, date_bagged: date };
  }).sort((a, b) => a.date_bagged.localeCompare(b.date_bagged));

  let blob, fname;
  if (kind === 'json') {
    blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    fname = 'munros-bagged.json';
  } else {
    const head = 'id,name,height_m,grid_ref,date_bagged';
    const csv = [head, ...rows.map(r => `${r.id},"${r.name}",${r.height_m},${r.grid_ref},${r.date_bagged}`)].join('\n');
    blob = new Blob([csv], { type: 'text/csv' });
    fname = 'munros-bagged.csv';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = fname; a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- date utils ---------- */
function todayStr() {
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDate(s) {
  const [y, m, d] = s.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}
