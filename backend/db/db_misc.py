"""PostFreely — DB: History / Settings / Users"""
import uuid
from datetime import datetime

import db_cloud
from db_init import read, write, default_settings, MAX_HISTORY_ENTRIES

# History
def add_history(e, owner_id=None):
    if db_cloud.enabled() and owner_id:
        return db_cloud.add_history(owner_id, e)
    data = read("history")
    e["id"] = str(uuid.uuid4()); e["timestamp"] = datetime.utcnow().isoformat()
    data.setdefault("entries",[]).insert(0,e); data["entries"]=data["entries"][:MAX_HISTORY_ENTRIES]
    write("history",data); return e

def get_history(owner_id=None):
    if db_cloud.enabled() and owner_id:
        return db_cloud.get_history(owner_id)
    return read("history").get("entries",[])

def clear_history(owner_id=None):
    if db_cloud.enabled() and owner_id:
        db_cloud.clear_history(owner_id)
        return
    write("history",{"entries":[]})

# Settings
def get_settings(owner_id=None):
    if db_cloud.enabled() and owner_id:
        return db_cloud.get_settings(owner_id)
    data = default_settings()
    data.update(read("settings"))
    return data

def update_settings(updates, owner_id=None):
    if db_cloud.enabled() and owner_id:
        return db_cloud.update_settings(owner_id, updates)
    data=read("settings"); data.update(updates); write("settings",data); return data

# Users
def get_current_user(): return read("users").get("current")
def save_user(user):
    data=read("users"); user.setdefault("id",str(uuid.uuid4()))
    data["current"]=user; data.setdefault("accounts",{})[user["id"]]=user
    write("users",data); return user
def logout_user():
    data=read("users"); data["current"]=None; write("users",data)
