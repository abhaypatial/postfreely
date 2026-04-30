window.PostFreelyCloudImport = (() => {
  function nowIso() {
    return new Date().toISOString();
  }

  function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `pf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeAiSources(rawSources) {
    if (!Array.isArray(rawSources)) return [];
    return rawSources
      .filter(source => source && typeof source === 'object' && !Array.isArray(source))
      .map(source => {
        const type = ['url', 'note', 'file'].includes(String(source.type || 'note').toLowerCase())
          ? String(source.type || 'note').toLowerCase()
          : 'note';
        const content = String(source.content || '').trim();
        if (!content) return null;
        return {
          id: String(source.id || uuid()),
          type,
          label: String(source.label || '').trim(),
          content,
          allow_fetch: type === 'url' ? !!source.allow_fetch : false,
        };
      })
      .filter(Boolean);
  }

  function legacyAiFields(aiSources, body = {}) {
    let docsUrl = '';
    let docsNotes = '';
    let allowFetch = false;
    (aiSources || []).forEach(source => {
      if (source.type === 'url' && !docsUrl) {
        docsUrl = source.content;
        allowFetch = !!source.allow_fetch;
        return;
      }
      if (source.type === 'note' || source.type === 'file') {
        const block = source.label ? `${source.label}\n${source.content}` : source.content;
        docsNotes = `${docsNotes}\n\n${block}`.trim();
      }
    });
    if (!docsUrl) docsUrl = String(body.docs_url || '');
    if (!docsNotes) docsNotes = String(body.docs_notes || '');
    if (!allowFetch) allowFetch = !!body.allow_ai_doc_fetch;
    return { docs_url: docsUrl, docs_notes: docsNotes.slice(0, 6000), allow_ai_doc_fetch: allowFetch };
  }

  function defaultSettings() {
    return {
      theme: 'dark',
      background: 'none',
      bg_opacity: 0.18,
      bg_size: 'cover',
      bg_pos_x: 50,
      bg_pos_y: 50,
      bg_blur: 0,
      bg_bokeh: 18,
      ai_provider: '',
      ai_api_key: '',
      ai_model: '',
      ai_custom_url: '',
      font_size: 13,
      timeout: 30,
      runner_parallel: 4,
    };
  }

  function sampleCollection() {
    const created = nowIso();
    return {
      id: uuid(),
      name: 'Sample Collection',
      description: 'Example requests to get you started.',
      created,
      variables: {},
      docs_url: '',
      docs_notes: '',
      allow_ai_doc_fetch: false,
      ai_sources: [],
      requests: [
        { id: uuid(), name: 'Get Users', method: 'GET', url: 'https://jsonplaceholder.typicode.com/users', params: [], headers: [], body: '', bodyType: 'json', auth: { type: 'none' }, folder: null },
        { id: uuid(), name: 'Get Post', method: 'GET', url: 'https://jsonplaceholder.typicode.com/posts/1', params: [], headers: [], body: '', bodyType: 'json', auth: { type: 'none' }, folder: null },
        { id: uuid(), name: 'Create Post', method: 'POST', url: 'https://jsonplaceholder.typicode.com/posts', params: [], headers: [['Content-Type', 'application/json']], body: '{"title":"foo","body":"bar","userId":1}', bodyType: 'json', auth: { type: 'none' }, folder: null },
      ],
    };
  }

  function sampleEnvironments() {
    const dev = uuid();
    const prod = uuid();
    return {
      active: dev,
      envs: {
        [dev]: { id: dev, name: 'Development', variables: { baseUrl: 'http://localhost:3000', apiKey: 'dev-key-123', token: '', userId: '1' } },
        [prod]: { id: prod, name: 'Production', variables: { baseUrl: 'https://api.example.com', apiKey: 'prod-key-abc', token: '', userId: '' } },
      },
    };
  }

  function tokenizeCurl(command = '') {
    command = String(command || '').replace(/\\\r?\n/g, ' ');
    const tokens = [];
    let current = '';
    let quote = '';
    let escape = false;
    for (const char of String(command || '')) {
      if (escape) {
        current += char;
        escape = false;
        continue;
      }
      if (char === '\\' && quote !== '\'') {
        escape = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = '';
        else current += char;
        continue;
      }
      if (char === '"' || char === '\'') {
        quote = char;
        continue;
      }
      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }
      current += char;
    }
    if (current) tokens.push(current);
    return tokens;
  }

  function importCurl(raw, name = '') {
    let tokens = tokenizeCurl(raw);
    if (tokens[0]?.toLowerCase() === 'curl') tokens = tokens.slice(1);
    if (!tokens.length) throw new Error('No cURL arguments found');
    let method = 'GET';
    let url = '';
    const headers = [];
    const bodyParts = [];
    let auth = { type: 'none' };
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if ((token === '-X' || token === '--request') && tokens[i + 1]) {
        method = String(tokens[i + 1]).toUpperCase();
        i += 1;
        continue;
      }
      if ((token === '-H' || token === '--header') && tokens[i + 1]) {
        const header = tokens[i + 1];
        const idx = header.indexOf(':');
        if (idx > -1) headers.push([header.slice(0, idx).trim(), header.slice(idx + 1).trim()]);
        i += 1;
        continue;
      }
      if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '-F', '--form'].includes(token) && tokens[i + 1]) {
        bodyParts.push(tokens[i + 1]);
        if (method === 'GET') method = 'POST';
        i += 1;
        continue;
      }
      if ((token === '-u' || token === '--user') && tokens[i + 1]) {
        const [username, password = ''] = String(tokens[i + 1]).split(':');
        auth = { type: 'basic', username, password };
        i += 1;
        continue;
      }
      if (token === '--url' && tokens[i + 1]) {
        url = tokens[i + 1];
        i += 1;
        continue;
      }
      if (/^https?:\/\//i.test(token) || (!token.startsWith('-') && !url)) {
        url = token;
      }
    }
    if (!url) throw new Error('Could not find a URL in the cURL command');
    const body = bodyParts.join('&');
    if (body && !headers.some(([key]) => String(key).toLowerCase() === 'content-type')) {
      headers.push(['Content-Type', body.trim().startsWith('{') || body.trim().startsWith('[') ? 'application/json' : 'application/x-www-form-urlencoded']);
    }
    const parsed = new URL(url);
    const defaultName = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || parsed.hostname || 'Imported cURL';
    return {
      id: uuid(),
      name: name || `${defaultName} Collection`,
      description: 'Imported from cURL',
      created: nowIso(),
      variables: {},
      docs_url: '',
      docs_notes: '',
      allow_ai_doc_fetch: false,
      ai_sources: [],
      requests: [{
        id: uuid(),
        name: name || defaultName,
        method,
        url,
        params: [],
        headers,
        body,
        bodyType: body && headers.some(([key, value]) => String(key).toLowerCase() === 'content-type' && String(value).includes('x-www-form-urlencoded')) ? 'form' : 'json',
        auth,
        folder: null,
      }],
    };
  }

  function importPostman(raw) {
    const name = raw?.info?.name || 'Imported';
    const requests = [];
    const extract = (items, folder = null) => {
      (items || []).forEach(item => {
        if (Array.isArray(item.item)) {
          extract(item.item, item.name || folder);
          return;
        }
        const req = item.request || item || {};
        let url = req.url || '';
        if (url && typeof url === 'object' && !Array.isArray(url)) url = url.raw || '';
        const body = req.body || {};
        let rawBody = '';
        let bodyType = 'json';
        if (body.mode === 'raw') rawBody = body.raw || '';
        else if (body.mode === 'urlencoded') {
          bodyType = 'form';
          rawBody = (body.urlencoded || []).filter(row => !row.disabled && row.key).map(row => `${row.key}=${row.value || ''}`).join('&');
        }
        const params = req.url && typeof req.url === 'object' && !Array.isArray(req.url)
          ? (req.url.query || []).filter(row => !row.disabled && row.key).map(row => [row.key, row.value || ''])
          : [];
        const headers = (req.header || []).filter(row => !row.disabled && row.key).map(row => [row.key, row.value || '']);
        requests.push({
          id: uuid(),
          name: item.name || String(url || '').slice(0, 40) || 'Imported Request',
          method: String(req.method || 'GET').toUpperCase(),
          url: String(url || ''),
          params,
          headers,
          body: rawBody,
          bodyType,
          auth: { type: 'none' },
          folder,
        });
      });
    };
    extract(raw?.item || []);
    return {
      id: uuid(),
      name,
      description: raw?.info?.description || '',
      created: nowIso(),
      variables: {},
      docs_url: '',
      docs_notes: '',
      allow_ai_doc_fetch: false,
      ai_sources: [],
      requests,
    };
  }

  return {
    nowIso,
    uuid,
    defaultSettings,
    sampleCollection,
    sampleEnvironments,
    normalizeAiSources,
    legacyAiFields,
    importCurl,
    importPostman,
  };
})();
