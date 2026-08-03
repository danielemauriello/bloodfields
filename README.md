# Bloodfields Roster Builder

A small web app for building army rosters for the Bloodfields tabletop game.
Pick a realm, browse its units (plus mercenaries, always available), add
them to a roster, and save it by name for later.

## Running it

No dependencies to install — the server uses only Node's built-in modules.

```
node server.js
```

Then open http://localhost:3000. The port can be overridden with the `PORT`
environment variable.

`unit_cards/` and `data/*.json` are generated files and are not checked into
the repo. `server.js` automatically runs first-time setup (`setup.js`) before
it starts listening: it downloads the unit card images from the xlsx into
`unit_cards/` (`download_unit_cards.js`), then parses the xlsx and
cross-references `unit_cards/` to produce `data/units.json` (`build_data.js`).
Each step is skipped if its output already exists, so this adds no delay on
later starts. Delete `unit_cards/` or `data/units.json` first if you need to
force a refresh (e.g. after the xlsx changes). Saved rosters are stored at
runtime in `data/rosters.json`, created automatically on first save.

## Project layout

- `server.js` — static file server + small JSON API for saving/loading rosters; runs `setup.js` on startup
- `public/` — frontend (`index.html`, `app.js`, `style.css`)
- `Bloodfields Unit List.xlsx` — source data for all units and realms
- `setup.js` — first-time setup, run automatically by `server.js`
- `download_unit_cards.js` — downloads unit card images from the xlsx into `unit_cards/`
- `build_data.js` — parses the xlsx and cross-references `unit_cards/` to produce `data/units.json`

## API

- `GET /api/rosters` — list all saved rosters
- `POST /api/rosters/:name` — save/overwrite a roster (`{ realm, unitIds: [] }`)
- `DELETE /api/rosters/:name` — delete a saved roster

## Changelog

- **2026-08-03** — `node server.js` now runs first-time setup automatically,
  so a fresh checkout only needs that one command. Setup skips any step
  whose output already exists.
- **2026-08-03** — Added `setup.js`, a single command for first-time setup.
  It replaces running `download_unit_cards.js` and `build_data.js`
  separately, and skips each step whose output already exists.
