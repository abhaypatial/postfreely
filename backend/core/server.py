"""
PostFreely server entry point.
Run from project root: python backend/core/server.py
"""
import os
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _load_env_file(path):
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            os.environ[key] = value


_load_env_file(os.path.join(ROOT, ".env"))

for p in [
    ROOT,
    os.path.join(ROOT, "backend", "core"),
    os.path.join(ROOT, "backend", "api"),
    os.path.join(ROOT, "backend", "db"),
    os.path.join(ROOT, "backend", "utils"),
]:
    if p not in sys.path:
        sys.path.insert(0, p)

from http.server import ThreadingHTTPServer

from db_init import init_db
from router import PostFreelyHandler
from ssl_config import outbound_ssl_mode


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", 5000))


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), PostFreelyHandler)
    print("\n".join([
        "",
        "  ========================================",
        "  PostFreely running",
        f"  URL: http://{HOST}:{PORT}",
        f"  Outbound TLS: {outbound_ssl_mode()}",
        "  Health: /healthz",
        "  Ctrl+C to stop",
        "  ========================================",
        "",
    ]))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")


if __name__ == "__main__":
    main()
