# Third-party material in this repository

## `template-styles.css`

This file is a **verbatim copy** of
[`Template:Interactive image/styles.css`](https://en.wikipedia.org/wiki/Template:Interactive_image/styles.css)
from English Wikipedia (revision of 2026-11-18), which is the stylesheet that makes
`{{Interactive image}}` work on-wiki.

- © Wikipedia contributors
- Licensed **CC BY-SA 4.0** — https://creativecommons.org/licenses/by-sa/4.0/
- **Not** covered by the repository's MIT licence (`LICENSE`).
- It is loaded into the preview iframe unchanged; the tool never edits it. Re-fetch a newer
  revision with `python3 refresh-template-css.py`, which rewrites the provenance header with the
  captured revision timestamp.

## Wikimedia content fetched at runtime

The tool resolves Commons file names through the Commons API
(`action=query&prop=imageinfo`) and displays thumbnails from `upload.wikimedia.org`. Nothing is
downloaded into the repository, re-hosted, or redistributed — the app only points at Commons, and
the wikitext it emits contains file names whose attribution lives on the file description pages.

The tool itself is not affiliated with or endorsed by the Wikimedia Foundation.
