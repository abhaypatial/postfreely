/* PostFreely — Modals */

// ── Generic open/close ────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
function closeAll() {
  document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
}

// ESC closes all modals
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => {
  if (e.target === o) closeAll();
}));

// ── HISTORY ───────────────────────────────────────────────────
async function openHistory() {
  openModal('history-modal');
  const data = await API.getHistory();
  const list = document.getElementById('hist-list');
  if (!data || !data.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">No history yet.</div>';
    return;
  }
  list.innerHTML = data.map(h => `
    <div class="hist-row" data-method="${esc(h.method)}" data-url="${esc(h.url)}">
      <span class="meth ${methodColor(h.method||'GET')}">${h.method||'GET'}</span>
      <span class="hist-url">${esc(h.url||'')}</span>
      <span class="status-pill ${h.status_code>=400?'s4':'s2'}" style="font-size:10px;padding:1px 7px">${h.status_code||0}</span>
      <span class="hist-time">${h.elapsed_ms||0}ms</span>
    </div>`).join('');

  list.querySelectorAll('.hist-row').forEach(row => {
    row.addEventListener('click', () => {
      closeAll();
      addNewTab({ method: row.dataset.method, url: row.dataset.url, name: row.dataset.url });
    });
  });
}

// ── ENVIRONMENT ───────────────────────────────────────────────
let _editEnvId = null;

async function openEnvModal(envId = null) {
  _editEnvId = envId;
  const envs   = State.environments.envs || {};
  const active = State.environments.active;

  // Rebuild env selector list
  const envList = document.getElementById('env-modal-list');
  envList.innerHTML = '';
  Object.values(envs).forEach(e => {
    const item = document.createElement('div');
    item.className = 'env-list-item' + (e.id === active ? ' active-env' : '');
    item.dataset.eid = e.id;
    item.innerHTML = `<span>${esc(e.name)}</span>${e.id===active?'<span style="color:var(--accent);font-size:10px">● active</span>':''}`;
    item.addEventListener('click', () => editEnv(item.dataset.eid));
    envList.appendChild(item);
  });

  if (envId) editEnv(envId);
  else if (Object.keys(envs).length) editEnv(Object.keys(envs)[0]);
  else showEnvEditor(null);

  openModal('env-modal');
}

function showEnvEditor(env) {
  const ed = document.getElementById('env-editor');
  if (!env) { ed.innerHTML = '<p style="color:var(--text3);font-size:12px;padding:20px">Select an environment to edit, or create a new one.</p>'; return; }

  ed.innerHTML = `
    <div class="field"><label>Environment Name</label>
      <input id="env-name-inp" value="${esc(env.name)}" /></div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--text2);flex:1">Variables</span>
      <button class="add-kv" id="add-env-var-btn">+ Add Variable</button>
    </div>
    <div class="env-kv-list" id="env-kv-list"></div>
    <div class="modal-foot">
      <button class="btn-danger" id="del-env-btn">Delete</button>
      <button class="btn-ghost" onclick="closeAll()">Cancel</button>
      <button class="btn-primary" id="save-env-btn">Save</button>
    </div>`;

  const kvList = document.getElementById('env-kv-list');
  Object.entries(env.variables || {}).forEach(([k,v]) => addEnvKVRow(kvList, k, v));
  addEnvKVRow(kvList, '', '');

  document.getElementById('add-env-var-btn').addEventListener('click', () => addEnvKVRow(kvList, '', ''));

  document.getElementById('save-env-btn').addEventListener('click', async () => {
    const name = document.getElementById('env-name-inp').value.trim();
    if (!name) return;
    const variables = {};
    kvList.querySelectorAll('.env-row').forEach(row => {
      const [k,v] = [...row.querySelectorAll('input')].map(i=>i.value.trim());
      if (k) variables[k] = v;
    });
    const updated = await API.updateEnvironment(env.id, { name, variables });
    if (updated.id) {
      State.environments.envs[env.id] = updated;
      renderEnvStrip();
      showToast('Environment saved');
      closeAll();
    }
  });

  document.getElementById('del-env-btn').addEventListener('click', async () => {
    if (!confirm(`Delete "${env.name}"?`)) return;
    await API.deleteEnvironment(env.id);
    delete State.environments.envs[env.id];
    if (State.environments.active === env.id) State.environments.active = null;
    renderEnvStrip();
    closeAll();
  });
}

function editEnv(eid) {
  _editEnvId = eid;
  const env = (State.environments.envs || {})[eid];
  showEnvEditor(env);
  document.querySelectorAll('#env-modal-list .env-list-item').forEach(i =>
    i.classList.toggle('sel', i.dataset.eid === eid));
}

function addEnvKVRow(container, k, v) {
  const row = document.createElement('div');
  row.className = 'env-row';
  row.innerHTML = `
    <input type="text" placeholder="Variable name" value="${esc(k)}"/>
    <input type="text" placeholder="Value" value="${esc(v)}"/>
    <button class="kv-del">×</button>`;
  row.querySelector('.kv-del').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

async function createNewEnv() {
  const name = prompt('Environment name:');
  if (!name) return;
  const env = await API.createEnvironment({ name, variables: {} });
  if (env.id) {
    State.environments.envs = State.environments.envs || {};
    State.environments.envs[env.id] = env;
    renderEnvStrip();
    openEnvModal(env.id);
  }
}

// ── COLLECTION STUDIO ─────────────────────────────────────────
function openImportModal(mode = 'postman') {
  document.getElementById('studio-import-err').textContent = '';
  document.getElementById('studio-blank-coll-name').value = '';
  document.getElementById('studio-blank-coll-desc').value = '';
  document.getElementById('studio-import-ta').value = '';
  document.getElementById('studio-curl-coll-name').value = '';
  document.getElementById('studio-curl-import-ta').value = '';
  document.getElementById('studio-import-file-input').value = '';
  document.getElementById('studio-import-file-name').textContent = 'No file selected';
  setCollectionStudioMode(mode);
  openModal('collection-studio-modal');
}

function setCollectionStudioMode(mode) {
  document.querySelectorAll('#collection-mode-tabs .seg-tab').forEach(tab =>
    tab.classList.toggle('active', tab.dataset.importMode === mode));
  document.querySelectorAll('#collection-studio-modal .import-pane').forEach(pane =>
    pane.classList.toggle('active', pane.id === `import-pane-${mode}`));
  document.getElementById('studio-do-import-btn').textContent = {
    blank: 'Create Collection',
    postman: 'Import JSON',
    curl: 'Import cURL',
  }[mode] || 'Create Collection';
}

async function loadStudioImportFile(file) {
  if (!file) return;
  document.getElementById('studio-import-file-name').textContent = file.name;
  document.getElementById('studio-import-ta').value = await file.text();
}

async function doImport() {
  const mode = document.querySelector('#collection-mode-tabs .seg-tab.active')?.dataset.importMode || 'blank';
  const errEl = document.getElementById('studio-import-err');
  errEl.textContent = '';

  try {
    let result = null;

    if (mode === 'blank') {
      const name = document.getElementById('studio-blank-coll-name').value.trim();
      const description = document.getElementById('studio-blank-coll-desc').value.trim();
      if (!name) { errEl.textContent = 'Give the collection a name first.'; return; }
      result = await API.createCollection({ name, description });
    }

    if (mode === 'postman') {
      const raw = document.getElementById('studio-import-ta').value.trim();
      if (!raw) { errEl.textContent = 'Choose a JSON file or paste collection JSON first.'; return; }
      const parsed = JSON.parse(raw);
      result = await API.importCollection(parsed);
    }

    if (mode === 'curl') {
      const raw = document.getElementById('studio-curl-import-ta').value.trim();
      const name = document.getElementById('studio-curl-coll-name').value.trim();
      if (!raw) { errEl.textContent = 'Paste a cURL command first.'; return; }
      result = await API.importCollection({ format: 'curl', raw, name });
    }

    if (!result || result.error) {
      errEl.textContent = result?.error || 'Import failed.';
      return;
    }

    State.collections[result.id] = result;
    renderSidebar();
    closeAll();
    showToast(mode === 'blank' ? `Created: ${result.name}` : `Imported: ${result.name}`);
    if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
  } catch(e) {
    errEl.textContent = mode === 'postman' ? ('Invalid JSON: ' + e.message) : e.message;
  }
}

let _varEditContext = null;

function openVariableEditor(key, collectionId = null) {
  const envId = State.environments.active;
  const env = envId ? (State.environments.envs || {})[envId] : null;
  const collection = collectionId ? State.collections[collectionId] : null;
  if (!env && !collection) {
    showToast('Create an environment or save this request into a collection first.', true);
    return;
  }

  const resolved = State.resolveVariable(key, collectionId);
  const defaultScope = resolved.source === 'collection' ? 'collection' : (resolved.source === 'environment' ? 'environment' : (collection ? 'collection' : 'environment'));
  const scopeSel = document.getElementById('var-edit-scope');
  const options = [];
  if (env) options.push({ value: 'environment', label: `Environment - ${env.name}` });
  if (collection) options.push({ value: 'collection', label: `Collection - ${collection.name}` });

  scopeSel.innerHTML = options.map(opt => `<option value="${opt.value}">${esc(opt.label)}</option>`).join('');
  scopeSel.value = options.some(opt => opt.value === defaultScope) ? defaultScope : options[0].value;

  _varEditContext = { key, collectionId, envId };
  document.getElementById('var-edit-key').value = `{{${key}}}`;
  document.getElementById('var-edit-value').value = resolved.found && resolved.value != null ? String(resolved.value) : '';
  updateVariableEditorHelp(resolved, scopeSel.value, collectionId);
  openModal('var-edit-modal');
  setTimeout(() => document.getElementById('var-edit-value').focus(), 30);
}

function updateVariableEditorHelp(resolved, scope, collectionId) {
  const collection = collectionId ? State.collections[collectionId] : null;
  const env = State.environments.active ? (State.environments.envs || {})[State.environments.active] : null;
  const target = scope === 'collection'
    ? `Saved on the current collection${collection ? ` (${collection.name})` : ''}.`
    : `Saved on the active environment${env ? ` (${env.name})` : ''}.`;
  let source = 'This variable does not exist yet.';
  if (resolved.source === 'collection') source = 'Current value comes from the collection override.';
  if (resolved.source === 'environment') source = 'Current value comes from the active environment.';
  document.getElementById('var-edit-help').textContent = `${source} ${target}`;
}

function handleVariableEditorScopeChange(scope) {
  if (!_varEditContext) return;
  updateVariableEditorHelp(State.resolveVariable(_varEditContext.key, _varEditContext.collectionId), scope, _varEditContext.collectionId);
}

async function saveVariableEditor() {
  if (!_varEditContext) return;
  const scope = document.getElementById('var-edit-scope').value;
  const value = document.getElementById('var-edit-value').value;
  const { key, collectionId, envId } = _varEditContext;

  if (scope === 'collection') {
    if (!collectionId || !State.collections[collectionId]) {
      showToast('This request is not attached to a collection yet.', true);
      return;
    }
    const col = State.collections[collectionId];
    const variables = { ...(col.variables || {}), [key]: value };
    const result = await API.updateCollVars(collectionId, { variables });
    if (result.id) State.collections[collectionId] = result;
  } else {
    if (!envId || !(State.environments.envs || {})[envId]) {
      showToast('No active environment selected.', true);
      return;
    }
    const env = State.environments.envs[envId];
    const variables = { ...(env.variables || {}), [key]: value };
    const result = await API.updateEnvironment(envId, { name: env.name, variables });
    if (result.id) State.environments.envs[envId] = result;
  }

  renderEnvStrip();
  renderSidebar();
  closeModal('var-edit-modal');
  _varEditContext = null;
  showToast(`Saved {{${key}}}`);
  if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
}

// ── COLLECTION OVERVIEW ───────────────────────────────────────
let _overviewColId = null;

function openCollectionOverview(cid) {
  _overviewColId = cid;
  const col = State.collections[cid];
  if (!col) return;

  const el = document.getElementById('coll-overview-modal');
  el.querySelector('.modal-hd h2').innerHTML = `<span>📁</span> ${esc(col.name)}`;

  // Stats
  document.getElementById('coll-stats').innerHTML = `
    <div class="coll-stat"><b>${(col.requests||[]).length}</b> requests</div>
    <div class="coll-stat"><b>${Object.keys(col.variables||{}).length}</b> variables</div>
    <div class="coll-stat" style="color:var(--text3)">${col.created ? new Date(col.created).toLocaleDateString() : ''}</div>`;

  // Description
  const descInp = document.getElementById('coll-desc-inp');
  descInp.value = col.description || '';
  document.getElementById('coll-docs-url-inp').value = col.docs_url || '';
  document.getElementById('coll-docs-notes-inp').value = col.docs_notes || '';
  document.getElementById('coll-ai-doc-fetch-inp').checked = !!col.allow_ai_doc_fetch;

  // Variables
  renderColVars(col.variables || {});

  openModal('coll-overview-modal');
}

function renderColVars(vars) {
  const list = document.getElementById('coll-vars-list');
  list.innerHTML = '';
  Object.entries(vars).forEach(([k,v]) => addColVarRow(list, k, v));
  addColVarRow(list, '', '');
}

function addColVarRow(container, k, v) {
  const row = document.createElement('div');
  row.className = 'colvar-row';
  row.innerHTML = `
    <input type="text" placeholder="Variable" value="${esc(k)}"/>
    <input type="text" placeholder="Value" value="${esc(v)}"/>
    <button class="kv-del">×</button>`;
  row.querySelector('.kv-del').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

async function saveCollectionOverview() {
  const col = State.collections[_overviewColId];
  if (!col) return;
  col.description = document.getElementById('coll-desc-inp').value;
  col.docs_url = document.getElementById('coll-docs-url-inp').value.trim();
  col.docs_notes = document.getElementById('coll-docs-notes-inp').value.trim();
  col.allow_ai_doc_fetch = document.getElementById('coll-ai-doc-fetch-inp').checked;
  await API.updateCollection(_overviewColId, {
    name: col.name,
    description: col.description,
    docs_url: col.docs_url,
    docs_notes: col.docs_notes,
    allow_ai_doc_fetch: col.allow_ai_doc_fetch,
  });
  // Save variables
  const vars = {};
  document.querySelectorAll('#coll-vars-list .colvar-row').forEach(row => {
    const [k,v] = [...row.querySelectorAll('input')].map(i=>i.value.trim());
    if (k) vars[k] = v;
  });
  const result = await API.updateCollVars(_overviewColId, { variables: vars });
  if (result.id) {
    State.collections[_overviewColId] = result;
    renderSidebar();
    showToast('Collection saved');
    closeAll();
  }
}

async function deleteCollectionFromOverview() {
  const col = State.collections[_overviewColId];
  if (!col || !confirm(`Delete collection "${col.name}"?`)) return;
  await API.deleteCollection(_overviewColId);
  delete State.collections[_overviewColId];
  renderSidebar();
  closeAll();
}

// ── THEME ─────────────────────────────────────────────────────
const THEMES = [
  { id:'graphite',  name:'Graphite Pulse', colors:['#0a0f17','#56f1cb','#79a7ff'], desc:'deep glass, electric aqua, crisp blue' },
  { id:'calm',      name:'Calm Tide',      colors:['#eef7f6','#1a9088','#8fc6ff'], desc:'soft seafoam, relaxed depth, clean light' },
  { id:'aurora',    name:'Aurora Night',   colors:['#0a1022','#7d8dff','#5ef0df'], desc:'indigo glow, violet air, cinematic calm' },
  { id:'vibrant',   name:'Vibrant Bloom',  colors:['#1a0d1f','#ff7a6b','#ffcf7d'], desc:'bold coral, neon bloom, playful energy' },
  { id:'ember',     name:'Ember Mist',     colors:['#1a1110','#ffb36b','#ff7f7c'], desc:'warm dusk, copper light, rich contrast' },
  { id:'porcelain', name:'Porcelain Luxe', colors:['#f8f4ff','#7a6bff','#f4a0c8'], desc:'premium paper, polished violet, airy glow' },
];

const BG_PRESETS = [
  { id:'none',     name:'None',        css:'' },
  { id:'gradient1',name:'Neon Veil',   css:'linear-gradient(135deg,#081321 0%,#1b1441 36%,#0f4154 72%,#08121a 100%)' },
  { id:'gradient2',name:'Calm Tide',   css:'linear-gradient(135deg,#e1f8f2 0%,#d9ebff 45%,#fafcff 100%)' },
  { id:'gradient3',name:'Sunset Bloom',css:'linear-gradient(135deg,#2b1230 0%,#6d2742 38%,#c76c61 72%,#f5c585 100%)' },
  { id:'gradient4',name:'Botanic Mist',css:'linear-gradient(135deg,#071814 0%,#124337 36%,#0c6a58 72%,#6bd6cb 100%)' },
  { id:'mesh',     name:'Aurora Haze', css:'radial-gradient(circle at 12% 18%,rgba(0,229,160,.22) 0%,transparent 30%),radial-gradient(circle at 82% 14%,rgba(92,164,255,.24) 0%,transparent 34%),radial-gradient(circle at 58% 78%,rgba(180,127,255,.18) 0%,transparent 34%),linear-gradient(135deg,#0a1024 0%,#1f1848 48%,#091521 100%)' },
  { id:'dots',     name:'Studio Grid', css:'linear-gradient(135deg,#09111d 0%,#10192a 100%),repeating-linear-gradient(0deg,rgba(255,255,255,.04) 0px,rgba(255,255,255,.04) 1px,transparent 1px,transparent 40px),repeating-linear-gradient(90deg,rgba(255,255,255,.04) 0px,rgba(255,255,255,.04) 1px,transparent 1px,transparent 40px)' },
  { id:'halo',     name:'Halo Dream',  css:'radial-gradient(circle at 18% 20%,rgba(255,255,255,.20) 0%,transparent 18%),radial-gradient(circle at 76% 24%,rgba(92,164,255,.30) 0%,transparent 22%),radial-gradient(circle at 82% 82%,rgba(255,127,124,.20) 0%,transparent 18%),linear-gradient(135deg,#0a1128 0%,#281b52 48%,#7a3454 100%)' },
  { id:'custom',   name:'Custom URL',  css:'' },
];

function bgSetting(name, fallback) {
  return State.settings[name] == null ? fallback : State.settings[name];
}

function normalizeThemeId(id) {
  return ({
    dark: 'graphite',
    light: 'calm',
    midnight: 'aurora',
    terminal: 'vibrant',
    solarized: 'ember',
  })[id] || id || 'graphite';
}

function normalizeCssUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  return `url("${value.replace(/"/g, '%22')}")`;
}

function setThemeBackgroundSelection(bgId) {
  document.querySelectorAll('#bg-grid .bg-card').forEach(card =>
    card.classList.toggle('sel', card.dataset.bg === bgId));
}

function toggleCustomBackgroundControls(show) {
  document.getElementById('custom-bg-row').style.display = show ? '' : 'none';
  document.getElementById('custom-bg-controls').style.display = show ? '' : 'none';
}

function applyFontSize(fontSize) {
  const size = Number(fontSize) || 13;
  const scale = Math.max(0.84, Math.min(1.38, size / 13));
  document.documentElement.style.fontSize = `${size}px`;
  document.documentElement.style.setProperty('--ui-scale', scale.toFixed(3));
  State.settings.font_size = size;
}

function syncCustomBackgroundInput(rawUrl) {
  const value = String(rawUrl || '').trim();
  setThemeBackgroundSelection('custom');
  toggleCustomBackgroundControls(true);
  applyBackground('custom', value);
}

function applyBackgroundFrame(size, posX, posY) {
  document.body.style.setProperty('--bg-size', size || 'cover');
  document.body.style.setProperty('--bg-pos-x', `${posX ?? 50}%`);
  document.body.style.setProperty('--bg-pos-y', `${posY ?? 50}%`);
  State.settings.bg_size = size || 'cover';
  State.settings.bg_pos_x = Number(posX ?? 50);
  State.settings.bg_pos_y = Number(posY ?? 50);
}

function applyBackgroundEffects(blur, bokeh) {
  const blurPx = Math.max(0, Number(blur) || 0);
  const bokehAmount = Math.max(0, Number(bokeh) || 0);
  const scale = 1 + (blurPx / 220);
  const bokehOpacity = Math.min(0.85, bokehAmount / 100);
  const bokehBlur = 10 + (bokehAmount * 0.42);

  document.body.style.setProperty('--bg-blur', `${blurPx}px`);
  document.body.style.setProperty('--bg-scale', scale.toFixed(3));
  document.body.style.setProperty('--bg-bokeh-opacity', bokehOpacity.toFixed(3));
  document.body.style.setProperty('--bg-bokeh-blur', `${bokehBlur.toFixed(1)}px`);

  State.settings.bg_blur = blurPx;
  State.settings.bg_bokeh = bokehAmount;
}

function openThemeModal() {
  const cur = normalizeThemeId(State.settings.theme || 'dark');
  const curBg = State.settings.background || 'none';
  const curFit = bgSetting('bg_size', 'cover');
  const curPosX = bgSetting('bg_pos_x', 50);
  const curPosY = bgSetting('bg_pos_y', 50);
  const curBlur = bgSetting('bg_blur', 0);
  const curBokeh = bgSetting('bg_bokeh', 18);

  // Theme cards
  const tgrid = document.getElementById('theme-grid');
  tgrid.innerHTML = THEMES.map(t => `
    <div class="theme-card ${t.id===cur?'sel':''}" data-theme="${t.id}">
      <div class="theme-swatch" style="background:linear-gradient(135deg,${t.colors[0]} 0%,${t.colors[1]} 100%)"></div>
      <span class="theme-card-name">${t.name}</span>
      <small>${t.desc}</small>
    </div>`).join('');
  tgrid.querySelectorAll('.theme-card').forEach(c =>
    c.addEventListener('click', () => {
      tgrid.querySelectorAll('.theme-card').forEach(x=>x.classList.remove('sel'));
      c.classList.add('sel');
      applyTheme(c.dataset.theme);
    }));

  // BG cards
  const bgrid = document.getElementById('bg-grid');
  bgrid.innerHTML = BG_PRESETS.map(b => {
    const sty = b.css ? `background:${b.css}` : 'background:var(--bg3)';
    return `<div class="bg-card ${b.id===curBg?'sel':''}" data-bg="${b.id}" title="${b.name}" style="${sty}">
      <span class="lbl">${b.name}</span></div>`;
  }).join('');
  bgrid.querySelectorAll('.bg-card').forEach(c =>
    c.addEventListener('click', () => {
      setThemeBackgroundSelection(c.dataset.bg);
      if (c.dataset.bg === 'custom') {
        toggleCustomBackgroundControls(true);
        syncCustomBackgroundInput(document.getElementById('custom-bg-inp').value.trim());
      } else {
        toggleCustomBackgroundControls(false);
        applyBackground(c.dataset.bg, '');
      }
    }));

  // Custom bg field
  document.getElementById('custom-bg-inp').value = State.settings.custom_bg || '';
  toggleCustomBackgroundControls(curBg === 'custom');
  document.getElementById('bg-fit-sel').value = curFit;
  document.getElementById('bg-pos-x-inp').value = curPosX;
  document.getElementById('bg-pos-y-inp').value = curPosY;
  document.getElementById('bg-pos-x-val').textContent = curPosX + '%';
  document.getElementById('bg-pos-y-val').textContent = curPosY + '%';
  applyBackgroundFrame(curFit, curPosX, curPosY);

  // Opacity
  const opEl = document.getElementById('bg-opacity-inp');
  opEl.value = Math.round((State.settings.bg_opacity ?? 0.18) * 100);
  document.getElementById('bg-opacity-val').textContent = opEl.value + '%';
  opEl.oninput = () => {
    document.getElementById('bg-opacity-val').textContent = opEl.value + '%';
    applyOpacity(opEl.value / 100);
  };

  const blurEl = document.getElementById('bg-blur-inp');
  blurEl.value = curBlur;
  document.getElementById('bg-blur-val').textContent = `${curBlur}px`;
  blurEl.oninput = () => {
    document.getElementById('bg-blur-val').textContent = `${blurEl.value}px`;
    applyBackgroundEffects(blurEl.value, document.getElementById('bg-bokeh-inp').value);
  };

  const bokehEl = document.getElementById('bg-bokeh-inp');
  bokehEl.value = curBokeh;
  document.getElementById('bg-bokeh-val').textContent = `${curBokeh}%`;
  bokehEl.oninput = () => {
    document.getElementById('bg-bokeh-val').textContent = `${bokehEl.value}%`;
    applyBackgroundEffects(document.getElementById('bg-blur-inp').value, bokehEl.value);
  };

  // Font size
  const fsEl = document.getElementById('font-size-inp');
  fsEl.value = State.settings.font_size || 13;
  document.getElementById('font-size-val').textContent = fsEl.value + 'px';
  fsEl.oninput = () => {
    document.getElementById('font-size-val').textContent = fsEl.value + 'px';
    applyFontSize(fsEl.value);
  };

  document.getElementById('custom-bg-inp').oninput = e => {
    syncCustomBackgroundInput(e.target.value);
  };

  document.getElementById('bg-fit-sel').onchange = e => {
    applyBackgroundFrame(e.target.value, document.getElementById('bg-pos-x-inp').value, document.getElementById('bg-pos-y-inp').value);
  };
  document.getElementById('bg-pos-x-inp').oninput = e => {
    document.getElementById('bg-pos-x-val').textContent = e.target.value + '%';
    applyBackgroundFrame(document.getElementById('bg-fit-sel').value, e.target.value, document.getElementById('bg-pos-y-inp').value);
  };
  document.getElementById('bg-pos-y-inp').oninput = e => {
    document.getElementById('bg-pos-y-val').textContent = e.target.value + '%';
    applyBackgroundFrame(document.getElementById('bg-fit-sel').value, document.getElementById('bg-pos-x-inp').value, e.target.value);
  };

  openModal('theme-modal');
}

function applyTheme(id) {
  const normalized = normalizeThemeId(id);
  document.documentElement.setAttribute('data-theme', normalized);
  State.settings.theme = normalized;
}

function applyBackground(presetId, customUrl) {
  const preset = BG_PRESETS.find(b => b.id === presetId);
  const css    = presetId === 'custom' ? normalizeCssUrl(customUrl) : (preset?.css || '');
  document.body.style.setProperty('--custom-bg', css || 'none');
  State.settings.background = presetId;
  State.settings.custom_bg  = String(customUrl || '').trim();
  if (presetId !== 'custom') {
    applyBackgroundFrame('cover', 50, 50);
  } else {
    applyBackgroundFrame(bgSetting('bg_size', 'cover'), bgSetting('bg_pos_x', 50), bgSetting('bg_pos_y', 50));
  }
}

function applyOpacity(v) {
  document.body.style.setProperty('--bg-opacity', v);
  State.settings.bg_opacity = v;
}

async function saveTheme() {
  const themeCard = document.querySelector('#theme-grid .theme-card.sel');
  const bgCard    = document.querySelector('#bg-grid .bg-card.sel');
  const customUrl = document.getElementById('custom-bg-inp').value.trim();
  const opacity   = document.getElementById('bg-opacity-inp').value / 100;
  const fontSize  = document.getElementById('font-size-inp').value;
  const bgFit     = document.getElementById('bg-fit-sel').value;
  const bgPosX    = Number(document.getElementById('bg-pos-x-inp').value);
  const bgPosY    = Number(document.getElementById('bg-pos-y-inp').value);
  const bgBlur    = Number(document.getElementById('bg-blur-inp').value);
  const bgBokeh   = Number(document.getElementById('bg-bokeh-inp').value);
  const selectedBg = bgCard?.dataset.bg || State.settings.background || 'none';
  const effectiveCustomUrl = selectedBg === 'custom' ? customUrl : '';

  if (themeCard) applyTheme(themeCard.dataset.theme);
  applyBackground(selectedBg, effectiveCustomUrl);
  if (selectedBg === 'custom') {
    applyBackgroundFrame(bgFit, bgPosX, bgPosY);
  }
  applyOpacity(opacity);
  applyBackgroundEffects(bgBlur, bgBokeh);
  applyFontSize(fontSize);

  await API.updateSettings({
    theme:      State.settings.theme,
    background: State.settings.background,
    custom_bg:  State.settings.custom_bg,
    bg_size:    State.settings.bg_size,
    bg_pos_x:   State.settings.bg_pos_x,
    bg_pos_y:   State.settings.bg_pos_y,
    bg_opacity: opacity,
    bg_blur:    State.settings.bg_blur,
    bg_bokeh:   State.settings.bg_bokeh,
    font_size:  Number(fontSize),
  });

  closeAll();
  showToast('Theme saved');
}

function applySettings(s) {
  if (s.theme)      document.documentElement.setAttribute('data-theme', normalizeThemeId(s.theme));
  applyFontSize(s.font_size || 13);
  const bg = s.background || 'none';
  const preset = BG_PRESETS.find(b => b.id === bg);
  let css = '';
  if (bg === 'custom' && s.custom_bg) css = normalizeCssUrl(s.custom_bg);
  else if (preset?.css) css = preset.css;
  if (css) document.body.style.setProperty('--custom-bg', css);
  else document.body.style.setProperty('--custom-bg', 'none');
  applyBackgroundFrame(s.bg_size || 'cover', s.bg_pos_x ?? 50, s.bg_pos_y ?? 50);
  document.body.style.setProperty('--bg-opacity', s.bg_opacity ?? 0.18);
  applyBackgroundEffects(s.bg_blur ?? 0, s.bg_bokeh ?? 18);
}

// ── AI CONFIG ─────────────────────────────────────────────────
const AI_PROVIDERS = [
  { id:'openai',     name:'OpenAI',      icon:'🤖', desc:'GPT-4o, GPT-4 Turbo', models:'gpt-4o-mini, gpt-4o, gpt-4-turbo', keyLabel:'API Key', keyHint:'sk-...' },
  { id:'anthropic',  name:'Anthropic',   icon:'◆',  desc:'Claude 3.5, Claude 3', models:'claude-3-5-sonnet, claude-3-haiku', keyLabel:'API Key', keyHint:'sk-ant-...' },
  { id:'gemini',     name:'Gemini',      icon:'✦',  desc:'Google Gemini Pro/Flash', models:'gemini-1.5-flash, gemini-1.5-pro', keyLabel:'API Key', keyHint:'AI...' },
  { id:'deepseek',   name:'DeepSeek',    icon:'🔍', desc:'DeepSeek Chat / Coder', models:'deepseek-chat, deepseek-coder', keyLabel:'API Key', keyHint:'sk-...' },
  { id:'perplexity', name:'Perplexity',  icon:'∞',  desc:'Sonar online search AI', models:'llama-3.1-sonar-small-128k-online', keyLabel:'API Key', keyHint:'pplx-...' },
  { id:'ollama',     name:'Ollama',      icon:'🦙', desc:'Local — no API key needed', models:'llama3, mistral, phi3', keyLabel:'Base URL', keyHint:'http://localhost:11434' },
  { id:'custom',     name:'Custom',      icon:'⚙',  desc:'Any OpenAI-compatible endpoint', models:'any model name', keyLabel:'API Key (optional)', keyHint:'' },
];

function openAIConfig() {
  const cur = State.settings.ai_provider || '';
  const grid = document.getElementById('ai-provider-grid');
  grid.innerHTML = AI_PROVIDERS.map(p => `
    <div class="ai-pcard ${p.id===cur?'sel':''}" data-pid="${p.id}">
      <div class="ai-pcard-icon">${p.icon}</div>
      <div class="ai-pcard-name">${p.name}</div>
      <div class="ai-pcard-desc">${p.desc}</div>
      <div class="ai-pcard-models">${p.models}</div>
    </div>`).join('');

  grid.querySelectorAll('.ai-pcard').forEach(c => c.addEventListener('click', () => {
    grid.querySelectorAll('.ai-pcard').forEach(x=>x.classList.remove('sel'));
    c.classList.add('sel');
    renderAIFields(c.dataset.pid);
  }));

  renderAIFields(cur || 'openai');
  openModal('ai-config-modal');
}

function renderAIFields(pid) {
  const p   = AI_PROVIDERS.find(x => x.id === pid);
  const s   = State.settings;
  const el  = document.getElementById('ai-fields');
  el.innerHTML = `
    <div class="field">
      <label>${p?.keyLabel || 'API Key'}</label>
      <input type="password" id="ai-key-inp" value="${esc(s.ai_api_key||'')}" placeholder="${p?.keyHint||''}"/>
    </div>
    <div class="field">
      <label>Model <span style="color:var(--text3);font-weight:400">(optional — leave blank for default)</span></label>
      <input type="text" id="ai-model-inp" value="${esc(s.ai_model||'')}" placeholder="${p?.models?.split(',')[0]?.trim()||''}"/>
    </div>
    ${pid==='ollama'||pid==='custom' ? `
    <div class="field">
      <label>${pid==='ollama'?'Ollama Base URL':'Custom Endpoint URL'}</label>
      <input type="text" id="ai-url-inp" value="${esc(s.ai_custom_url||'')}" placeholder="${pid==='ollama'?'http://localhost:11434':'https://api.example.com/v1/chat/completions'}"/>
    </div>` : ''}
    <div class="info-box">
      Available models: <code>${p?.models||''}</code>
    </div>`;
}

async function saveAIConfig() {
  const grid = document.getElementById('ai-provider-grid');
  const sel  = grid.querySelector('.ai-pcard.sel');
  if (!sel) { showToast('Pick a provider first', true); return; }
  const provider = sel.dataset.pid;
  const key     = document.getElementById('ai-key-inp')?.value.trim() || '';
  const model   = document.getElementById('ai-model-inp')?.value.trim() || '';
  const url     = document.getElementById('ai-url-inp')?.value.trim() || '';

  const updated = await API.updateSettings({ ai_provider:provider, ai_api_key:key, ai_model:model, ai_custom_url:url });
  Object.assign(State.settings, updated);
  closeAll();
  showToast(`AI configured: ${sel.querySelector('.ai-pcard-name').textContent}`);
}

// ── SIGN IN ───────────────────────────────────────────────────
let _authMode = 'signin';
let _pendingVerificationEmail = '';

function normalizedAuthEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function resetAuthAssistance() {
  _pendingVerificationEmail = '';
  const resendBtn = document.getElementById('signin-resend-btn');
  if (resendBtn) resendBtn.style.display = 'none';
}

function setPendingVerificationEmail(email = '') {
  _pendingVerificationEmail = normalizedAuthEmail(email);
  const resendBtn = document.getElementById('signin-resend-btn');
  if (resendBtn) resendBtn.style.display = _pendingVerificationEmail ? '' : 'none';
}

function authFriendlyError(message, mode = 'signin') {
  const raw = String(message || '').trim();
  if (!raw) return mode === 'signup' ? 'Could not create the account right now.' : 'Could not sign in right now.';
  const lower = raw.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return 'Email or password was not accepted. If you just created this account, confirm the email first. If this account started with Google, use Google sign-in.';
  }
  if (lower.includes('email not confirmed') || lower.includes('email_not_confirmed') || lower.includes('confirm your email')) {
    return 'Your account is waiting for email confirmation. Open the verification email, then try again.';
  }
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return 'That email is already registered. Sign in instead, or use Google if you originally joined with Google.';
  }
  if (lower.includes('email address not authorized')) {
    return 'Supabase is still using the default test email sender. Add the email to your Supabase team or set up custom SMTP before using email signup in production.';
  }
  return raw;
}

function shouldOfferVerificationHelp(message) {
  const lower = String(message || '').trim().toLowerCase();
  return lower.includes('invalid login credentials')
    || lower.includes('email not confirmed')
    || lower.includes('email_not_confirmed')
    || lower.includes('confirm your email');
}

function authModeNote() {
  if (_authMode === 'signup') {
    return 'Create an account to sync collections, environments, history, and runner results. After signup, PostFreely will email you a confirmation link.';
  }
  return State.publicConfig.google_auth_enabled
    ? 'Use email/password or Google to sync collections, environments, history, and runner results.'
    : 'Use your PostFreely account to sync collections, environments, history, and runner results.';
}

function setAuthMode(mode = 'signin') {
  _authMode = mode === 'signup' ? 'signup' : 'signin';
  document.querySelectorAll('#signin-mode-tabs .seg-tab').forEach(tab =>
    tab.classList.toggle('active', tab.dataset.authMode === _authMode));
  document.getElementById('signin-name-row').style.display = _authMode === 'signup' ? '' : 'none';
  document.getElementById('signin-confirm-row').style.display = _authMode === 'signup' ? '' : 'none';
  document.getElementById('signin-password').setAttribute('autocomplete', _authMode === 'signup' ? 'new-password' : 'current-password');
  document.getElementById('do-signin-btn').textContent = _authMode === 'signup' ? 'Create Account' : 'Sign In';
  document.getElementById('signin-cloud-note').textContent = authModeNote();
  if (_authMode !== 'signup') {
    document.getElementById('signin-password-confirm').value = '';
  }
  resetAuthAssistance();
}

function renderAuthModalState() {
  const accountView = document.getElementById('signin-account-view');
  const cloudView = document.getElementById('signin-cloud-view');
  const localView = document.getElementById('signin-local-view');
  const isCloud = !!State.publicConfig?.auth_required;

  accountView.style.display = State.currentUser ? '' : 'none';
  cloudView.style.display = !State.currentUser && isCloud ? '' : 'none';
  localView.style.display = !State.currentUser && !isCloud ? '' : 'none';

  if (State.currentUser) {
    document.getElementById('signin-account-summary').innerHTML = `
      <strong>${esc(State.currentUser.username || 'User')}</strong><br/>
      <span style="color:var(--text2)">${esc(State.currentUser.email || 'No email saved')}</span><br/>
      <span style="color:var(--text3);text-transform:uppercase;letter-spacing:.12em;font-size:10px">${esc(State.currentUser.provider || 'local')}${State.currentUser.is_admin ? ' - admin' : ''}</span>`;
    const adminNote = document.getElementById('signin-account-admin-note');
    adminNote.style.display = State.currentUser.is_admin ? '' : 'none';
    adminNote.textContent = State.currentUser.is_admin
      ? 'Admin mode is enabled. Use the Workspace selector in the top bar to inspect another user workspace.'
      : '';
    return;
  }

  if (isCloud) {
    document.getElementById('signin-cloud-note').textContent = authModeNote();
    document.getElementById('do-google-signin-btn').style.display = State.publicConfig.google_auth_enabled ? '' : 'none';
    setAuthMode(_authMode);
  }
}

async function openSignIn() {
  document.getElementById('signin-err').textContent = '';
  document.getElementById('signin-local-err').textContent = '';
  resetAuthAssistance();
  renderAuthModalState();
  openModal('signin-modal');
}

async function finishAuthenticatedSession(result, successMessage) {
  if (result?.session?.access_token) {
    API.setSession(result.session);
  }
  if (result?.user) {
    State.currentUser = result.user;
    updateUserUI(result.user);
  } else {
    await refreshCurrentUser();
  }
  await loadAdminUsers();
  await loadActorSettings();
  await loadWorkspaceData();
  closeAll();
  showToast(successMessage);
}

async function doSignIn() {
  const email = normalizedAuthEmail(document.getElementById('signin-email').value);
  const password = document.getElementById('signin-password').value;
  const passwordConfirm = document.getElementById('signin-password-confirm').value;
  const username = document.getElementById('signin-name').value.trim();
  const errEl = document.getElementById('signin-err');
  errEl.textContent = '';
  resetAuthAssistance();

  if (State.publicConfig?.auth_required) {
    if (!email || !password) {
      errEl.textContent = 'Enter your email and password.';
      return;
    }
    if (_authMode === 'signup') {
      if (password.length < 8) {
        errEl.textContent = 'Use at least 8 characters for the password.';
        return;
      }
      if (password !== passwordConfirm) {
        errEl.textContent = 'The password confirmation does not match.';
        return;
      }
    }
    const result = _authMode === 'signup'
      ? await API.signup({ email, password, username })
      : await API.login({ email, password });
    if (result?.error) {
      errEl.textContent = authFriendlyError(result.error, _authMode);
      if (_authMode === 'signin' && shouldOfferVerificationHelp(result.error)) {
        setPendingVerificationEmail(email);
      }
      return;
    }
    if (!result?.session?.access_token) {
      errEl.textContent = result?.message || 'Check your inbox and confirm your email before signing in.';
      setPendingVerificationEmail(email);
      return;
    }
    try {
      await finishAuthenticatedSession(result, _authMode === 'signup' ? 'Account created and synced' : 'Signed in');
    } catch (error) {
      errEl.textContent = error.message || 'Signed in, but the workspace could not load yet.';
    }
    return;
  }

  const localResult = await API.login({ email, username });
  if (localResult?.error) {
    errEl.textContent = localResult.error;
    return;
  }
  State.currentUser = localResult.user;
  updateUserUI(localResult.user);
  closeAll();
  showToast(`Welcome, ${localResult.user?.username || 'User'}!`);
}

async function doLocalSignIn() {
  const email = document.getElementById('signin-local-email').value.trim();
  const username = document.getElementById('signin-local-name').value.trim();
  const errEl = document.getElementById('signin-local-err');
  errEl.textContent = '';
  if (!email && !username) {
    errEl.textContent = 'Enter your name or email.';
    return;
  }
  const result = await API.login({ email, username });
  if (result?.error) {
    errEl.textContent = result.error;
    return;
  }
  State.currentUser = result.user;
  updateUserUI(result.user);
  closeAll();
  showToast(`Welcome, ${result.user?.username || 'User'}!`);
}

async function startGoogleSignIn() {
  const redirect = `${window.location.origin}/auth/callback.html`;
  const result = await API.getGoogleAuthUrl(redirect);
  if (result?.error || !result?.url) {
    document.getElementById('signin-err').textContent = result?.error || 'Could not start Google sign-in.';
    return;
  }
  window.location.href = result.url;
}

async function resendVerificationEmail() {
  const email = _pendingVerificationEmail || normalizedAuthEmail(document.getElementById('signin-email').value);
  const errEl = document.getElementById('signin-err');
  errEl.textContent = '';
  if (!email) {
    errEl.textContent = 'Enter the email address you used to create the account first.';
    return;
  }
  const result = await API.resendSignupEmail({ email });
  if (result?.error) {
    errEl.textContent = authFriendlyError(result.error, 'signup');
    return;
  }
  setPendingVerificationEmail(email);
  errEl.textContent = result?.message || 'Verification email sent.';
}

async function doSignOut() {
  try {
    await API.logout();
  } catch (_) {
  }
  API.clearSession();
  API.setViewOwnerId('');
  State.currentUser = null;
  State.adminUsers = [];
  updateUserUI(null);
  renderAdminScope();
  resetWorkspaceData();
  closeAll();
  showToast('Signed out');
  if (State.publicConfig?.auth_required) {
    openSignIn();
  }
}

function togglePasswordVisibility(targetId) {
  const input = document.getElementById(targetId);
  const toggle = document.querySelector(`[data-password-toggle="${targetId}"]`);
  if (!input || !toggle) return;
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  toggle.textContent = reveal ? 'Hide' : 'Show';
}

function updateUserUI(user) {
  const btn = document.getElementById('user-btn');
  State.currentUser = user || null;
  btn.textContent = user ? `◉ ${user.username || user.email || 'Account'}` : 'Sign In';
  renderAdminScope();
}

// ── GENERATE REQUEST (AI) ─────────────────────────────────────
function collectionAiSources(collection) {
  if (!collection) return [];
  if (Array.isArray(collection.ai_sources) && collection.ai_sources.length) return collection.ai_sources;
  const legacy = [];
  if (collection.docs_url) legacy.push({ id: 'legacy-docs-url', type: 'url', label: 'Docs URL', content: collection.docs_url, allow_fetch: !!collection.allow_ai_doc_fetch });
  if (collection.docs_notes) legacy.push({ id: 'legacy-docs-notes', type: 'note', label: 'Collection Notes', content: collection.docs_notes, allow_fetch: false });
  return legacy;
}

function renderGenerateSources(collectionId) {
  const container = document.getElementById('gen-source-list');
  const collection = collectionId ? State.collections[collectionId] : null;
  if (!collection) {
    container.innerHTML = '<div class="info-box" style="margin-top:0">Choose a collection if you want AI to use saved docs, notes, or file snippets while building the request.</div>';
    return;
  }
  const sources = collectionAiSources(collection);
  if (!sources.length) {
    container.innerHTML = '<div class="info-box" style="margin-top:0">No saved AI sources on this collection yet. You can still generate a request from your description alone, or add sources from the runner AI Sources panel.</div>';
    return;
  }
  container.innerHTML = sources.map(source => `
    <label class="source-choice">
      <input type="checkbox" value="${esc(source.id || '')}" ${source.type === 'url' ? 'checked' : ''}/>
      <span>
        <strong>${esc(source.label || (source.type === 'url' ? 'Link Source' : source.type === 'file' ? 'File Source' : 'Note Source'))}</strong>
        <small>${esc(source.type.toUpperCase())} - ${esc(String(source.content || '').slice(0, 160))}${String(source.content || '').length > 160 ? '…' : ''}</small>
      </span>
    </label>
  `).join('');
}

async function openGenerateModal() {
  if (!State.settings.ai_provider) {
    showToast('Configure AI first (AI Config)', true);
    openAIConfig(); return;
  }
  const tab = State.getTab(State.activeTab);
  const collectionId = tab?.collectionId || '';
  const sel = document.getElementById('gen-coll-sel');
  sel.innerHTML = '<option value="">No collection context</option>' +
    Object.values(State.collections).map(c =>
      `<option value="${c.id}" ${c.id === collectionId ? 'selected' : ''}>${esc(c.name)}</option>`
    ).join('');
  sel.onchange = e => renderGenerateSources(e.target.value);
  openModal('generate-modal');
  document.getElementById('gen-desc').value = '';
  document.getElementById('gen-err').textContent = '';
  document.getElementById('gen-fetch-docs').checked = false;
  renderGenerateSources(collectionId);
}

async function doGenerate() {
  const desc = document.getElementById('gen-desc').value.trim();
  const collectionId = document.getElementById('gen-coll-sel').value || null;
  const selectedSourceIds = [...document.querySelectorAll('#gen-source-list input[type=checkbox]:checked')].map(input => input.value);
  const allowDocFetch = document.getElementById('gen-fetch-docs').checked;
  if (!desc) return;
  document.getElementById('gen-err').textContent = 'Generating...';
  const result = await API.aiGenerate({
    description: desc,
    collection_id: collectionId,
    selected_source_ids: selectedSourceIds,
    allow_doc_fetch: allowDocFetch,
  });
  if (result.error) { document.getElementById('gen-err').textContent = result.error; return; }
  if (result.raw)   { document.getElementById('gen-err').textContent = 'Could not parse AI response.'; return; }
  addNewTab({
    name:    result.description || desc,
    method:  result.method  || 'GET',
    url:     result.url     || '',
    params:  (result.params || []).map(p => Array.isArray(p) ? p : [p.key, p.value]),
    headers: (result.headers || []).map(h => Array.isArray(h) ? h : [h.key, h.value]),
    body:    result.body    || '',
    bodyType: result.bodyType || 'json',
    auth: result.auth || { type: 'none' },
    prescript: result.prescript || '',
    postscript: result.postscript || '',
    collectionId,
  });
  if (result.docs_fetched) showToast(`AI used saved docs from ${result.docs_url || 'your sources'}`);
  closeAll();
}

// ── SAVE REQUEST to collection ─────────────────────────────────
async function openSaveModal() {
  saveCurrentTabState();
  const tab = State.getTab(State.activeTab);
  if (!tab) return;

  const sel = document.getElementById('save-coll-sel');
  sel.innerHTML = '<option value="">+ Create new collection</option>' +
    Object.values(State.collections).map(c =>
      `<option value="${c.id}" ${tab.collectionId===c.id?'selected':''}>${esc(c.name)}</option>`
    ).join('');
  document.getElementById('save-req-name').value = tab.name || tab.url || 'New Request';
  document.getElementById('save-err').textContent = '';
  openModal('save-modal');
}

async function doSaveRequest() {
  saveCurrentTabState();
  const tab  = State.getTab(State.activeTab);
  if (!tab) return;
  const name = document.getElementById('save-req-name').value.trim() || tab.url;
  let   cid  = document.getElementById('save-coll-sel').value;

  if (!cid) {
    const cname = prompt('New collection name:'); if (!cname) return;
    const col   = await API.createCollection({ name: cname });
    if (!col.id) return;
    State.collections[col.id] = col; cid = col.id;
  }

  const reqData = {
    name, method: tab.method, url: tab.url,
    params: tab.params, headers: tab.headers,
    body: tab.body, bodyType: tab.bodyType,
    auth: tab.auth, prescript: tab.prescript,
    postscript: tab.postscript,
    transport_mode: tab.transportMode || 'auto',
    browser_compatibility: tab.browserCompatibility || API.compatibilityStatus('untested', 'Browser compatibility has not been checked yet.'),
  };

  let saved;
  if (tab.savedReqId && tab.collectionId === cid) {
    saved = await API.updateRequest(cid, tab.savedReqId, reqData);
  } else {
    saved = await API.addRequest(cid, reqData);
  }
  if (saved.id) {
    tab.savedReqId   = saved.id;
    tab.collectionId = cid;
    tab.name         = name;
    // Refresh collection
    const cols = await API.getCollections();
    Object.assign(State.collections, cols);
    renderTabs();
    renderSidebar();
    closeAll();
    showToast(`Saved to ${State.collections[cid]?.name}`);
  }
}

// ── AI ANALYZE ────────────────────────────────────────────────
async function doAiAnalyze() {
  if (!State.lastResponse) return;
  if (!State.settings.ai_provider) {
    showToast('Configure AI first (AI Config)', true);
    openAIConfig(); return;
  }
  switchRespTab('ai');
  const aiMsgs = document.getElementById('ai-messages');
  aiMsgs.innerHTML = '<div class="ai-bubble ai">Analyzing response...</div>';

  const result = await API.aiAnalyze({ response: State.lastResponse });
  aiMsgs.innerHTML = '';
  if (result.error) {
    aiMsgs.innerHTML = `<div class="ai-bubble error">✗ ${esc(result.error)}</div>`;
  } else {
    addAiBubble('ai', result.analysis || '');
  }
}

async function doAiFix() {
  const tab = State.getTab(State.activeTab);
  if (!tab || !State.lastResponse) {
    showToast('Send a request first', true);
    return;
  }
  if (!State.settings.ai_provider) {
    showToast('Configure AI first (AI Config)', true);
    openAIConfig();
    return;
  }

  saveCurrentTabState();
  const collection = tab.collectionId ? State.collections[tab.collectionId] : null;
  const shouldFetchDocs = !!(collection?.docs_url && (
    collection.allow_ai_doc_fetch ||
    confirm(`Allow AI to fetch docs from:\n${collection.docs_url}\n\nThis helps it inspect the API format before suggesting a fix.`)
  ));

  switchRespTab('ai');
  const aiMsgs = document.getElementById('ai-messages');
  aiMsgs.innerHTML = '<div class="ai-bubble ai">Reviewing the request, response, and collection context...</div>';

  const result = await API.aiFix({
    request: {
      name: tab.name,
      method: tab.method,
      url: tab.url,
      params: tab.params,
      headers: tab.headers,
      body: tab.body,
      bodyType: tab.bodyType,
      auth: tab.auth,
      prescript: tab.prescript,
      postscript: tab.postscript,
    },
    response: State.lastResponse,
    collection_id: tab.collectionId,
    docs_url: collection?.docs_url || '',
    docs_notes: collection?.docs_notes || '',
    allow_doc_fetch: shouldFetchDocs,
  });

  aiMsgs.innerHTML = '';
  if (result.error) {
    aiMsgs.innerHTML = `<div class="ai-bubble error">Fix suggestion failed: ${esc(result.error)}</div>`;
    return;
  }

  if (result.docs_fetched) {
    addAiBubble('ai', `Docs fetched from ${result.docs_url}`);
  } else if (result.docs_fetch_error) {
    addAiBubble('error', `Docs fetch skipped or failed: ${result.docs_fetch_error}`);
  }
  addAiBubble('ai', result.suggestion || '');
}
