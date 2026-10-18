// Fetch-only adapter: keep management credentials in the host, not the sandbox.
export class Daytona {
  constructor(env) {
    this.key = env.DAYTONA_API_KEY;
    this.base = env.DAYTONA_API_URL || 'https://app.daytona.io/api';
    this.test = env.APP_ENV === 'test';
    this.checkUrl(this.base);
  }
  checkUrl(value) {
    const url = new URL(value);
    const trusted = url.protocol === 'https:' && ['app.daytona.io', 'proxy.app.daytona.io'].includes(url.hostname);
    const fixture = this.test && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!trusted && !fixture) || url.username || url.password) throw Error('untrusted_daytona_endpoint');
  }
  async request(url, method = 'GET', body, timeout = 10000) {
    this.checkUrl(url);
    const response = await fetch(url, {
      method, headers: { Authorization: `Bearer ${this.key}`, ...(body ? {'Content-Type':'application/json'} : {}) },
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(timeout), redirect:'manual',
    });
    if (response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(Error(`daytona_http_${response.status}`), {status:response.status});
    }
    const text = await response.text();
    if (text.length > 1048576) throw Error('daytona_response_too_large');
    return text ? JSON.parse(text) : {};
  }
  get(name) { return this.request(`${this.base}/sandbox/${encodeURIComponent(name)}`); }
  create(name, { network = false, ttlMinutes = 5 } = {}) {
    if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 15) throw Error('invalid_sandbox_ttl');
    return this.request(`${this.base}/sandbox`, 'POST', {
      name, snapshot:'dad882b3-a047-4715-8713-bddec50bb7ca', target:'us',
      public:false, networkBlockAll:!network,
      autoStopInterval:1, autoDeleteInterval:0, ttlMinutes,
      labels:{'gameverse.scope':'staging-reference','gameverse.request':name},
    });
  }
  delete(name) { return this.request(`${this.base}/sandbox/${encodeURIComponent(name)}`, 'DELETE'); }
  toolbox(sandbox, path) {
    if (!sandbox.toolboxProxyUrl) throw Error('missing_toolbox_url');
    const url = `${sandbox.toolboxProxyUrl.replace(/\/$/,'')}/${encodeURIComponent(sandbox.id)}${path}`;
    this.checkUrl(url);
    return url;
  }
  execute(sandbox, command, timeout = 10) {
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30) throw Error('invalid_command_timeout');
    return this.request(this.toolbox(sandbox, '/process/execute'), 'POST', {command,timeout}, (timeout + 5) * 1000);
  }
  async upload(sandbox, path, bytes) {
    const url = this.toolbox(sandbox, `/files/upload-v2?path=${encodeURIComponent(path)}`);
    const form = new FormData();
    form.append('file', new Blob([bytes]), 'input');
    const response = await fetch(url, { method:'POST', headers:{Authorization:`Bearer ${this.key}`},
      body:form, redirect:'manual', signal:AbortSignal.timeout(15000) });
    await response.body?.cancel();
    if (!response.ok) throw Error(`daytona_upload_${response.status}`);
  }
  async download(sandbox, path, limit = 262144) {
    const url = this.toolbox(sandbox, `/files/download?path=${encodeURIComponent(path)}`);
    const response = await fetch(url, { headers:{Authorization:`Bearer ${this.key}`}, redirect:'manual', signal:AbortSignal.timeout(10000) });
    if (response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw Error(`daytona_download_${response.status}`); }
    const reader = response.body.getReader(), chunks=[];
    let size=0;
    try {
      while (true) {
        const {done,value}=await reader.read(); if (done) break;
        size+=value.length;
        if (size>limit) { await reader.cancel(); throw Error('daytona_file_too_large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes=new Uint8Array(size); let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return bytes;
  }
}
