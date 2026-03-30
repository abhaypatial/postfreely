"""
PostFreely — HTTP Router
Maps every URL to an API handler or serves a static frontend file.
"""
import json, os, mimetypes
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import api_collections, api_environments, api_proxy, api_runner
import api_history, api_settings, api_users, api_ai, api_public, api_admin
import db_cloud

FRONTEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
)

ROUTES = {
    "GET    /api/public/config":                       api_public.get_public_config,
    "GET    /api/collections":                        api_collections.list_collections,
    "POST   /api/collections":                        api_collections.create_collection,
    "PUT    /api/collections/:id":                    api_collections.update_collection,
    "DELETE /api/collections/:id":                    api_collections.delete_collection,
    "POST   /api/collections/:id/requests":           api_collections.add_request,
    "PUT    /api/collections/:cid/requests/:rid":     api_collections.update_request,
    "DELETE /api/collections/:cid/requests/:rid":     api_collections.delete_request,
    "POST   /api/collections/import":                 api_collections.import_collection,
    "PUT    /api/collections/:id/variables":          api_collections.update_variables,
    "GET    /api/environments":                       api_environments.list_envs,
    "POST   /api/environments":                       api_environments.create_env,
    "PUT    /api/environments/:id":                   api_environments.update_env,
    "DELETE /api/environments/:id":                   api_environments.delete_env,
    "POST   /api/environments/:id/activate":          api_environments.activate_env,
    "POST   /api/proxy":                              api_proxy.send_request,
    "POST   /api/runner":                             api_runner.run_collection,
    "GET    /api/runner/:id":                         api_runner.get_collection_run,
    "POST   /api/runner/stop":                        api_runner.stop_collection_run,
    "GET    /api/history":                            api_history.get_history,
    "POST   /api/history":                            api_history.add_history,
    "DELETE /api/history":                            api_history.clear_history,
    "GET    /api/settings":                           api_settings.get_settings,
    "PUT    /api/settings":                           api_settings.update_settings,
    "POST   /api/auth/login":                         api_users.login,
    "POST   /api/auth/signup":                        api_users.signup,
    "POST   /api/auth/refresh":                       api_users.refresh,
    "POST   /api/auth/logout":                        api_users.logout,
    "GET    /api/auth/me":                            api_users.me,
    "GET    /api/auth/google/url":                    api_users.google_url,
    "GET    /api/admin/users":                        api_admin.list_users,
    "POST   /api/ai/chat":                            api_ai.chat,
    "POST   /api/ai/analyze":                         api_ai.analyze_response,
    "POST   /api/ai/generate":                        api_ai.generate_request,
    "POST   /api/ai/fix":                             api_ai.suggest_fix,
}

PAGE_ALIASES = {
    "/runner":   "pages/runner.html",
    "/settings": "pages/settings.html",
}

class PostFreelyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.command:<7} {self.path.split('?')[0]:<40} {args[1]}")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")

    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    do_GET    = lambda self: self._handle("GET")
    do_POST   = lambda self: self._handle("POST")
    do_PUT    = lambda self: self._handle("PUT")
    do_DELETE = lambda self: self._handle("DELETE")

    def _handle(self, method):
        parsed = urlparse(self.path)
        path   = parsed.path.rstrip("/") or "/"
        qs     = parse_qs(parsed.query)

        if method == "GET" and path == "/healthz":
            self._json(200, {
                "ok": True,
                "cloud_enabled": db_cloud.enabled(),
                "auth_enabled": db_cloud.auth_enabled(),
                "public_url_configured": bool(db_cloud.public_url()),
            })
            return

        if not path.startswith("/api"):
            self._serve_static(path); return

        body, length = {}, int(self.headers.get("Content-Length", 0))
        if length:
            raw = self.rfile.read(length)
            try:    body = json.loads(raw)
            except: body = {"_raw": raw.decode("utf-8", errors="replace")}

        fn, params = self._match(method, path)
        if fn is None:
            self._json(404, {"error": f"No route: {method} {path}"}); return

        ctx = {"method": method, "path": path, "params": params,
               "query": qs, "body": body, "headers": dict(self.headers)}
        try:
            result = fn(ctx)
            self._json(result.get("status", 200), result.get("data", {}))
        except PermissionError as exc:
            message = str(exc) or "Authentication required"
            status = 403 if "admin" in message.lower() or "denied" in message.lower() else 401
            self._json(status, {"error": message})
        except db_cloud.CloudError as exc:
            self._json(exc.status, {"error": str(exc), "details": exc.details})
        except Exception as exc:
            import traceback; traceback.print_exc()
            self._json(500, {"error": str(exc)})

    def _match(self, method, path):
        for pattern, fn in ROUTES.items():
            pm, pp = pattern.split(None, 1)
            pm, pp = pm.strip(), pp.strip()
            if pm != method: continue
            params = self._path_params(pp, path)
            if params is not None: return fn, params
        return None, {}

    def _path_params(self, pattern, path):
        pp, ap = pattern.split("/"), path.split("/")
        if len(pp) != len(ap): return None
        params = {}
        for seg, actual in zip(pp, ap):
            if seg.startswith(":"): params[seg[1:]] = actual
            elif seg != actual:     return None
        return params

    def _json(self, status, data):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type",   "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors(); self.end_headers(); self.wfile.write(body)

    def _serve_static(self, path):
        path  = PAGE_ALIASES.get(path, path)
        if path in ("/", ""): path = "/index.html"
        fpath = os.path.join(FRONTEND_DIR, path.lstrip("/"))
        if not os.path.isfile(fpath):
            fpath = os.path.join(FRONTEND_DIR, "index.html")
        try:
            with open(fpath, "rb") as f: content = f.read()
            mime, _ = mimetypes.guess_type(fpath)
            self.send_response(200)
            self.send_header("Content-Type",   mime or "text/html")
            self.send_header("Content-Length", str(len(content)))
            self._cors(); self.end_headers(); self.wfile.write(content)
        except Exception as exc:
            self._json(500, {"error": str(exc)})
