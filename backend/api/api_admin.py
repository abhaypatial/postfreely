"""PostFreely - API: admin helpers."""
import db_access
import db_cloud


def list_users(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    if not ctx.get("is_admin"):
        return {"status": 403, "data": {"error": "Admin access required"}}
    return {"data": db_cloud.list_profiles()}
