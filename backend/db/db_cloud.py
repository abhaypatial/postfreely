"""PostFreely cloud storage + auth helpers for Supabase."""
import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime

from db_init import default_settings, sample_collection, sample_environments
from ssl_config import outbound_ssl_context, env_flag


class CloudError(RuntimeError):
    def __init__(self, message, status=500, details=None):
        super().__init__(message)
        self.status = status
        self.details = details or {}


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "").strip()
PUBLIC_URL = os.environ.get("POSTFREELY_PUBLIC_URL", "").rstrip("/")
ADMIN_EMAILS = {
    item.strip().lower()
    for item in os.environ.get("POSTFREELY_ADMIN_EMAILS", "").split(",")
    if item.strip()
}

TABLE_PROFILES = "pf_profiles"
TABLE_COLLECTIONS = "pf_collections"
TABLE_ENVIRONMENTS = "pf_environments"
TABLE_SETTINGS = "pf_user_settings"
TABLE_HISTORY = "pf_history"
_SSL_CTX = None


def enabled():
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY)


def public_url():
    return PUBLIC_URL


def google_enabled():
    return enabled() and env_flag("POSTFREELY_ENABLE_GOOGLE_AUTH", True)


def auth_enabled():
    return enabled()


def admin_email(email):
    return str(email or "").strip().lower() in ADMIN_EMAILS


def _ssl():
    global _SSL_CTX
    if _SSL_CTX is None:
        _SSL_CTX = outbound_ssl_context()
    return _SSL_CTX


def _json_request(method, url, *, headers=None, payload=None, timeout=30):
    req_headers = dict(headers or {})
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl()) as resp:
            raw = resp.read()
            if not raw:
                return resp.status, None, dict(resp.headers)
            try:
                return resp.status, json.loads(raw.decode("utf-8")), dict(resp.headers)
            except Exception:
                return resp.status, raw.decode("utf-8", errors="replace"), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        body = {}
        if raw:
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                body = {"error": raw.decode("utf-8", errors="replace")}
        message = (
            body.get("msg")
            or body.get("message")
            or body.get("error_description")
            or body.get("error")
            or f"Supabase request failed ({exc.code})"
        )
        raise CloudError(message, status=exc.code, details=body)
    except urllib.error.URLError as exc:
        reason = str(exc.reason)
        if "CERTIFICATE_VERIFY_FAILED" in reason or "certificate verify failed" in reason.lower():
            raise CloudError(
                "Supabase TLS validation failed. Check the project URL/certificate, or only for local self-signed testing set POSTFREELY_INSECURE_SSL=1.",
                status=503,
                details={"reason": reason},
            )
        raise CloudError(f"Supabase connection failed: {reason}", status=503)


def _service_headers(extra=None):
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    headers.update(extra or {})
    return headers


def _anon_headers(extra=None, access_token=None):
    token = access_token or SUPABASE_ANON_KEY
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}",
    }
    headers.update(extra or {})
    return headers


def _table_url(table, query=None):
    qs = urllib.parse.urlencode(query or {}, doseq=True)
    return f"{SUPABASE_URL}/rest/v1/{table}" + (f"?{qs}" if qs else "")


def _auth_url(path):
    return f"{SUPABASE_URL}/auth/v1/{path.lstrip('/')}"


def _eq(filters=None, **extra):
    merged = dict(filters or {})
    merged.update(extra)
    return {k: f"eq.{v}" for k, v in merged.items() if v not in (None, "")}


def _select(table, *, filters=None, select="*", order=None, limit=None):
    query = {"select": select}
    query.update(filters or {})
    if order:
        query["order"] = order
    if limit:
        query["limit"] = str(limit)
    _, data, _ = _json_request("GET", _table_url(table, query), headers=_service_headers())
    return data or []


def _select_one(table, *, filters=None, select="*"):
    rows = _select(table, filters=filters, select=select, limit=1)
    return rows[0] if rows else None


def _insert(table, rows, *, upsert=False):
    headers = {"Prefer": "return=representation"}
    if upsert:
        headers["Prefer"] = "resolution=merge-duplicates,return=representation"
    _, data, _ = _json_request(
        "POST",
        _table_url(table),
        headers=_service_headers(headers),
        payload=rows,
    )
    return data or []


def _update(table, values, *, filters=None):
    _, data, _ = _json_request(
        "PATCH",
        _table_url(table, filters or {}),
        headers=_service_headers({"Prefer": "return=representation"}),
        payload=values,
    )
    return data or []


def _delete(table, *, filters=None):
    _, data, _ = _json_request(
        "DELETE",
        _table_url(table, filters or {}),
        headers=_service_headers({"Prefer": "return=representation"}),
    )
    return data or []


def _jwt_expiry(access_token):
    try:
        payload = access_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")).decode("utf-8"))
        return int(data.get("exp") or 0)
    except Exception:
        return 0


def _profile_username(user):
    meta = user.get("user_metadata") or {}
    for key in ("username", "full_name", "name", "preferred_username", "display_name"):
        value = str(meta.get(key) or "").strip()
        if value:
            return value
    email = str(user.get("email") or "").strip()
    return email.split("@")[0] if "@" in email else "User"


def _profile_provider(user):
    app_meta = user.get("app_metadata") or {}
    identities = user.get("identities") or []
    if identities and isinstance(identities[0], dict):
        return str(identities[0].get("provider") or app_meta.get("provider") or "email")
    return str(app_meta.get("provider") or "email")


def _profile_payload(user):
    email = str(user.get("email") or "").strip()
    payload = {
        "id": user.get("id"),
        "email": email,
        "username": _profile_username(user),
        "provider": _profile_provider(user),
        "updated_at": datetime.utcnow().isoformat(),
    }
    if admin_email(email):
        payload["role"] = "admin"
    return payload


def sanitize_profile(row):
    if not row:
        return None
    return {
        "id": row.get("id"),
        "email": row.get("email", ""),
        "username": row.get("username") or row.get("email", "").split("@")[0] or "User",
        "provider": row.get("provider") or "email",
        "role": row.get("role") or ("admin" if admin_email(row.get("email")) else "user"),
        "is_admin": (row.get("role") == "admin") or admin_email(row.get("email")),
    }


def ensure_profile(user):
    if not enabled():
        return None
    payload = _profile_payload(user)
    rows = _insert(TABLE_PROFILES, [payload], upsert=True)
    profile = sanitize_profile(rows[0] if rows else payload)
    ensure_workspace(profile["id"])
    return profile


def get_profile(user_id):
    return sanitize_profile(_select_one(TABLE_PROFILES, filters=_eq(id=user_id)))


def list_profiles():
    rows = _select(TABLE_PROFILES, order="created_at.asc")
    return [sanitize_profile(row) for row in rows]


def ensure_workspace(owner_id):
    if not owner_id or not enabled():
        return
    settings_row = _select_one(TABLE_SETTINGS, filters=_eq(owner_id=owner_id))
    env_rows = _select(TABLE_ENVIRONMENTS, filters=_eq(owner_id=owner_id), limit=1)
    coll_rows = _select(TABLE_COLLECTIONS, filters=_eq(owner_id=owner_id), limit=1)
    if settings_row and env_rows and coll_rows:
        return

    env_map = sample_environments()
    env_rows_to_insert = []
    active_env_id = None
    for index, env in enumerate(env_map["envs"].values()):
        env_row = {
            "id": env["id"],
            "owner_id": owner_id,
            "name": env["name"],
            "variables": env.get("variables", {}),
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        env_rows_to_insert.append(env_row)
        if index == 0:
            active_env_id = env["id"]
    if env_rows_to_insert and not env_rows:
        _insert(TABLE_ENVIRONMENTS, env_rows_to_insert, upsert=True)

    if not settings_row:
        _insert(
            TABLE_SETTINGS,
            [
                {
                    "owner_id": owner_id,
                    "active_env_id": active_env_id,
                    "settings": default_settings(),
                    "created_at": datetime.utcnow().isoformat(),
                    "updated_at": datetime.utcnow().isoformat(),
                }
            ],
            upsert=True,
        )

    if not coll_rows:
        collection = sample_collection()
        _insert(
            TABLE_COLLECTIONS,
            [
                {
                    "id": collection["id"],
                    "owner_id": owner_id,
                    "name": collection["name"],
                    "description": collection.get("description", ""),
                    "variables": collection.get("variables", {}),
                    "requests": collection.get("requests", []),
                    "docs_url": collection.get("docs_url", ""),
                    "docs_notes": collection.get("docs_notes", ""),
                    "allow_ai_doc_fetch": bool(collection.get("allow_ai_doc_fetch", False)),
                    "ai_sources": collection.get("ai_sources", []),
                    "created_at": collection.get("created"),
                    "updated_at": collection.get("created"),
                }
            ],
            upsert=True,
        )


def login_password(email, password):
    _, data, _ = _json_request(
        "POST",
        _auth_url("token?grant_type=password"),
        headers=_anon_headers(),
        payload={"email": email, "password": password},
    )
    user = data.get("user") or {}
    profile = ensure_profile(user)
    return {"session": _session_payload(data), "user": profile}


def signup_password(email, password, username=""):
    payload = {"email": email, "password": password}
    username = str(username or "").strip()
    if username:
        payload["data"] = {"username": username}
    _, data, _ = _json_request(
        "POST",
        _auth_url("signup"),
        headers=_anon_headers(),
        payload=payload,
    )
    user = data.get("user") or {}
    profile = ensure_profile(user) if user.get("id") else None
    result = {
        "session": _session_payload(data),
        "user": profile,
        "needs_email_confirmation": not bool(data.get("session")),
        "message": "Account created. Check your inbox if email confirmation is enabled.",
    }
    return result


def refresh_session(refresh_token):
    _, data, _ = _json_request(
        "POST",
        _auth_url("token?grant_type=refresh_token"),
        headers=_anon_headers(),
        payload={"refresh_token": refresh_token},
    )
    user = data.get("user") or {}
    profile = ensure_profile(user) if user.get("id") else None
    return {"session": _session_payload(data), "user": profile}


def sign_out(access_token):
    _json_request("POST", _auth_url("logout"), headers=_anon_headers(access_token=access_token))
    return {"ok": True}


def get_user(access_token):
    _, data, _ = _json_request("GET", _auth_url("user"), headers=_anon_headers(access_token=access_token))
    profile = ensure_profile(data)
    return profile


def google_login_url(redirect_to="", state=""):
    if not enabled():
        raise CloudError("Google login is not configured.", status=400)
    target = redirect_to or (f"{PUBLIC_URL}/auth/callback.html" if PUBLIC_URL else "")
    params = {"provider": "google"}
    if target:
        params["redirect_to"] = target
    if state:
        params["state"] = state
    return f"{_auth_url('authorize')}?{urllib.parse.urlencode(params)}"


def _session_payload(data):
    access_token = data.get("access_token", "")
    return {
        "access_token": access_token,
        "refresh_token": data.get("refresh_token", ""),
        "token_type": data.get("token_type", "bearer"),
        "expires_in": int(data.get("expires_in") or 0),
        "expires_at": int(data.get("expires_at") or _jwt_expiry(access_token) or 0),
    }


def collection_row_to_api(row):
    return {
        "id": row.get("id"),
        "name": row.get("name", "Untitled Collection"),
        "description": row.get("description", ""),
        "created": row.get("created_at") or row.get("created"),
        "updated": row.get("updated_at"),
        "variables": row.get("variables") or {},
        "requests": row.get("requests") or [],
        "docs_url": row.get("docs_url", ""),
        "docs_notes": row.get("docs_notes", ""),
        "allow_ai_doc_fetch": bool(row.get("allow_ai_doc_fetch", False)),
        "ai_sources": row.get("ai_sources") or [],
        "owner_id": row.get("owner_id"),
    }


def environment_row_to_api(row):
    return {
        "id": row.get("id"),
        "name": row.get("name", "Environment"),
        "variables": row.get("variables") or {},
        "owner_id": row.get("owner_id"),
        "created": row.get("created_at"),
        "updated": row.get("updated_at"),
    }


def history_row_to_api(row):
    return {
        "id": row.get("id"),
        "method": row.get("method", "GET"),
        "url": row.get("url", ""),
        "status_code": int(row.get("status_code") or 0),
        "elapsed_ms": int(row.get("elapsed_ms") or 0),
        "size_bytes": int(row.get("size_bytes") or 0),
        "timestamp": row.get("timestamp"),
    }


def list_collections(owner_id):
    rows = _select(TABLE_COLLECTIONS, filters=_eq(owner_id=owner_id), order="created_at.asc")
    return {row["id"]: collection_row_to_api(row) for row in rows}


def get_collection(collection_id, owner_id):
    row = _select_one(TABLE_COLLECTIONS, filters=_eq(id=collection_id, owner_id=owner_id))
    return collection_row_to_api(row) if row else None


def save_collection(collection, owner_id):
    payload = {
        "id": collection["id"],
        "owner_id": owner_id,
        "name": collection.get("name", "New Collection"),
        "description": collection.get("description", ""),
        "variables": collection.get("variables", {}),
        "requests": collection.get("requests", []),
        "docs_url": collection.get("docs_url", ""),
        "docs_notes": collection.get("docs_notes", ""),
        "allow_ai_doc_fetch": bool(collection.get("allow_ai_doc_fetch", False)),
        "ai_sources": collection.get("ai_sources", []),
        "created_at": collection.get("created") or datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    rows = _insert(TABLE_COLLECTIONS, [payload], upsert=True)
    return collection_row_to_api(rows[0] if rows else payload)


def delete_collection(collection_id, owner_id):
    _delete(TABLE_COLLECTIONS, filters=_eq(id=collection_id, owner_id=owner_id))


def list_environments(owner_id):
    rows = _select(TABLE_ENVIRONMENTS, filters=_eq(owner_id=owner_id), order="created_at.asc")
    state = get_workspace_state(owner_id)
    envs = {row["id"]: environment_row_to_api(row) for row in rows}
    return {"active": state.get("active_env_id"), "envs": envs}


def get_environment(env_id, owner_id):
    row = _select_one(TABLE_ENVIRONMENTS, filters=_eq(id=env_id, owner_id=owner_id))
    return environment_row_to_api(row) if row else None


def save_environment(env, owner_id):
    payload = {
        "id": env["id"],
        "owner_id": owner_id,
        "name": env.get("name", "Environment"),
        "variables": env.get("variables", {}),
        "created_at": env.get("created") or datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    rows = _insert(TABLE_ENVIRONMENTS, [payload], upsert=True)
    return environment_row_to_api(rows[0] if rows else payload)


def delete_environment(env_id, owner_id):
    _delete(TABLE_ENVIRONMENTS, filters=_eq(id=env_id, owner_id=owner_id))
    state = get_workspace_state(owner_id)
    if state.get("active_env_id") == env_id:
        remaining = _select(TABLE_ENVIRONMENTS, filters=_eq(owner_id=owner_id), order="created_at.asc", limit=1)
        set_active_environment(owner_id, remaining[0]["id"] if remaining else None)


def get_workspace_state(owner_id):
    row = _select_one(TABLE_SETTINGS, filters=_eq(owner_id=owner_id))
    if row:
        return row
    settings = {
        "owner_id": owner_id,
        "active_env_id": None,
        "settings": default_settings(),
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    rows = _insert(TABLE_SETTINGS, [settings], upsert=True)
    return rows[0] if rows else settings


def set_active_environment(owner_id, env_id):
    rows = _update(
        TABLE_SETTINGS,
        {"active_env_id": env_id, "updated_at": datetime.utcnow().isoformat()},
        filters=_eq(owner_id=owner_id),
    )
    if rows:
        return rows[0]
    return get_workspace_state(owner_id)


def get_settings(owner_id):
    row = get_workspace_state(owner_id)
    data = default_settings()
    data.update(row.get("settings") or {})
    return data


def update_settings(owner_id, updates):
    row = get_workspace_state(owner_id)
    data = default_settings()
    data.update(row.get("settings") or {})
    data.update(updates or {})
    rows = _update(
        TABLE_SETTINGS,
        {"settings": data, "updated_at": datetime.utcnow().isoformat()},
        filters=_eq(owner_id=owner_id),
    )
    return (rows[0].get("settings") if rows else data) or data


def add_history(owner_id, entry):
    payload = {
        "id": str(uuid.uuid4()),
        "owner_id": owner_id,
        "method": entry.get("method", "GET"),
        "url": entry.get("url", ""),
        "status_code": int(entry.get("status_code") or 0),
        "elapsed_ms": int(entry.get("elapsed_ms") or 0),
        "size_bytes": int(entry.get("size_bytes") or 0),
        "timestamp": datetime.utcnow().isoformat(),
    }
    rows = _insert(TABLE_HISTORY, [payload], upsert=False)
    return history_row_to_api(rows[0] if rows else payload)


def get_history(owner_id, limit=200):
    rows = _select(TABLE_HISTORY, filters=_eq(owner_id=owner_id), order="timestamp.desc", limit=limit)
    return [history_row_to_api(row) for row in rows]


def clear_history(owner_id):
    _delete(TABLE_HISTORY, filters=_eq(owner_id=owner_id))
