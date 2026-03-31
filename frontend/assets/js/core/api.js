/* PostFreely - API client */
const POSTFREELY_SESSION_KEY = 'postfreely.session.v1';
const POSTFREELY_VIEW_OWNER_KEY = 'postfreely.view-owner.v1';
const POSTFREELY_CONFIG = window.POSTFREELY_CONFIG || {};
const BROWSER_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FORBIDDEN_BROWSER_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers',
  'access-control-request-method', 'connection', 'content-length', 'cookie',
  'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(POSTFREELY_SESSION_KEY) || 'null');
  } catch (_) {
    return null;
  }
}

function setSession(session) {
  if (!session) {
    clearSession();
    return;
  }
  localStorage.setItem(POSTFREELY_SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent('postfreely-auth-changed', { detail: { session } }));
}

function clearSession() {
  localStorage.removeItem(POSTFREELY_SESSION_KEY);
  window.dispatchEvent(new CustomEvent('postfreely-auth-changed', { detail: { session: null } }));
}

function getViewOwnerId() {
  return localStorage.getItem(POSTFREELY_VIEW_OWNER_KEY) || '';
}

function setViewOwnerId(ownerId) {
  const normalized = String(ownerId || '').trim();
  if (normalized) localStorage.setItem(POSTFREELY_VIEW_OWNER_KEY, normalized);
  else localStorage.removeItem(POSTFREELY_VIEW_OWNER_KEY);
  window.dispatchEvent(new CustomEvent('postfreely-view-owner-changed', { detail: { ownerId: normalized } }));
}

function isSupabaseCloudMode() {
  return !!window.PostFreelyCloudAPI?.isConfigured?.();
}

function withQuery(url, query = {}) {
  const qs = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value == null || value === '') return;
    qs.set(key, value);
  });
  const suffix = qs.toString();
  return suffix ? `${url}${url.includes('?') ? '&' : '?'}${suffix}` : url;
}

function scopedUrl(url, scoped = true, extraQuery = {}) {
  const ownerId = scoped ? getViewOwnerId() : '';
  return withQuery(url, ownerId ? { ...extraQuery, owner_id: ownerId } : extraQuery);
}

function scopedBody(body, scoped = true) {
  const ownerId = scoped ? getViewOwnerId() : '';
  if (!ownerId || !isPlainObject(body)) return body;
  return { ...body, owner_id: ownerId };
}

function interpolateString(value, variables = {}) {
  return String(value == null ? '' : value).replace(/\{\{(.+?)\}\}/g, (_, key) => {
    const trimmed = key.trim();
    return Object.prototype.hasOwnProperty.call(variables, trimmed) ? String(variables[trimmed]) : `{{${trimmed}}}`;
  });
}

function compatibilityStatus(status = 'untested', detail = '') {
  return {
    status,
    detail: String(detail || ''),
    checked_at: new Date().toISOString(),
  };
}

function mergeCompatibility(previous, next) {
  if (!next || !next.status) return previous || compatibilityStatus();
  return {
    status: next.status,
    detail: next.detail || '',
    checked_at: next.checked_at || new Date().toISOString(),
  };
}

function parseHeaderRows(rows, variables = {}) {
  const headers = {};
  (rows || []).forEach(row => {
    if (!Array.isArray(row) || !row[0]) return;
    const key = interpolateString(row[0], variables).trim();
    if (!key) return;
    const lower = key.toLowerCase();
    if (FORBIDDEN_BROWSER_HEADERS.has(lower) || lower.startsWith('sec-')) return;
    headers[key] = interpolateString(row[1], variables);
  });
  return headers;
}

function defaultContentTypeForBodyType(bodyType = 'json') {
  return {
    json: 'application/json',
    xml: 'application/xml',
    form: 'application/x-www-form-urlencoded',
    text: 'text/plain',
    graphql: 'application/json',
  }[String(bodyType || 'json').toLowerCase()] || 'application/json';
}

function buildExternalRequest(payload = {}, options = {}) {
  const variables = options.variables || {};
  const method = String(payload.method || 'GET').toUpperCase();
  const bodyType = String(payload.body_type || payload.bodyType || 'json').toLowerCase();
  let url = interpolateString(payload.url || '', variables).trim();
  const headers = parseHeaderRows(payload.headers, variables);
  const params = Array.isArray(payload.params) ? payload.params : [];
  const qp = [];
  params.forEach(row => {
    if (!Array.isArray(row) || !row[0]) return;
    qp.push([interpolateString(row[0], variables), interpolateString(row[1], variables)]);
  });
  if (qp.length) {
    const qs = new URLSearchParams(qp);
    url += (url.includes('?') ? '&' : '?') + qs.toString();
  }

  const auth = payload.auth || { type: 'none' };
  const atype = String(auth.type || 'none').toLowerCase();
  if (atype === 'bearer') {
    headers.Authorization = `Bearer ${interpolateString(auth.token || '', variables)}`;
  } else if (atype === 'basic') {
    const username = interpolateString(auth.username || '', variables);
    const password = interpolateString(auth.password || '', variables);
    headers.Authorization = `Basic ${btoa(`${username}:${password}`)}`;
  } else if (atype === 'apikey') {
    const keyName = interpolateString(auth.key_name || 'X-API-Key', variables);
    const keyValue = interpolateString(auth.key_value || '', variables);
    if ((auth.in || 'header') === 'query') {
      url += (url.includes('?') ? '&' : '?') + `${encodeURIComponent(keyName)}=${encodeURIComponent(keyValue)}`;
    } else if (!FORBIDDEN_BROWSER_HEADERS.has(keyName.toLowerCase())) {
      headers[keyName] = keyValue;
    }
  } else if (atype === 'oauth2') {
    const token = interpolateString(auth.token || '', variables);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let body = null;
  if (!BROWSER_SAFE_METHODS.has(method)) {
    const rawBody = payload.body == null ? '' : interpolateString(payload.body, variables);
    if (rawBody) {
      body = rawBody;
      if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = defaultContentTypeForBodyType(bodyType);
      }
    }
  }

  return { method, url, headers, body };
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return { error: text };
  }
}

function responseHeadersToObject(headers) {
  const data = {};
  headers.forEach((value, key) => {
    data[key] = value;
  });
  return data;
}

function deriveHttpError(statusCode, statusText, body, headers) {
  if (!Number.isInteger(statusCode) || statusCode < 400) {
    return { summary: null, detail: '', hint: '', body_preview: '' };
  }
  const contentType = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
  let preview = String(body || '').trim();
  if (preview.length > 800) preview = `${preview.slice(0, 800)}\n...`;
  const hint = {
    400: 'The API rejected the request format or required fields.',
    401: 'Authentication is missing, expired, or invalid.',
    403: 'The request was understood but blocked by permissions or policy.',
    404: 'The endpoint or resource was not found.',
    405: 'The endpoint does not allow this HTTP method.',
    409: 'The API reported a conflict.',
    415: 'The API rejected the content type.',
    422: 'The API parsed the request but rejected the data.',
    429: 'Rate limiting was triggered.',
    500: 'The upstream API failed internally.',
    502: 'A gateway or upstream service failed.',
    503: 'The service is temporarily unavailable.',
    504: 'The upstream service timed out.',
  }[statusCode] || 'Review the response body and headers for more details.';
  const summary = `${statusCode} ${statusText}${preview ? ` - ${preview.replace(/\s+/g, ' ').slice(0, 180)}` : ''}`;
  const detail = preview ? `Content-Type: ${contentType || 'unknown'}\n\n${preview}` : contentType;
  return { summary, detail: detail.trim(), hint, body_preview: preview };
}

function formatBrowserResult(rawBody, statusCode, statusText, headers, elapsedMs, extras = {}) {
  let decoded = String(rawBody == null ? '' : rawBody);
  let body = decoded;
  let isJson = false;
  try {
    body = JSON.stringify(JSON.parse(decoded), null, 2);
    isJson = true;
  } catch (_) {
  }
  const sizeBytes = extras.size_bytes != null ? Number(extras.size_bytes) : new TextEncoder().encode(decoded).length;
  const errorMeta = deriveHttpError(statusCode, statusText || 'OK', body, headers);
  return {
    status_code: statusCode,
    status_text: statusText || 'OK',
    headers,
    body,
    raw_body: decoded,
    elapsed_ms: Math.max(0, Math.round(elapsedMs || 0)),
    size_bytes: sizeBytes,
    is_json: isJson,
    error: errorMeta.summary,
    error_detail: errorMeta.detail,
    error_hint: errorMeta.hint,
    body_preview: errorMeta.body_preview,
    connection_error: false,
    execution_mode: extras.execution_mode || 'browser',
    browser_compatibility: extras.browser_compatibility || compatibilityStatus('supported', 'Browser request succeeded.'),
  };
}

async function refreshSessionInternal() {
  if (isSupabaseCloudMode()) {
    return window.PostFreelyCloudAPI.refreshSession();
  }
  const session = getSession();
  if (!session?.refresh_token) return null;
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const data = await parseResponse(response);
  if (!response.ok || data?.error || !data?.session?.access_token) {
    clearSession();
    return null;
  }
  setSession(data.session);
  return data.session;
}

async function request(method, url, body, options = {}) {
  const scoped = options.scoped !== false;
  const skipAuth = !!options.skipAuth;
  const finalUrl = scopedUrl(url, scoped, options.query || {});
  const finalBody = method === 'GET' || method === 'DELETE' ? undefined : scopedBody(body, scoped);
  const headers = { Accept: 'application/json' };
  if (finalBody !== undefined) headers['Content-Type'] = 'application/json';
  if (!skipAuth) {
    const session = getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch(finalUrl, {
    method,
    headers,
    body: finalBody === undefined ? undefined : JSON.stringify(finalBody),
  });

  let data = await parseResponse(response);
  if (response.status === 401 && !skipAuth && options.retry !== false) {
    const refreshed = await refreshSessionInternal();
    if (refreshed) {
      return request(method, url, body, { ...options, retry: false });
    }
    window.dispatchEvent(new CustomEvent('postfreely-auth-required', {
      detail: { url, message: data?.error || 'Authentication required' },
    }));
  }

  if (!response.ok && data && typeof data === 'object' && !Array.isArray(data) && !data.error) {
    data.error = response.statusText || `Request failed (${response.status})`;
  }
  return data;
}

function compatibilityFromPayload(payload) {
  const data = payload?.browser_compatibility;
  if (data?.status) return data;
  return compatibilityStatus('untested', 'Browser compatibility has not been checked yet.');
}

function shouldUseBrowser(payload = {}) {
  const transport = String(payload.transport_mode || 'auto').toLowerCase();
  const compat = compatibilityFromPayload(payload);
  const method = String(payload.method || 'GET').toUpperCase();
  if (transport === 'proxy') return false;
  if (transport === 'browser') return true;
  if (compat.status === 'supported') return true;
  if (compat.status === 'blocked') return false;
  return BROWSER_SAFE_METHODS.has(method);
}

async function saveHistoryEntry(entry) {
  try {
    if (isSupabaseCloudMode()) await window.PostFreelyCloudAPI.addHistory(entry);
    else await request('POST', '/api/history', entry);
  } catch (_) {
  }
}

async function sendProxyRequest(payload) {
  if (isSupabaseCloudMode()) {
    const result = await window.PostFreelyCloudAPI.sendProxyRequest(payload);
    if (result && typeof result === 'object') {
      result.execution_mode = 'proxy';
      if (!result.browser_compatibility) {
        result.browser_compatibility = compatibilityFromPayload(payload);
      }
    }
    return result;
  }
  const result = await request('POST', '/api/proxy', payload);
  if (result && typeof result === 'object') {
    result.execution_mode = 'proxy';
    if (!result.browser_compatibility) {
      result.browser_compatibility = compatibilityFromPayload(payload);
    }
  }
  return result;
}

async function executeBrowserRequest(payload, options = {}) {
  const built = buildExternalRequest(payload, { variables: options.variables || {} });
  const started = performance.now();
  try {
    const response = await fetch(built.url, {
      method: built.method,
      headers: built.headers,
      body: built.body,
      mode: 'cors',
    });
    const rawBody = await response.text();
    const result = formatBrowserResult(
      rawBody,
      response.status,
      response.statusText,
      responseHeadersToObject(response.headers),
      performance.now() - started,
      {
        execution_mode: 'browser',
        browser_compatibility: compatibilityStatus('supported', 'Browser request succeeded.'),
      },
    );
    if (options.saveHistory !== false) {
      await saveHistoryEntry({
        method: built.method,
        url: built.url,
        status_code: result.status_code,
        elapsed_ms: result.elapsed_ms,
        size_bytes: result.size_bytes,
      });
    }
    return result;
  } catch (error) {
    const message = error?.message || String(error);
    return {
      status_code: 0,
      status_text: 'Connection Error',
      headers: {},
      body: '',
      raw_body: '',
      elapsed_ms: Math.max(0, Math.round(performance.now() - started)),
      size_bytes: 0,
      is_json: false,
      error: `Browser request failed: ${message}`,
      error_detail: message,
      error_hint: 'This usually means the API blocked the browser request with CORS or the network request failed before a response was readable.',
      body_preview: '',
      connection_error: true,
      execution_mode: 'browser',
      browser_compatibility: compatibilityStatus('blocked', message),
      _browser_failed_before_response: true,
    };
  }
}

async function executeExternalRequest(payload, options = {}) {
  const transport = String(payload.transport_mode || 'auto').toLowerCase();
  const compat = compatibilityFromPayload(payload);
  const safeMethod = BROWSER_SAFE_METHODS.has(String(payload.method || 'GET').toUpperCase());
  const useBrowser = shouldUseBrowser(payload);

  if (useBrowser) {
    const directResult = await executeBrowserRequest(payload, options);
    if (directResult._browser_failed_before_response && transport === 'auto' && compat.status !== 'supported' && safeMethod) {
      const proxyResult = await sendProxyRequest(payload);
      proxyResult.browser_compatibility = compatibilityStatus('blocked', directResult.error_detail || directResult.error || 'Browser request was blocked.');
      return proxyResult;
    }
    return directResult;
  }

  return sendProxyRequest(payload);
}

async function testBrowserCompatibility(payload, options = {}) {
  const method = String(payload.method || 'GET').toUpperCase();
  if (!BROWSER_SAFE_METHODS.has(method) && options.allowMutatingProbe !== true) {
    return {
      ok: false,
      blocked: false,
      compatibility: compatibilityStatus('untested', 'This check would send the real mutating request. Confirm first if you want to test it.'),
    };
  }
  const result = await executeBrowserRequest(payload, { ...options, saveHistory: false });
  return {
    ok: !result.connection_error,
    blocked: !!result._browser_failed_before_response,
    result,
    compatibility: result.browser_compatibility || compatibilityStatus('untested'),
  };
}

const API = {
  getSession,
  setSession,
  clearSession,
  getViewOwnerId,
  setViewOwnerId,
  compatibilityStatus,
  mergeCompatibility,
  buildExternalRequest,
  executeBrowserRequest,
  executeExternalRequest,
  testBrowserCompatibility,

  getPublicConfig:       ()      => isSupabaseCloudMode() ? Promise.resolve(window.PostFreelyCloudAPI.publicConfig()) : request('GET', '/api/public/config', undefined, { skipAuth: true, scoped: false }),

  // Collections
  getCollections:        ()      => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.getCollections() : request('GET', '/api/collections'),
  createCollection:      (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.createCollection(d || {}) : request('POST', '/api/collections', d),
  updateCollection:      (id,d)  => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.updateCollection(id, d || {}) : request('PUT', `/api/collections/${id}`, d),
  deleteCollection:      (id)    => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.deleteCollection(id) : request('DELETE', `/api/collections/${id}`),
  addRequest:            (cid,d) => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.addRequest(cid, d || {}) : request('POST', `/api/collections/${cid}/requests`, d),
  updateRequest:         (cid,rid,d) => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.updateRequest(cid, rid, d || {}) : request('PUT', `/api/collections/${cid}/requests/${rid}`, d),
  deleteRequest:         (cid,rid)   => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.deleteRequest(cid, rid) : request('DELETE', `/api/collections/${cid}/requests/${rid}`),
  importCollection:      (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.importCollection(d || {}) : request('POST', '/api/collections/import', d),
  updateCollVars:        (id,d)  => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.updateCollVars(id, d || {}) : request('PUT', `/api/collections/${id}/variables`, d),

  // Environments
  getEnvironments:       ()      => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.getEnvironments() : request('GET', '/api/environments'),
  createEnvironment:     (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.createEnvironment(d || {}) : request('POST', '/api/environments', d),
  updateEnvironment:     (id,d)  => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.updateEnvironment(id, d || {}) : request('PUT', `/api/environments/${id}`, d),
  deleteEnvironment:     (id)    => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.deleteEnvironment(id) : request('DELETE', `/api/environments/${id}`),
  activateEnvironment:   (id)    => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.activateEnvironment(id) : request('POST', `/api/environments/${id}/activate`, {}),

  // Proxy / execution
  sendProxyRequest,
  sendRequest:           (d)     => sendProxyRequest(d),
  addHistory:            (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.addHistory(d || {}) : request('POST', '/api/history', d),

  // Legacy backend runner endpoints
  runCollection:         (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.runCollection(d || {}) : request('POST', '/api/runner', d),
  getCollectionRun:      (id,since=0) => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.getCollectionRun(id, since) : request('GET', `/api/runner/${id}`, undefined, { query: { since } }),
  stopCollectionRun:     (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.stopCollectionRun(d || {}) : request('POST', '/api/runner/stop', d),

  // History
  getHistory:            ()      => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.getHistory() : request('GET', '/api/history'),
  clearHistory:          ()      => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.clearHistory() : request('DELETE', '/api/history'),

  // Settings
  getSettings:           ()      => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.getSettings() : request('GET', '/api/settings', undefined, { scoped: false }),
  updateSettings:        (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.updateSettings(d || {}) : request('PUT', '/api/settings', d, { scoped: false }),

  // Auth
  login:                 (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.login(d || {}) : request('POST', '/api/auth/login', d, { skipAuth: true, scoped: false }),
  signup:                (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.signup(d || {}) : request('POST', '/api/auth/signup', d, { skipAuth: true, scoped: false }),
  resendSignupEmail:     (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.resendSignupEmail(d || {}) : Promise.resolve({ error: 'Email verification resend is only available in cloud auth mode.' }),
  refresh:               (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.refresh(d || {}) : request('POST', '/api/auth/refresh', d, { skipAuth: true, scoped: false }),
  logout:                ()      => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.logout() : request('POST', '/api/auth/logout', {}, { scoped: false }),
  me:                    ()      => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.me() : request('GET', '/api/auth/me', undefined, { scoped: false }),
  getGoogleAuthUrl:      (redirect_to='') => isSupabaseCloudMode() ? Promise.resolve(window.PostFreelyCloudAPI.getGoogleAuthUrl(redirect_to)) : request('GET', '/api/auth/google/url', undefined, { skipAuth: true, scoped: false, query: { redirect_to } }),

  // Admin
  getAdminUsers:         ()      => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.getAdminUsers() : request('GET', '/api/admin/users', undefined, { scoped: false }),

  // AI
  aiChat:                (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.aiChat(d || {}) : request('POST', '/api/ai/chat', d),
  aiAnalyze:             (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.aiAnalyze(d || {}) : request('POST', '/api/ai/analyze', d),
  aiGenerate:            (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.aiGenerate(d || {}) : request('POST', '/api/ai/generate', d),
  aiFix:                 (d)     => isSupabaseCloudMode() ? window.PostFreelyCloudAPI.aiFix(d || {}) : request('POST', '/api/ai/fix', d),
};
