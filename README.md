# Munro Bagger

A map-first web app for tracking climbs of Scotland's 282 Munros. Browse every
Munro on a topographic map, open one to see its details and routes up, and tick
it off with a date. Your progress lives in the browser (localStorage) — no login.

**Status:** v1 prototype. All 282 summits are plotted; route data has been derived
for a sample of hills (Ben Lomond, plus others in progress). The rest show an
honest "no routes sourced yet" state with a link out to Walkhighlands.

## Features

- **Map** — all 282 current Munros on an Esri topographic basemap (MapLibre GL).
  Blue = to do, green = bagged, gold ring = has route data.
- **Details panel** — height (m/ft), height rank, grid reference and OS sheet.
- **Routes** — where derived, real route lines follow the OpenStreetMap foot
  network, with distance, ascent, Naismith time, and a confidence dot
  (green = derived from mapped paths, amber = approach approximate, red = no mapped path).
- **Tick-off** — bag a Munro with a date; the "X / 282" counter and progress bar update.
- **Filter** — All / To do / Bagged.
- **Export** — download your tick list as CSV or JSON.

## Run it

Any static file server works — the app is plain HTML/CSS/JS with no build step:

```bash
cd munro-app
python -m http.server 5178
# open http://localhost:5178
```

## Data

- **Munro list** — `munro-app/data/munros.geojson`, derived from the
  [Database of British and Irish Hills](https://www.hills-database.co.uk/)
  `munrotab v8.0.1` (current SMC classification, `2021 == "MUN"` → 282), with
  OSGB36 eastings/northings reprojected to WGS84. Licence: CC-BY / OGL.
- **Routes** — `munro-app/data/routes.json`, derived from the OpenStreetMap foot
  network (ODbL) by shortest-path from trailhead to summit. See
  `munro-app/data/derive_routes.py`.
- **Coverage sense-check** — `munro-app/data/coverage_check.py` /
  `coverage_results.tsv`: OSM path coverage across contrasting Munros.
- **Basemap** — Esri World Topographic tiles.

## Licensing note

Route *descriptions* on sites like Walkhighlands are copyrighted and are not
reproduced here. Derived geometry comes from open data (OSM); anything unverified
is flagged as such in the UI. Auto-derived routes are not a substitute for proper
navigation.
