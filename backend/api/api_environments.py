"""PostFreely — API: Environments"""
import uuid
import db_access
import db_environments

def list_envs(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    return {"data": db_environments.get_all(owner_id=ctx["target_owner_id"])}

def create_env(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    b = req["body"]
    env = {"id":str(uuid.uuid4()),"name":b.get("name","New Environment"),"variables":b.get("variables",{})}
    return {"data": db_environments.save(env, owner_id=ctx["target_owner_id"])}

def update_env(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    data = db_environments.get_all(owner_id=ctx["target_owner_id"])
    env  = data.get("envs",{}).get(req["params"]["id"])
    if not env: return {"status":404,"data":{"error":"Not found"}}
    b = req["body"]
    env["name"]      = b.get("name",      env["name"])
    env["variables"] = b.get("variables", env.get("variables",{}))
    return {"data": db_environments.save(env, owner_id=ctx["target_owner_id"])}

def delete_env(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    db_environments.delete(req["params"]["id"], owner_id=ctx["target_owner_id"]); return {"data":{"ok":True}}

def activate_env(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    env_id = req["params"]["id"]
    db_environments.set_active(env_id, owner_id=ctx["target_owner_id"])
    return {"data":{"active": env_id}}
