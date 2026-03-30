"""
PostFreely - API: AI Integration
Providers: OpenAI, Anthropic, Google Gemini, DeepSeek, Perplexity, Ollama, Custom
"""
import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request

import db_access
import db_collections
import db_misc


def _ssl():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _post(url, headers, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60, context=_ssl()) as resp:
        return json.loads(resp.read())


def _fetch_text(url):
    parsed = urllib.parse.urlparse(url or "")
    if parsed.scheme not in ("http", "https"):
        return "", "Only http/https doc URLs are supported."
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "PostFreely/3.0",
            "Accept": "application/json, text/plain, text/html, application/yaml, text/yaml, */*",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=20, context=_ssl()) as resp:
        raw = resp.read(16000)
        content_type = resp.headers.get("Content-Type", "")
        try:
            text = raw.decode("utf-8")
        except Exception:
            text = raw.decode("latin-1", errors="replace")
    return _normalize_doc_text(text, content_type), None


def _normalize_doc_text(text, content_type=""):
    clean = (text or "").strip()
    if "html" in (content_type or "").lower():
        clean = clean.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
        clean = re.sub(r"<script[\s\S]*?</script>", " ", clean, flags=re.I)
        clean = re.sub(r"<style[\s\S]*?</style>", " ", clean, flags=re.I)
        clean = re.sub(r"<[^>]+>", " ", clean)
    clean = " ".join(clean.split())
    return clean[:8000]


def _collection_context(collection_id, owner_id=None):
    col = db_collections.get_one(collection_id, owner_id=owner_id) if collection_id else None
    if not col:
        return None, ""

    lines = [
        f"Collection: {col.get('name', '')}",
        f"Description: {col.get('description', '')}",
        f"Variables: {json.dumps(col.get('variables', {}), indent=1)[:1200]}",
        "Requests:",
    ]
    for request in (col.get("requests") or [])[:12]:
        lines.append(
            f"- {request.get('name', request.get('url', ''))}: "
            f"{request.get('method', 'GET')} {request.get('url', '')} "
            f"headers={json.dumps(request.get('headers', []))[:240]} "
            f"body={str(request.get('body', ''))[:240]}"
        )
    return col, "\n".join(lines)


def _normalize_sources(col):
    if not col:
        return []

    sources = []
    for source in col.get("ai_sources") or []:
        if not isinstance(source, dict):
            continue
        source_type = str(source.get("type", "note") or "note").strip().lower()
        if source_type not in ("url", "note", "file"):
            source_type = "note"
        content = str(source.get("content", "") or "").strip()
        if not content:
            continue
        sources.append(
            {
                "id": str(source.get("id") or ""),
                "type": source_type,
                "label": str(source.get("label", "") or "").strip(),
                "content": content,
                "allow_fetch": bool(source.get("allow_fetch", False)) if source_type == "url" else False,
            }
        )

    if sources:
        return sources

    legacy = []
    if col.get("docs_url"):
        legacy.append(
            {
                "id": "legacy-docs-url",
                "type": "url",
                "label": "Docs URL",
                "content": str(col.get("docs_url")),
                "allow_fetch": bool(col.get("allow_ai_doc_fetch", False)),
            }
        )
    if col.get("docs_notes"):
        legacy.append(
            {
                "id": "legacy-docs-notes",
                "type": "note",
                "label": "Collection Notes",
                "content": str(col.get("docs_notes")),
                "allow_fetch": False,
            }
        )
    return legacy


def _sources_context(col, body):
    body = body if isinstance(body, dict) else {}
    selected_ids = {
        str(source_id).strip()
        for source_id in (body.get("selected_source_ids") or [])
        if str(source_id).strip()
    }
    allow_fetch_override = bool(body.get("allow_doc_fetch"))
    sources = _normalize_sources(col)
    if selected_ids:
        sources = [source for source in sources if source.get("id") in selected_ids]

    primary_url = next((source["content"] for source in sources if source["type"] == "url"), "")
    parts = []
    fetched_urls = []
    fetch_errors = []

    for index, source in enumerate(sources[:12], start=1):
        label = source.get("label") or f"Source {index}"
        if source["type"] == "url":
            parts.append(f"URL Source [{label}]: {source['content']}")
            if allow_fetch_override or source.get("allow_fetch"):
                try:
                    doc_text, fetch_error = _fetch_text(source["content"])
                    if doc_text:
                        parts.append(f"Fetched source excerpt [{label}]:\n{doc_text}")
                        fetched_urls.append(source["content"])
                    elif fetch_error:
                        fetch_errors.append(f"{source['content']} - {fetch_error}")
                except Exception as exc:
                    fetch_errors.append(f"{source['content']} - {exc}")
        elif source["type"] == "file":
            parts.append(f"Attached File [{label}]:\n{source['content'][:5000]}")
        else:
            parts.append(f"Saved Note [{label}]:\n{source['content'][:4000]}")

    fetch_error = "\n".join(fetch_errors).strip() or None
    return "\n\n".join(parts).strip(), bool(fetched_urls), fetch_error, primary_url


def _call(system, user_prompt, actor_id=None):
    settings = db_misc.get_settings(owner_id=actor_id)
    provider = settings.get("ai_provider", "")
    api_key = settings.get("ai_api_key", "")
    model = settings.get("ai_model", "")
    base_url = settings.get("ai_custom_url", "")

    if not provider:
        return None, "No AI provider configured. Open AI Config to set one up."
    if not api_key and provider not in ("ollama", "custom"):
        return None, f"No API key for {provider}. Open AI Config to add your key."

    try:
        def openai_compat(endpoint, mdl, key=None, extra_headers=None):
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key or api_key}",
            }
            if extra_headers:
                headers.update(extra_headers)
            response = _post(
                endpoint,
                headers,
                {
                    "model": mdl,
                    "max_tokens": 1800,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user_prompt},
                    ],
                },
            )
            return response["choices"][0]["message"]["content"]

        if provider == "openai":
            return openai_compat("https://api.openai.com/v1/chat/completions", model or "gpt-4o-mini"), None

        if provider == "anthropic":
            model = model or "claude-3-haiku-20240307"
            response = _post(
                "https://api.anthropic.com/v1/messages",
                {
                    "Content-Type": "application/json",
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                },
                {
                    "model": model,
                    "max_tokens": 1800,
                    "system": system,
                    "messages": [{"role": "user", "content": user_prompt}],
                },
            )
            return response["content"][0]["text"], None

        if provider == "gemini":
            model = model or "gemini-1.5-flash"
            response = _post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
                {"Content-Type": "application/json"},
                {"contents": [{"parts": [{"text": system + "\n\n" + user_prompt}]}]},
            )
            return response["candidates"][0]["content"]["parts"][0]["text"], None

        if provider == "deepseek":
            return openai_compat("https://api.deepseek.com/v1/chat/completions", model or "deepseek-chat"), None

        if provider == "perplexity":
            return openai_compat(
                "https://api.perplexity.ai/chat/completions",
                model or "llama-3.1-sonar-small-128k-online",
            ), None

        if provider == "ollama":
            base = base_url or "http://localhost:11434"
            model = model or "llama3"
            response = _post(
                f"{base}/api/chat",
                {"Content-Type": "application/json"},
                {
                    "model": model,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user_prompt},
                    ],
                },
            )
            return response["message"]["content"], None

        if provider == "custom":
            if not base_url:
                return None, "Custom AI URL not set."
            response = _post(
                base_url,
                {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}" if api_key else "",
                },
                {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user_prompt},
                    ],
                },
            )
            if "choices" in response:
                return response["choices"][0]["message"]["content"], None
            if "content" in response:
                return response["content"], None
            return json.dumps(response), None

        return None, f"Unknown provider: {provider}"

    except urllib.error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="replace")
        return None, f"AI API error {exc.code}: {message[:400]}"
    except Exception as exc:
        return None, str(exc)


def chat(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    body = req["body"]
    msg = body.get("message", "").strip()
    if not msg:
        return {"status": 400, "data": {"error": "message required"}}

    history = body.get("history", [])
    current_response = body.get("api_response")
    col, col_ctx = _collection_context(body.get("collection_id"), owner_id=ctx.get("target_owner_id"))
    docs_ctx, fetched_docs, fetch_error, docs_url = _sources_context(col, body)

    system = (
        "You are PostFreely AI - an expert embedded in a powerful API client. "
        "Help debug HTTP requests, explain responses, generate request bodies, write tests, "
        "and explain REST or GraphQL concepts. Be concise and technical."
    )
    if col_ctx:
        system += "\n\nCurrent collection context:\n" + col_ctx[:4000]
    if docs_ctx:
        system += "\n\nAPI docs context:\n" + docs_ctx[:5000]
    if current_response:
        system += (
            f"\n\nCurrent API response:\nStatus: {current_response.get('status_code')} "
            f"{current_response.get('status_text')}\nBody:\n{str(current_response.get('body', ''))[:1800]}"
        )

    prompt_history = "".join(
        f"\n{item.get('role', 'user').upper()}: {item.get('content', '')}" for item in history[-6:]
    )
    reply, err = _call(system, (prompt_history + f"\nUSER: {msg}").strip(), actor_id=ctx.get("actor_id"))
    if err:
        return {"status": 500, "data": {"error": err}}
    return {
        "data": {
            "reply": reply,
            "docs_fetched": fetched_docs,
            "docs_url": docs_url,
            "docs_fetch_error": fetch_error,
        }
    }


def analyze_response(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    response = req["body"].get("response", {})
    if not response:
        return {"status": 400, "data": {"error": "No response to analyze"}}
    system = "You are an expert API debugger. Analyze the HTTP response clearly."
    prompt = (
        f"Analyze:\nStatus: {response.get('status_code')} {response.get('status_text')}\n"
        f"Time: {response.get('elapsed_ms')}ms  Size: {response.get('size_bytes')}B\n"
        f"Headers:\n{json.dumps(response.get('headers', {}), indent=1)[:500]}\n"
        f"Body:\n{str(response.get('body', ''))[:2200]}\n\n"
        "Give: 1) What this means  2) Issues or warnings  3) Suggestions"
    )
    reply, err = _call(system, prompt, actor_id=ctx.get("actor_id"))
    if err:
        return {"status": 500, "data": {"error": err}}
    return {"data": {"analysis": reply}}


def generate_request(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    body = req["body"]
    description = body.get("description", "").strip()
    if not description:
        return {"status": 400, "data": {"error": "description required"}}
    col, col_ctx = _collection_context(body.get("collection_id"), owner_id=ctx.get("target_owner_id"))
    docs_ctx, fetched_docs, fetch_error, docs_url = _sources_context(col, body)
    system = (
        "Output ONLY valid JSON (no markdown) with keys: "
        '{"method":"GET","url":"https://...","headers":[[key,val]],"params":[[key,val]],'
        '"body":"...","bodyType":"json","auth":{"type":"none"},"prescript":"","postscript":"",'
        '"description":"one-line summary"}'
        "\nIf the API needs authentication, set auth.type to bearer/basic/apikey/oauth2 and fill the matching fields."
        "\nIf the workflow needs token exchange, request signing, or response extraction, use prescript/postscript."
    )
    prompt = (
        f"Goal:\n{description}\n\n"
        f"Collection context:\n{col_ctx[:4000] if col_ctx else 'None'}\n\n"
        f"AI sources:\n{docs_ctx[:5500] if docs_ctx else 'None'}\n\n"
        "Generate the best saved request for PostFreely. Prefer concrete URLs, params, auth details, and scripts over vague placeholders."
    )
    reply, err = _call(system, prompt, actor_id=ctx.get("actor_id"))
    if err:
        return {"status": 500, "data": {"error": err}}
    try:
        clean = reply.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        parsed = json.loads(clean)
        parsed["docs_fetched"] = fetched_docs
        parsed["docs_url"] = docs_url
        parsed["docs_fetch_error"] = fetch_error
        return {"data": parsed}
    except Exception:
        return {"data": {"raw": reply}}


def suggest_fix(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    body = req["body"]
    current_request = body.get("request") or {}
    current_response = body.get("response") or {}
    collection_id = body.get("collection_id")
    col, col_ctx = _collection_context(collection_id, owner_id=ctx.get("target_owner_id"))
    docs_ctx, fetched_docs, fetch_error, docs_url = _sources_context(col, body)

    if not current_request and not current_response:
        return {"status": 400, "data": {"error": "request or response required"}}

    system = (
        "You are PostFreely AI working as a senior API debugger and API designer. "
        "Use the request, response, collection, variables, scripts, and docs context to propose a concrete fix. "
        "Be specific about what should change in the URL, headers, auth, body, pre-script, and post-script. "
        "If docs were not fetched but would likely help, say so explicitly."
    )
    prompt = (
        f"Current request:\n{json.dumps(current_request, indent=2)[:3200]}\n\n"
        f"Current response:\n{json.dumps(current_response, indent=2)[:3600]}\n\n"
        f"Collection context:\n{col_ctx[:4000] if col_ctx else 'None'}\n\n"
        f"Docs context:\n{docs_ctx[:5000] if docs_ctx else 'None'}\n\n"
        "Give:\n"
        "1. Root cause\n"
        "2. Exact request fixes\n"
        "3. Suggested body/auth/header changes\n"
        "4. Suggested pre-script/post-script changes if useful\n"
        "5. A short checklist to retry safely"
    )
    reply, err = _call(system, prompt, actor_id=ctx.get("actor_id"))
    if err:
        return {"status": 500, "data": {"error": err}}
    return {
        "data": {
            "suggestion": reply,
            "docs_fetched": fetched_docs,
            "docs_url": docs_url,
            "docs_fetch_error": fetch_error,
        }
    }
