# Interactive image workbench

Authoring tool for `{{Interactive image}}` on English Wikipedia (and its Basque
original `{{Irudi interaktiboa}}`): place numbered markers on a base image, attach the
per-region layer files, watch the real template render live, and export wikitext that
already has the right coordinate units in it.

Static app — no server logic, no dependencies, no build step.

## Why it exists

The template has no coordinate picker and no authoring documentation. Marker positions
are written in the base file's own pixel units (`N-x`/`N-y` against
`original-width`/`original-height`), so reading them out of an SVG's source, by hand, is
the step where authors place every marker plausibly and wrongly. A wrong unit looks
exactly like a CSS bug: markers sit off-canvas or drift as the image scales.

So the tool's three load-bearing decisions:

1. **Units are never percentages.** Coordinates come from clicking the rendered image and
   are written in `original-width`/`original-height` units, both filled in from the
   file's natural size.
2. **Layers are verified against the base canvas.** Every layer's natural size is
   compared with the base image; a different canvas is flagged, because that layer will
   appear shifted or scaled when hovered.
3. **The preview is the template's own CSS.** `template-styles.css` is a verbatim copy of
   `Template:Interactive image/styles.css` (provenance header + `refresh-template-css.py`),
   and the preview markup mirrors what `Module:Interactive image` emits — legend rows as
   preceding siblings of the image wrapper, cards with the same up/right/centre classes,
   the Commons credit box.

## Using it

The default view is a four-step guide (top bar): **1 Choose image → 2 Place regions →
3 Describe them → 4 Export**. Each step shows only the surfaces it needs, the step you are on
is highlighted, and *Next* refuses to advance without the prerequisite (no image, no regions).
**Show all panels** switches to the free-form three-panel layout for editing an existing
project, and **‹ / ›** in step 3 walk region by region.

- **Commons / Upload / URL** — load a base image. A Commons file name is resolved through
  `action=query&prop=imageinfo` (thumb URL for display, natural size for units). Loading one
  advances you to step 2 by itself.
- **Click the image** to drop a marker, **drag** it, **arrow keys** nudge (Shift = 10 px),
  **Delete** removes.
- **Items panel** — name (required; an item without one does not render), badge label,
  text, layer file, link, raw x/y.
- **Card mode** (`captions=card`) moves the text into a hover card next to the marker —
  check the mobile 360 px preview, where the template collapses cards back into the legend.
- **Export** (step 4) puts the block inline with Copy/Download buttons: aligned, with
  `original-width`, `original-height`, `resolution` and per-item `N-x`/`N-y` filled in.
  The same block is also available any time from the top-bar *Export wikitext* button.
- **Import wikitext** parses an existing block back into the editor — English or Basque
  parameter names, so an eu.wp `{{Irudi interaktiboa}}` can be inspected or ported.
- **Save/Load project** (JSON) keeps local uploads inline as data URLs.

## What it deliberately does not do

- No uploads, no wiki writes. File names in the export must already exist on Commons.
- Wikitext in `N-text` is previewed with a small parser (links, bold, italics, lists);
  templates, tables and references inside the text are not rendered.
- Fonts/skin come from the browser, not Vector 2022 — text metrics differ slightly.
- Not affiliated with or endorsed by the Wikimedia Foundation.

## Running it

```bash
cd /opt/data/interactive-image-workbench
python3 -m http.server 8811 --bind 127.0.0.1
# public demo URL:
cloudflared tunnel --url http://127.0.0.1:8811 --no-autoupdate --logfile tunnel.log
```

Refresh the copied stylesheet after the template's CSS changes:

```bash
python3 refresh-template-css.py
```

## Version control

This directory is a git repository: one commit per behaviour change, so any revision can be
revisited.

```bash
git log --oneline          # the sequence of revisions
git tag                    # milestones (v1.0.0 = the guided workbench)
git checkout v1.0.0        # show that version …
git switch main            # … and come back
```

Because the tunnel points at this directory, `git checkout` also changes what the public demo
serves. That is handy for comparing two builds at one URL and a trap if you leave the repo on an
old revision — `git switch main` restores it.

Conventions: message says what changed and why; tag milestones `vX.Y.Z` and add a `CHANGELOG.md`
entry; `tunnel.log` and saved projects stay untracked.

## Files

| file | job |
|---|---|
| `index.html` | the whole UI shell |
| `app.js` | state, canvas interaction, preview builder, wikitext export/import |
| `app.css` | workbench chrome (not the template's CSS) |
| `template-styles.css` | verbatim copy of the template's TemplateStyles sheet — the preview's only styling |
| `refresh-template-css.py` | re-pull that sheet, with revision timestamp in the header |

Provenance: built by Hermes Agent for Andrew Lih, November 2026, while auditing
`{{Interactive image}}` on en.wp. Template/module/stylesheet © Wikipedia contributors,
CC BY-SA 4.0.
