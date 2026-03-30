window.PostFreelyCloudAPI = (() => {
  function config() {
    return window.POSTFREELY_CONFIG || {};
  }

  function isConfigured() {
    return String(config().mode || '').toLowerCase() === 'supabase'
      && !!config().supabaseUrl
      && !!config().supabaseAnonKey;
  }

  function supabaseUrl() {
    return String(config().supabaseUrl || '').replace(/\/+$/, '');
  }

  function proxyUrl() {
    return String(config().proxyUrl || '').trim();
  }

  function aiUrl() {
    return String(config().aiUrl || '').trim();
  }

  function googleAuthEnabled() {
    return config().enableGoogleAuth !== false;
  }

  function publicConfig() {
    return {
      cloud_enabled: true,
      auth_required: true,
      google_auth_enabled: googleAuthEnabled(),
      password_auth_enabled: true,
      signup_enabled: true,
      public_url: String(config().publicUrl || window.location.origin || ''),
      admin_emails_configured: true,
      proxy_enabled: false,
      ai_enabled: false,
    };
  }

  function headers(options = {}) {
    const auth = options.auth !== false;
    const session = typeof getSession === 'function' ? getSession() : null;
    const accessToken = options.accessToken || session?.access_token || '';
    const result = {
      Accept: 'application/json',
      apikey: String(config().supabaseAnonKey || ''),
    };
    if (options.json !== false) result['Content-Type'] = 'application/json';
    if (auth) result.Authorization = `Bearer ${accessToken || config().supabaseAnonKey || ''}`;
    if (options.prefer) result.Prefer = options.prefer;
    return result;
  }

  function decodeJwt(token) {
    try {
      const encoded = String(token || '').split('.')[1] || '';
      const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      return JSON.parse(atob(padded));
    } catch (_) {
      return {};
    }
  }

  function actorId() {
    const session = typeof getSession === 'function' ? getSession() : null;
    return String(decodeJwt(session?.access_token || '').sub || '');
  }

  function workspaceOwnerId() {
    return (typeof getViewOwnerId === 'function' && getViewOwnerId()) || actorId();
  }

  function sessionPayloadFromAuth(data = {}) {
    const token = String(data.access_token || '');
    const payload = decodeJwt(token);
    return {
      access_token: token,
      refresh_token: String(data.refresh_token || ''),
      token_type: String(data.token_type || 'bearer'),
      expires_in: Number(data.expires_in || 0),
      expires_at: Number(data.expires_at || payload.exp || 0),
    };
  }

  function authUsername(user = {}) {
    const meta = user.user_metadata || {};
    for (const key of ['username', 'full_name', 'name', 'preferred_username', 'display_name']) {
      const value = String(meta[key] || '').trim();
      if (value) return value;
    }
    const email = String(user.email || '').trim();
    return email.includes('@') ? email.split('@')[0] : 'User';
  }

  function authProvider(user = {}) {
    const appMeta = user.app_metadata || {};
    const identity = Array.isArray(user.identities) && user.identities[0] && typeof user.identities[0] === 'object'
      ? user.identities[0]
      : null;
    return String(identity?.provider || appMeta.provider || 'email');
  }

  function sanitizeProfile(row = {}, fallbackUser = null) {
    const email = String(row.email || fallbackUser?.email || '').trim().toLowerCase();
    const role = String(row.role || 'user').toLowerCase() === 'admin' ? 'admin' : 'user';
    return {
      id: row.id || fallbackUser?.id || '',
      email,
      username: row.username || authUsername(fallbackUser || row),
      provider: row.provider || authProvider(fallbackUser || row),
      role,
      is_admin: role === 'admin',
    };
  }

  async function fetchJson(url, options = {}, meta = {}) {
    const response = await fetch(url, options);
    let data = typeof parseResponse === 'function' ? await parseResponse(response) : {};
    if (response.status === 401 && meta.auth !== false && meta.retry !== false && typeof refreshSessionInternal === 'function') {
      const refreshed = await refreshSessionInternal();
      if (refreshed) {
        return fetchJson(url, {
          ...options,
          headers: { ...(options.headers || {}), Authorization: `Bearer ${refreshed.access_token}` },
        }, { ...meta, retry: false });
      }
      window.dispatchEvent(new CustomEvent('postfreely-auth-required', {
        detail: { url, message: data?.error_description || data?.message || data?.error || 'Authentication required' },
      }));
    }
    if (!response.ok) {
      const message = data?.msg || data?.message || data?.error_description || data?.error || response.statusText || `Request failed (${response.status})`;
      if (data && typeof data === 'object' && !Array.isArray(data)) data.error = data.error || message;
      else data = { error: message };
    }
    return { response, data };
  }

  function restUrl(table, query = {}) {
    return `${supabaseUrl()}/rest/v1/${table}${withQuery('', query)}`;
  }

  async function select(table, query = {}, options = {}) {
    const { data } = await fetchJson(restUrl(table, query), {
      method: 'GET',
      headers: headers({ json: false, auth: options.auth !== false }),
    }, { auth: options.auth !== false });
    return Array.isArray(data) ? data : [];
  }

  async function insert(table, rows, options = {}) {
    const { data } = await fetchJson(restUrl(table), {
      method: 'POST',
      headers: headers({ prefer: options.prefer || 'return=representation', auth: options.auth !== false }),
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    }, { auth: options.auth !== false });
    return Array.isArray(data) ? data : (data?.error ? data : []);
  }

  async function patch(table, values, query = {}, options = {}) {
    const { data } = await fetchJson(restUrl(table, query), {
      method: 'PATCH',
      headers: headers({ prefer: options.prefer || 'return=representation', auth: options.auth !== false }),
      body: JSON.stringify(values || {}),
    }, { auth: options.auth !== false });
    return Array.isArray(data) ? data : (data?.error ? data : []);
  }

  async function remove(table, query = {}, options = {}) {
    const { data } = await fetchJson(restUrl(table, query), {
      method: 'DELETE',
      headers: headers({ prefer: options.prefer || 'return=representation', auth: options.auth !== false, json: false }),
    }, { auth: options.auth !== false });
    return Array.isArray(data) ? data : (data?.error ? data : []);
  }

  function requireActorId() {
    const value = actorId();
    if (!value) throw new Error('Sign in first.');
    return value;
  }

  function requireWorkspaceOwnerId() {
    const value = workspaceOwnerId();
    if (!value) throw new Error('Sign in first.');
    return value;
  }

  function collectionRow(row = {}) {
    return {
      id: row.id,
      name: row.name || 'Untitled Collection',
      description: row.description || '',
      created: row.created_at || row.created || PostFreelyCloudImport.nowIso(),
      updated: row.updated_at || row.created_at || PostFreelyCloudImport.nowIso(),
      variables: row.variables || {},
      requests: row.requests || [],
      docs_url: row.docs_url || '',
      docs_notes: row.docs_notes || '',
      allow_ai_doc_fetch: !!row.allow_ai_doc_fetch,
      ai_sources: row.ai_sources || [],
      owner_id: row.owner_id || '',
    };
  }

  function environmentRow(row = {}) {
    return {
      id: row.id,
      name: row.name || 'Environment',
      variables: row.variables || {},
      owner_id: row.owner_id || '',
      created: row.created_at || PostFreelyCloudImport.nowIso(),
      updated: row.updated_at || row.created_at || PostFreelyCloudImport.nowIso(),
    };
  }

  function historyRow(row = {}) {
    return {
      id: row.id,
      method: row.method || 'GET',
      url: row.url || '',
      status_code: Number(row.status_code || 0),
      elapsed_ms: Number(row.elapsed_ms || 0),
      size_bytes: Number(row.size_bytes || 0),
      timestamp: row.timestamp || PostFreelyCloudImport.nowIso(),
    };
  }

  async function ensureProfile(user) {
    if (!user?.id) return null;
    const payload = {
      id: user.id,
      email: String(user.email || '').trim().toLowerCase(),
      username: authUsername(user),
      provider: authProvider(user),
      updated_at: PostFreelyCloudImport.nowIso(),
    };
    const rows = await insert('pf_profiles', [payload], { prefer: 'resolution=merge-duplicates,return=representation' });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return sanitizeProfile(row || payload, user);
  }

  async function ensureWorkspace(ownerId) {
    if (!ownerId) return;
    const settingsRows = await select('pf_user_settings', { select: '*', owner_id: `eq.${ownerId}`, limit: '1' });
    const envRows = await select('pf_environments', { select: 'id', owner_id: `eq.${ownerId}`, limit: '1' });
    const colRows = await select('pf_collections', { select: 'id', owner_id: `eq.${ownerId}`, limit: '1' });
    if (!envRows.length) {
      const seed = PostFreelyCloudImport.sampleEnvironments();
      await insert('pf_environments', Object.values(seed.envs).map(env => ({
        id: env.id,
        owner_id: ownerId,
        name: env.name,
        variables: env.variables,
        created_at: PostFreelyCloudImport.nowIso(),
        updated_at: PostFreelyCloudImport.nowIso(),
      })), { prefer: 'resolution=merge-duplicates,return=representation' });
      if (!settingsRows.length) {
        await insert('pf_user_settings', [{
          owner_id: ownerId,
          active_env_id: seed.active,
          settings: PostFreelyCloudImport.defaultSettings(),
          created_at: PostFreelyCloudImport.nowIso(),
          updated_at: PostFreelyCloudImport.nowIso(),
        }], { prefer: 'resolution=merge-duplicates,return=representation' });
      }
    } else if (!settingsRows.length) {
      await insert('pf_user_settings', [{
        owner_id: ownerId,
        active_env_id: envRows[0].id,
        settings: PostFreelyCloudImport.defaultSettings(),
        created_at: PostFreelyCloudImport.nowIso(),
        updated_at: PostFreelyCloudImport.nowIso(),
      }], { prefer: 'resolution=merge-duplicates,return=representation' });
    }
    if (!colRows.length) {
      const collection = PostFreelyCloudImport.sampleCollection();
      const legacy = PostFreelyCloudImport.legacyAiFields(collection.ai_sources, collection);
      await insert('pf_collections', [{
        id: collection.id,
        owner_id: ownerId,
        name: collection.name,
        description: collection.description,
        variables: collection.variables,
        requests: collection.requests,
        docs_url: legacy.docs_url,
        docs_notes: legacy.docs_notes,
        allow_ai_doc_fetch: legacy.allow_ai_doc_fetch,
        ai_sources: collection.ai_sources,
        created_at: collection.created,
        updated_at: collection.created,
      }], { prefer: 'resolution=merge-duplicates,return=representation' });
    }
  }

  async function workspaceState(ownerId) {
    const rows = await select('pf_user_settings', { select: '*', owner_id: `eq.${ownerId}`, limit: '1' });
    if (rows[0]) return rows[0];
    await ensureWorkspace(ownerId);
    const seeded = await select('pf_user_settings', { select: '*', owner_id: `eq.${ownerId}`, limit: '1' });
    return seeded[0] || { owner_id: ownerId, active_env_id: null, settings: PostFreelyCloudImport.defaultSettings() };
  }

  async function getCollections() {
    const ownerId = requireWorkspaceOwnerId();
    await ensureWorkspace(ownerId);
    const rows = await select('pf_collections', { select: '*', owner_id: `eq.${ownerId}`, order: 'created_at.asc' });
    return rows.reduce((acc, row) => {
      acc[row.id] = collectionRow(row);
      return acc;
    }, {});
  }

  async function saveCollection(input, ownerId = requireWorkspaceOwnerId()) {
    const aiSources = PostFreelyCloudImport.normalizeAiSources(input.ai_sources || input.aiSources || []);
    const legacy = PostFreelyCloudImport.legacyAiFields(aiSources, input);
    const payload = {
      id: input.id || PostFreelyCloudImport.uuid(),
      owner_id: ownerId,
      name: input.name || 'New Collection',
      description: input.description || '',
      variables: input.variables || {},
      requests: input.requests || [],
      docs_url: legacy.docs_url,
      docs_notes: legacy.docs_notes,
      allow_ai_doc_fetch: legacy.allow_ai_doc_fetch,
      ai_sources: aiSources,
      created_at: input.created || PostFreelyCloudImport.nowIso(),
      updated_at: PostFreelyCloudImport.nowIso(),
    };
    const rows = await insert('pf_collections', [payload], { prefer: 'resolution=merge-duplicates,return=representation' });
    return collectionRow((Array.isArray(rows) ? rows[0] : rows) || payload);
  }

  async function getCollection(collectionId) {
    const ownerId = requireWorkspaceOwnerId();
    const rows = await select('pf_collections', { select: '*', id: `eq.${collectionId}`, owner_id: `eq.${ownerId}`, limit: '1' });
    return rows[0] ? collectionRow(rows[0]) : null;
  }

  async function updateCollection(id, updates = {}) {
    const current = await getCollection(id);
    if (!current) return { error: 'Not found' };
    return saveCollection({
      ...current,
      ...updates,
      ai_sources: Object.prototype.hasOwnProperty.call(updates, 'ai_sources') ? updates.ai_sources : current.ai_sources,
      created: current.created,
    });
  }

  async function deleteCollection(id) {
    const ownerId = requireWorkspaceOwnerId();
    await remove('pf_collections', { id: `eq.${id}`, owner_id: `eq.${ownerId}` });
    return { ok: true };
  }

  async function addRequest(collectionId, requestData = {}) {
    const collection = await getCollection(collectionId);
    if (!collection) return { error: 'Collection not found' };
    const next = {
      id: requestData.id || PostFreelyCloudImport.uuid(),
      name: requestData.name || 'New Request',
      method: requestData.method || 'GET',
      url: requestData.url || '',
      params: requestData.params || [],
      headers: requestData.headers || [],
      body: requestData.body || '',
      bodyType: requestData.bodyType || requestData.body_type || 'json',
      auth: requestData.auth || { type: 'none' },
      prescript: requestData.prescript || '',
      postscript: requestData.postscript || '',
      folder: requestData.folder || null,
      transport_mode: requestData.transport_mode || requestData.transportMode || 'auto',
      browser_compatibility: requestData.browser_compatibility || requestData.browserCompatibility || compatibilityStatus(),
    };
    await saveCollection({ ...collection, requests: [...(collection.requests || []), next] });
    return next;
  }

  async function updateRequest(collectionId, requestId, requestData = {}) {
    const collection = await getCollection(collectionId);
    if (!collection) return { error: 'Not found' };
    let updated = null;
    const requests = (collection.requests || []).map(item => {
      if (item.id !== requestId) return item;
      updated = { ...requestData, id: requestId, bodyType: requestData.bodyType || requestData.body_type || item.bodyType || 'json' };
      return updated;
    });
    if (!updated) return { error: 'Not found' };
    await saveCollection({ ...collection, requests });
    return updated;
  }

  async function deleteRequest(collectionId, requestId) {
    const collection = await getCollection(collectionId);
    if (!collection) return { error: 'Not found' };
    await saveCollection({ ...collection, requests: (collection.requests || []).filter(item => item.id !== requestId) });
    return { ok: true };
  }

  async function updateCollectionVariables(collectionId, payload = {}) {
    const collection = await getCollection(collectionId);
    if (!collection) return { error: 'Not found' };
    return saveCollection({ ...collection, variables: payload.variables || {} });
  }

  async function importCollection(payload) {
    if (payload?.format === 'curl') {
      return saveCollection(PostFreelyCloudImport.importCurl(payload.raw || payload._raw || '', payload.name || ''));
    }
    const raw = payload?.collection && typeof payload.collection === 'object' ? payload.collection : payload;
    if (!raw?.item && !raw?.info) {
      return { error: "Not a valid collection JSON (missing 'item' or 'info')" };
    }
    const collection = PostFreelyCloudImport.importPostman(raw);
    if (!collection?.requests) return { error: "Not a valid collection JSON (missing 'item' or 'info')" };
    return saveCollection(collection);
  }

  async function getEnvironments() {
    const ownerId = requireWorkspaceOwnerId();
    await ensureWorkspace(ownerId);
    const rows = await select('pf_environments', { select: '*', owner_id: `eq.${ownerId}`, order: 'created_at.asc' });
    const state = await workspaceState(ownerId);
    return {
      active: state.active_env_id || '',
      envs: rows.reduce((acc, row) => {
        acc[row.id] = environmentRow(row);
        return acc;
      }, {}),
    };
  }

  async function createEnvironment(payload = {}) {
    const ownerId = requireWorkspaceOwnerId();
    const env = {
      id: PostFreelyCloudImport.uuid(),
      owner_id: ownerId,
      name: payload.name || 'Environment',
      variables: payload.variables || {},
      created_at: PostFreelyCloudImport.nowIso(),
      updated_at: PostFreelyCloudImport.nowIso(),
    };
    const rows = await insert('pf_environments', [env], { prefer: 'return=representation' });
    return environmentRow((Array.isArray(rows) ? rows[0] : rows) || env);
  }

  async function updateEnvironment(id, payload = {}) {
    const ownerId = requireWorkspaceOwnerId();
    const rows = await patch('pf_environments', {
      name: payload.name || 'Environment',
      variables: payload.variables || {},
      updated_at: PostFreelyCloudImport.nowIso(),
    }, { id: `eq.${id}`, owner_id: `eq.${ownerId}` });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row?.error ? row : environmentRow(row || {});
  }

  async function deleteEnvironment(id) {
    const ownerId = requireWorkspaceOwnerId();
    await remove('pf_environments', { id: `eq.${id}`, owner_id: `eq.${ownerId}` });
    const state = await workspaceState(ownerId);
    if (state.active_env_id === id) {
      const remaining = await select('pf_environments', { select: 'id', owner_id: `eq.${ownerId}`, order: 'created_at.asc', limit: '1' });
      await patch('pf_user_settings', { active_env_id: remaining[0]?.id || null, updated_at: PostFreelyCloudImport.nowIso() }, { owner_id: `eq.${ownerId}` });
    }
    return { ok: true };
  }

  async function activateEnvironment(id) {
    const ownerId = requireWorkspaceOwnerId();
    await workspaceState(ownerId);
    await patch('pf_user_settings', { active_env_id: id, updated_at: PostFreelyCloudImport.nowIso() }, { owner_id: `eq.${ownerId}` });
    return { active: id };
  }

  async function getSettings() {
    const row = await workspaceState(requireActorId());
    return { ...PostFreelyCloudImport.defaultSettings(), ...(row.settings || {}) };
  }

  async function updateSettings(updates = {}) {
    const actor = requireActorId();
    const row = await workspaceState(actor);
    const next = { ...PostFreelyCloudImport.defaultSettings(), ...(row.settings || {}), ...(updates || {}) };
    const rows = await patch('pf_user_settings', { settings: next, updated_at: PostFreelyCloudImport.nowIso() }, { owner_id: `eq.${actor}` });
    const saved = Array.isArray(rows) ? rows[0] : rows;
    return { ...PostFreelyCloudImport.defaultSettings(), ...((saved && saved.settings) || next) };
  }

  async function addHistory(entry = {}) {
    const ownerId = requireWorkspaceOwnerId();
    const payload = {
      id: PostFreelyCloudImport.uuid(),
      owner_id: ownerId,
      method: entry.method || 'GET',
      url: entry.url || '',
      status_code: Number(entry.status_code || 0),
      elapsed_ms: Number(entry.elapsed_ms || 0),
      size_bytes: Number(entry.size_bytes || 0),
      timestamp: PostFreelyCloudImport.nowIso(),
    };
    const rows = await insert('pf_history', [payload], { prefer: 'return=representation' });
    return historyRow((Array.isArray(rows) ? rows[0] : rows) || payload);
  }

  async function getHistory() {
    const ownerId = requireWorkspaceOwnerId();
    const rows = await select('pf_history', { select: '*', owner_id: `eq.${ownerId}`, order: 'timestamp.desc', limit: '200' });
    return rows.map(historyRow);
  }

  async function clearHistory() {
    const ownerId = requireWorkspaceOwnerId();
    await remove('pf_history', { owner_id: `eq.${ownerId}` });
    return { ok: true };
  }

  async function login(payload = {}) {
    const { response, data } = await fetchJson(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: headers({ auth: false }),
      body: JSON.stringify({ email: payload.email, password: payload.password }),
    }, { auth: false });
    if (!response.ok || data?.error || !data?.access_token) return data;
    const profile = await ensureProfile(data.user || {});
    await ensureWorkspace(profile?.id || data.user?.id);
    return { session: sessionPayloadFromAuth(data), user: profile };
  }

  async function signup(payload = {}) {
    const body = { email: payload.email, password: payload.password };
    const username = String(payload.username || '').trim();
    if (username) body.data = { username };
    const { response, data } = await fetchJson(`${supabaseUrl()}/auth/v1/signup`, {
      method: 'POST',
      headers: headers({ auth: false }),
      body: JSON.stringify(body),
    }, { auth: false });
    if (!response.ok || data?.error) return data;
    if (!data?.access_token) {
      return {
        session: null,
        user: null,
        needs_email_confirmation: true,
        message: 'Account created. Finish the email confirmation step, then sign in.',
      };
    }
    const profile = await ensureProfile(data.user || {});
    await ensureWorkspace(profile?.id || data.user?.id);
    return { session: sessionPayloadFromAuth(data), user: profile, needs_email_confirmation: false, message: 'Account created.' };
  }

  async function refresh(payload = {}) {
    const { response, data } = await fetchJson(`${supabaseUrl()}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: headers({ auth: false }),
      body: JSON.stringify({ refresh_token: payload.refresh_token }),
    }, { auth: false });
    if (!response.ok || data?.error || !data?.access_token) return data;
    const profile = await ensureProfile(data.user || {});
    await ensureWorkspace(profile?.id || data.user?.id);
    return { session: sessionPayloadFromAuth(data), user: profile };
  }

  async function refreshSession() {
    const session = typeof getSession === 'function' ? getSession() : null;
    if (!session?.refresh_token) return null;
    const result = await refresh({ refresh_token: session.refresh_token });
    if (!result?.session?.access_token) {
      if (typeof clearSession === 'function') clearSession();
      return null;
    }
    if (typeof setSession === 'function') setSession(result.session);
    return result.session;
  }

  async function logout() {
    const session = typeof getSession === 'function' ? getSession() : null;
    await fetchJson(`${supabaseUrl()}/auth/v1/logout`, {
      method: 'POST',
      headers: headers({ accessToken: session?.access_token, json: false }),
    }, { auth: false, retry: false });
    return { ok: true };
  }

  async function me() {
    const { response, data } = await fetchJson(`${supabaseUrl()}/auth/v1/user`, {
      method: 'GET',
      headers: headers({ json: false }),
    });
    if (!response.ok || data?.error) return { error: data?.error || 'Not logged in' };
    const profile = await ensureProfile(data);
    await ensureWorkspace(profile?.id || data.id);
    return { user: profile || sanitizeProfile({}, data) };
  }

  function googleUrl(redirectTo = '', state = '') {
    const params = new URLSearchParams();
    params.set('provider', 'google');
    params.set('redirect_to', redirectTo || `${window.location.origin}/auth/callback.html`);
    if (state) params.set('state', state);
    return { url: `${supabaseUrl()}/auth/v1/authorize?${params.toString()}` };
  }

  async function getAdminUsers() {
    const rows = await select('pf_profiles', { select: 'id,email,username,provider,role,created_at', order: 'created_at.asc' });
    return rows.map(row => sanitizeProfile(row));
  }

  function proxyError() {
    return Promise.resolve({
      status_code: 0,
      status_text: 'Proxy Unavailable',
      headers: {},
      body: '',
      raw_body: '',
      elapsed_ms: 0,
      size_bytes: 0,
      is_json: false,
      error: 'Proxy mode is not available in the static Cloudflare Pages deployment.',
      error_detail: 'This repo currently supports browser-first execution only when running as a static Pages app.',
      error_hint: 'Use Browser mode for CORS-compatible APIs. Server proxy support can be added later with a worker.',
      body_preview: '',
      connection_error: true,
      execution_mode: 'proxy',
    });
  }

  function unsupported(message) {
    return Promise.resolve({ error: message });
  }

  return {
    isConfigured,
    publicConfig,
    proxyUrl,
    aiUrl,
    refreshSession,
    getCollections,
    createCollection: saveCollection,
    updateCollection,
    deleteCollection,
    addRequest,
    updateRequest,
    deleteRequest,
    importCollection,
    updateCollVars: updateCollectionVariables,
    getEnvironments,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    activateEnvironment,
    getSettings,
    updateSettings,
    addHistory,
    getHistory,
    clearHistory,
    login,
    signup,
    refresh,
    logout,
    me,
    getGoogleAuthUrl: googleUrl,
    getAdminUsers,
    sendProxyRequest: proxyError,
    runCollection: () => unsupported('Cloud runner jobs are disabled in the static Pages deployment. Use the browser runner.'),
    getCollectionRun: () => unsupported('Cloud runner jobs are disabled in the static Pages deployment.'),
    stopCollectionRun: () => unsupported('Cloud runner jobs are disabled in the static Pages deployment.'),
    aiChat: () => unsupported('AI chat is not configured for the static Pages deployment yet.'),
    aiAnalyze: () => unsupported('AI analysis is not configured for the static Pages deployment yet.'),
    aiGenerate: () => unsupported('AI generation is not configured for the static Pages deployment yet.'),
    aiFix: () => unsupported('AI fix suggestions are not configured for the static Pages deployment yet.'),
  };
})();
