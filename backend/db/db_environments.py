"""PostFreely — DB: Environments"""
import uuid

import db_cloud
from db_init import read, write

def get_all(owner_id=None):
    if db_cloud.enabled() and owner_id:
        return db_cloud.list_environments(owner_id)
    return read("environments")

def get_active_id():
    return get_all().get("active")

def get_active_variables(owner_id=None):
    data   = get_all(owner_id=owner_id)
    env_id = data.get("active")
    if not env_id: return {}
    return data.get("envs", {}).get(env_id, {}).get("variables", {})

def get_variables(env_id, owner_id=None):
    data = get_all(owner_id=owner_id)
    if not env_id:
        return {}
    return data.get("envs", {}).get(env_id, {}).get("variables", {})

def set_active(env_id, owner_id=None):
    if db_cloud.enabled() and owner_id:
        db_cloud.set_active_environment(owner_id, env_id)
        return
    data = get_all(); data["active"] = env_id; write("environments", data)

def save(env, owner_id=None):
    if db_cloud.enabled() and owner_id:
        return db_cloud.save_environment(env, owner_id)
    data = get_all()
    data.setdefault("envs", {})[env["id"]] = env
    write("environments", data); return env

def delete(env_id, owner_id=None):
    if db_cloud.enabled() and owner_id:
        db_cloud.delete_environment(env_id, owner_id)
        return
    data = get_all()
    data.get("envs", {}).pop(env_id, None)
    if data.get("active") == env_id:
        remaining = list(data.get("envs", {}).keys())
        data["active"] = remaining[0] if remaining else None
    write("environments", data)
