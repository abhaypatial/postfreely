"""PostFreely - API: Users/Auth."""
import uuid

import db_access
import db_cloud
import db_misc


def _user_payload(user):
    return user or None


def login(req):
    body = req["body"] or {}
    if db_cloud.enabled():
        email = str(body.get("email") or "").strip()
        password = str(body.get("password") or "")
        if not email or not password:
            return {"status": 400, "data": {"error": "Email and password are required"}}
        try:
            result = db_cloud.login_password(email, password)
            return {"data": result}
        except db_cloud.CloudError as exc:
            return {"status": exc.status, "data": {"error": str(exc)}}

    email = body.get("email", "").strip()
    username = body.get("username", email.split("@")[0] if "@" in email else "User")
    if not email and not username:
        return {"status": 400, "data": {"error": "Email or name required"}}
    user = db_misc.save_user(
        {
            "id": str(uuid.uuid4()),
            "email": email,
            "username": username,
            "provider": body.get("provider", "local"),
            "role": "admin",
            "is_admin": True,
        }
    )
    return {"data": {"user": _user_payload(user), "session": None}}


def signup(req):
    body = req["body"] or {}
    if not db_cloud.enabled():
        return login(req)

    email = str(body.get("email") or "").strip()
    password = str(body.get("password") or "")
    username = str(body.get("username") or "").strip()
    if not email or not password:
        return {"status": 400, "data": {"error": "Email and password are required"}}
    try:
        result = db_cloud.signup_password(email, password, username=username)
        return {"data": result}
    except db_cloud.CloudError as exc:
        return {"status": exc.status, "data": {"error": str(exc)}}


def refresh(req):
    body = req["body"] or {}
    if not db_cloud.enabled():
        return {"status": 400, "data": {"error": "Refresh is only available in cloud mode"}}
    refresh_token = str(body.get("refresh_token") or "").strip()
    if not refresh_token:
        return {"status": 400, "data": {"error": "refresh_token required"}}
    try:
        result = db_cloud.refresh_session(refresh_token)
        return {"data": result}
    except db_cloud.CloudError as exc:
        return {"status": exc.status, "data": {"error": str(exc)}}


def google_url(req):
    redirect_to = ((req.get("query") or {}).get("redirect_to") or [""])[0]
    state = ((req.get("query") or {}).get("state") or [""])[0]
    if not db_cloud.enabled():
        return {"status": 400, "data": {"error": "Google login is not configured"}}
    try:
        return {"data": {"url": db_cloud.google_login_url(redirect_to=redirect_to, state=state)}}
    except db_cloud.CloudError as exc:
        return {"status": exc.status, "data": {"error": str(exc)}}


def logout(req):
    if db_cloud.enabled():
        access_token = ""
        headers = req.get("headers") or {}
        raw = headers.get("Authorization") or headers.get("authorization") or ""
        if raw.lower().startswith("bearer "):
            access_token = raw.split(" ", 1)[1].strip()
        if access_token:
            try:
                db_cloud.sign_out(access_token)
            except Exception:
                pass
            db_access.clear_token_cache(access_token)
        return {"data": {"ok": True}}
    db_misc.logout_user()
    return {"data": {"ok": True}}


def me(req):
    ctx = db_access.request_context(req, require_auth=False)
    if not ctx.get("user"):
        return {"status": 401, "data": {"error": "Not logged in"}}
    return {"data": {"user": _user_payload(ctx["user"])}}
