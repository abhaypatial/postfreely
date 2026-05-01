"""PostFreely — DB: Collections"""
import shlex
import uuid
from urllib.parse import urlparse
from datetime import datetime

import db_cloud
from db_init import read, write

def get_all(owner_id=None):
    if db_cloud.enabled() and owner_id:
        return db_cloud.list_collections(owner_id)
    return read("collections")

def get_one(cid, owner_id=None): return get_all(owner_id=owner_id).get(cid)

def save(col, owner_id=None):
    if db_cloud.enabled() and owner_id:
        return db_cloud.save_collection(col, owner_id)
    data = get_all(); data[col["id"]] = col; write("collections", data); return col

def delete(cid, owner_id=None):
    if db_cloud.enabled() and owner_id:
        db_cloud.delete_collection(cid, owner_id)
        return
    data = get_all(); data.pop(cid, None); write("collections", data)

def add_request(cid, req, owner_id=None):
    data = get_all(owner_id=owner_id)
    if cid not in data: return None
    req.setdefault("id", str(uuid.uuid4()))
    data[cid]["requests"].append(req)
    save(data[cid], owner_id=owner_id)
    return req

def update_request(cid, rid, req, owner_id=None):
    data = get_all(owner_id=owner_id)
    if cid not in data: return None
    for i, r in enumerate(data[cid]["requests"]):
        if r["id"] == rid:
            req["id"] = rid; data[cid]["requests"][i] = req
            save(data[cid], owner_id=owner_id)
            return req
    return None

def delete_request(cid, rid, owner_id=None):
    data = get_all(owner_id=owner_id)
    if cid not in data: return
    data[cid]["requests"] = [r for r in data[cid]["requests"] if r["id"] != rid]
    save(data[cid], owner_id=owner_id)

def update_variables(cid, variables, owner_id=None):
    data = get_all(owner_id=owner_id)
    if cid not in data: return None
    data[cid]["variables"] = variables
    return save(data[cid], owner_id=owner_id)

def import_postman(raw, owner_id=None):
    name = raw.get("info", {}).get("name", "Imported")
    col_id = str(uuid.uuid4()); requests = []

    def script_from_events(events, listen):
        for event in events or []:
            if event.get("listen") != listen:
                continue
            script = event.get("script") or {}
            exec_lines = script.get("exec", "")
            if isinstance(exec_lines, list):
                return "\n".join(str(line) for line in exec_lines)
            if isinstance(exec_lines, str):
                return exec_lines
        return ""

    def import_variables(items):
        variables = {}
        for item in items or []:
            if not isinstance(item, dict):
                continue
            key = item.get("key")
            if key:
                variables[str(key)] = item.get("value", "")
        return variables

    def import_auth(auth):
        if not isinstance(auth, dict):
            return {"type": "none"}
        atype = auth.get("type", "none")
        rows = auth.get(atype, [])
        values = {}
        if isinstance(rows, list):
            values = {row.get("key"): row.get("value", "") for row in rows if isinstance(row, dict)}
        if atype == "bearer":
            return {"type": "bearer", "token": values.get("token", "")}
        if atype == "basic":
            return {"type": "basic", "username": values.get("username", ""), "password": values.get("password", "")}
        if atype in ("apikey", "apiKey"):
            return {
                "type": "apikey",
                "key_name": values.get("key", values.get("key_name", "X-API-Key")),
                "key_value": values.get("value", values.get("key_value", "")),
                "in": values.get("in", "header"),
            }
        if atype == "oauth2":
            return {"type": "oauth2", "token": values.get("accessToken", values.get("token", ""))}
        return {"type": "none"}

    collection_prescript = script_from_events(raw.get("event", []), "prerequest")
    collection_postscript = script_from_events(raw.get("event", []), "test")

    def extract(items, folder=None):
        for item in items:
            if "item" in item: extract(item["item"], item.get("name", folder)); continue
            req = item.get("request") or item
            if not req: continue
            url = req.get("url", "")
            if isinstance(url, dict):
                url = url.get("raw", "")
                if url and "?" in url and urlparse(url).query:
                    url = url.split("?", 1)[0]
            method  = req.get("method", "GET").upper()
            headers = [[h["key"], h.get("value","")] for h in req.get("header",[]) if not h.get("disabled")]
            body    = ""
            bd      = req.get("body") or {}
            if bd.get("mode") == "raw":        body = bd.get("raw","")
            elif bd.get("mode") == "urlencoded": body = "&".join(f"{p['key']}={p.get('value','')}" for p in bd.get("urlencoded",[]))
            body_type = "json"
            if bd.get("mode") == "urlencoded":
                body_type = "form"
            elif bd.get("mode") == "raw":
                raw_lang = ((bd.get("options") or {}).get("raw") or {}).get("language", "")
                if raw_lang in ("json", "xml", "text", "graphql"):
                    body_type = raw_lang
            params  = []
            if isinstance(req.get("url"), dict):
                params = [[q["key"],q.get("value","")] for q in req["url"].get("query",[]) if not q.get("disabled")]
            prescript = "\n".join(
                part for part in (
                    collection_prescript,
                    script_from_events(item.get("event", []), "prerequest"),
                ) if part.strip()
            )
            postscript = "\n".join(
                part for part in (
                    collection_postscript,
                    script_from_events(item.get("event", []), "test"),
                ) if part.strip()
            )
            requests.append({"id":str(uuid.uuid4()),"name":item.get("name",url[:40]),
                "method":method,"url":url,"params":params,"headers":headers,
                "body":body,"body_type":body_type,"bodyType":body_type,
                "auth":import_auth(req.get("auth")),"folder":folder,
                "prescript":prescript,"postscript":postscript})
    extract(raw.get("item", []))
    col = {"id":col_id,"name":name,"description":raw.get("info",{}).get("description",""),
           "created":datetime.utcnow().isoformat(),"variables":import_variables(raw.get("variable", [])),"requests":requests,
           "docs_url":"","docs_notes":"","allow_ai_doc_fetch":False,"ai_sources":[]}
    save(col, owner_id=owner_id); return col

def import_curl(raw, name=None, owner_id=None):
    command = (raw or "").strip()
    if not command:
        raise ValueError("cURL command is empty")

    try:
        tokens = shlex.split(command, posix=True)
    except ValueError:
        tokens = shlex.split(command, posix=False)

    if tokens and tokens[0].lower() == "curl":
        tokens = tokens[1:]
    if not tokens:
        raise ValueError("No cURL arguments found")

    method = "GET"
    url = ""
    headers = []
    body_parts = []
    auth = {"type": "none"}

    i = 0
    while i < len(tokens):
        token = tokens[i]

        if token in ("-X", "--request") and i + 1 < len(tokens):
            method = tokens[i + 1].upper()
            i += 2
            continue

        if token in ("-H", "--header") and i + 1 < len(tokens):
            header = tokens[i + 1]
            if ":" in header:
                key, value = header.split(":", 1)
                headers.append([key.strip(), value.strip()])
            i += 2
            continue

        if token in ("-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "-F", "--form") and i + 1 < len(tokens):
            body_parts.append(tokens[i + 1])
            if method == "GET":
                method = "POST"
            i += 2
            continue

        if token in ("-u", "--user") and i + 1 < len(tokens):
            creds = tokens[i + 1]
            username, _, password = creds.partition(":")
            auth = {"type": "basic", "username": username, "password": password}
            i += 2
            continue

        if token == "--url" and i + 1 < len(tokens):
            url = tokens[i + 1]
            i += 2
            continue

        if token.startswith("http://") or token.startswith("https://"):
            url = token
            i += 1
            continue

        if not token.startswith("-") and not url:
            url = token
            i += 1
            continue

        i += 1

    if not url:
        raise ValueError("Could not find a URL in the cURL command")

    body = "&".join(body_parts)
    if body and not any(h[0].lower() == "content-type" for h in headers):
        looks_json = body.lstrip().startswith("{") or body.lstrip().startswith("[")
        headers.append(["Content-Type", "application/json" if looks_json else "application/x-www-form-urlencoded"])

    parsed = urlparse(url)
    default_name = (parsed.path.rstrip("/").split("/")[-1] or parsed.netloc or "Imported cURL").strip()
    req = {
        "id": str(uuid.uuid4()),
        "name": name or default_name or "Imported cURL",
        "method": method,
        "url": url,
        "params": [],
        "headers": headers,
        "body": body,
        "auth": auth,
        "folder": None,
    }
    col = {
        "id": str(uuid.uuid4()),
        "name": name or f"{req['name']} Collection",
        "description": "Imported from cURL",
        "created": datetime.utcnow().isoformat(),
        "variables": {},
        "docs_url": "",
        "docs_notes": "",
        "allow_ai_doc_fetch": False,
        "ai_sources": [],
        "requests": [req],
    }
    save(col, owner_id=owner_id)
    return col
