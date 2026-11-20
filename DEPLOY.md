# Deploying on Toolforge (Build Service)

**Status: deployed.** The tool is live at <https://interactive-image-maker.toolforge.org>, built from
`https://github.com/wikibutler/interactive-image-maker`. This document is the reproducible path to
that state.

The tool is a static page, so the container only runs a small standard-library
file server (`app.py`). Nothing is installed at build time, there is no database and
no credentials, and the build takes about a minute.

`Procfile`, `requirements.txt` (comment-only, so the Python buildpack recognises the
project) and `.python-version` are already in the repository. The repository must be
**public** for Toolforge to build from it — it is.

## One-time setup

1. Create the tool at <https://toolsadmin.wikimedia.org/tools/create>. This one is
   `interactive-image-maker` (the URL becomes `https://interactive-image-maker.toolforge.org`). Tool
   names are lowercase letters, digits and hyphens.
2. Give the maintainers Toolforge accounts with access to the tool.
3. Nothing else: no `toolforge envvars`, no NFS layout, no virtualenv.

## Before you build

CI runs the suite on every push; locally:

```bash
npm run check     # static, seconds
npm test          # browser, needs network (live Commons API)
```

A build from a red commit bakes the bug into the image — the v1.7.2 deploy shipped a dead
**Load sample** button that way.

## First deploy

```bash
ssh <your-shell-username>@login.toolforge.org
become interactive-image-maker

# build the image straight from the public repository
toolforge build start https://github.com/wikibutler/interactive-image-maker

# wait for "ok (Succeeded)"
toolforge build show

# start the web process (Procfile: web: python3 app.py)
toolforge webservice buildservice start --mount=none -m 512Mi
```

`--mount=none` is deliberate: the app reads nothing from NFS. 512 Mi is generous for a
file server; the default 512 Mi is fine, `1Gi` unnecessary.

### What success looks like

`toolforge build show` ends with `Status: ok` and a digest, and the export step names the image:

```
Saving tools-harbor.wmcloud.org/tool-interactive-image-maker/tool-interactive-image-maker:latest...
*** Images (sha256:83e7847f…):
Status: ok
```

`webservice buildservice start` prints `Starting webservice…` and then goes quiet. The first request
can return 503 for up to a minute while the pod comes up — that is normal, not a broken build.
The response header `server: interactive-image-maker/1.0 Python/3.12` is proof the image is the one
you think it is.

Check it:

```bash
curl -s https://interactive-image-maker.toolforge.org/healthz        # → ok
curl -s -o /dev/null -w '%{http_code}\n' https://interactive-image-maker.toolforge.org/
toolforge webservice buildservice status
```

## Updating

```bash
git push origin main                     # from your machine
become interactive-image-maker
toolforge build start https://github.com/wikibutler/interactive-image-maker
toolforge build show                     # wait for ok (Succeeded)
toolforge webservice buildservice restart
```

HTML is served with `Cache-Control: no-cache`, so a reload shows the new build
immediately; CSS/JS carry a 5-minute cache.

## Notes and traps

- **`.python-version`, not `runtime.txt`.** Current Heroku Python buildpacks reject
  `runtime.txt` outright. The file holds `3.12` — major.minor only. If a build complains that the
  version is unavailable on the stack, delete the file and let the platform pick its default.
- **A Python project needs `requirements.txt`.** Without it the buildpack does not
  detect Python at all; this one is comment-only because the app is stdlib-only.
- **Bind `0.0.0.0:$PORT`.** `app.py` reads `PORT` from the environment and defaults to
  8811 for local use. Never hard-code the port.
- **Directory listings are disabled** in `app.py`; the repository root is otherwise
  fully public (it is a public repo already).
- **Licence.** Toolforge requires an OSI-approved licence for tool code — see `LICENSE`
  (MIT). The copied `template-styles.css` is CC BY-SA 4.0 and is declared in `NOTICE.md`.
- **Logs:** `toolforge webservice buildservice logs` (or `kubectl logs -f
  deployment/interactive-image-maker`) show the request log; `X-Content-Type-Options` and
  `Cache-Control` are set per request in `app.py`.

## Running the same thing locally

```bash
python3 app.py                 # http://127.0.0.1:8811
PORT=9000 python3 app.py       # any port
```

That is the identical code path the container runs, which is why a deploy rarely
surprises.
