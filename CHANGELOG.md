# Changelog

Dates are UTC. The project is a static app — every commit is a working tree that can be served
as-is, so any version can be revisited with `git checkout <sha>`.

## v1.6.0 — 2026-11-20

Making it something other people can use: public repo, Toolforge deployment, and a README written
for someone who has never heard of the template.

- Repository is **public**.
- **Toolforge Build Service ready**: `app.py` (standard-library static server reading `PORT`, no
  directory listings, `/healthz`, per-extension cache headers), `Procfile`
  (`web: python3 app.py`), `.python-version` (`3.12`), and a comment-only `requirements.txt` so the
  Python buildpack detects the project. `DEPLOY.md` has the build/start/update commands and the
  traps (`.python-version` not `runtime.txt`, bind `0.0.0.0:$PORT`, licence requirement).
- **README rewritten for a newcomer**: what an interactive image is, what the template does, why
  coordinates and canvases go wrong, a two-minute walkthrough, how to make layers, languages,
  deep links, then the maintainer details.
- **Screenshot** at `assets/tool-screenshot.png` (2880×1900, the Voyager sample loaded) and
  `tools/screenshot.mjs` to regenerate it — it waits for all 16 layers to resolve and for the toast
  to fade, so the shot never shows a half-loaded canvas.

## v1.5.0 — 2026-11-19

"`?page=Voyager 1` — but how does it know which wiki?" It didn't, explicitly: it fell back to the
target wiki (en by default) and only `?wiki=` could change that. Fixed.

- `?page=` accepts a scoped title — `en:Voyager 1`, `eu:Zaldi`, plus `enwp:` / `euwp:` aliases —
  or a pasted article URL (`https://eu.wikipedia.org/wiki/Zaldi`, `m.` hosts and `#sections`
  included).
- The colon rule: a prefix is only a wiki when it is one we know. `Star Trek: Voyager`,
  `Category:Foo`, `File:X.svg` and `Wikipedia:Featured articles` stay titles — verified case by
  case, since silently querying the wrong wiki for those would look like a broken tool.
- A URL may name any language subdomain; we fetch from it and, if we have no dialect for that
  wiki yet, keep the current export dialect and say which wiki the page came from.
- `?page=` without a prefix still defaults to the current target wiki (en unless `?wiki=`), and
  **Copy link** now always emits the scoped form (`page=en:Voyager+1`), so shared links state
  their wiki instead of relying on a default.
- New **Open from a wiki page** field in the left panel does the same thing without a URL.
- Adding a wiki to `i18n.js` makes its prefix valid automatically.
- Fixed the "no block on …" message, which printed doubled braces (`{{{{Interactive image}}}}`).

## v1.4.0 — 2026-11-19

Two requests from review: make the canvas inspectable, and let a URL carry the template.

- **Canvas zoom.** `−` / `+` / `fit` in the canvas corner scale the fitted view; above fit the
  stage scrolls (markers keep their exact percentages — verified 35.83 % / 45.86 % unchanged at
  156 % zoom), so the whole diagram is reachable without touching the page.
- **Draggable split** between canvas and preview (persisted), and **expand** hands the whole
  column to the preview — the answer to "the preview extends too far and I can't see all of it":
  expand + the preview pane's own scrollbar shows the entire widget.
- **Deep links**: `?page=`, `?wikitext=`, `?sample=`, `?file=`, `?lang=`, `?wiki=`, `?target=`.
  `?page=Voyager 1` fetches the article's wikitext, extracts the block and resolves every layer.
  **Copy link** in the top bar builds the URL for the current state (page-based when known,
  otherwise the wikitext).
- `extractBlock()` — brace-counting extraction of the first invocation from a whole page, shared by
  the page loader and the paste importer. It strips HTML comments first: the demo file's own
  header contained `{{Interactive image}}` inside a comment and won the match, which silently
  produced a zero-parameter block (caught by the sample test, fixed).

## v1.3.0 — 2026-11-19

Layout rebuilt so the page never grows taller than the window.

- The shell is `100vh` with `overflow:hidden`; `main` is a grid with one `minmax(0,1fr)` row.
  Left and right columns scroll **independently** (`overflow-y:auto`, overscroll containment,
  stable scrollbar gutter), so the bottom of the options and the bottom of the region list are
  reachable without pushing the canvas out of view.
- The centre column is a flex split — canvas `flex:3` (min 240 px), preview `flex:2` (min 180 px) —
  so there is no blank area under the preview any more: whatever space the content does not use is
  simply not allocated.
- The canvas is fitted to the stage box in JS: the frame is set to exactly the rendered image's
  width, so percentage markers stay glued to the picture at any window size, and a very tall image
  scrolls inside the canvas instead of stretching the page. Fitting runs on load, on resize, on
  step change and once the preview has settled.
- **hide preview** (new pill in the preview bar) gives the canvas the whole column; the choice is
  remembered.
- Step 4 fills the centre column with the wikitext pane, which scrolls internally.
- Below 1180 px everything reverts to ordinary document scrolling — independent panes are the
  wrong model on a phone.

## v1.2.0 — 2026-11-19

A blank canvas is a bad first impression, so the empty state now offers a finished example.

- **Load sample** button (in the empty canvas and the top bar) opens the *Voyager 1* spacecraft
  block: 16 regions, 16 layer files, all already on Commons. It goes through the same
  parse → resolve → preview path as *Import wikitext*, so what you see is a real article's block,
  not a fixture. `demo/voyager-spacecraft.txt` holds the wikitext (fetched 2026-11-19).
- `applyBlock()` extracted from the import handler and shared with the sampler; layers resolve
  sequentially with a progress toast (16 Commons lookups, ~1.5 s here).
- **Fixed while wiring it:** importing a block overwrote its declared `original-width` /
  `original-height` with the file's intrinsic size. For the Voyager block that is 600×737 declared
  vs 726×892 actual — same aspect, so nothing looked broken, but every marker was computed against
  the wrong grid (~17% off). The coordinate space declared by the block now wins;
  `setBase(..., { keepUnits: true })` keeps the file size separately for geometry checks.
- Layer-canvas check now compares *aspect ratios* against the base file, not absolute pixels
  against the declared grid — a 2× layer aligns fine, a different ratio does not, and the old rule
  flagged all 16 correct layers.
- New check: the declared grid's ratio vs the file's own ratio, so a genuinely mismatched block is
  reported instead of silently shifting.

## v1.1.0 — 2026-11-19

Multilingual from the start: the tool now has an interface language and a target-wiki dialect,
chosen independently, and neither is hard-coded in the logic.

- `i18n.js` — two parallel tables: `I18N.ui.<code>` (152 interface strings) and
  `I18N.wikis.<code>` (template name, parameter names, accepted values, module defaults, doc and
  stylesheet pages) for **en** (`{{Interactive image}}`) and **eu** (`{{Irudi interaktiboa}}`).
- Interface selector and target-wiki selector in the step bar. The target follows the interface
  language until one is picked explicitly; both persist in `localStorage`.
- Export/import are dialect-aware in both directions: the exporter writes the target wiki's
  parameter names and values, the importer accepts any known dialect and retargets when the block
  names another wiki's template. Field labels in the editor follow the target dialect
  (`N-izena`, `N-etiketua`, …), the preview uses that wiki's default note/credit strings, and
  the wiki links point at the right project.
- `check-i18n.js` (`node check-i18n.js`) fails when a language or dialect is incomplete.
- Fixed while doing this: wiki URLs used `encodeURIComponent`, which mangled subpage titles into
  `Txantiloi%3A…`; the expert-mode button label was still hard-coded; an imported block that
  retargeted the wiki did not refresh the export note.

Basque interface strings are mine, not a native speaker's — corrections belong in `i18n.js`.

## v1.0.0 — 2026-11-19

First committed state: the guided workbench.

- Four-step guided flow (choose image → place regions → describe them → export), with *Next*
  refusing to advance without the prerequisite, and **Show all panels** for the free-form
  three-panel layout.
- Base image from a Commons file name, a local upload, or a URL; `original-width` /
  `original-height` filled from the file's natural size.
- Click-to-place markers with drag, arrow-key nudging and a live coordinate readout; coordinates
  stored in file units, never percentages.
- Per-region name / label / text / layer file / link; layer attachments from Commons or a local
  file, with a canvas-size comparison against the base.
- Live preview built from the template's own `template-styles.css` and the same markup the Lua
  module emits (legend-first sibling order, card placement classes, Commons credit box), with a
  360 px mobile viewport toggle.
- Wikitext export (aligned, explicit `original-width` / `original-height`, per-item `N-x` / `N-y`)
  and import of an existing block in English or Basque parameter names, round-tripping
  byte-identically.
- Project save/load as JSON, with local uploads inlined as data URLs.

### Pre-history (built and fixed before this repo existed)

Written in one session; these were the defects found by testing rather than by reading the code.
Recorded here so the reasoning survives even though there are no commits for them:

- **Empty state covered the loaded image** — an author `display:grid` rule outranked the UA
  `[hidden]` rule; fixed with an explicit `.frame .empty[hidden]{display:none}`.
- **Export/import lost coordinates** — the item-key regex did not accept `x` / `y`, so a
  round-trip silently dropped every marker position.
- **English `image=` was dropped on import** — only the Basque `irudia` was mapped to the layer
  field.
- **Basque blocks were rejected outright** — the parser matched only `Interactive image`.
- **Header count was stale** — the status line was only written on image load, not on region add
  or delete.
- **Export put x and y on one padded line** — split onto separate aligned lines.
