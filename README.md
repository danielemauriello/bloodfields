# Bloodfields Roster Builder

A small web app for building army rosters for the Bloodfields tabletop game.
Pick a realm, browse its units (plus mercenaries, always available) along
with each faction's reference info, add units to a roster, save it by name,
and export it as a PDF of the unit cards.

It's a fully static, backend-free app — everything (roster storage, PDF
generation) runs in the browser — so it can be hosted for free on GitHub
Pages, in addition to running locally.

## Running it locally

Requires Node.js — download it from https://nodejs.org (LTS version) if you
don't already have it installed.

No dependencies to install — the local dev server uses only Node's built-in
modules.

```
node server.js
```

Then open http://localhost:3000. The port can be overridden with the `PORT`
environment variable. `server.js` is a plain static file server for local
development; it has no app logic of its own — everything else (browsing
units, building a roster, saving, exporting a PDF) runs client-side in
`public/app.js` and `public/pdf-builder.js`, the same code that runs when
the site is deployed to GitHub Pages.

`unit_cards/` and `data/*.json` are generated files and are not checked into
the repo. `server.js` automatically runs first-time setup (`setup.js`) before
it starts listening: it downloads the unit card images from the xlsx into
`unit_cards/` (`download_unit_cards.js`), parses the xlsx and cross-references
`unit_cards/` to produce `data/units.json` (`build_data.js`), and parses the
per-faction description / abilities / bonus text from column J into
`data/factions.json` (`build_factions.js`). Each step is skipped if its
output already exists, so this adds no delay on later starts. Delete
`unit_cards/` or the relevant `data/*.json` file first if you need to force a
refresh (e.g. after the xlsx changes).

## Saved rosters

Rosters are saved to `localStorage` in whatever browser you're using — there
is no server-side storage, so a roster saved on one device/browser won't
show up on another. Use the **Export all** / **Import…** buttons on the
roster picker screen to move rosters between devices or back them up: Export
downloads all your saved rosters as one JSON file; Import merges a
previously-exported file back in (existing rosters with the same name are
overwritten, after a confirmation).

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and deploys the site automatically on
every push to `master`:

1. Runs `setup.js` to download the card art and build `data/units.json` /
   `data/factions.json` (cached between runs, keyed on the xlsx contents, so
   this is fast unless the xlsx changed).
2. Assembles `public/` + `data/*.json` + `unit_cards/` into one static site.
3. Publishes it via GitHub Pages.

One-time setup: in the repo's **Settings → Pages**, set **Source** to
**GitHub Actions**. After that, every push to `master` redeploys the site —
no manual steps.

All asset references in `public/` are relative (no leading `/`), so the same
build works whether it's served from a domain root or, as GitHub Pages does
for project sites, from a `/<repo-name>/` subpath.

## Project layout

- `server.js` — static file server for local development; runs `setup.js` on startup
- `public/` — frontend: `index.html`, `app.js` (roster builder UI + localStorage roster storage), `pdf-builder.js` (client-side PDF export), `style.css`
- `.github/workflows/deploy.yml` — builds and publishes the site to GitHub Pages on push
- `Bloodfields Unit List.xlsx` — source data for all units, realms, and faction reference text
- `setup.js` — first-time setup, run automatically by `server.js` (and by the Pages deploy workflow)
- `download_unit_cards.js` — downloads unit card images from the xlsx into `unit_cards/`
- `build_data.js` — parses the xlsx and cross-references `unit_cards/` to produce `data/units.json`
- `build_factions.js` — parses each faction's description, per-type abilities, and loyalty bonus (xlsx column J) into `data/factions.json`

## Changelog

- **2026-08-04** — Converted to a fully static, backend-free app so it can be
  hosted on GitHub Pages: roster storage moved from a server-side JSON file
  to browser `localStorage` (with Export/Import for moving rosters between
  devices), PDF export moved from `pdf.js` on the server to
  `public/pdf-builder.js` in the browser, and all asset paths were made
  relative so the site works from a project-page subpath. `server.js` is now
  a plain static file server used only for local development. Added
  `.github/workflows/deploy.yml` to build and publish to GitHub Pages on
  every push to `master`.
- **2026-08-04** — Added a "Faction info" panel to each faction section in
  the roster builder, showing the same description/abilities/loyalty-bonus
  reference text from `data/factions.json` used in the PDF export.
- **2026-08-04** — Added PDF export for rosters: a "Download PDF" button in
  the roster drawer and a "PDF" action on each saved roster, producing a
  printable PDF with faction reference pages followed by a grid of unit
  cards.
- **2026-08-04** — Added `build_factions.js`, which extracts each faction's
  description, per-type abilities, and loyalty bonus text into
  `data/factions.json`. Wired into `setup.js` alongside the other generated
  data.
- **2026-08-03** — `node server.js` now runs first-time setup automatically,
  so a fresh checkout only needs that one command. Setup skips any step
  whose output already exists.
- **2026-08-03** — Added `setup.js`, a single command for first-time setup.
  It replaces running `download_unit_cards.js` and `build_data.js`
  separately, and skips each step whose output already exists.
