# Changelog

Dates are UTC. The project is a static app — every commit is a working tree that can be served
as-is, so any version can be revisited with `git checkout <sha>`.

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
