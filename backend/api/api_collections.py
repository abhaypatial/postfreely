"""PostFreely - API: Collections"""
import json
import uuid
from datetime import datetime

import db_access
import db_collections


def _normalize_ai_sources(raw_sources):
    if not isinstance(raw_sources, list):
        return []
    cleaned = []
    for source in raw_sources:
        if not isinstance(source, dict):
            continue
        source_type = str(source.get("type", "note") or "note").strip().lower()
        if source_type not in ("url", "note", "file"):
            source_type = "note"
        content = str(source.get("content", "") or "").strip()
        if not content:
            continue
        cleaned.append(
            {
                "id": str(source.get("id") or uuid.uuid4()),
                "type": source_type,
                "label": str(source.get("label", "") or "").strip(),
                "content": content,
                "allow_fetch": bool(source.get("allow_fetch", False)) if source_type == "url" else False,
            }
        )
    return cleaned


def _legacy_ai_fields(ai_sources, body):
    docs_url = ""
    docs_notes = ""
    allow_fetch = False

    for source in ai_sources:
        if source["type"] == "url" and not docs_url:
            docs_url = source["content"]
            allow_fetch = bool(source.get("allow_fetch"))
            continue
        if source["type"] in ("note", "file"):
            block = source["content"]
            if source.get("label"):
                block = f"{source['label']}\n{block}"
            docs_notes = (docs_notes + "\n\n" + block).strip()

    if not docs_url:
        docs_url = body.get("docs_url", "")
    if not docs_notes:
        docs_notes = body.get("docs_notes", "")
    if not allow_fetch:
        allow_fetch = bool(body.get("allow_ai_doc_fetch", False))

    return docs_url, docs_notes[:6000], allow_fetch


def list_collections(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    return {"data": db_collections.get_all(owner_id=ctx["target_owner_id"])}


def create_collection(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    body = req["body"]
    ai_sources = _normalize_ai_sources(body.get("ai_sources", []))
    docs_url, docs_notes, allow_fetch = _legacy_ai_fields(ai_sources, body)
    col = {
        "id": str(uuid.uuid4()),
        "name": body.get("name", "New Collection"),
        "description": body.get("description", ""),
        "created": datetime.utcnow().isoformat(),
        "variables": body.get("variables", {}),
        "requests": body.get("requests", []),
        "docs_url": docs_url,
        "docs_notes": docs_notes,
        "allow_ai_doc_fetch": allow_fetch,
        "ai_sources": ai_sources,
    }
    return {"data": db_collections.save(col, owner_id=ctx["target_owner_id"])}


def update_collection(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    col = db_collections.get_one(req["params"]["id"], owner_id=ctx["target_owner_id"])
    if not col:
        return {"status": 404, "data": {"error": "Not found"}}

    body = req["body"]
    col["name"] = body.get("name", col["name"])
    col["description"] = body.get("description", col.get("description", ""))

    if "ai_sources" in body:
        col["ai_sources"] = _normalize_ai_sources(body.get("ai_sources", []))
        docs_url, docs_notes, allow_fetch = _legacy_ai_fields(col["ai_sources"], body)
        col["docs_url"] = docs_url
        col["docs_notes"] = docs_notes
        col["allow_ai_doc_fetch"] = allow_fetch
    else:
        col["docs_url"] = body.get("docs_url", col.get("docs_url", ""))
        col["docs_notes"] = body.get("docs_notes", col.get("docs_notes", ""))
        col["allow_ai_doc_fetch"] = bool(body.get("allow_ai_doc_fetch", col.get("allow_ai_doc_fetch", False)))
        col.setdefault("ai_sources", [])

    return {"data": db_collections.save(col, owner_id=ctx["target_owner_id"])}


def delete_collection(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    db_collections.delete(req["params"]["id"], owner_id=ctx["target_owner_id"])
    return {"data": {"ok": True}}


def add_request(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    cid = req["params"]["id"]
    body = req["body"]
    body.setdefault("id", str(uuid.uuid4()))
    body.setdefault("method", "GET")
    body.setdefault("url", "")
    body.setdefault("params", [])
    body.setdefault("headers", [])
    body.setdefault("body", "")
    body.setdefault("auth", {"type": "none"})
    body.setdefault("folder", None)
    result = db_collections.add_request(cid, body, owner_id=ctx["target_owner_id"])
    return {"data": result} if result else {"status": 404, "data": {"error": "Collection not found"}}


def update_request(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    result = db_collections.update_request(
        req["params"]["cid"], req["params"]["rid"], req["body"], owner_id=ctx["target_owner_id"]
    )
    return {"data": result} if result else {"status": 404, "data": {"error": "Not found"}}


def delete_request(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    db_collections.delete_request(req["params"]["cid"], req["params"]["rid"], owner_id=ctx["target_owner_id"])
    return {"data": {"ok": True}}


def update_variables(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    cid = req["params"]["id"]
    result = db_collections.update_variables(cid, req["body"].get("variables", {}), owner_id=ctx["target_owner_id"])
    return {"data": result} if result else {"status": 404, "data": {"error": "Not found"}}


def import_collection(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    body = req["body"]
    try:
        fmt = (body.get("format") if isinstance(body, dict) else None) or ""
        if fmt == "curl":
            raw = body.get("raw") or body.get("_raw") or ""
            col = db_collections.import_curl(raw, body.get("name"), owner_id=ctx["target_owner_id"])
            return {"data": col}

        if isinstance(body, str):
            raw = json.loads(body)
        elif "_raw" in body:
            raw = json.loads(body["_raw"])
        else:
            raw = body

        if isinstance(raw, str) and raw.lstrip().lower().startswith("curl "):
            col = db_collections.import_curl(raw, body.get("name") if isinstance(body, dict) else None)
            return {"data": col}
        if "collection" in raw and isinstance(raw["collection"], dict):
            raw = raw["collection"]
        if "item" not in raw and "info" not in raw:
            return {"status": 400, "data": {"error": "Not a valid collection JSON (missing 'item' or 'info')"}}
        col = db_collections.import_postman(raw, owner_id=ctx["target_owner_id"])
        return {"data": col}
    except json.JSONDecodeError as exc:
        return {"status": 400, "data": {"error": f"Invalid JSON: {exc}"}}
    except Exception as exc:
        import traceback

        traceback.print_exc()
        return {"status": 400, "data": {"error": f"Import failed: {exc}"}}
