"""PostFreely — API: Settings"""
import db_access, db_misc
def get_settings(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    return {"data": db_misc.get_settings(owner_id=ctx["actor_id"])}
def update_settings(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    body = dict(req["body"] or {})
    body.pop("owner_id", None)
    return {"data": db_misc.update_settings(body, owner_id=ctx["actor_id"])}
