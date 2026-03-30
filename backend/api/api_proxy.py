"""
PostFreely — API: Proxy
Sends HTTP requests server-side (no CORS ever).
Interpolates {{variables}} from active environment + collection variables.
Returns full error details matching what Postman shows.
"""
import re, time, json, base64
import urllib.request, urllib.error, urllib.parse
import db_access, db_environments, db_misc, db_collections
from interpolation import interpolate
from ssl_config import outbound_ssl_context

_SSL_CTX = None

def _ssl_ctx():
    global _SSL_CTX
    if _SSL_CTX is None:
        _SSL_CTX = outbound_ssl_context()
    return _SSL_CTX

def _default_content_type(body_type):
    return {
        "json": "application/json",
        "xml": "application/xml",
        "form": "application/x-www-form-urlencoded",
        "text": "text/plain",
        "graphql": "application/json",
    }.get(str(body_type or "json").lower(), "application/json")

def send_request(req):
    body      = req["body"]
    ctx       = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    owner_id  = ctx.get("target_owner_id")
    settings  = db_misc.get_settings(owner_id=ctx.get("actor_id"))

    # ── Build variable map: env vars + collection vars (collection wins) ──
    env_id    = body.get("env_id")
    env_vars  = db_environments.get_variables(env_id, owner_id=owner_id) if env_id else db_environments.get_active_variables(owner_id=owner_id)
    col_id    = body.get("collection_id")
    col_vars  = {}
    if col_id:
        col = db_collections.get_one(col_id, owner_id=owner_id)
        if col: col_vars = col.get("variables", {})
    data_vars  = body.get("data_vars") or {}
    if not isinstance(data_vars, dict):
        data_vars = {}
    variables = {**env_vars, **col_vars, **data_vars}   # data row wins for runner iterations

    method   = body.get("method", "GET").upper()
    url      = interpolate(body.get("url",""), variables)
    params   = body.get("params",  [])
    headers  = body.get("headers", [])
    raw_body = body.get("body",    "")
    body_type = body.get("body_type") or body.get("bodyType") or "json"
    auth     = body.get("auth",    {"type":"none"})
    timeout  = settings.get("timeout", 30)

    if not url: return {"status":400,"data":{"error":"URL is required"}}

    # Query params
    qp = [(k, interpolate(v, variables)) for k,v in params if k]
    if qp:
        qs  = urllib.parse.urlencode(qp)
        url = url + ("&" if "?" in url else "?") + qs

    # Headers
    hdr = {"Connection": "keep-alive", "User-Agent": "PostFreely/3.0"}
    for row in headers:
        if isinstance(row,(list,tuple)) and len(row)==2 and row[0]:
            hdr[interpolate(row[0],variables)] = interpolate(row[1],variables)

    # Auth
    atype = auth.get("type","none")
    if atype == "bearer":
        hdr["Authorization"] = "Bearer " + interpolate(auth.get("token",""), variables)
    elif atype == "basic":
        u = interpolate(auth.get("username",""), variables)
        p = interpolate(auth.get("password",""), variables)
        hdr["Authorization"] = "Basic " + base64.b64encode(f"{u}:{p}".encode()).decode()
    elif atype == "apikey":
        kname  = interpolate(auth.get("key_name","X-API-Key"), variables)
        kvalue = interpolate(auth.get("key_value",""), variables)
        if auth.get("in") == "query":
            sep = "&" if "?" in url else "?"
            url += f"{sep}{urllib.parse.quote(kname)}={urllib.parse.quote(kvalue)}"
        else:
            hdr[kname] = kvalue
    elif atype == "oauth2":
        token = interpolate(auth.get("token",""), variables)
        if token: hdr["Authorization"] = "Bearer " + token

    # Body
    encoded_body = None
    if raw_body and method not in ("GET","HEAD","OPTIONS"):
        interp = interpolate(raw_body, variables)
        encoded_body = interp.encode("utf-8")
        if "Content-Type" not in hdr: hdr["Content-Type"] = _default_content_type(body_type)

    request_obj = urllib.request.Request(url, data=encoded_body, headers=hdr, method=method)
    t0 = time.time()

    try:
        with urllib.request.urlopen(request_obj, timeout=timeout, context=_ssl_ctx()) as resp:
            raw_bytes = resp.read()
            elapsed   = int((time.time()-t0)*1000)
            db_misc.add_history({"method":method,"url":url,
                "status_code":resp.status,"elapsed_ms":elapsed,"size_bytes":len(raw_bytes)}, owner_id=owner_id)
            return {"data": _build(raw_bytes, resp.status, "", dict(resp.headers), elapsed)}

    except urllib.error.HTTPError as exc:
        raw_bytes = exc.read()
        elapsed   = int((time.time()-t0)*1000)
        db_misc.add_history({"method":method,"url":url,
            "status_code":exc.code,"elapsed_ms":elapsed,"size_bytes":len(raw_bytes)}, owner_id=owner_id)
        return {"data": _build(raw_bytes, exc.code, str(exc.reason), dict(exc.headers), elapsed)}

    except urllib.error.URLError as exc:
        reason = str(exc.reason)
        # Surface the real OS error with guidance
        msg = f"Connection failed: {reason}"
        if "11001" in reason or "getaddrinfo" in reason:
            msg = f"DNS resolution failed — cannot reach host.\nCheck: 1) URL spelling  2) Internet connection  3) VPN/proxy settings\nOS error: {reason}"
        elif "10061" in reason or "Connection refused" in reason:
            msg = f"Connection refused — server actively rejected the connection.\nCheck: 1) Server is running  2) Port is correct\nOS error: {reason}"
        elif "CERTIFICATE_VERIFY_FAILED" in reason or "certificate verify failed" in reason.lower():
            msg = f"TLS certificate validation failed.\nCheck: 1) The API certificate is valid  2) The hostname matches  3) Only for self-signed local testing, set POSTFREELY_INSECURE_SSL=1\nOS error: {reason}"
        elif "timed out" in reason.lower():
            msg = f"Request timed out after {timeout}s.\nCheck: 1) Server is reachable  2) Increase timeout in settings\nOS error: {reason}"
        return {"data": {"status_code":0,"status_text":"Connection Error",
            "headers":{},"body":"","raw_body":"","elapsed_ms":int((time.time()-t0)*1000),
            "size_bytes":0,"is_json":False,"error":msg,"connection_error":True}}

    except Exception as exc:
        return {"data": {"status_code":0,"status_text":"Error","headers":{},
            "body":"","raw_body":"","elapsed_ms":0,"size_bytes":0,"is_json":False,
            "error":str(exc),"connection_error":True}}

def _build(raw_bytes, status_code, status_reason, resp_headers, elapsed):
    size = len(raw_bytes)
    try:    decoded = raw_bytes.decode("utf-8")
    except: decoded = raw_bytes.decode("latin-1", errors="replace")
    is_json = False
    try:    body = json.dumps(json.loads(decoded),indent=2); is_json=True
    except: body = decoded
    error_meta = _derive_http_error(status_code, status_reason or _st(status_code), body, resp_headers)
    return {"status_code":status_code,"status_text":status_reason or _st(status_code),
            "headers":resp_headers,"body":body,"raw_body":decoded,
            "elapsed_ms":elapsed,"size_bytes":size,"is_json":is_json,
            "error":error_meta["summary"],"error_detail":error_meta["detail"],
            "error_hint":error_meta["hint"],"body_preview":error_meta["body_preview"],
            "connection_error":False}

def _derive_http_error(status_code, status_text, body, headers):
    if not isinstance(status_code, int) or status_code < 400:
        return {"summary": None, "detail": "", "hint": "", "body_preview": ""}

    content_type = ""
    for key, value in (headers or {}).items():
        if str(key).lower() == "content-type":
            content_type = str(value)
            break

    preview = str(body or "").strip()
    if len(preview) > 800:
        preview = preview[:800] + "\n..."

    hint = {
        400: "The server rejected the request format or required fields. Check body shape, query params, and headers.",
        401: "Authentication is missing, expired, or invalid. Check tokens, API keys, and auth headers.",
        403: "The request was understood but blocked. Check scopes, roles, tenant context, IP allowlists, or feature access.",
        404: "The endpoint or resource was not found. Check the path, base URL, route version, and IDs.",
        405: "This endpoint does not allow the selected method. Compare the route with the API docs.",
        409: "The server reports a conflict. The resource may already exist or be in a conflicting state.",
        415: "The server rejected the content type. Check Content-Type and body encoding.",
        422: "The server parsed the request but rejected the data. Check validation errors in the response body.",
        429: "Rate limiting was triggered. Retry later or reduce request volume.",
        500: "The server failed internally. Review the response body for trace IDs or backend error details.",
        502: "A gateway or upstream service failed. The backend dependency may be unavailable.",
        503: "The service is temporarily unavailable. The backend may be starting, overloaded, or down for maintenance.",
        504: "The upstream service timed out. Check the backend health and timeout settings.",
    }.get(status_code, "Review the response body and headers for details from the API.")

    summary = f"{status_code} {status_text}"
    if preview:
        compact = re.sub(r"\s+", " ", preview)
        summary += f" - {compact[:180]}"
    detail = f"Content-Type: {content_type or 'unknown'}\n\n{preview}" if preview else (content_type or "")
    return {"summary": summary, "detail": detail.strip(), "hint": hint, "body_preview": preview}

_STATUS={200:"OK",201:"Created",204:"No Content",301:"Moved",302:"Found",
         400:"Bad Request",401:"Unauthorized",403:"Forbidden",404:"Not Found",
         405:"Method Not Allowed",409:"Conflict",422:"Unprocessable Entity",
         429:"Too Many Requests",500:"Internal Server Error",502:"Bad Gateway",
         503:"Service Unavailable",504:"Gateway Timeout"}
def _st(code): return _STATUS.get(code,"Unknown")
