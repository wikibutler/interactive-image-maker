# Deploying on Toolforge (Build Service)

The tool is a static page, so the container only runs a small standard-library
file server (`app.py`). Nothing is installed at build time, there is no database and
no credentials, and the build takes about a minute.

`Procfile`, `requirements.txt` (comment-only, so the Python buildpack recognises the
project) and `.python-version` are already in the repository. The repository must be
**public** for Toolforge to build from it — it is.

## One-time setup

1. Create the tool at <https://toolsadmin.wikimedia.org/tools/create>. Suggested name:
   `ii-maker` (the URL becomes `https://ii-maker.toolforge.org`). Tool names are
   lowercase letters, digits and hyphens.
2. Give the maintainers Toolforge accounts with access to the tool.
3. Nothing else: no `toolforge envvars`, no NFS layout, no virtualenv.

## First deploy

```bash
ssh <your-shell-username>@login.toolforge.org
become ii-maker

# build the image straight from the public repository
toolforge build start https://github.com/wikibutler/interactive-image-maker

# wait for "ok (Succeeded)"
toolforge build show

# start the web process (Procfile: web: python3 app.py)
toolforge webservice buildservice start --mount=none -m 512Mi
```

`--mount=none` is deliberate: the app reads nothing from NFS. 512 Mi is generous for a
file server; the default 512 Mi is fine, `1Gi` unnecessary.

Check it:

```bash
curl -s https://ii-maker.toolforge.org/healthz        # → ok
curl -s -o /dev/null -w '%{http_code}\n' https://ii-maker.toolforge.org/
toolforge webservice buildservice status
```

## Updating

```bash
git push origin main                     # from your machine
become ii-maker
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
  deployment/ii-maker`) show the request log; `X-Content-Type-Options` and
  `Cache-Control` are set per request in `app.py`.

## Running the same thing locally

```bash
python3 app.py                 # http://127.0.0.1:8811
PORT=9000 python3 app.py       # any port
```

That is the identical code path the container runs, which is why a deploy rarely
surprises.
