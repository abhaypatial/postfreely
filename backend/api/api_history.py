"""PostFreely history API."""
import db_access
import db_misc


def get_history(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    return {"data": db_misc.get_history(owner_id=ctx["target_owner_id"])}


def add_history(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    body = req.get("body") or {}
    entry = {
        "method": body.get("method", "GET"),
        "url": body.get("url", ""),
        "status_code": int(body.get("status_code") or 0),
        "elapsed_ms": int(body.get("elapsed_ms") or 0),
        "size_bytes": int(body.get("size_bytes") or 0),
    }
    return {"data": db_misc.add_history(entry, owner_id=ctx["target_owner_id"])}


def clear_history(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    db_misc.clear_history(owner_id=ctx["target_owner_id"])
    return {"data": {"ok": True}}
