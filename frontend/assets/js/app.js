/* PostFreely — Main App */

// ── Script Sandbox ────────────────────────────────────────────
/**
 * Executes a pre- or post-request script in a sandboxed context.
 * Returns { envChanges, requestMutations, tests, logs, error }
 */
function runScript(code, context = {}) {
  const logs    = [];
  const tests   = [];   // { name, passed }
  const envChanges = {};
  let   requestMutations = {};

  const envProxy = {
    get: (key) => {
      const val = (State.activeEnvVars())[key] ?? '';
      logs.push({ type:'info', msg:`env.get('${key}') → ${JSON.stringify(val)}` });
      return val;
    },
    set: (key, val) => {
      envChanges[key] = val;
      logs.push({ type:'set', msg:`env.set('${key}', ${JSON.stringify(val)})` });
    },
  };

  const requestProxy = context.request ? new Proxy(context.request, {
    set(t, k, v) { t[k] = v; requestMutations[k] = v; return true; }
  }) : {};

  const responseProxy = context.response ? {
    ...context.response,
    json: () => {
      try { return JSON.parse(context.response.body); }
      catch { return null; }
    },
    get status()  { return context.response.status_code; },
    get headers() { return context.response.headers || {}; },
  } : null;

  const testFn = (name, fn) => {
    try {
      const passed = !!fn();
      tests.push({ name, passed });
      logs.push({ type: passed ? 'pass' : 'fail', msg: `test('${name}') → ${passed ? '✓ PASS' : '✗ FAIL'}` });
    } catch(e) {
      tests.push({ name, passed: false });
      logs.push({ type:'fail', msg:`test('${name}') → ✗ ERROR: ${e.message}` });
    }
  };

  const consoleFn = { log: (...a) => logs.push({ type:'info', msg: a.map(x=>JSON.stringify(x)).join(' ') }) };

  try {
    // eslint-disable-next-line no-new-func
    new Function('env', 'request', 'response', 'test', 'console', 'crypto', code)(
      envProxy, requestProxy, responseProxy, testFn, consoleFn,
      typeof crypto !== 'undefined' ? crypto : { randomUUID: () => Math.random().toString(36).slice(2) }
    );
  } catch(e) {
    logs.push({ type:'err', msg:`Script error: ${e.message}` });
    return { envChanges, requestMutations, tests, logs, error: e.message };
  }
  return { envChanges, requestMutations, tests, logs, error: null };
}

function showScriptLog(logElId, result) {
  const el = document.getElementById(logElId);
  if (!result.logs.length && !result.error) { el.style.display='none'; return; }
  el.style.display = '';
  el.innerHTML = result.logs.map(l =>
    `<div class="log-${l.type}">${l.type==='pass'?'✓':l.type==='fail'?'✗':l.type==='set'?'→':'·'} ${esc(l.msg)}</div>`
  ).join('');
}

function applyScriptEnvChanges(changes) {
  if (!Object.keys(changes).length) return;
  const activeId = State.environments.active;
  if (!activeId) return;
  const env = (State.environments.envs || {})[activeId];
  if (!env) return;
  Object.assign(env.variables, changes);
  // Persist to backend
  API.updateEnvironment(activeId, { name: env.name, variables: env.variables });
  renderEnvStrip();
}

function showPostScriptBadge(tests) {
  const tab = document.querySelector('.stab[data-st="postscript"]');
  if (!tab || !tests.length) return;
  const pass  = tests.filter(t => t.passed).length;
  const total = tests.length;
  tab.classList.add('has-tests');
  tab.classList.toggle('some-fail', pass < total);
  tab.setAttribute('data-pass',  pass);
  tab.setAttribute('data-total', total);
}

const WORKSPACE_STORAGE_KEY = 'postfreely.workspace.v2';
let _workspacePersistTimer = null;
let _workspacePersistSuspended = false;

function normalizeSavedTab(tab, index) {
  return {
    id: tab?.id || `t${index + 1}`,
    name: tab?.name || 'New Request',
    method: tab?.method || 'GET',
    url: tab?.url || '',
    params: Array.isArray(tab?.params) ? tab.params : [],
    headers: Array.isArray(tab?.headers) ? tab.headers : [],
    body: tab?.body || '',
    bodyType: tab?.bodyType || 'json',
    auth: tab?.auth || { type: 'none' },
    prescript: tab?.prescript || '',
    postscript: tab?.postscript || '',
    transportMode: tab?.transportMode || tab?.transport_mode || 'auto',
    browserCompatibility: tab?.browserCompatibility || tab?.browser_compatibility || API.compatibilityStatus('untested', 'Browser compatibility has not been checked yet.'),
    savedReqId: tab?.savedReqId || null,
    collectionId: tab?.collectionId || null,
    response: tab?.response || null,
  };
}

function scheduleWorkspacePersist() {
  if (_workspacePersistSuspended) return;
  clearTimeout(_workspacePersistTimer);
  _workspacePersistTimer = setTimeout(persistWorkspace, 160);
}

function persistWorkspace() {
  if (_workspacePersistSuspended) return;
  _workspacePersistSuspended = true;
  try {
    saveCurrentTabState();
    const data = {
      tabs: State.tabs,
      activeTab: State.activeTab,
      nextTabId: State.nextTabId,
      reqPanelHeight: State.reqPanelHeight,
      reqPanelManual: State.reqPanelManual,
      activeRequestTab: document.querySelector('.stab.active')?.dataset.st || 'params',
      activeResponseTab: State.activeResponseTab || 'body',
      sidebarCollapsed: document.getElementById('sidebar')?.classList.contains('collapsed') || false,
    };
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(data));
  } catch (_) {
  } finally {
    _workspacePersistSuspended = false;
  }
}

function restoreWorkspace() {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.tabs) || !data.tabs.length) return false;

    State.tabs = data.tabs.map(normalizeSavedTab);
    State.activeTab = data.activeTab;
    State.reqPanelHeight = typeof data.reqPanelHeight === 'number' ? data.reqPanelHeight : null;
    State.reqPanelManual = !!data.reqPanelManual;
    State.activeResponseTab = data.activeResponseTab || 'body';

    const ids = State.tabs.map(tab => Number(String(tab.id || '').replace(/\D/g, '')) || 0);
    State.nextTabId = Math.max(data.nextTabId || 1, ...ids.map(n => n + 1));

    setSidebarCollapsed(!!data.sidebarCollapsed, false);
    renderTabs();

    const active = State.getTab(State.activeTab) || State.tabs[0];
    if (!active) return false;
    State.activeTab = active.id;
    loadTabToUI(active);
    activateRequestSubTab(data.activeRequestTab || 'params', false);
    return true;
  } catch (_) {
    return false;
  }
}

function resetWorkspaceData() {
  State.collections = {};
  State.environments = { envs: {}, active: null };
  renderEnvStrip();
  renderSidebar();
}

function normalizeRequestExecution(request) {
  if (!request || typeof request !== 'object') return request;
  request.transport_mode = request.transport_mode || request.transportMode || 'auto';
  request.browser_compatibility = API.mergeCompatibility(
    API.compatibilityStatus('untested', 'Browser compatibility has not been checked yet.'),
    request.browser_compatibility || request.browserCompatibility
  );
  return request;
}

function openRunnerStudio(collectionId = '') {
  const url = new URL('/runner/', window.location.origin);
  if (collectionId) url.searchParams.set('cid', collectionId);
  window.open(url.toString(), '_blank');
}

function currentTabVariables(tab) {
  return State.variablesFor(tab?.collectionId || null).merged;
}

function requestPayloadForExecution(tab, extra = {}) {
  return {
    method: tab.method,
    url: tab.url,
    params: tab.params,
    headers: tab.headers,
    body: tab.body,
    body_type: tab.bodyType || 'json',
    auth: tab.auth,
    collection_id: tab.collectionId,
    transport_mode: tab.transportMode || 'auto',
    browser_compatibility: tab.browserCompatibility || API.compatibilityStatus('untested', 'Browser compatibility has not been checked yet.'),
    ...extra,
  };
}

function updateBrowserCompatibilityUi(tab = State.getTab(State.activeTab)) {
  const pill = document.getElementById('browser-compat-status');
  const transportSel = document.getElementById('transport-sel');
  if (!pill || !transportSel) return;
  const compat = tab?.browserCompatibility || API.compatibilityStatus('untested', 'Browser compatibility has not been checked yet.');
  const label = compat.status === 'supported' ? 'Browser OK' : compat.status === 'blocked' ? 'Proxy Needed' : 'Untested';
  pill.textContent = label;
  pill.className = `req-compat-pill ${compat.status || 'untested'}`;
  pill.title = compat.detail || label;
  transportSel.value = tab?.transportMode || 'auto';
}

function markActiveTabCompatibilityUntested(detail = 'Request changed. Browser compatibility should be checked again.') {
  const tab = State.getTab(State.activeTab);
  if (!tab) return;
  tab.browserCompatibility = API.compatibilityStatus('untested', detail);
  updateBrowserCompatibilityUi(tab);
}

function syncTabRequestMetadata(tab) {
  if (!tab?.collectionId || !tab?.savedReqId || !State.collections[tab.collectionId]) return;
  const request = (State.collections[tab.collectionId].requests || []).find(item => item.id === tab.savedReqId);
  if (!request) return;
  request.transport_mode = tab.transportMode || 'auto';
  request.browser_compatibility = tab.browserCompatibility || API.compatibilityStatus('untested', 'Browser compatibility has not been checked yet.');
}

async function loadActorSettings() {
  if (State.publicConfig?.auth_required && !State.currentUser) {
    State.settings = {};
    applySettings({});
    return false;
  }
  const settings = await API.getSettings();
  if (settings?.error) {
    State.settings = {};
    applySettings({});
    return false;
  }
  State.settings = settings || {};
  applySettings(State.settings);
  return true;
}

async function refreshCurrentUser() {
  const result = await API.me();
  if (!result || result.error || !result.user) {
    State.currentUser = null;
    updateUserUI(null);
    return null;
  }
  State.currentUser = result.user;
  updateUserUI(result.user);
  return result.user;
}

function renderAdminScope() {
  const wrap = document.getElementById('admin-scope-wrap');
  const sel = document.getElementById('admin-scope-sel');
  if (!wrap || !sel) return;

  if (!State.currentUser?.is_admin || !State.publicConfig?.auth_required) {
    wrap.style.display = 'none';
    sel.innerHTML = '';
    if (API.getViewOwnerId()) API.setViewOwnerId('');
    return;
  }

  const currentValue = API.getViewOwnerId();
  sel.innerHTML = '<option value="">My workspace</option>' +
    (State.adminUsers || [])
      .filter(user => user?.id && user.id !== State.currentUser.id)
      .map(user => `<option value="${user.id}" ${user.id === currentValue ? 'selected' : ''}>${esc(user.username || user.email || user.id)}${user.email ? ` - ${esc(user.email)}` : ''}</option>`)
      .join('');
  wrap.style.display = '';
}

async function loadAdminUsers() {
  if (!State.currentUser?.is_admin || !State.publicConfig?.auth_required) {
    State.adminUsers = [];
    renderAdminScope();
    return;
  }
  const users = await API.getAdminUsers();
  State.adminUsers = Array.isArray(users) ? users : [];
  renderAdminScope();
}

async function loadWorkspaceData() {
  const [cols, envs] = await Promise.all([
    API.getCollections(),
    API.getEnvironments(),
  ]);

  if (cols?.error) throw new Error(cols.error);
  if (envs?.error) throw new Error(envs.error);

  State.collections = cols && typeof cols === 'object' ? cols : {};
  Object.values(State.collections).forEach(collection => {
    collection.requests = (collection.requests || []).map(normalizeRequestExecution);
  });
  State.environments = envs && envs.active !== undefined ? envs : { envs: {}, active: null };
  renderEnvStrip();
  renderSidebar(document.getElementById('sb-search-inp')?.value || '');
}

async function hydrateSessionState() {
  State.publicConfig = (await API.getPublicConfig()) || {};
  const hasSession = !!API.getSession()?.access_token;
  if (State.publicConfig.auth_required && !hasSession) {
    State.currentUser = null;
    updateUserUI(null);
    renderAdminScope();
    return null;
  }

  try {
    const user = await refreshCurrentUser();
    await loadAdminUsers();
    return user;
  } catch (_) {
    State.currentUser = null;
    updateUserUI(null);
    renderAdminScope();
    return null;
  }
}


// ── Boot ──────────────────────────────────────────────────────
async function boot() {
  try {
    // Wire UI first so listeners exist before auth/data finishes
    wireUI();
    initVariableHover();
    initResizeHandle();
    await hydrateSessionState();
    await loadActorSettings();

    if (State.currentUser || !State.publicConfig.auth_required) {
      await loadWorkspaceData();
    } else {
      resetWorkspaceData();
    }

    // Restore workspace or create first tab
    if (!restoreWorkspace()) {
      setSidebarCollapsed(false, false);
      addNewTab();
      activateRequestSubTab('params', false);
    }
    applyStoredRequestPanelHeight();

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey||e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSend(); }
      if ((e.ctrlKey||e.metaKey) && e.key === 't')     { e.preventDefault(); addNewTab(); }
      if ((e.ctrlKey||e.metaKey) && e.key === 's')     { e.preventDefault(); openSaveModal(); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) persistWorkspace();
    });
    window.addEventListener('beforeunload', persistWorkspace);
    window.addEventListener('resize', () => {
      syncRequestEditors();
      if (State.reqPanelManual) applyStoredRequestPanelHeight();
      else fitRequestPanelToContent(true);
      if (typeof syncTabScrollButtons === 'function') syncTabScrollButtons();
    });
    window.addEventListener('postfreely-auth-required', event => {
      const detail = event.detail || {};
      showToast(detail.message || 'Sign in required', true);
      openSignIn();
    });
    window.addEventListener('postfreely-view-owner-changed', async () => {
      if (!State.currentUser) return;
      try {
        await loadWorkspaceData();
        showToast(API.getViewOwnerId() ? 'Switched workspace view' : 'Back to your workspace');
      } catch (error) {
        showToast(error.message || 'Could not load that workspace', true);
      }
    });

    if (State.publicConfig.auth_required && !State.currentUser) {
      setTimeout(() => openSignIn(), 60);
    }
  } catch(err) {
    console.error('Boot error:', err);
    document.body.innerHTML = `<div style="padding:40px;color:#ff5c7c;font-family:monospace">
      <h2>PostFreely failed to start</h2>
      <p>Make sure the Python backend is running: <code>python backend/core/server.py</code></p>
      <pre>${err.message || err}</pre>
    </div>`;
  }
}

// ── Wire UI ───────────────────────────────────────────────────
function wireUI() {
  // Add tab button
  document.getElementById('add-tab').addEventListener('click', () => addNewTab());

  // Method select
  document.getElementById('method-sel').addEventListener('change', () => {
    updateMethodStyle();
    const tab = State.getTab(State.activeTab);
    if (tab) tab.method = document.getElementById('method-sel').value;
    renderTabs();
    markActiveTabCompatibilityUntested();
    saveCurrentTabState();
  });

  // URL input
  document.getElementById('url-inp').addEventListener('input', () => {
    const tab = State.getTab(State.activeTab);
    if (tab) { tab.url = document.getElementById('url-inp').value; renderTabs(); }
    markActiveTabCompatibilityUntested();
    scheduleWorkspacePersist();
  });

  ['body-ta', 'prescript-ta', 'postscript-ta'].forEach(id => {
    document.getElementById(id).addEventListener('input', e => {
      autoSizeEditor(e.target);
      fitRequestPanelToContent();
      if (id === 'body-ta') markActiveTabCompatibilityUntested();
      saveCurrentTabState();
    });
  });

  // Send button
  document.getElementById('send-btn').addEventListener('click', doSend);
  document.getElementById('browser-check-btn').addEventListener('click', runBrowserCompatibilityCheck);
  document.getElementById('transport-sel').addEventListener('change', e => {
    const tab = State.getTab(State.activeTab);
    if (!tab) return;
    tab.transportMode = e.target.value || 'auto';
    syncTabRequestMetadata(tab);
    updateBrowserCompatibilityUi(tab);
    scheduleWorkspacePersist();
  });

  // Save button
  document.getElementById('save-btn').addEventListener('click', openSaveModal);

  // Generate button
  document.getElementById('generate-btn').addEventListener('click', openGenerateModal);

  // Toolbar buttons
  document.getElementById('hist-btn').addEventListener('click',     openHistory);
  document.getElementById('env-btn').addEventListener('click',      () => openEnvModal());
  document.getElementById('ai-config-btn').addEventListener('click', openAIConfig);
  document.getElementById('theme-btn').addEventListener('click',    openThemeModal);
  document.getElementById('runner-btn').addEventListener('click',   () => openRunnerStudio());
  document.getElementById('user-btn').addEventListener('click',     openSignIn);
  document.getElementById('tab-scroll-left').addEventListener('click', () => scrollTabsBy(-220));
  document.getElementById('tab-scroll-right').addEventListener('click', () => scrollTabsBy(220));
  document.getElementById('tab-bar-wrap').addEventListener('scroll', syncTabScrollButtons);
  document.getElementById('tab-bar-wrap').addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    e.currentTarget.scrollLeft += e.deltaY;
    syncTabScrollButtons();
  }, { passive: false });
  document.getElementById('admin-scope-sel').addEventListener('change', e => {
    API.setViewOwnerId(e.target.value || '');
  });

  // Sidebar import
  document.getElementById('sb-import-btn').addEventListener('click', () => openImportModal('postman'));

  // Sidebar search
  document.getElementById('sb-search-inp').addEventListener('input', e => renderSidebar(e.target.value));

  // New collection button
  document.getElementById('new-coll-btn').addEventListener('click', () => openImportModal('blank'));

  // Sub-tabs
  document.querySelectorAll('.stab').forEach(t => t.addEventListener('click', () => {
    activateRequestSubTab(t.dataset.st);
  }));

  // Body type buttons
  document.querySelectorAll('.btype').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.btype').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    setBodyType(b.dataset.bt);
  }));

  // Format JSON button
  document.getElementById('fmt-json-btn')?.addEventListener('click', () => {
    const ta = document.getElementById('body-ta');
    try {
      ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
      autoSizeEditor(ta);
      fitRequestPanelToContent();
      saveCurrentTabState();
    }
    catch { showToast('Invalid JSON', true); }
  });

  // Auth select
  document.getElementById('auth-sel').addEventListener('change', e => {
    renderAuthFields(e.target.value);
    markActiveTabCompatibilityUntested();
    saveCurrentTabState();
  });
  document.getElementById('auth-fields').addEventListener('input', () => {
    markActiveTabCompatibilityUntested();
    saveCurrentTabState();
  });
  document.getElementById('auth-fields').addEventListener('change', () => {
    markActiveTabCompatibilityUntested();
    saveCurrentTabState();
  });

  // Environment selector
  document.getElementById('env-sel').addEventListener('change', async e => {
    const id = e.target.value;
    State.environments.active = id || null;
    if (id) await API.activateEnvironment(id);
    renderEnvStrip();
    markActiveTabCompatibilityUntested('Environment changed. Browser compatibility should be checked again if the target origin changed.');
    showToast(id ? `Env: ${(State.environments.envs||{})[id]?.name || id}` : 'No environment');
    scheduleWorkspacePersist();
  });

  // Edit env link
  document.getElementById('edit-env-btn').addEventListener('click', () => openEnvModal());

  // New env button
  document.getElementById('new-env-btn').addEventListener('click', createNewEnv);

  // Sidebar collapse
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    setSidebarCollapsed(!document.getElementById('sidebar').classList.contains('collapsed'));
  });
  document.getElementById('sidebar-reopen').addEventListener('click', () => setSidebarCollapsed(false));

  // Modal close buttons (generic)
  document.querySelectorAll('[data-close-modal]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal)));

  // Import modal
  document.getElementById('studio-do-import-btn').addEventListener('click', doImport);
  document.querySelectorAll('#collection-mode-tabs .seg-tab').forEach(tab =>
    tab.addEventListener('click', () => setCollectionStudioMode(tab.dataset.importMode)));
  document.getElementById('studio-import-file-btn').addEventListener('click', () => {
    document.getElementById('studio-import-file-input').click();
  });
  document.getElementById('studio-import-file-input').addEventListener('change', e => {
    loadStudioImportFile(e.target.files?.[0]);
  });

  // Save request modal
  document.getElementById('do-save-btn').addEventListener('click', doSaveRequest);

  // Theme save
  document.getElementById('save-theme-btn').addEventListener('click', saveTheme);

  // AI config save
  document.getElementById('save-ai-btn').addEventListener('click', saveAIConfig);

  // Sign in modal
  document.getElementById('do-signin-btn').addEventListener('click', doSignIn);
  document.getElementById('do-local-signin-btn').addEventListener('click', doLocalSignIn);
  document.getElementById('do-google-signin-btn').addEventListener('click', startGoogleSignIn);
  document.getElementById('signin-resend-btn').addEventListener('click', resendVerificationEmail);
  document.getElementById('do-signout-btn').addEventListener('click', doSignOut);
  document.querySelectorAll('#signin-mode-tabs .seg-tab').forEach(tab =>
    tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
  document.querySelectorAll('[data-password-toggle]').forEach(btn =>
    btn.addEventListener('click', () => togglePasswordVisibility(btn.dataset.passwordToggle)));
  ['signin-email', 'signin-password', 'signin-password-confirm', 'signin-name'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSignIn();
      }
    });
  });

  // Collection overview save/delete
  document.getElementById('save-coll-overview-btn').addEventListener('click', saveCollectionOverview);
  document.getElementById('del-coll-overview-btn').addEventListener('click', deleteCollectionFromOverview);
  document.getElementById('export-coll-btn').addEventListener('click', exportCollectionFromOverview);
  document.getElementById('add-colvar-btn').addEventListener('click', () => {
    addColVarRow(document.getElementById('coll-vars-list'), '', '');
  });
  document.getElementById('run-coll-btn').addEventListener('click', () => {
    if (!_overviewColId) return;
    closeAll();
    openRunnerStudio(_overviewColId);
  });

  // Generate modal
  document.getElementById('do-generate-btn').addEventListener('click', doGenerate);

  // Variable editor
  document.getElementById('save-var-btn').addEventListener('click', saveVariableEditor);
  document.getElementById('var-edit-scope').addEventListener('change', e => handleVariableEditorScopeChange(e.target.value));

  // AI chat
  document.getElementById('ai-send').addEventListener('click', doAiSend);
  document.getElementById('ai-inp').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAiSend(); }
  });
  document.getElementById('ai-fix-btn')?.addEventListener('click', doAiFix);
  document.querySelectorAll('.ai-quick:not(.ai-fix)').forEach(btn => {
    btn.addEventListener('click', () => runAiQuickAction(btn.dataset.aiPrompt || ''));
  });
}

// ── SEND REQUEST ──────────────────────────────────────────────
async function doSend() {
  saveCurrentTabState();
  const tab = State.getTab(State.activeTab);
  if (!tab) return;

  const url = tab.url.trim();
  if (!url) { showToast('Enter a URL first', true); return; }

  // ── Run Pre-script ────────────────────────────────────────
  const preLog = document.getElementById('prescript-log');
  preLog.style.display = 'none'; preLog.innerHTML = '';

  if (tab.prescript?.trim()) {
    // Build mutable headers object from tab.headers array
    const headersObj = Object.fromEntries((tab.headers||[]).filter(h=>h[0]).map(h=>[h[0],h[1]]));
    const requestCtx = { url: tab.url, method: tab.method, headers: headersObj };
    const pre = runScript(tab.prescript, { request: requestCtx });
    showScriptLog('prescript-log', pre);
    if (Object.keys(pre.envChanges).length) applyScriptEnvChanges(pre.envChanges);
    // Apply request mutations from pre-script back into tab
    if (pre.requestMutations.url)    { tab.url    = pre.requestMutations.url;    document.getElementById('url-inp').value = tab.url; }
    if (pre.requestMutations.method) { tab.method = pre.requestMutations.method; document.getElementById('method-sel').value = tab.method; }
    // Merge any header mutations back into tab.headers array
    if (requestCtx.headers) {
      const extraHeaders = Object.entries(requestCtx.headers).filter(([k]) =>
        !tab.headers.some(h => h[0] === k)
      );
      if (extraHeaders.length) tab.headers = [...tab.headers, ...extraHeaders];
    }
  }

  document.getElementById('send-btn').classList.add('loading');
  document.getElementById('send-btn').textContent = 'Sending...';
  showLoadbar(true);

  try {
    const result = await API.executeExternalRequest(
      requestPayloadForExecution(tab),
      { variables: currentTabVariables(tab), saveHistory: true }
    );
    if (result?.error && result.status_code == null) throw new Error(result.error);

    tab.browserCompatibility = API.mergeCompatibility(tab.browserCompatibility, result.browser_compatibility);
    syncTabRequestMetadata(tab);
    tab.response     = result;
    State.lastResponse = result;
    State.aiHistory  = [];
    State.activeResponseTab = 'body';
    renderResponse(result, 'body');
    updateBrowserCompatibilityUi(tab);

    // ── Run Post-script ─────────────────────────────────────
    const postLog = document.getElementById('postscript-log');
    postLog.style.display = 'none'; postLog.innerHTML = '';

    if (tab.postscript?.trim()) {
      const post = runScript(tab.postscript, { response: result });
      showScriptLog('postscript-log', post);
      if (Object.keys(post.envChanges).length) {
        applyScriptEnvChanges(post.envChanges);
        showToast(`Script saved ${Object.keys(post.envChanges).length} variable(s) to env`);
      }
      result.tests = post.tests || [];
      result.postscript_logs = post.logs || [];
      result.postscript_error = post.error || '';
      tab.response = result;
      State.lastResponse = result;
      showPostScriptBadge(post.tests);
      renderResponse(result, State.activeResponseTab || 'body');
    }

    scheduleWorkspacePersist();

    // Show bottom error toast for connection errors (like Postman)
    if (result.connection_error || result.status_code === 0) {
      showErrorToast(result.error || 'Connection failed');
    }

  } catch(e) {
    showErrorToast(e.message);
  } finally {
    document.getElementById('send-btn').classList.remove('loading');
    document.getElementById('send-btn').textContent = 'Send';
    showLoadbar(false);
  }
}

async function runBrowserCompatibilityCheck() {
  saveCurrentTabState();
  const tab = State.getTab(State.activeTab);
  if (!tab) return;
  if (!tab.url?.trim()) {
    showToast('Enter a URL first', true);
    return;
  }

  const method = String(tab.method || 'GET').toUpperCase();
  const allowMutatingProbe = BROWSER_SAFE_METHODS.has(method)
    ? true
    : confirm(`This compatibility check will send the real ${method} request. Continue?`);
  if (!allowMutatingProbe) return;

  const button = document.getElementById('browser-check-btn');
  button.disabled = true;
  button.textContent = 'Checking...';
  try {
    const check = await API.testBrowserCompatibility(
      requestPayloadForExecution(tab),
      { variables: currentTabVariables(tab), allowMutatingProbe }
    );
    tab.browserCompatibility = API.mergeCompatibility(tab.browserCompatibility, check.compatibility);
    syncTabRequestMetadata(tab);
    updateBrowserCompatibilityUi(tab);
    scheduleWorkspacePersist();
    if (check.ok) {
      showToast('Browser access works for this request.');
    } else if (check.compatibility?.status === 'untested') {
      showToast(check.compatibility.detail || 'Browser compatibility was not checked.', true);
    } else {
      showToast('Browser access is blocked. Proxy mode will be needed.', true);
    }
  } catch (error) {
    showToast(error.message || 'Compatibility check failed.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Check Browser';
  }
}

function showErrorToast(msg) {
  const el = document.getElementById('err-toast');
  el.style.display = 'block';
  el.querySelector('.err-toast-title').textContent = '✗ Request Failed';
  el.querySelector('.err-toast-body').textContent  = msg;
  el.classList.add('show');
  clearTimeout(el._to);
  el._to = setTimeout(() => { el.classList.remove('show'); setTimeout(()=>el.style.display='none',400); }, 8000);
}

// ── AI Chat ───────────────────────────────────────────────────
function runAiQuickAction(prompt) {
  if (!State.lastResponse) {
    showToast('Send a request first', true);
    return;
  }
  switchRespTab('ai');
  doAiSend(prompt);
}

async function doAiSend(prefilledMessage = '') {
  const inp = document.getElementById('ai-inp');
  const msg = (prefilledMessage || inp.value).trim();
  if (!msg) return;
  inp.value = '';
  const tab = State.getTab(State.activeTab);

  if (!State.settings.ai_provider) {
    addAiBubble('error', 'No AI configured. Click AI Config in the toolbar.');
    return;
  }

  addAiBubble('user', msg);
  State.aiHistory.push({ role:'user', content:msg });
  addAiBubble('ai', 'Thinking...', 'thinking');

  const result = await API.aiChat({
    message:      msg,
    history:      State.aiHistory.slice(-8),
    api_response: State.lastResponse,
    collection_id: tab?.collectionId || null,
  });

  document.querySelector('.ai-bubble.thinking')?.remove();

  if (result.error) {
    addAiBubble('error', result.error);
  } else {
    addAiBubble('ai', result.reply || '');
    State.aiHistory.push({ role:'assistant', content: result.reply });
  }
}

function addAiBubble(role, text, extraClass = '') {
  const el = document.createElement('div');
  el.className = `ai-bubble ${role} fade-in` + (extraClass ? ' ' + extraClass : '');
  // Basic markdown-ish formatting
  el.innerHTML = esc(text)
    .replace(/```([\s\S]*?)```/g, '<pre style="background:var(--bg3);padding:8px;border-radius:6px;margin:4px 0;overflow:auto">$1</pre>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--bg4);padding:1px 4px;border-radius:3px;color:var(--accent)">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  const msgs = document.getElementById('ai-messages');
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

window.addEventListener('DOMContentLoaded', boot);
