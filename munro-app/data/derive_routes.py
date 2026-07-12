"""Derive real route geometry by shortest-path over the OSM foot network.
Fetch path/track ways in a corridor (with node ids), build a graph, Dijkstra
from trailhead -> (via) -> summit. Honest: if the graph can't connect, the route
gets no line (geometry_status='no-path') rather than a fake one."""
import json, math, time, heapq, urllib.request, urllib.parse, sys
sys.stdout.reconfigure(line_buffering=True)

ENDPOINTS = ["https://overpass.kumi.systems/api/interpreter",
             "https://overpass-api.de/api/interpreter",
             "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
HW = "path|footway|track|steps|bridleway|cycleway"

def haversine(a, b):
    (lo1, la1), (lo2, la2) = a, b
    R = 6371000.0
    p1, p2 = math.radians(la1), math.radians(la2)
    dp = math.radians(la2 - la1); dl = math.radians(lo2 - lo1)
    x = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))

def overpass(bbox):
    s, w, n, e = bbox
    q = (f'[out:json][timeout:120];'
         f'(way["highway"~"^({HW})$"]({s},{w},{n},{e}););'
         f'out body;>;out skel qt;')
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for ep in ENDPOINTS:
        try:
            req = urllib.request.Request(ep, data=data,
                headers={"User-Agent": "munro-app/0.1 route-derive", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode())
        except Exception as ex:
            last = f"{ep.split('/')[2]}: {ex}"; time.sleep(3)
    raise RuntimeError(last)

def build_graph(osm):
    nodes = {}          # id -> (lon, lat)
    for el in osm["elements"]:
        if el["type"] == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])
    adj = {}            # id -> list of (nbr_id, dist_m)
    for el in osm["elements"]:
        if el["type"] == "way":
            ns = el.get("nodes", [])
            for a, b in zip(ns, ns[1:]):
                if a in nodes and b in nodes:
                    d = haversine(nodes[a], nodes[b])
                    adj.setdefault(a, []).append((b, d))
                    adj.setdefault(b, []).append((a, d))
    return nodes, adj

def nearest_node(nodes, pt, restrict=None):
    best, bd = None, 1e18
    keys = restrict if restrict is not None else nodes.keys()
    for nid in keys:
        d = haversine(nodes[nid], pt)
        if d < bd: bd, best = d, nid
    return best, bd

def component_of(adj, start):
    seen = {start}; st = [start]
    while st:
        u = st.pop()
        for v, _ in adj.get(u, []):
            if v not in seen: seen.add(v); st.append(v)
    return seen

def dijkstra(adj, src, dst):
    dist = {src: 0.0}; prev = {}; pq = [(0.0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == dst: break
        if d > dist.get(u, 1e18): continue
        for v, w in adj.get(u, []):
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
    if dst not in dist: return None, None
    path = [dst]
    while path[-1] != src: path.append(prev[path[-1]])
    return path[::-1], dist[dst]

def route_line(nodes, adj, waypoints):
    """Snap the summit (last waypoint) to its nearest node, take that node's connected
    component, and snap every waypoint INTO that component. Guarantees connectivity and
    keeps the line on the real track. Returns (coords, total_m, snap_distances)."""
    summit_node, _ = nearest_node(nodes, waypoints[-1])
    if summit_node is None: return None, None, []
    comp = component_of(adj, summit_node)
    if len(comp) < 30: return None, None, [1e9]     # summit sits on an isolated stub -> pathless
    snapped = [nearest_node(nodes, w, restrict=comp) for w in waypoints]
    snaps = [s[1] for s in snapped]
    coords = []; total = 0.0
    for (a, _), (b, _) in zip(snapped, snapped[1:]):
        seg, dseg = dijkstra(adj, a, b)
        if seg is None: return None, None, snaps
        pts = [nodes[n] for n in seg]
        if coords and pts and coords[-1] == pts[0]: pts = pts[1:]
        coords += pts; total += dseg
    return coords, total, snaps

# ---- summit coords from dataset ----
fc = json.load(open('munro-app/data/munros.geojson', encoding='utf-8'))
summit = {f['properties']['id']: tuple(f['geometry']['coordinates']) for f in fc['features']}

# ---- route definitions: waypoints are trailhead ... [via] ... summit ----
S = summit
DEFS = [
 dict(id="r-278-mtntrack", mid=278, name="Mountain Track (Pony Track)", trailhead="Achintee, Glen Nevis",
      type="Out & back", ascent=1352, grade="Straightforward but long; Scotland's highest",
      wps=[(-5.09843, 56.79867), S[278]]),
 dict(id="r-278-cmd", mid=278, name="CMD Arête via Càrn Mòr Dearg", trailhead="North Face car park, Torlundy",
      type="Out & back", ascent=1600, grade="Serious, exposed narrow-arête scramble",
      wps=[(-5.07076, 56.82440), (-5.0327, 56.8055), S[278]]),   # via CMD col area
 dict(id="r-32-tourist", mid=32, name="Mountain Path from Rowardennan", trailhead="Rowardennan car park",
      type="Out & back", ascent=975, grade="Straightforward; the standard route",
      wps=[(-4.63447, 56.15074), S[32]]),
 dict(id="r-32-ptarmigan", mid=32, name="Ptarmigan Ridge", trailhead="Rowardennan car park",
      type="Out & back", ascent=1000, grade="Quieter, steeper ridge line",
      wps=[(-4.63447, 56.15074), (-4.64550, 56.17700), S[32]]),  # via Ptarmigan
 dict(id="r-103-eastridge", mid=103, name="East Ridge from Braes of Foss", trailhead="Braes of Foss car park",
      type="Out & back", ascent=760, grade="Straightforward; bouldery summit ridge",
      wps=[(-4.06730, 56.67967), S[103]]),
 dict(id="r-525-windyridge", mid=525, name="Windy Ridge from Coire Cas", trailhead="Coire Cas (ski centre) car park",
      type="Out & back", ascent=560, grade="Short; exposed summit plateau",
      wps=[(-3.67070, 57.11760), S[525]]),
 dict(id="r-525-fiacaill", mid=525, name="Fiacaill a' Choire Chais", trailhead="Coire Cas car park",
      type="Out & back", ascent=620, grade="Fine corrie-rim ridge",
      wps=[(-3.67070, 57.11760), (-3.65980, 57.12460), S[525]]),
 # Remote — long walk-ins with no continuous mapped path; marked no-path directly (derive=False)
 # to avoid huge, slow Overpass corridors. The full 282 run handles these with the DEM + confidence pass.
 dict(id="r-345-dalwhinnie", mid=345, name="From Dalwhinnie (bike walk-in)", trailhead="Dalwhinnie",
      type="Out & back", ascent=1150, grade="Remote; long cycle/walk-in", derive=False, wps=[(-4.24170, 56.93450), S[345]]),
 dict(id="r-1069-inverlael", mid=1069, name="From Inverlael", trailhead="Inverlael, Loch Broom",
      type="Out & back", ascent=1100, grade="Very remote", derive=False, wps=[(-5.01700, 57.80800), S[1069]]),
 dict(id="r-730-dessarry", mid=730, name="From Strathan, Glen Dessarry", trailhead="Strathan (Loch Arkaig)",
      type="Out & back", ascent=1350, grade="Remote; rough steep upper ground", derive=False, wps=[(-5.35300, 56.95800), S[730]]),
 dict(id="r-898-craig", mid=898, name="From Craig, Achnashellach", trailhead="Craig (Achnashellach)",
      type="Out & back", ascent=1400, grade="Very remote; long day", derive=False, wps=[(-5.30000, 57.48100), S[898]]),
]

def corridor(wps, pad=0.03):
    lons = [w[0] for w in wps]; lats = [w[1] for w in wps]
    return (min(lats)-pad, min(lons)-pad, max(lats)+pad, max(lons)+pad)

wanted = set(sys.argv[1:]) if len(sys.argv) > 1 else None   # optional list of route ids to derive
out_routes = []
for d in DEFS:
    if wanted and d["id"] not in wanted: continue
    if not d.get("derive", True):
        out_routes.append(dict(id=d["id"], munro_ids=[d["mid"]], name=d["name"], trailhead=d["trailhead"],
            type=d["type"], ascent_m=d["ascent"], grade=d["grade"], source="remote — no continuous mapped path",
            distance_km=None, time_h=None, geometry_status="no-path", geometry=None))
        print(f"{d['id']:22s} no-path        (remote; skipped derivation)")
        continue
    bbox = corridor(d["wps"])
    try:
        osm = overpass(bbox)
    except Exception as ex:
        print(f"{d['id']:22s} OVERPASS-ERR {ex}"); continue
    nodes, adj = build_graph(osm)
    coords, oneway, snaps = route_line(nodes, adj, d["wps"]) if nodes else (None, None, [])
    rec = dict(id=d["id"], munro_ids=[d["mid"]], name=d["name"], trailhead=d["trailhead"],
               type=d["type"], ascent_m=d["ascent"], grade=d["grade"], source="derived from OSM foot network")
    if coords and oneway:
        rt_km = round(oneway/1000 * (2 if d["type"] == "Out & back" else 1), 1)
        maxsnap = max(snaps)
        rec["distance_km"] = rt_km
        rec["time_h"] = round(rt_km/5 + d["ascent"]/600, 1)
        # confidence from how far waypoints had to snap onto the mapped network
        rec["geometry_status"] = "derived" if maxsnap <= 400 else ("derived-approx" if maxsnap <= 1500 else "no-path")
        rec["snap_m"] = [round(s) for s in snaps]
        rec["geometry"] = {"type": "LineString", "coordinates": [[round(x,6), round(y,6)] for x,y in coords]}
        print(f"{d['id']:22s} {rec['geometry_status']:14s} oneway={oneway/1000:5.1f}km rt={rt_km:5.1f}km pts={len(coords):4d} maxsnap={maxsnap:5.0f}m")
    else:
        rec["distance_km"] = None; rec["time_h"] = None
        rec["geometry_status"] = "no-path"
        rec["geometry"] = None
        print(f"{d['id']:22s} NO-PATH (graph did not connect trailhead->summit)")
    out_routes.append(rec)
    time.sleep(1)

payload = {"type": "routes",
           "note": "Geometry derived from the OSM foot network by shortest-path (trailhead->summit). "
                   "'no-path' = no continuous mapped route; ascent is published, distance is measured from the derived line.",
           "routes": out_routes}
json.dump(payload, open('munro-app/data/routes.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"\nwrote {len(out_routes)} routes -> munro-app/data/routes.json")
