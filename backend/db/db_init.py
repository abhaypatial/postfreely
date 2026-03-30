"""PostFreely — DB Init: seeds data/ files on first run."""
import copy
import json, os, uuid
from datetime import datetime

PROJECT_DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))
DATA_DIR = os.path.abspath(os.environ.get("POSTFREELY_DATA_DIR") or os.environ.get("DATA_DIR") or PROJECT_DATA_DIR)
DEFAULT_TIMEOUT_SECONDS = int(os.environ.get("POSTFREELY_DEFAULT_TIMEOUT_SECONDS") or 30)
DEFAULT_RUNNER_PARALLEL = int(os.environ.get("POSTFREELY_DEFAULT_RUNNER_PARALLEL") or 4)
MAX_HISTORY_ENTRIES = int(os.environ.get("POSTFREELY_MAX_HISTORY_ENTRIES") or 200)
FILES = {
    "collections":  "collections.json",
    "environments": "environments.json",
    "history":      "history.json",
    "settings":     "settings.json",
    "users":        "users.json",
}

def path(key): return os.path.join(DATA_DIR, FILES[key])

def read(key):
    p = path(key)
    if not os.path.exists(p): return {}
    with open(p) as f: return json.load(f)

def write(key, data):
    with open(path(key), "w") as f: json.dump(data, f, indent=2)

def _req(name, method, url, headers=None, body="", folder=None):
    return {"id": str(uuid.uuid4()), "name": name, "method": method,
            "url": url, "params": [], "headers": headers or [],
            "body": body, "auth": {"type": "none"}, "folder": folder}

def sample_collection():
    sid = str(uuid.uuid4())
    created = datetime.utcnow().isoformat()
    return {
        "id": sid,
        "name": "Sample Collection",
        "description": "Example requests to get you started.",
        "created": created,
        "variables": {},
        "docs_url": "",
        "docs_notes": "",
        "allow_ai_doc_fetch": False,
        "ai_sources": [],
        "requests": [
            _req("Get Users",   "GET",  "https://jsonplaceholder.typicode.com/users"),
            _req("Get Post",    "GET",  "https://jsonplaceholder.typicode.com/posts/1"),
            _req("Create Post", "POST", "https://jsonplaceholder.typicode.com/posts",
                 headers=[["Content-Type","application/json"]],
                 body='{"title":"foo","body":"bar","userId":1}'),
        ],
    }

def sample_environments():
    dev = str(uuid.uuid4()); prod = str(uuid.uuid4())
    return {
        "active": dev,
        "envs": {
            dev:  {"id": dev,  "name": "Development",
                   "variables": {"baseUrl": "http://localhost:3000", "apiKey": "dev-key-123", "token": "", "userId": "1"}},
            prod: {"id": prod, "name": "Production",
                   "variables": {"baseUrl": "https://api.example.com", "apiKey": "prod-key-abc", "token": "", "userId": ""}},
        }
    }

def default_settings():
    return {
        "theme": "dark",
        "background": "none",
        "bg_opacity": 0.18,
        "bg_size": "cover",
        "bg_pos_x": 50,
        "bg_pos_y": 50,
        "bg_blur": 0,
        "bg_bokeh": 18,
        "ai_provider": "",
        "ai_api_key": "",
        "ai_model": "",
        "ai_custom_url": "",
        "font_size": 13,
        "timeout": DEFAULT_TIMEOUT_SECONDS,
        "runner_parallel": DEFAULT_RUNNER_PARALLEL,
    }

def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(path("collections")):
        col = sample_collection()
        write("collections", {col["id"]: copy.deepcopy(col)})
    if not os.path.exists(path("environments")):
        write("environments", sample_environments())
    if not os.path.exists(path("history")):   write("history",  {"entries": []})
    if not os.path.exists(path("settings")):  write("settings", default_settings())
    if not os.path.exists(path("users")):     write("users", {"current": None, "accounts": {}})
