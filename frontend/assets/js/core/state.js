/* PostFreely — Global State */
const State = {
  tabs: [],          // [{id, name, method, url, params, headers, body, bodyType, auth, prescript, savedReqId, collectionId}]
  activeTab: null,
  collections: {},   // id → collection obj
  environments: {},  // envs map + active
  settings: {},
  publicConfig: {},
  currentUser: null,
  adminUsers: [],
  lastResponse: null,
  aiHistory: [],
  reqPanelHeight: null, // px, null = auto
  reqPanelManual: false,

  nextTabId: 1,

  newTab(overrides = {}) {
    const id = 't' + (this.nextTabId++);
    const tab = {
      id,
      name:       overrides.name    || 'New Request',
      method:     overrides.method  || 'GET',
      url:        overrides.url     || '',
      params:     overrides.params  || [],
      headers:    overrides.headers || [],
      body:       overrides.body    || '',
      bodyType:   overrides.bodyType|| 'json',
      auth:       overrides.auth    || { type: 'none' },
      prescript:  overrides.prescript || '',
      postscript: overrides.postscript || '',
      transportMode: overrides.transportMode || overrides.transport_mode || 'auto',
      browserCompatibility: overrides.browserCompatibility || overrides.browser_compatibility || API.compatibilityStatus('untested', 'Browser compatibility has not been checked yet.'),
      savedReqId: overrides.savedReqId || null,
      collectionId: overrides.collectionId || null,
      response:   null,
    };
    this.tabs.push(tab);
    return tab;
  },

  getTab(id)    { return this.tabs.find(t => t.id === id); },
  removeTab(id) { this.tabs = this.tabs.filter(t => t.id !== id); },

  activeEnvId() { return this.environments.active || null; },

  activeEnvVars() {
    const id = this.activeEnvId();
    if (!id) return {};
    const env = (this.environments.envs || {})[id];
    return env ? (env.variables || {}) : {};
  },

  variablesFor(collectionId = null) {
    const envVars = this.activeEnvVars();
    let colVars = {};
    if (collectionId && this.collections[collectionId]) {
      colVars = this.collections[collectionId].variables || {};
    }
    return {
      envVars,
      colVars,
      merged: { ...envVars, ...colVars },
    };
  },

  resolveVariable(key, collectionId = null) {
    const name = String(key || '').trim();
    const { envVars, colVars, merged } = this.variablesFor(collectionId);
    if (Object.prototype.hasOwnProperty.call(colVars, name)) {
      return {
        found: true,
        key: name,
        value: merged[name],
        source: 'collection',
        overriddenEnv: Object.prototype.hasOwnProperty.call(envVars, name),
      };
    }
    if (Object.prototype.hasOwnProperty.call(envVars, name)) {
      return {
        found: true,
        key: name,
        value: envVars[name],
        source: 'environment',
        overriddenEnv: false,
      };
    }
    return {
      found: false,
      key: name,
      value: null,
      source: 'missing',
      overriddenEnv: false,
    };
  },

  // Interpolate {{vars}} using active env + optional collection vars
  interpolate(str, collectionId = null) {
    const vars = this.variablesFor(collectionId).merged;
    return str.replace(/\{\{(.+?)\}\}/g, (_, k) => {
      const key = k.trim();
      return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : `{{${key}}}`;
    });
  },
};
