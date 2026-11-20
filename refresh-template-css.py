#!/usr/bin/env python3
"""Refresh template-styles.css from English Wikipedia.

The preview pane must render with the *real* TemplateStyles sheet, otherwise the
tool quietly previews its own guess at the interaction. Run this after the
template's styles change:

    python3 refresh-template-css.py

It rewrites template-styles.css (with a provenance header) and prints the
revision timestamp it captured.
"""
import json
import pathlib
import urllib.parse
import urllib.request

PAGE = "Template:Interactive image/styles.css"
API = "https://en.wikipedia.org/w/api.php"
UA = "HermesAgent/1.0 (https://en.wikipedia.org/wiki/User:Fuzheado) InteractiveImageMaker/1.0"
OUT = pathlib.Path(__file__).with_name("template-styles.css")


def main() -> None:
    q = urllib.parse.urlencode({
        "action": "query", "prop": "revisions", "titles": PAGE,
        "rvprop": "content|timestamp", "rvslots": "main",
        "format": "json", "formatversion": "2",
    })
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    rev = data["query"]["pages"][0]["revisions"][0]
    css = rev["slots"]["main"]["content"]
    ts = rev["timestamp"]
    header = (
        "/* Template:Interactive image/styles.css — fetched verbatim from English Wikipedia\n"
        f" * revision as of {ts} (UTC), page https://en.wikipedia.org/wiki/{PAGE.replace(' ', '_')}\n"
        " * © Wikipedia contributors, CC BY-SA 4.0. Only the preview stylesheet is copied here;\n"
        " * this file is NOT edited by the tool (the template uses the wiki copy).\n"
        " * Refresh with: python3 refresh-template-css.py\n */\n"
    )
    OUT.write_text(header + css, encoding="utf-8")
    print(f"wrote {OUT} ({len(css)} css chars), revision {ts}")


if __name__ == "__main__":
    main()
