# Munro Bagger

A map-first web app for tracking climbs of Scotland's 282 Munros. Browse every
Munro on a topographic map, open one to see its details and routes up, and tick
it off with a date. Your progress is saved in the browser (localStorage) — no login.

**Live:** https://munrobagger.uk

**Status:** v1 prototype. All 282 summits are plotted; route data has been derived
for a sample so far (Ben Lomond). Other summits show an honest "no routes sourced
yet" state with a link out to Walkhighlands.

## Features

- **Map** — all 282 current Munros on an Esri topographic basemap (MapLibre GL).
  Blue = to do, green = bagged, gold ring = has route data.
- **Details panel** — height (m/ft), height rank, grid reference and OS sheet.
- **Routes** — where derived, real route lines follow the OpenStreetMap foot
  network, with distance, ascent, Naismith time, and a confidence dot
  (green = derived from mapped paths, amber = approach approximate, red = no mapped path).
- **Tick-off** — bag a Munro with a date; a big "Bagged!" confirmation flashes up,
  and the "X / 282" counter and progress bar update.
- **Filter** — All / To do / Bagged.
- **Export** — download your tick list as CSV or JSON.

## Run it locally

Plain HTML/CSS/JS, no build step. Serve the repo root with any static server:

```bash
python -m http.server 8000
# open http://localhost:8000
```

## Project layout

- `index.html`, `app.js`, `styles.css` — the app, served at the site root.
- `munro-app/data/` — datasets and the data-pipeline scripts:
  - `munros.geojson` — 282 current Munros (DoBIH, reprojected to WGS84).
  - `routes.json` — derived route geometry.
  - `derive_routes.py` — OSM route-derivation pipeline (Overpass → graph → shortest path).
  - `coverage_check.py` / `coverage_results.tsv` — OSM path-coverage sense-check.

## Data

- **Munro list** — from the [Database of British and Irish Hills](https://www.hills-database.co.uk/)
  `munrotab v8.0.1` (current SMC classification → 282), OSGB36 reprojected to WGS84.
  Licence: CC-BY / OGL.
- **Routes** — derived from the OpenStreetMap foot network (ODbL) by shortest-path
  from trailhead to summit.
- **Basemap** — Esri World Topographic tiles.

## Licensing note

Route *descriptions* on sites like Walkhighlands are copyrighted and are not
reproduced here. Derived geometry comes from open data (OSM); anything unverified
is flagged as such in the UI. Auto-derived routes are not a substitute for proper
navigation.
