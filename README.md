# Bloodfields Roster Builder

A small web app for building army rosters for the Bloodfields tabletop game.
Pick a realm, browse its units (plus mercenaries, always available), add
them to a roster, and save it by name for later.

## First-time setup

`unit_cards/` and `data/*.json` are generated files and are not checked into
the repo, so run this once before starting the server — otherwise the app
will have no unit cards or unit data to show:

```
node setup.js
```

This downloads the unit card images from the xlsx into `unit_cards/`
(`download_unit_cards.js`), then parses the xlsx and cross-references
`unit_cards/` to produce `data/units.json` (`build_data.js`). Each step is
skipped if its output already exists, so re-running `setup.js` later (e.g.
after pulling xlsx changes) won't re-download images that are already
there — delete `unit_cards/` or `data/units.json` first if you need to force
a refresh, or run the underlying script directly. Saved rosters are stored
at runtime in `data/rosters.json`, created automatically on first save.

## Running it

No dependencies to install — the server uses only Node's built-in modules.

```
node server.js
```

Then open http://localhost:3000. The port can be overridden with the `PORT`
environment variable.

## Project layout

- `server.js` — static file server + small JSON API for saving/loading rosters
- `public/` — frontend (`index.html`, `app.js`, `style.css`)
- `Bloodfields Unit List.xlsx` — source data for all units and realms
- `setup.js` — runs first-time setup (see below)
- `download_unit_cards.js` — downloads unit card images from the xlsx into `unit_cards/`
- `build_data.js` — parses the xlsx and cross-references `unit_cards/` to produce `data/units.json`

## API

- `GET /api/rosters` — list all saved rosters
- `POST /api/rosters/:name` — save/overwrite a roster (`{ realm, unitIds: [] }`)
- `DELETE /api/rosters/:name` — delete a saved roster
