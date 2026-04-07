/* PostFreely — UI Rendering */

// ── Tabs ──────────────────────────────────────────────────────
function tabStripWrap() {
  return document.getElementById('tab-bar-wrap') || document.getElementById('tab-bar');
}

function syncTabScrollButtons() {
  const wrap = tabStripWrap();
  const left = document.getElementById('tab-scroll-left');
  const right = document.getElementById('tab-scroll-right');
  if (!wrap || !left || !right) return;
  const canScroll = wrap.scrollWidth > wrap.clientWidth + 8;
  left.style.display = canScroll ? '' : 'none';
  right.style.display = canScroll ? '' : 'none';
  left.disabled = wrap.scrollLeft <= 4;
  right.disabled = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 4;
}

function scrollTabsBy(delta) {
  const wrap = tabStripWrap();
  if (!wrap) return;
  wrap.scrollBy({ left: delta, behavior: 'smooth' });
  setTimeout(syncTabScrollButtons, 220);
}

function ensureActiveTabVisible() {
  const wrap = tabStripWrap();
  const active = document.querySelector('#tab-bar .tab.active');
  if (!wrap || !active) return;
  const wrapLeft = wrap.scrollLeft;
  const wrapRight = wrapLeft + wrap.clientWidth;
  const tabLeft = active.offsetLeft;
  const tabRight = tabLeft + active.offsetWidth;
  if (tabLeft < wrapLeft + 12) {
    wrap.scrollTo({ left: Math.max(0, tabLeft - 18), behavior: 'smooth' });
  } else if (tabRight > wrapRight - 12) {
    wrap.scrollTo({ left: tabRight - wrap.clientWidth + 18, behavior: 'smooth' });
  }
  setTimeout(syncTabScrollButtons, 220);
}

function renderTabs() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = '';
  State.tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === State.activeTab ? ' active' : '');
    el.dataset.id = tab.id;
    const mc = methodColor(tab.method);
    el.innerHTML = `
      <span class="t-meth ${mc}">${tab.method}</span>
      <span class="t-name">${esc(tab.name)}</span>
      <span class="t-x" data-close="${tab.id}">×</span>`;
    el.addEventListener('click', e => {
      if (e.target.dataset.close) { closeTab(e.target.dataset.close); return; }
      switchTab(tab.id);
    });
    bar.appendChild(el);
  });
  requestAnimationFrame(() => {
    ensureActiveTabVisible();
    syncTabScrollButtons();
  });
}

function methodColor(m) {
  return { GET:'mGET', POST:'mPOST', PUT:'mPUT', DELETE:'mDELETE',
           PATCH:'mPATCH', HEAD:'mHEAD', OPTIONS:'mOPTIONS' }[m] || 'mHEAD';
}

function switchTab(id) {
  saveCurrentTabState();
  State.activeTab = id;
  renderTabs();
  loadTabToUI(State.getTab(id));
  if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
}

function closeTab(id) {
  const idx = State.tabs.findIndex(t => t.id === id);
  State.removeTab(id);
  if (State.activeTab === id) {
    const next = State.tabs[Math.min(idx, State.tabs.length - 1)];
    if (next) { State.activeTab = next.id; loadTabToUI(next); }
    else       { addNewTab(); return; }
  }
  renderTabs();
  if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
}

function addNewTab(overrides) {
  const tab = State.newTab(overrides);
  State.activeTab = tab.id;
  renderTabs();
  loadTabToUI(tab);
  if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
  return tab;
}

function saveCurrentTabState() {
  const tab = State.getTab(State.activeTab);
  if (!tab) return;
  tab.method    = document.getElementById('method-sel').value;
  tab.url       = document.getElementById('url-inp').value;
  tab.params    = readKV('params-kv');
  tab.headers   = readKV('headers-kv');
  tab.body      = document.getElementById('body-ta').value;
  tab.bodyType  = document.querySelector('.btype.active')?.dataset.bt || 'json';
  tab.auth      = readAuth();
  tab.prescript = document.getElementById('prescript-ta').value;
  tab.postscript = document.getElementById('postscript-ta').value;
  tab.transportMode = document.getElementById('transport-sel')?.value || tab.transportMode || 'auto';
  if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
}

function loadTabToUI(tab) {
  if (!tab) return;
  document.getElementById('method-sel').value = tab.method;
  updateMethodStyle();
  document.getElementById('url-inp').value = tab.url;
  renderKV('params-kv', tab.params);
  renderKV('headers-kv', tab.headers);
  document.getElementById('body-ta').value = tab.body;
  setBodyType(tab.bodyType || 'json');
  loadAuth(tab.auth);
  document.getElementById('prescript-ta').value  = tab.prescript  || '';
  document.getElementById('postscript-ta').value = tab.postscript || '';
  const transportSel = document.getElementById('transport-sel');
  if (transportSel) transportSel.value = tab.transportMode || 'auto';
  if (typeof updateBrowserCompatibilityUi === 'function') updateBrowserCompatibilityUi(tab);
  renderVariablesPanel(tab.collectionId || null);
  // Clear script logs when switching tabs
  ['prescript-log','postscript-log'].forEach(id => {
    const el = document.getElementById(id);
    el.style.display = 'none'; el.innerHTML = '';
  });
  // Clear post-script test badges
  const ptab = document.querySelector('.stab[data-st="postscript"]');
  if (ptab) { ptab.classList.remove('has-tests','some-fail'); ptab.removeAttribute('data-pass'); ptab.removeAttribute('data-total'); }
  updateSubTabCounts();

  // show response if tab has one
  if (tab.response) {
    State.lastResponse = tab.response;
    renderResponse(tab.response, State.activeResponseTab || 'body');
  } else {
    showRespEmpty();
  }
  requestAnimationFrame(() => {
    syncRequestEditors();
    applyStoredRequestPanelHeight();
    refreshVariableTokenHighlight();
  });
}

function updateMethodStyle() {
  const sel = document.getElementById('method-sel');
  sel.className = '';
  const m = sel.value;
  sel.style.color = { GET:'var(--green)', POST:'var(--amber)', PUT:'var(--blue)',
    DELETE:'var(--red)', PATCH:'var(--purple)' }[m] || 'var(--text)';
}

// ── KV Rows ───────────────────────────────────────────────────
function renderKV(containerId, rows) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  (rows || []).forEach(([k, v]) => addKVRow(container, k, v));
  addKVRow(container, '', ''); // empty placeholder
  requestAnimationFrame(refreshVariableTokenHighlight);
}

function addKVRow(container, k, v) {
  const row = document.createElement('div');
  row.className = 'kv-row';
  row.innerHTML = `
    <input type="text" placeholder="Key" value="${esc(k)}" />
    <input type="text" placeholder="Value" value="${esc(v)}" />
    <button class="kv-del" title="Remove">×</button>`;
  row.querySelector('.kv-del').addEventListener('click', () => {
    row.remove(); updateSubTabCounts();
    if (typeof markActiveTabCompatibilityUntested === 'function') markActiveTabCompatibilityUntested();
    if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
  });
  // auto-add new row when typing in last empty row
  row.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      updateSubTabCounts();
      const rows = container.querySelectorAll('.kv-row');
      const last = rows[rows.length - 1];
      if (row === last && inp.value) addKVRow(container, '', '');
      if (typeof markActiveTabCompatibilityUntested === 'function') markActiveTabCompatibilityUntested();
      if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
    });
  });
  container.appendChild(row);
}

function readKV(containerId) {
  const rows = [];
  document.querySelectorAll(`#${containerId} .kv-row`).forEach(row => {
    const [k, v] = [...row.querySelectorAll('input')].map(i => i.value.trim());
    if (k) rows.push([k, v]);
  });
  return rows;
}

// ── Sub-tab counts ────────────────────────────────────────────
function updateSubTabCounts() {
  const pc = readKV('params-kv').length;
  const hc = readKV('headers-kv').length;
  const activeTab = State.getTab(State.activeTab);
  const vc = Object.keys(State.variablesFor(activeTab?.collectionId || null).merged || {}).length;
  document.getElementById('params-cnt').textContent  = pc  || '';
  document.getElementById('headers-cnt').textContent = hc  || '';
  const variablesCnt = document.getElementById('variables-cnt');
  if (variablesCnt) variablesCnt.textContent = vc || '';
}

// ── Body type ─────────────────────────────────────────────────
function setBodyType(bt) {
  document.querySelectorAll('.btype').forEach(b => b.classList.toggle('active', b.dataset.bt === bt));
  const ta = document.getElementById('body-ta');
  const hint = document.getElementById('body-content-type-hint');
  const map = { json:'application/json', xml:'application/xml', form:'application/x-www-form-urlencoded', text:'text/plain', graphql:'application/json' };
  if (hint) hint.textContent = map[bt] || '';
  ta.placeholder = {
    json: '{\n  "key": "value"\n}',
    xml:  '<root>\n  <key>value</key>\n</root>',
    form: 'key=value&other=data',
    text: 'Plain text body...',
    graphql: '{\n  query {\n    field\n  }\n}',
  }[bt] || '';
  autoSizeEditor(ta);
  fitRequestPanelToContent();
  requestAnimationFrame(refreshVariableTokenHighlight);
  if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
}

// ── Auth ──────────────────────────────────────────────────────
function loadAuth(auth) {
  const sel = document.getElementById('auth-sel');
  const type = auth?.type || 'none';
  sel.value = type;
  renderAuthFields(type, auth);
}

function renderAuthFields(type, auth = {}) {
  const container = document.getElementById('auth-fields');
  container.innerHTML = '';
  const field = (id, label, val, t='text') => `
    <div class="auth-field">
      <label>${label}</label>
      <input type="${t}" id="${id}" value="${esc(val || '')}" placeholder="${label}"/>
    </div>`;
  if (type === 'bearer') {
    container.innerHTML = field('auth-token', 'Bearer Token', auth.token, 'text');
  } else if (type === 'basic') {
    container.innerHTML = field('auth-user', 'Username', auth.username) + field('auth-pass', 'Password', auth.password, 'password');
  } else if (type === 'apikey') {
    container.innerHTML = field('auth-key-name', 'Header / Query Name', auth.key_name || 'X-API-Key') +
      field('auth-key-val', 'Value', auth.key_value) + `
      <div class="auth-field">
        <label>Add to</label>
        <select id="auth-key-in">
          <option value="header" ${auth.in==='header'?'selected':''}>Header</option>
          <option value="query"  ${auth.in==='query' ?'selected':''}>Query Param</option>
        </select>
      </div>`;
  } else if (type === 'oauth2') {
    container.innerHTML = field('auth-token', 'Access Token', auth.token);
  } else if (type === 'none') {
    container.innerHTML = '<p style="color:var(--text3);font-size:12px;padding:6px 0">No authentication</p>';
  }
  requestAnimationFrame(refreshVariableTokenHighlight);
}

function readAuth() {
  const type = document.getElementById('auth-sel').value;
  const g = id => document.getElementById(id)?.value || '';
  if (type === 'bearer')  return { type, token: g('auth-token') };
  if (type === 'basic')   return { type, username: g('auth-user'), password: g('auth-pass') };
  if (type === 'apikey')  return { type, key_name: g('auth-key-name'), key_value: g('auth-key-val'), in: g('auth-key-in') || 'header' };
  if (type === 'oauth2')  return { type, token: g('auth-token') };
  return { type: 'none' };
}

// ── ENV strip ─────────────────────────────────────────────────
function renderEnvStrip() {
  const sel  = document.getElementById('env-sel');
  if (!sel) return;
  const envs = State.environments.envs || {};
  const activeId = State.environments.active;

  // Rebuild options
  sel.innerHTML = '<option value="">— No Environment —</option>';
  Object.values(envs).forEach(env => {
    const opt = document.createElement('option');
    opt.value = env.id; opt.textContent = env.name;
    if (env.id === activeId) opt.selected = true;
    sel.appendChild(opt);
  });

  const activeTab = State.getTab(State.activeTab);
  renderVariablesPanel(activeTab?.collectionId || null);
  updateSubTabCounts();
}

function renderVariablesPanel(collectionId = null) {
  const panel = document.getElementById('variables-panel');
  if (!panel) return;

  const envId = State.environments.active;
  const env = envId ? (State.environments.envs || {})[envId] : null;
  const collection = collectionId ? State.collections[collectionId] : null;
  const envVars = env?.variables || {};
  const colVars = collection?.variables || {};

  function renderRows(scope, vars, scopeLabel, sourceLabel) {
    const entries = Object.entries(vars || {});
    if (!entries.length) {
      return `
        <div class="vars-empty">
          <div class="vars-empty-title">No ${scopeLabel.toLowerCase()} variables yet</div>
          <button class="vars-edit-btn" type="button" data-var-action="new" data-var-scope="${scope}">
            Add ${scopeLabel} variable
          </button>
        </div>`;
    }

    return `
      <div class="vars-list">
        ${entries.map(([key, value]) => `
          <button class="var-chip-card" type="button" data-var-edit="${esc(key)}">
            <span class="var-chip-name">{{${esc(key)}}}</span>
            <span class="var-chip-value">${esc(String(value ?? ''))}</span>
            <span class="var-chip-meta">${esc(sourceLabel)}</span>
          </button>`).join('')}
      </div>
      <button class="vars-edit-btn secondary" type="button" data-var-action="new" data-var-scope="${scope}">
        Add another
      </button>`;
  }

  panel.innerHTML = `
    <div class="vars-shell">
      <div class="vars-section">
        <div class="vars-section-head">
          <div>
            <div class="vars-kicker">Environment</div>
            <div class="vars-title">${esc(env?.name || 'No environment selected')}</div>
          </div>
          <button class="vars-edit-btn" type="button" data-var-action="manage-env">Manage</button>
        </div>
        ${renderRows('environment', envVars, 'Environment', env?.name || 'Environment')}
      </div>
      <div class="vars-section">
        <div class="vars-section-head">
          <div>
            <div class="vars-kicker">Collection</div>
            <div class="vars-title">${esc(collection?.name || 'Unsaved request')}</div>
          </div>
          <button class="vars-edit-btn" type="button" data-var-action="manage-collection" ${collection ? '' : 'disabled'}>
            Manage
          </button>
        </div>
        ${renderRows('collection', colVars, 'Collection', collection?.name || 'Collection')}
      </div>
    </div>`;

  panel.querySelectorAll('[data-var-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof openVariableEditor === 'function') openVariableEditor(btn.dataset.varEdit || '', collectionId || null);
    });
  });

  panel.querySelectorAll('[data-var-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.varAction;
      if (action === 'manage-env') {
        if (typeof openEnvModal === 'function') openEnvModal(envId || null);
        return;
      }
      if (action === 'manage-collection') {
        if (collectionId && typeof openCollectionOverview === 'function') openCollectionOverview(collectionId);
        return;
      }
      if (action === 'new') {
        const key = prompt(`Variable name for the ${btn.dataset.varScope === 'collection' ? 'collection' : 'environment'}:`);
        if (key && typeof openVariableEditor === 'function') openVariableEditor(key.trim(), collectionId || null);
      }
    });
  });
}

function activateRequestSubTab(tabName, persist = true) {
  document.querySelectorAll('.stab').forEach(x => x.classList.toggle('active', x.dataset.st === tabName));
  document.querySelectorAll('.spanel').forEach(x => x.classList.remove('active'));
  document.getElementById('panel-' + tabName)?.classList.add('active');
  requestAnimationFrame(() => {
    syncRequestEditors();
    fitRequestPanelToContent();
    refreshVariableTokenHighlight();
    if (persist && typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
  });
}

function getRequestPanelBounds() {
  const panel = document.getElementById('req-panel');
  if (!panel) return { min: 118, max: Math.max(220, Math.floor(window.innerHeight * 0.46)) };

  const chromeIds = ['url-bar', 'req-subtabs', 'resize-handle'];
  const chrome = chromeIds.reduce((sum, id) => sum + (document.getElementById(id)?.offsetHeight || 0), 0);
  const available = panel.clientHeight - chrome;
  const min = 118;
  const max = Math.max(min, available - 340);
  return { min, max: Math.max(min, max) };
}

function autoSizeEditor(el) {
  if (!el) return;
  const min = el.id === 'body-ta' ? 136 : 124;
  const panel = el.closest('.spanel');
  const siblingsHeight = panel
    ? [...panel.children]
        .filter(child => child !== el)
        .reduce((sum, child) => sum + child.offsetHeight + 10, 0)
    : 0;
  const available = panel && panel.classList.contains('active')
    ? Math.max(min, panel.clientHeight - siblingsHeight - 2)
    : min;
  const contentHeight = Math.max(min, el.scrollHeight + 2);
  const viewportCap = Math.max(min, Math.floor(window.innerHeight * (el.id === 'body-ta' ? 0.28 : 0.2)));
  const next = State.reqPanelManual
    ? Math.max(contentHeight, available)
    : Math.max(Math.min(contentHeight, viewportCap), available);

  el.style.height = `${next}px`;
  el.style.overflowY = contentHeight > next ? 'auto' : 'hidden';
}

function syncRequestEditors() {
  ['body-ta', 'prescript-ta', 'postscript-ta'].forEach(id => autoSizeEditor(document.getElementById(id)));
  refreshVariableTokenHighlight();
}

function setRequestPanelHeight(height, { manual = true, persist = true } = {}) {
  const reqContent = document.getElementById('req-content');
  if (!reqContent) return;
  const { min, max } = getRequestPanelBounds();
  const next = Math.max(min, Math.min(Math.round(height || min), max));
  reqContent.style.height = next + 'px';
  reqContent.style.maxHeight = max + 'px';
  State.reqPanelHeight = next;
  State.reqPanelManual = manual;
  syncRequestEditors();
  if (persist && typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
}

function fitRequestPanelToContent(force = false) {
  if (State.reqPanelManual && !force) return;
  const activePanel = document.querySelector('.spanel.active');
  const { min, max } = getRequestPanelBounds();
  let desired = min + 18;
  if (activePanel) desired = activePanel.scrollHeight + 18;
  setRequestPanelHeight(desired, { manual: false, persist: false });
  const current = typeof State.reqPanelHeight === 'number' ? State.reqPanelHeight : desired;
  if (current > max) setRequestPanelHeight(max, { manual: false, persist: false });
}

function applyStoredRequestPanelHeight() {
  if (typeof State.reqPanelHeight === 'number' && State.reqPanelHeight > 0) {
    setRequestPanelHeight(State.reqPanelHeight, { manual: !!State.reqPanelManual, persist: false });
  } else {
    fitRequestPanelToContent(true);
  }
}

function setSidebarCollapsed(collapsed, persist = true) {
  const sidebar = document.getElementById('sidebar');
  const workspace = document.getElementById('workspace');
  if (!sidebar || !workspace) return;
  sidebar.classList.toggle('collapsed', collapsed);
  workspace.classList.toggle('sidebar-collapsed', collapsed);
  if (persist && typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
}

// ── Sidebar ───────────────────────────────────────────────────
function renderSidebar(filter = '') {
  const list = document.getElementById('collections-list');
  list.innerHTML = '';
  const cols = Object.values(State.collections);
  if (!cols.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">No collections yet.<br><br>Import JSON / cURL or create one.</div>';
    return;
  }
  cols.forEach(col => {
    const reqs = (col.requests || []).filter(r =>
      !filter || r.name.toLowerCase().includes(filter.toLowerCase()) ||
                 r.url.toLowerCase().includes(filter.toLowerCase()));
    if (filter && !reqs.length && !col.name.toLowerCase().includes(filter.toLowerCase())) return;
    const isOpen = col._open !== false;

    const group = document.createElement('div');
    group.className = 'coll-group';
    group.innerHTML = `
      <div class="coll-head ${isOpen ? 'open' : ''}" data-cid="${col.id}">
        <span class="coll-chevron">▶</span>
        <span class="coll-name-text">${esc(col.name)}</span>
        <span class="coll-count">${(col.requests||[]).length}</span>
        <button class="coll-menu-btn" data-cmenu="${col.id}" title="Collection options">⋯</button>
      </div>
      <div class="coll-body">
        ${reqs.map(r => `
          <div class="req-item" data-rid="${r.id}" data-cid="${col.id}">
            <span class="meth ${methodColor(r.method)}">${r.method}</span>
            <span class="req-name-text" title="${esc(r.url)}">${esc(r.name || r.url)}</span>
          </div>`).join('')}
        <div style="padding:4px 10px 4px 22px">
          <button class="add-kv" data-addreq="${col.id}">+ Add Request</button>
        </div>
      </div>`;

    // Collection header click → toggle or open overview
    group.querySelector('.coll-head').addEventListener('click', e => {
      if (e.target.closest('.coll-menu-btn')) return;
      const head = group.querySelector('.coll-head');
      head.classList.toggle('open');
      col._open = head.classList.contains('open');
    });

    // Collection header DOUBLE-click → overview
    group.querySelector('.coll-name-text').addEventListener('dblclick', e => {
      e.stopPropagation();
      openCollectionOverview(col.id);
    });

    // Menu button
    group.querySelector('.coll-menu-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      openCollectionOverview(col.id);
    });

    // Request click
    group.querySelectorAll('.req-item').forEach(item => {
      item.addEventListener('click', () => {
        const r = (col.requests || []).find(x => x.id === item.dataset.rid);
        if (!r) return;
        addNewTab({
          name:         r.name || r.url,
          method:       r.method,
          url:          r.url,
          params:       r.params || [],
          headers:      r.headers || [],
          body:         r.body || '',
          bodyType:     r.bodyType || 'json',
          auth:         r.auth || { type:'none' },
          prescript:    r.prescript || '',
          savedReqId:   r.id,
          collectionId: col.id,
          transportMode: r.transport_mode || r.transportMode || 'auto',
          browserCompatibility: r.browser_compatibility || r.browserCompatibility || API.compatibilityStatus('untested', 'Browser compatibility has not been checked yet.'),
          postscript:   r.postscript || '',
        });
      });
    });

    // Add request button
    group.querySelector('[data-addreq]')?.addEventListener('click', e => {
      e.stopPropagation();
      addNewTab({ name:'New Request', collectionId: col.id });
    });

    list.appendChild(group);
  });
}

const VAR_TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
let _varHoverTooltip = null;
let _varHoverMirror = null;
let _varHighlightLayer = null;
let _varHoverField = null;
let _varHoverToken = '';
let _varHighlightField = null;

function initVariableHover() {
  ensureVariableHoverEls();
  document.addEventListener('mousemove', handleVariableHoverMove, true);
  document.addEventListener('dblclick', handleVariableHoverDoubleClick, true);
  document.addEventListener('input', handleVariableHoverInput, true);
  document.addEventListener('scroll', handleVariableHighlightViewportChange, true);
  document.addEventListener('pointerdown', hideVariableHover, true);
  document.addEventListener('focusin', handleVariableHighlightFocus, true);
  document.addEventListener('mouseout', e => {
    if (!e.relatedTarget) hideVariableHover();
  }, true);
  window.addEventListener('resize', handleVariableHighlightViewportChange);
}

function ensureVariableHoverEls() {
  if (!_varHoverTooltip) {
    _varHoverTooltip = document.createElement('div');
    _varHoverTooltip.id = 'var-hover-tooltip';
    document.body.appendChild(_varHoverTooltip);
  }
  if (!_varHoverMirror) {
    _varHoverMirror = document.createElement('div');
    _varHoverMirror.id = 'var-hover-mirror';
    _varHoverMirror.setAttribute('aria-hidden', 'true');
    document.body.appendChild(_varHoverMirror);
  }
  if (!_varHighlightLayer) {
    _varHighlightLayer = document.createElement('div');
    _varHighlightLayer.id = 'var-highlight-layer';
    _varHighlightLayer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(_varHighlightLayer);
  }
}

function handleVariableHoverMove(e) {
  const field = getVariableHoverField(e.target);
  if (!field) {
    hideVariableHover();
    return;
  }
  syncVariableTokenHighlight(field);

  const hovered = findHoveredVariableToken(field, e.clientX, e.clientY);
  if (!hovered) {
    hideVariableHover();
    return;
  }

  const tab = State.getTab(State.activeTab);
  const resolved = State.resolveVariable(hovered.key, tab?.collectionId || null);
  showVariableHover(field, hovered, resolved);
}

function handleVariableHoverInput(e) {
  if (_varHoverField === e.target) hideVariableHover();
  const field = getVariableHoverField(e.target);
  if (field) syncVariableTokenHighlight(field);
}

function handleVariableHoverDoubleClick(e) {
  const field = getVariableHoverField(e.target);
  if (!field) return;
  const hovered = findHoveredVariableToken(field, e.clientX, e.clientY);
  if (!hovered) return;
  e.preventDefault();
  e.stopPropagation();
  const tab = State.getTab(State.activeTab);
  if (typeof openVariableEditor === 'function') {
    openVariableEditor(hovered.key, tab?.collectionId || null);
  }
}

function handleVariableHighlightFocus(e) {
  hideVariableHover();
  const field = getVariableHoverField(e.target);
  if (field) syncVariableTokenHighlight(field);
  else hideVariableTokenHighlight();
}

function handleVariableHighlightViewportChange() {
  hideVariableHover();
  refreshVariableTokenHighlight();
}

function getVariableHoverField(target) {
  if (!(target instanceof Element)) return null;
  const field = target.closest('#url-inp, #body-ta, #params-kv input, #headers-kv input, #auth-fields input');
  if (!field) return null;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return null;
  if (field instanceof HTMLInputElement && (field.type === 'password' || field.type === 'hidden')) return null;
  return field;
}

function findHoveredVariableToken(field, clientX, clientY) {
  const value = field.value || '';
  if (!value.includes('{{')) return null;

  syncVariableHoverMirror(field, value);
  const tokens = _varHoverMirror.querySelectorAll('.var-hover-token');
  for (const token of tokens) {
    const rect = token.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return {
        key: token.dataset.key || '',
        raw: token.dataset.raw || token.textContent || '',
        rect,
      };
    }
  }
  return null;
}

function syncVariableHoverMirror(field, value) {
  const tab = State.getTab(State.activeTab);
  syncVariableTokenLayer(_varHoverMirror, field, value, 'var-hover-token', tab?.collectionId || null);
}

function syncVariableTokenHighlight(field) {
  if (!shouldShowVariableTokenHighlight(field)) {
    hideVariableTokenHighlight();
    return;
  }
  ensureVariableHoverEls();
  const tab = State.getTab(State.activeTab);
  syncVariableTokenLayer(_varHighlightLayer, field, field.value || '', 'var-highlight-token', tab?.collectionId || null);
  _varHighlightLayer.classList.add('show');
  _varHighlightField = field;
}

function syncVariableTokenLayer(layer, field, value, tokenClass, collectionId = null) {
  ensureVariableHoverEls();
  const cs = getComputedStyle(field);
  const rect = field.getBoundingClientRect();
  const isTextarea = field instanceof HTMLTextAreaElement;
  const props = [
    'boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'lineHeight', 'textTransform', 'textIndent', 'wordSpacing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
  ];

  props.forEach(prop => {
    layer.style[prop] = cs[prop];
  });

  layer.className = isTextarea ? 'textarea' : 'input';
  layer.style.left = rect.left + 'px';
  layer.style.top = rect.top + 'px';
  layer.style.width = rect.width + 'px';
  layer.style.height = rect.height + 'px';
  layer.style.whiteSpace = isTextarea ? 'pre-wrap' : 'pre';
  layer.style.overflowWrap = isTextarea ? 'break-word' : 'normal';
  layer.style.wordBreak = isTextarea ? 'break-word' : 'normal';
  layer.style.textAlign = cs.textAlign;
  layer.style.overflow = 'hidden';
  layer.innerHTML = buildVariableTokenMirrorHTML(value, tokenClass, collectionId);
  layer.scrollTop = field.scrollTop;
  layer.scrollLeft = field.scrollLeft;
}

function buildVariableTokenMirrorHTML(value, tokenClass, collectionId = null) {
  let html = '';
  let lastIndex = 0;
  VAR_TOKEN_RE.lastIndex = 0;

  for (let match = VAR_TOKEN_RE.exec(value); match; match = VAR_TOKEN_RE.exec(value)) {
    const key = match[1].trim();
    const resolved = State.resolveVariable(key, collectionId);
    const sourceClass = resolved.source === 'collection'
      ? ' var-token-collection'
      : (resolved.source === 'environment' ? ' var-token-environment' : ' var-token-missing');
    html += esc(value.slice(lastIndex, match.index));
    html += `<span class="${tokenClass}${sourceClass}" data-key="${esc(key)}" data-raw="${esc(match[0])}">${esc(match[0])}</span>`;
    lastIndex = match.index + match[0].length;
  }

  html += esc(value.slice(lastIndex));
  if (!html) return '&nbsp;';
  if (value.endsWith('\n')) html += '\n ';
  return html;
}

function showVariableHover(field, hovered, resolved) {
  ensureVariableHoverEls();
  const tokenSig = `${field.id || field.name || 'field'}:${hovered.raw}:${hovered.rect.left}:${hovered.rect.top}`;
  if (_varHoverField !== field || _varHoverToken !== tokenSig) {
    _varHoverTooltip.className = 'show' + (resolved.found ? '' : ' missing');
    _varHoverTooltip.innerHTML = `
      <div class="var-hover-token-name">${esc(hovered.raw)}</div>
      <div class="var-hover-source">${getVariableHoverSourceLabel(resolved)}</div>
      <div class="var-hover-value">${formatVariableHoverValue(resolved)}</div>`;
  }

  _varHoverField = field;
  _varHoverToken = tokenSig;
  positionVariableHover(hovered.rect);
}

function positionVariableHover(anchorRect) {
  const gap = 10;
  const tipRect = _varHoverTooltip.getBoundingClientRect();
  let left = anchorRect.left + (anchorRect.width / 2) - (tipRect.width / 2);
  left = Math.max(10, Math.min(left, window.innerWidth - tipRect.width - 10));

  let top = anchorRect.bottom + gap;
  if (top + tipRect.height > window.innerHeight - 10) {
    top = anchorRect.top - tipRect.height - gap;
  }
  top = Math.max(10, top);

  _varHoverTooltip.style.left = left + 'px';
  _varHoverTooltip.style.top = top + 'px';
}

function getVariableHoverSourceLabel(resolved) {
  if (resolved.source === 'collection') {
    return resolved.overriddenEnv ? 'Collection variable override' : 'Collection variable';
  }
  if (resolved.source === 'environment') {
    return 'Active environment variable';
  }
  return 'Variable not found';
}

function formatVariableHoverValue(resolved) {
  if (!resolved.found) {
    return '<span class="var-hover-missing">No value in the active environment or this collection.</span>';
  }
  const value = resolved.value == null ? '' : String(resolved.value);
  if (!value) {
    return '<span class="var-hover-empty">(empty string)</span>';
  }
  return esc(value).replace(/\n/g, '<br>');
}

function hideVariableHover() {
  if (_varHoverTooltip) _varHoverTooltip.className = '';
  _varHoverField = null;
  _varHoverToken = '';
}

function shouldShowVariableTokenHighlight(field) {
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
  if (field instanceof HTMLInputElement && (field.type === 'password' || field.type === 'hidden')) return false;
  if (!field.isConnected || field.offsetParent === null) return false;
  return String(field.value || '').includes('{{');
}

function getPreferredVariableHighlightField() {
  const focused = getVariableHoverField(document.activeElement);
  if (shouldShowVariableTokenHighlight(focused)) return focused;

  if (shouldShowVariableTokenHighlight(_varHighlightField)) return _varHighlightField;

  const candidates = [
    document.getElementById('url-inp'),
    document.querySelector('#panel-body.active #body-ta'),
    ...document.querySelectorAll('#panel-params.active #params-kv input, #panel-headers.active #headers-kv input, #panel-auth.active #auth-fields input'),
  ];
  return candidates.find(shouldShowVariableTokenHighlight) || null;
}

function refreshVariableTokenHighlight() {
  const field = getPreferredVariableHighlightField();
  if (!field) {
    hideVariableTokenHighlight();
    return;
  }
  syncVariableTokenHighlight(field);
}

function hideVariableTokenHighlight() {
  if (_varHighlightLayer) _varHighlightLayer.classList.remove('show');
  _varHighlightField = null;
}

// ── Response ──────────────────────────────────────────────────
function showRespEmpty() {
  State.activeResponseTab = 'body';
  document.getElementById('resp-empty').style.display = '';
  document.getElementById('resp-out').style.display   = 'none';
  document.getElementById('resp-preview').style.display = 'none';
  document.getElementById('resp-hdrs').style.display  = 'none';
  document.getElementById('resp-tests').style.display = 'none';
  document.getElementById('resp-error').style.display = 'none';
  document.getElementById('resp-ai').classList.remove('visible');
  document.getElementById('resp-ai').style.display = 'none';
  document.getElementById('resp-topbar').style.display = 'none';
}

function renderResponse(resp, preferredTab = '') {
  document.getElementById('resp-empty').style.display  = 'none';
  document.getElementById('resp-topbar').style.display = '';
  document.getElementById('resp-ai').classList.remove('visible');
  const desiredTab = preferredTab || State.activeResponseTab || 'body';
  const activeTab = State.getTab(State.activeTab);
  const activeUrl = activeTab?.url || '';
  const requestSummary = activeTab ? `
    <span class="resp-request-pill" title="${esc(activeUrl)}">
      <span class="req-method">${esc(activeTab.method || 'GET')}</span>
      <span class="req-url">${esc(activeUrl || activeTab.name || 'Request')}</span>
    </span>` : '';

  const tb = document.getElementById('resp-topbar');
  const preview = document.getElementById('resp-preview');

  if (resp.connection_error || resp.status_code === 0) {
    // Connection-level error: show detailed error panel
    document.getElementById('resp-out').style.display   = 'none';
    preview.style.display = 'none';
    document.getElementById('resp-hdrs').style.display  = 'none';
    document.getElementById('resp-tests').style.display = 'none';
    document.getElementById('resp-ai').style.display    = 'none';

    const errEl = document.getElementById('resp-error');
    errEl.style.display = '';
    errEl.innerHTML = `
      <div class="err-title">Warning ${esc(resp.status_text || 'Connection Error')}</div>
      <div class="err-body">${esc(resp.error || 'Unknown error')}</div>`;

    tb.innerHTML = `
      ${requestSummary}
      <span class="status-pill s4">0 Connection Error</span>
      <span id="resp-meta">${resp.elapsed_ms || 0}ms</span>
      <span class="resp-exec-mode ${esc(resp.execution_mode || 'proxy')}">${esc((resp.execution_mode || 'proxy').toUpperCase())}</span>`;
    State.activeResponseTab = 'body';
    return;
  }

  const errEl = document.getElementById('resp-error');
  const sc  = resp.status_code;
  if (sc >= 400) {
    errEl.style.display = '';
    errEl.innerHTML = `
      <div class="err-title">${sc} ${esc(resp.status_text || 'Request Failed')}</div>
      <div class="err-body">${esc(resp.error_detail || resp.error || 'The API returned an error response.')}${resp.error_hint ? `<br><br><strong>What to check:</strong><br>${esc(resp.error_hint)}` : ''}</div>`;
  } else {
    errEl.style.display = 'none';
    errEl.innerHTML = '';
  }

  // Status pill
  const cls = sc >= 500 ? 's5' : sc >= 400 ? 's4' : sc >= 300 ? 's3' : 's2';
  const size = resp.size_bytes > 1024
    ? `${(resp.size_bytes/1024).toFixed(1)} KB`
    : `${resp.size_bytes} B`;

  tb.innerHTML = `
    ${requestSummary}
    <span class="status-pill ${cls}">${sc} ${esc(resp.status_text)}</span>
    <span id="resp-meta">${resp.elapsed_ms}ms · ${size}</span>
    <span class="resp-exec-mode ${esc(resp.execution_mode || 'proxy')}">${esc((resp.execution_mode || 'proxy').toUpperCase())}</span>
    <div id="resp-tab-list">
      <span class="rtab" data-rt="body">Body</span>
      <span class="rtab" data-rt="preview">Preview</span>
      <span class="rtab" data-rt="headers">Headers</span>
      <span class="rtab" data-rt="tests">Tests</span>
      <span class="rtab" data-rt="ai">AI</span>
    </div>
    <button id="analyze-btn">Analyze with AI</button>
    <button id="copy-btn">Copy</button>`;

  // Wire response tabs
  tb.querySelectorAll('.rtab').forEach(t =>
    t.addEventListener('click', () => switchRespTab(t.dataset.rt)));

  document.getElementById('analyze-btn')?.addEventListener('click', doAiAnalyze);
  document.getElementById('copy-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(resp.body || '');
    showToast('Copied!');
  });

  // Body
  const out = document.getElementById('resp-out');
  out.style.display = 'block';
  out.innerHTML = resp.is_json ? syntaxHighlight(resp.body) : esc(resp.body);
  renderResponsePreview(resp);

  // Headers
  const hdrs = document.getElementById('resp-hdrs');
  hdrs.style.display = 'none';
  hdrs.innerHTML = Object.entries(resp.headers || {}).map(([k,v]) =>
    `<div class="rh-row"><span class="rh-key">${esc(k)}</span><span class="rh-val">${esc(String(v))}</span></div>`
  ).join('');

  renderResponseTests(resp);
  // AI panel hidden by default
  document.getElementById('resp-ai').style.display = 'none';
  switchRespTab(desiredTab);
}

function switchRespTab(rt) {
  State.activeResponseTab = rt;
  document.querySelectorAll('.rtab').forEach(t => t.classList.toggle('active', t.dataset.rt === rt));
  document.getElementById('resp-out').style.display   = rt==='body'    ? 'block' : 'none';
  document.getElementById('resp-preview').style.display = rt==='preview' ? 'block' : 'none';
  document.getElementById('resp-hdrs').style.display  = rt==='headers' ? 'block' : 'none';
  document.getElementById('resp-tests').style.display = rt==='tests' ? 'block' : 'none';
  const aiEl = document.getElementById('resp-ai');
  if (rt === 'ai') {
    aiEl.style.display = 'flex';
    aiEl.classList.add('visible');
  } else {
    aiEl.style.display = 'none';
    aiEl.classList.remove('visible');
  }
}

function renderResponseTests(resp) {
  const testsEl = document.getElementById('resp-tests');
  if (!testsEl) return;
  const tests = Array.isArray(resp?.tests) ? resp.tests : [];
  const logs = Array.isArray(resp?.postscript_logs) ? resp.postscript_logs : [];
  const err = resp?.postscript_error || '';
  const pass = tests.filter(test => test.passed).length;
  const total = tests.length;

  testsEl.style.display = 'none';
  testsEl.innerHTML = `
    <div class="tests-summary-grid">
      <div class="tests-card">
        <span class="tests-card-label">Assertions</span>
        <strong>${total}</strong>
      </div>
      <div class="tests-card">
        <span class="tests-card-label">Passed</span>
        <strong>${pass}</strong>
      </div>
      <div class="tests-card">
        <span class="tests-card-label">Failed</span>
        <strong>${Math.max(0, total - pass)}</strong>
      </div>
    </div>
    ${err ? `<div class="tests-runtime-error">${esc(err)}</div>` : ''}
    ${tests.length ? `
      <div class="tests-list">
        ${tests.map(test => `
          <div class="test-row ${test.passed ? 'pass' : 'fail'}">
            <span class="test-state">${test.passed ? 'PASS' : 'FAIL'}</span>
            <span class="test-name">${esc(test.name || 'Unnamed test')}</span>
          </div>`).join('')}
      </div>` : '<div class="tests-empty">No post-script tests ran for this response yet.</div>'}
    ${logs.length ? `
      <div class="tests-log-block">
        <div class="tests-log-title">Script log</div>
        ${logs.map(log => `<div class="tests-log-row ${esc(log.type || 'info')}">${esc(log.msg || '')}</div>`).join('')}
      </div>` : ''}`;
}

function syntaxHighlight(json) {
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
    let cls = 'jn';
    if (/^"/.test(m)) cls = /:$/.test(m) ? 'jk' : 'js';
    else if (/true|false/.test(m)) cls = 'jb';
    else if (/null/.test(m)) cls = 'jnull';
    return `<span class="${cls}">${esc(m)}</span>`;
  });
}

// ── Helpers ───────────────────────────────────────────────────
function renderResponsePreview(resp) {
  const preview = document.getElementById('resp-preview');
  if (!preview) return;

  preview.style.display = 'none';
  preview.innerHTML = '';

  const body = resp?.body || '';
  if (!body) {
    preview.innerHTML = '<div class="preview-empty">No response body to preview.</div>';
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch (_) {
  }

  if (parsed == null) {
    preview.innerHTML = `
      <div class="preview-grid">
        <div class="preview-card">
          <div class="preview-card-label">Content Type</div>
          <div class="preview-card-value">${esc(findHeaderValue(resp.headers || {}, 'Content-Type') || 'Unknown')}</div>
        </div>
        <div class="preview-card">
          <div class="preview-card-label">Body Size</div>
          <div class="preview-card-value">${esc(String(resp.size_bytes || 0))} bytes</div>
        </div>
      </div>
      <div class="preview-empty">Preview mode works best with JSON responses. Use the Body tab for raw text, HTML, or XML payloads.</div>`;
    return;
  }

  if (Array.isArray(parsed)) {
    renderArrayPreview(preview, parsed);
    return;
  }

  if (typeof parsed === 'object') {
    renderObjectPreview(preview, parsed);
    return;
  }

  preview.innerHTML = `<div class="preview-json">${esc(JSON.stringify(parsed, null, 2))}</div>`;
}

function renderArrayPreview(container, rows) {
  const sample = rows.find(row => row && typeof row === 'object' && !Array.isArray(row));
  const keys = sample ? Object.keys(sample).slice(0, 6) : [];

  const summary = `
    <div class="preview-grid">
      <div class="preview-card">
        <div class="preview-card-label">Items</div>
        <div class="preview-card-value">${rows.length}</div>
      </div>
      <div class="preview-card">
        <div class="preview-card-label">Shape</div>
        <div class="preview-card-value">${sample ? 'Array of objects' : 'Array of values'}</div>
      </div>
      <div class="preview-card">
        <div class="preview-card-label">Previewed Rows</div>
        <div class="preview-card-value">${Math.min(rows.length, 8)}</div>
      </div>
    </div>`;

  if (!sample) {
    container.innerHTML = `${summary}<div class="preview-json">${esc(JSON.stringify(rows.slice(0, 12), null, 2))}</div>`;
    return;
  }

  const tableRows = rows.slice(0, 8).map(row => `
    <tr>${keys.map(key => `<td>${formatPreviewCell(row?.[key])}</td>`).join('')}</tr>
  `).join('');

  container.innerHTML = `
    ${summary}
    <div class="preview-table-wrap">
      <table class="preview-table">
        <thead><tr>${keys.map(key => `<th>${esc(key)}</th>`).join('')}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
}

function renderObjectPreview(container, obj) {
  const entries = Object.entries(obj);
  const cards = entries.slice(0, 8).map(([key, value]) => `
    <div class="preview-card">
      <div class="preview-card-label">${esc(key)}</div>
      <div class="preview-card-value">${formatPreviewCell(value)}</div>
    </div>`).join('');

  container.innerHTML = `
    <div class="preview-grid">${cards || '<div class="preview-empty">No fields found.</div>'}</div>
    <div class="preview-json">${esc(JSON.stringify(obj, null, 2))}</div>`;
}

function formatPreviewCell(value) {
  if (value == null) return '<span style="color:var(--text3)">null</span>';
  if (typeof value === 'object') return esc(JSON.stringify(value));
  const text = String(value);
  return esc(text.length > 120 ? `${text.slice(0, 117)}...` : text);
}

function findHeaderValue(headers, targetName) {
  const wanted = String(targetName || '').toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === wanted) return value;
  }
  return '';
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(t._to);
  t._to = setTimeout(() => t.className = '', 2500);
}

function showLoadbar(on) {
  const lb = document.getElementById('loadbar');
  if (on) { lb.style.width = '70%'; lb.style.opacity = '1'; }
  else    { lb.style.width = '100%'; setTimeout(() => { lb.style.opacity='0'; lb.style.width='0'; }, 400); }
}

// ── Resize handle ─────────────────────────────────────────────
function initResizeHandle() {
  const handle   = document.getElementById('resize-handle');
  const reqPanel = document.getElementById('req-content');
  let startY, startH;

  handle.addEventListener('mousedown', e => {
    startY = e.clientY;
    startH = reqPanel.offsetHeight;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  handle.addEventListener('dblclick', () => {
    State.reqPanelManual = false;
    fitRequestPanelToContent(true);
    if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
  });

  function onMove(e) {
    const h = startH + (e.clientY - startY);
    setRequestPanelHeight(h, { manual: true, persist: false });
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
  }
}
