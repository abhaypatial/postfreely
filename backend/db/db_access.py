"""PostFreely auth/access context helpers."""
import time

import db_cloud
import db_misc


_TOKEN_CACHE = {}
_TOKEN_CACHE_TTL_SECONDS = 240


def public_config():
    return {
        "cloud_enabled": db_cloud.enabled(),
        "auth_required": db_cloud.auth_enabled(),
        "google_auth_enabled": db_cloud.google_enabled(),
        "password_auth_enabled": True,
        "signup_enabled": True,
        "public_url": db_cloud.public_url(),
        "admin_emails_configured": bool(db_cloud.ADMIN_EMAILS),
    }


def _bearer(req):
    headers = (req or {}).get("headers") or {}
    raw = headers.get("Authorization") or headers.get("authorization") or ""
    if not raw.lower().startswith("bearer "):
        return ""
    return raw.split(" ", 1)[1].strip()


def _requested_owner_id(req):
    body = (req or {}).get("body") or {}
    query = (req or {}).get("query") or {}
    if isinstance(body, dict) and body.get("owner_id"):
        return str(body.get("owner_id")).strip()
    values = query.get("owner_id") or []
    if values:
        return str(values[0]).strip()
    return ""


def _cached_user(access_token):
    cached = _TOKEN_CACHE.get(access_token)
    if not cached:
        return None
    if cached["expires_at"] < time.time():
        _TOKEN_CACHE.pop(access_token, None)
        return None
    return cached["user"]


def _set_cached_user(access_token, user):
    _TOKEN_CACHE[access_token] = {
        "user": user,
        "expires_at": time.time() + _TOKEN_CACHE_TTL_SECONDS,
    }


def _cloud_actor(req):
    access_token = _bearer(req)
    if not access_token:
        return None
    cached = _cached_user(access_token)
    if cached:
        return cached
    user = db_cloud.get_user(access_token)
    _set_cached_user(access_token, user)
    return user


def clear_token_cache(access_token):
    if access_token:
        _TOKEN_CACHE.pop(access_token, None)


def request_context(req, require_auth=False):
    override = (req or {}).get("_pf_context")
    if override:
        target_owner_id = override.get("target_owner_id") or override.get("actor_id")
        return {
            "mode": override.get("mode", "cloud" if db_cloud.enabled() else "local"),
            "user": override.get("user"),
            "actor_id": override.get("actor_id"),
            "target_owner_id": target_owner_id,
            "is_admin": bool(override.get("is_admin")),
            "cloud": bool(override.get("mode") == "cloud" or db_cloud.enabled()),
        }

    if db_cloud.enabled():
        user = _cloud_actor(req)
        if require_auth and not user:
            raise PermissionError("Authentication required")
        requested_owner_id = _requested_owner_id(req)
        if not user:
            return {
                "mode": "cloud",
                "cloud": True,
                "user": None,
                "actor_id": None,
                "target_owner_id": requested_owner_id or None,
                "is_admin": False,
            }
        actor_id = user["id"]
        is_admin = bool(user.get("is_admin"))
        target_owner_id = actor_id
        if requested_owner_id and requested_owner_id != actor_id:
            if not is_admin:
                raise PermissionError("Admin access required")
            target_owner_id = requested_owner_id
        return {
            "mode": "cloud",
            "cloud": True,
            "user": user,
            "actor_id": actor_id,
            "target_owner_id": target_owner_id,
            "is_admin": is_admin,
        }

    user = db_misc.get_current_user()
    if require_auth and not user:
        raise PermissionError("Sign in required")
    actor_id = user.get("id") if user else None
    return {
        "mode": "local",
        "cloud": False,
        "user": user,
        "actor_id": actor_id,
        "target_owner_id": actor_id,
        "is_admin": bool(user and user.get("is_admin")),
    }
