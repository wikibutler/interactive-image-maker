#!/usr/bin/env python3
"""Static file server for the Interactive image workbench.

The app is a single page with no server-side logic, so this only has to serve the
repository read-only with correct MIME types, no directory listings, and a health
endpoint. Toolforge's Build Service runs it as the `web` process (see Procfile);
the platform supplies PORT and expects a bind on 0.0.0.0.

    python3 app.py                  # local: http://127.0.0.1:8811
    PORT=8080 python3 app.py        # what a container does
"""

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8811"))
HOST = os.environ.get("HOST", "0.0.0.0")

# text/html is served with no-cache so a redeploy is visible immediately; the
# copied TemplateStyles sheet and the demo block are stable within a revision.
CACHE = {
    ".html": "no-cache",
    ".css": "public, max-age=300",
    ".js": "public, max-age=300",
    ".txt": "public, max-age=300",
    ".png": "public, max-age=3600",
    ".svg": "public, max-age=3600",
}


class Handler(SimpleHTTPRequestHandler):
    server_version = "ii-workbench/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # a directory listing is a disclosure decision nobody asked for
    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def end_headers(self):
        path = self.path.split("?", 1)[0].lower()
        if path == "/healthz":
            pass
        elif path.endswith("/") or path.endswith(".html"):
            self.send_header("Cache-Control", CACHE[".html"])
        else:
            ext = os.path.splitext(path)[1]
            self.send_header("Cache-Control", CACHE.get(ext, "public, max-age=300"))
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/healthz":
            body = b"ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == "__main__":
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"serving {ROOT} on http://{HOST}:{PORT}/", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
