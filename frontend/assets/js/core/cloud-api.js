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

  function passwordAuthEnabled() {
    return config().enablePasswordAuth !== false;
  }

  function normalizedEmail(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function authRedirectTo(path = '/auth/callback.html') {
    const base = String(config().publicUrl || window.location.origin || '').replace(/\/+$/, '');
    const suffix = String(path || '/auth/callback.html');
    return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
  }

  function publicConfig() {
    return {
      cloud_enabled: true,
      auth_required: true,
      google_auth_enabled: googleAuthEnabled(),
      password_auth_enabled: passwordAuthEnabled(),
      signup_enabled: passwordAuthEnabled(),
      public_url: String(config().publicUrl || window.location.origin || ''),
      admin_emails_configured: true,
      proxy_enabled: false,
      ai_enabled: true,
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
      permissions: role === 'owner'
        ? { read: true, write: true, run: true, manage: true }
        : (members.find(member => member.user_id === actorId())?.permissions || {}),
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
      shared: !!row.shared,
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
    const ownedRows = await select('pf_collections', { select: '*', owner_id: `eq.${ownerId}`, order: 'created_at.asc' });
    let rows = ownedRows;
    const userId = actorId();
    if (userId && ownerId === userId) {
      const memberships = await select('pf_workspace_members', { select: 'workspace_id', user_id: `eq.${userId}`, status: 'eq.active' });
      const workspaceIds = [...new Set(memberships.map(row => row.workspace_id).filter(Boolean))];
      if (workspaceIds.length) {
        const links = await select('pf_workspace_collections', { select: 'collection_id', workspace_id: `in.(${workspaceIds.join(',')})` });
        const sharedIds = [...new Set(links.map(row => row.collection_id).filter(Boolean))].filter(id => !ownedRows.some(row => row.id === id));
        if (sharedIds.length) {
          const sharedRows = await select('pf_collections', { select: '*', id: `in.(${sharedIds.join(',')})`, order: 'created_at.asc' });
          rows = [...ownedRows, ...sharedRows.map(row => ({ ...row, shared: true }))];
        }
      }
    }
    return rows.reduce((acc, row) => {
      acc[row.id] = collectionRow(row);
      if (row.shared) acc[row.id].shared = true;
      return acc;
    }, {});
  }

  async function saveCollection(input, ownerId = requireWorkspaceOwnerId()) {
    const aiSources = PostFreelyCloudImport.normalizeAiSources(input.ai_sources || input.aiSources || []);
    const legacy = PostFreelyCloudImport.legacyAiFields(aiSources, input);
    const payload = {
      id: input.id || PostFreelyCloudImport.uuid(),
      owner_id: input.owner_id || ownerId,
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
    const rows = await select('pf_collections', { select: '*', id: `eq.${collectionId}`, limit: '1' });
    if (rows[0] && rows[0].owner_id !== ownerId && rows[0].owner_id !== actorId()) rows[0].shared = true;
    return rows[0] ? collectionRow(rows[0]) : null;
  }

  async function updateCollection(id, updates = {}) {
    const current = await getCollection(id);
    if (!current) return { error: 'Not found' };
    const safeUpdates = current.shared
      ? Object.fromEntries(Object.entries(updates || {}).filter(([key]) => key !== 'variables'))
      : updates;
    return saveCollection({
      ...current,
      ...safeUpdates,
      ai_sources: Object.prototype.hasOwnProperty.call(safeUpdates, 'ai_sources') ? safeUpdates.ai_sources : current.ai_sources,
      variables: current.shared ? current.variables : (safeUpdates.variables || current.variables),
      created: current.created,
    }, current.owner_id || requireWorkspaceOwnerId());
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
    const email = normalizedEmail(payload.email);
    const { response, data } = await fetchJson(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: headers({ auth: false }),
      body: JSON.stringify({ email, password: payload.password }),
    }, { auth: false });
    if (!response.ok || data?.error || !data?.access_token) return data;
    const profile = await ensureProfile(data.user || {});
    await ensureWorkspace(profile?.id || data.user?.id);
    return { session: sessionPayloadFromAuth(data), user: profile };
  }

  async function signup(payload = {}) {
    const body = {
      email: normalizedEmail(payload.email),
      password: payload.password,
      email_redirect_to: authRedirectTo('/auth/callback.html'),
    };
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
        message: 'Check your inbox and confirm your email to finish creating the account.',
      };
    }
    const profile = await ensureProfile(data.user || {});
    await ensureWorkspace(profile?.id || data.user?.id);
    return { session: sessionPayloadFromAuth(data), user: profile, needs_email_confirmation: false, message: 'Account created.' };
  }

  async function resendSignupEmail(payload = {}) {
    const email = normalizedEmail(payload.email);
    if (!email) return { error: 'Enter your email first.' };
    const { response, data } = await fetchJson(`${supabaseUrl()}/auth/v1/resend`, {
      method: 'POST',
      headers: headers({ auth: false }),
      body: JSON.stringify({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: authRedirectTo('/auth/callback.html'),
        },
      }),
    }, { auth: false });
    if (!response.ok || data?.error) return data;
    return {
      ok: true,
      message: 'Verification email sent. Open it, then PostFreely will bring you back automatically.',
    };
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

  function workspaceRow(row = {}, members = [], collections = []) {
    const role = row.owner_id === actorId()
      ? 'owner'
      : (members.find(member => member.user_id === actorId())?.role || 'collaborator');
    return {
      id: row.id,
      name: row.name || 'Team Workspace',
      description: row.description || '',
      owner_id: row.owner_id || '',
      role,
      members,
      collections,
      created_at: row.created_at || '',
      updated_at: row.updated_at || '',
    };
  }

  async function getWorkspaces() {
    const userId = requireActorId();
    const [owned, memberships] = await Promise.all([
      select('pf_workspaces', { select: '*', owner_id: `eq.${userId}`, order: 'created_at.asc' }),
      select('pf_workspace_members', { select: '*', user_id: `eq.${userId}`, status: 'eq.active' }),
    ]);
    const ids = [...new Set([...owned.map(row => row.id), ...memberships.map(row => row.workspace_id)])].filter(Boolean);
    if (!ids.length) return [];
    const workspaces = owned.length === ids.length
      ? owned
      : await select('pf_workspaces', { select: '*', id: `in.(${ids.join(',')})`, order: 'created_at.asc' });
    const [allMembers, allLinks] = await Promise.all([
      select('pf_workspace_members', { select: '*', workspace_id: `in.(${ids.join(',')})`, order: 'created_at.asc' }),
      select('pf_workspace_collections', { select: '*', workspace_id: `in.(${ids.join(',')})`, order: 'created_at.asc' }),
    ]);
    return workspaces.map(row => workspaceRow(
      row,
      allMembers.filter(member => member.workspace_id === row.id),
      allLinks.filter(link => link.workspace_id === row.id),
    ));
  }

  async function createWorkspace(payload = {}) {
    const owner = requireActorId();
    const row = {
      id: PostFreelyCloudImport.uuid(),
      owner_id: owner,
      name: payload.name || 'New Team',
      description: payload.description || '',
      created_at: PostFreelyCloudImport.nowIso(),
      updated_at: PostFreelyCloudImport.nowIso(),
    };
    const rows = await insert('pf_workspaces', [row], { prefer: 'return=representation' });
    const workspace = (Array.isArray(rows) ? rows[0] : rows) || row;
    await insert('pf_workspace_members', [{
      id: PostFreelyCloudImport.uuid(),
      workspace_id: workspace.id,
      user_id: owner,
      email: (typeof State !== 'undefined' && State.currentUser?.email) || '',
      role: 'owner',
      permissions: { read: true, write: true, run: true, manage: true },
      status: 'active',
      added_by: owner,
      created_at: PostFreelyCloudImport.nowIso(),
      updated_at: PostFreelyCloudImport.nowIso(),
    }], { prefer: 'resolution=merge-duplicates,return=representation' });
    return workspaceRow(workspace, [], []);
  }

  async function updateWorkspace(id, payload = {}) {
    const rows = await patch('pf_workspaces', {
      name: payload.name || 'Team Workspace',
      description: payload.description || '',
      updated_at: PostFreelyCloudImport.nowIso(),
    }, { id: `eq.${id}` });
    return workspaceRow((Array.isArray(rows) ? rows[0] : rows) || {});
  }

  async function inviteWorkspaceMember(workspaceId, payload = {}) {
    const email = normalizedEmail(payload.email);
    if (!email) return { error: 'Email required' };
    const profiles = await select('pf_profiles', { select: 'id,email', email: `eq.${email}`, limit: '1' });
    const member = {
      id: PostFreelyCloudImport.uuid(),
      workspace_id: workspaceId,
      user_id: profiles[0]?.id || null,
      email,
      role: ['owner', 'admin', 'collaborator'].includes(payload.role) && payload.role !== 'owner' ? payload.role : 'collaborator',
      permissions: payload.permissions || { read: true, write: true, run: true, manage: false },
      status: profiles[0]?.id ? 'active' : 'invited',
      added_by: requireActorId(),
      created_at: PostFreelyCloudImport.nowIso(),
      updated_at: PostFreelyCloudImport.nowIso(),
    };
    const rows = await insert('pf_workspace_members', [member], { prefer: 'resolution=merge-duplicates,return=representation' });
    return (Array.isArray(rows) ? rows[0] : rows) || member;
  }

  async function removeWorkspaceMember(workspaceId, memberId) {
    await remove('pf_workspace_members', { workspace_id: `eq.${workspaceId}`, id: `eq.${memberId}`, role: 'neq.owner' });
    return { ok: true };
  }

  async function updateWorkspaceMember(workspaceId, memberId, payload = {}) {
    const values = {
      role: ['admin', 'collaborator'].includes(payload.role) ? payload.role : 'collaborator',
      permissions: payload.permissions || {},
      updated_at: PostFreelyCloudImport.nowIso(),
    };
    const rows = await patch('pf_workspace_members', values, { workspace_id: `eq.${workspaceId}`, id: `eq.${memberId}`, role: 'neq.owner' });
    return (Array.isArray(rows) ? rows[0] : rows) || values;
  }

  async function shareWorkspaceCollection(workspaceId, collectionId) {
    const link = {
      id: PostFreelyCloudImport.uuid(),
      workspace_id: workspaceId,
      collection_id: collectionId,
      added_by: requireActorId(),
      created_at: PostFreelyCloudImport.nowIso(),
      updated_at: PostFreelyCloudImport.nowIso(),
    };
    const rows = await insert('pf_workspace_collections', [link], { prefer: 'resolution=merge-duplicates,return=representation' });
    return (Array.isArray(rows) ? rows[0] : rows) || link;
  }

  async function unshareWorkspaceCollection(workspaceId, collectionId) {
    await remove('pf_workspace_collections', { workspace_id: `eq.${workspaceId}`, collection_id: `eq.${collectionId}` });
    return { ok: true };
  }

  function clipText(value, limit = 4000) {
    return String(value || '').trim().slice(0, limit);
  }

  function stripHtml(text = '') {
    return String(text || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function fetchDocExcerpt(url) {
    try {
      const parsed = new URL(String(url || '').trim());
      if (!/^https?:$/.test(parsed.protocol)) {
        return { text: '', error: 'Only http/https doc URLs are supported.' };
      }
      const response = await fetch(parsed.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, text/html, application/yaml, text/yaml, */*',
        },
        mode: 'cors',
      });
      const text = await response.text();
      const contentType = response.headers.get('content-type') || '';
      return {
        text: clipText(contentType.includes('html') ? stripHtml(text) : text, 8000),
        error: response.ok ? '' : `${response.status} ${response.statusText}`.trim(),
      };
    } catch (error) {
      return { text: '', error: error?.message || 'Could not fetch docs from the browser.' };
    }
  }

  function normalizeAiSources(collection = {}) {
    const sources = [];
    (collection.ai_sources || []).forEach(source => {
      if (!source || typeof source !== 'object') return;
      const type = String(source.type || 'note').trim().toLowerCase();
      const content = String(source.content || '').trim();
      if (!content) return;
      sources.push({
        id: String(source.id || ''),
        type: ['url', 'note', 'file'].includes(type) ? type : 'note',
        label: String(source.label || '').trim(),
        content,
        allow_fetch: !!source.allow_fetch,
      });
    });
    if (sources.length) return sources;
    if (collection.docs_url) {
      sources.push({
        id: 'legacy-docs-url',
        type: 'url',
        label: 'Docs URL',
        content: String(collection.docs_url),
        allow_fetch: !!collection.allow_ai_doc_fetch,
      });
    }
    if (collection.docs_notes) {
      sources.push({
        id: 'legacy-docs-notes',
        type: 'note',
        label: 'Collection Notes',
        content: String(collection.docs_notes),
        allow_fetch: false,
      });
    }
    return sources;
  }

  function collectionContextText(collection) {
    if (!collection) return '';
    const lines = [
      `Collection: ${collection.name || ''}`,
      `Description: ${collection.description || ''}`,
      `Variables: ${JSON.stringify(collection.variables || {}, null, 1).slice(0, 1200)}`,
      'Requests:',
    ];
    (collection.requests || []).slice(0, 12).forEach(request => {
      lines.push(
        `- ${request.name || request.url || ''}: ${request.method || 'GET'} ${request.url || ''} ` +
        `headers=${JSON.stringify(request.headers || []).slice(0, 240)} body=${clipText(request.body || '', 240)}`
      );
    });
    return lines.join('\n');
  }

  async function aiSourcesContext(collection, payload = {}) {
    const selected = new Set((payload.selected_source_ids || []).map(value => String(value).trim()).filter(Boolean));
    const sources = normalizeAiSources(collection).filter(source => !selected.size || selected.has(source.id));
    const parts = [];
    const fetched = [];
    const errors = [];
    let primaryUrl = '';

    for (const [index, source] of sources.slice(0, 12).entries()) {
      const label = source.label || `Source ${index + 1}`;
      if (source.type === 'url') {
        parts.push(`URL Source [${label}]: ${source.content}`);
        if (!primaryUrl) primaryUrl = source.content;
        if (payload.allow_doc_fetch || source.allow_fetch) {
          const doc = await fetchDocExcerpt(source.content);
          if (doc.text) {
            parts.push(`Fetched source excerpt [${label}]:\n${doc.text}`);
            fetched.push(source.content);
          } else if (doc.error) {
            errors.push(`${source.content} - ${doc.error}`);
          }
        }
      } else if (source.type === 'file') {
        parts.push(`Attached File [${label}]:\n${clipText(source.content, 5000)}`);
      } else {
        parts.push(`Saved Note [${label}]:\n${clipText(source.content, 4000)}`);
      }
    }

    return {
      text: parts.join('\n\n').trim(),
      docs_fetched: fetched.length > 0,
      docs_url: primaryUrl,
      docs_fetch_error: errors.join('\n').trim(),
    };
  }

  function normalizeCodeFenceJson(text = '') {
    return String(text || '')
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  async function aiConfig() {
    const settings = await getSettings();
    return {
      provider: String(settings.ai_provider || '').trim().toLowerCase(),
      apiKey: String(settings.ai_api_key || '').trim(),
      model: String(settings.ai_model || '').trim(),
      baseUrl: String(settings.ai_custom_url || '').trim(),
    };
  }

  function aiDefaultModel(provider) {
    return {
      openai: 'gpt-4o-mini',
      anthropic: 'claude-3-5-sonnet-latest',
      gemini: 'gemini-1.5-flash',
      deepseek: 'deepseek-chat',
      perplexity: 'llama-3.1-sonar-small-128k-online',
      ollama: 'llama3',
      custom: '',
    }[provider] || '';
  }

  async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      return { raw: text };
    }
  }

  async function openAiCompat(endpoint, payload, apiKey, extraHeaders = {}) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...extraHeaders,
      },
      body: JSON.stringify(payload),
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      const msg = data?.error?.message || data?.error || data?.message || `${response.status} ${response.statusText}`.trim();
      throw new Error(msg);
    }
    return data;
  }

  async function callAiProvider(system, userPrompt) {
    const settings = await aiConfig();
    if (!settings.provider) throw new Error('No AI provider configured. Open AI Config to set one up.');
    if (!settings.apiKey && !['ollama', 'custom'].includes(settings.provider)) {
      throw new Error(`No API key for ${settings.provider}. Open AI Config to add your key.`);
    }

    const model = settings.model || aiDefaultModel(settings.provider);
    if (settings.provider === 'openai') {
      const data = await openAiCompat('https://api.openai.com/v1/chat/completions', {
        model,
        max_tokens: 1800,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }, settings.apiKey);
      return data?.choices?.[0]?.message?.content || '';
    }

    if (settings.provider === 'deepseek') {
      const data = await openAiCompat('https://api.deepseek.com/v1/chat/completions', {
        model,
        max_tokens: 1800,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }, settings.apiKey);
      return data?.choices?.[0]?.message?.content || '';
    }

    if (settings.provider === 'perplexity') {
      const data = await openAiCompat('https://api.perplexity.ai/chat/completions', {
        model,
        max_tokens: 1800,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }, settings.apiKey);
      return data?.choices?.[0]?.message?.content || '';
    }

    if (settings.provider === 'anthropic') {
      const data = await openAiCompat('https://api.anthropic.com/v1/messages', {
        model: model || 'claude-3-5-sonnet-latest',
        max_tokens: 1800,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }, '', {
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
      });
      return data?.content?.map(item => item?.text || '').join('\n').trim() || '';
    }

    if (settings.provider === 'gemini') {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent?key=${encodeURIComponent(settings.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${system}\n\n${userPrompt}` }] }],
        }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok) throw new Error(data?.error?.message || data?.error || `${response.status} ${response.statusText}`.trim());
      return data?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('\n').trim() || '';
    }

    if (settings.provider === 'ollama') {
      const base = settings.baseUrl || 'http://localhost:11434';
      const data = await openAiCompat(`${base.replace(/\/+$/, '')}/api/chat`, {
        model: model || 'llama3',
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }, '');
      return data?.message?.content || '';
    }

    if (settings.provider === 'custom') {
      if (!settings.baseUrl) throw new Error('Custom AI URL not set.');
      const data = await openAiCompat(settings.baseUrl, {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }, settings.apiKey);
      return data?.choices?.[0]?.message?.content || data?.content || data?.message || JSON.stringify(data);
    }

    throw new Error(`Unknown provider: ${settings.provider}`);
  }

  function formatHistory(history = []) {
    return (history || []).slice(-6).map(item => `${String(item.role || 'user').toUpperCase()}: ${String(item.content || '')}`).join('\n');
  }

  async function aiChat(payload = {}) {
    const message = String(payload.message || '').trim();
    if (!message) return { error: 'message required' };
    const collection = payload.collection_id ? await getCollection(payload.collection_id) : null;
    const collectionText = collectionContextText(collection);
    const docs = await aiSourcesContext(collection, payload);
    let system = 'You are PostFreely AI - an expert embedded in a browser-native API workspace. Help debug HTTP requests, explain responses, generate request bodies, write tests, and explain REST or GraphQL concepts. Be concise and technical.';
    if (collectionText) system += `\n\nCurrent collection context:\n${clipText(collectionText, 4000)}`;
    if (docs.text) system += `\n\nAPI docs context:\n${clipText(docs.text, 5000)}`;
    if (payload.api_response) {
      system += `\n\nCurrent API response:\nStatus: ${payload.api_response.status_code} ${payload.api_response.status_text}\nBody:\n${clipText(payload.api_response.body, 1800)}`;
    }
    const history = formatHistory(payload.history || []);
    try {
      const reply = await callAiProvider(system, `${history ? `${history}\n` : ''}USER: ${message}`.trim());
      return {
        reply,
        docs_fetched: docs.docs_fetched,
        docs_url: docs.docs_url,
        docs_fetch_error: docs.docs_fetch_error,
      };
    } catch (error) {
      return { error: error?.message || String(error) };
    }
  }

  async function aiAnalyze(payload = {}) {
    const response = payload.response || {};
    if (!response || !Object.keys(response).length) return { error: 'No response to analyze' };
    const system = 'You are an expert API debugger. Analyze the HTTP response clearly.';
    const prompt = [
      `Analyze:\nStatus: ${response.status_code} ${response.status_text}`,
      `Time: ${response.elapsed_ms}ms  Size: ${response.size_bytes}B`,
      `Headers:\n${clipText(JSON.stringify(response.headers || {}, null, 1), 700)}`,
      `Body:\n${clipText(response.body, 2200)}`,
      'Give: 1) What this means  2) Issues or warnings  3) Suggestions',
    ].join('\n');
    try {
      return { analysis: await callAiProvider(system, prompt) };
    } catch (error) {
      return { error: error?.message || String(error) };
    }
  }

  async function aiGenerate(payload = {}) {
    const description = String(payload.description || '').trim();
    if (!description) return { error: 'description required' };
    const collection = payload.collection_id ? await getCollection(payload.collection_id) : null;
    const collectionText = collectionContextText(collection);
    const docs = await aiSourcesContext(collection, payload);
    const system = 'Output ONLY valid JSON (no markdown) with keys: {"method":"GET","url":"https://...","headers":[[key,val]],"params":[[key,val]],"body":"...","bodyType":"json","auth":{"type":"none"},"prescript":"","postscript":"","description":"one-line summary"}\nIf the API needs authentication, set auth.type to bearer/basic/apikey/oauth2 and fill the matching fields.\nIf the workflow needs token exchange, request signing, or response extraction, use prescript/postscript.';
    const prompt = [
      `Goal:\n${description}`,
      `Collection context:\n${collectionText || 'None'}`,
      `AI sources:\n${docs.text || 'None'}`,
      'Generate the best saved request for PostFreely. Prefer concrete URLs, params, auth details, and scripts over vague placeholders.',
    ].join('\n\n');
    try {
      const reply = await callAiProvider(system, prompt);
      try {
        return {
          ...JSON.parse(normalizeCodeFenceJson(reply)),
          docs_fetched: docs.docs_fetched,
          docs_url: docs.docs_url,
          docs_fetch_error: docs.docs_fetch_error,
        };
      } catch (_) {
        return { raw: reply };
      }
    } catch (error) {
      return { error: error?.message || String(error) };
    }
  }

  async function aiFix(payload = {}) {
    const currentRequest = payload.request || {};
    const currentResponse = payload.response || {};
    if (!Object.keys(currentRequest).length && !Object.keys(currentResponse).length) {
      return { error: 'request or response required' };
    }
    const collection = payload.collection_id ? await getCollection(payload.collection_id) : null;
    const collectionText = collectionContextText(collection);
    const docs = await aiSourcesContext(collection, payload);
    const system = 'You are PostFreely AI working as a senior API debugger and API designer. Use the request, response, collection, variables, scripts, and docs context to propose a concrete fix. Be specific about what should change in the URL, headers, auth, body, pre-script, and post-script. If docs were not fetched but would likely help, say so explicitly.';
    const prompt = [
      `Current request:\n${clipText(JSON.stringify(currentRequest, null, 2), 3200)}`,
      `Current response:\n${clipText(JSON.stringify(currentResponse, null, 2), 3600)}`,
      `Collection context:\n${collectionText || 'None'}`,
      `Docs context:\n${docs.text || 'None'}`,
      'Give:\n1. Root cause\n2. Exact request fixes\n3. Suggested body/auth/header changes\n4. Suggested pre-script/post-script changes if useful\n5. A short checklist to retry safely',
    ].join('\n\n');
    try {
      return {
        suggestion: await callAiProvider(system, prompt),
        docs_fetched: docs.docs_fetched,
        docs_url: docs.docs_url,
        docs_fetch_error: docs.docs_fetch_error,
      };
    } catch (error) {
      return { error: error?.message || String(error) };
    }
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
    resendSignupEmail,
    refresh,
    logout,
    me,
    getGoogleAuthUrl: googleUrl,
    getAdminUsers,
    getWorkspaces,
    createWorkspace,
    updateWorkspace,
    inviteWorkspaceMember,
    removeWorkspaceMember,
    updateWorkspaceMember,
    shareWorkspaceCollection,
    unshareWorkspaceCollection,
    sendProxyRequest: proxyError,
    runCollection: () => unsupported('Cloud runner jobs are disabled in the static Pages deployment. Use the browser runner.'),
    getCollectionRun: () => unsupported('Cloud runner jobs are disabled in the static Pages deployment.'),
    stopCollectionRun: () => unsupported('Cloud runner jobs are disabled in the static Pages deployment.'),
    aiChat,
    aiAnalyze,
    aiGenerate,
    aiFix,
  };
})();
