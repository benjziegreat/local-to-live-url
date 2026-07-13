const { spawn, execFileSync } = require('node:child_process');

const MAX_LOG_LINES = 200;
const ASSUME_RUNNING_AFTER_MS = 6000;
const REGISTERED_RE = /Registered tunnel connection/i;
const SLOT_COUNT = 5;
const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

function cloudflaredTunnelExists(name) {
  try {
    execFileSync('cloudflared', ['tunnel', 'info', name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tracks one `cloudflared tunnel run` child process for a "Tunnel to DNS
 * url" slot. If no named tunnel exists yet for the given subdomain, `start`
 * provisions one automatically (`cloudflared tunnel create` +
 * `tunnel route dns --overwrite-dns`) before launching the connector, using
 * the subdomain itself as the tunnel name/ID.
 */
class DnsTunnelSlot {
  constructor(id) {
    this.id = id;
    this.reset();
  }

  reset() {
    this.status = 'stopped'; // stopped | starting | running | stopping | error
    this.localUrl = null;
    this.publicUrl = null;
    this.subdomain = null;
    this.startedAt = null;
    this.error = null;
    this.process = null;
    this.logs = [];
    if (this.runningTimer) clearTimeout(this.runningTimer);
    this.runningTimer = null;
  }

  getStatus() {
    return {
      id: this.id,
      status: this.status,
      localUrl: this.localUrl,
      publicUrl: this.publicUrl,
      startedAt: this.startedAt,
      error: this.error,
      logs: this.logs.slice(-40),
    };
  }

  _pushLog(line) {
    if (!line) return;
    this.logs.push(line);
    if (this.logs.length > MAX_LOG_LINES) this.logs.shift();
  }

  start({ localUrl, subdomain }) {
    if (this.status === 'starting' || this.status === 'running') {
      throw Object.assign(new Error('This tunnel is already starting or running. Stop it first.'), { statusCode: 409 });
    }

    let parsedLocal;
    try {
      parsedLocal = new URL(localUrl);
    } catch {
      throw Object.assign(new Error('localUrl must be a valid URL, e.g. https://localhost/PMS/'), { statusCode: 400 });
    }
    if (parsedLocal.protocol !== 'http:' && parsedLocal.protocol !== 'https:') {
      throw Object.assign(new Error('localUrl must use http or https'), { statusCode: 400 });
    }

    let host = (subdomain || '').trim();
    if (!host) {
      throw Object.assign(new Error('Cloudflared subdomain is required'), { statusCode: 400 });
    }
    // Tolerate a pasted full URL (e.g. "https://cjcshell.example.com/") even
    // though `cloudflared tunnel run` needs the bare hostname as tunnel ID.
    if (host.includes('://')) {
      try {
        host = new URL(host).hostname;
      } catch {
        throw Object.assign(new Error('Cloudflared subdomain must be a valid hostname or URL'), { statusCode: 400 });
      }
    } else {
      host = host.split('/')[0];
    }
    if (!HOSTNAME_RE.test(host)) {
      throw Object.assign(new Error('Cloudflared subdomain must be a valid hostname, e.g. cjcshell.intekn-app.com'), { statusCode: 400 });
    }

    this.reset();
    this.status = 'starting';
    this.localUrl = parsedLocal.toString();
    this.subdomain = host;
    this.publicUrl = `https://${host}`;
    this.startedAt = new Date().toISOString();

    try {
      if (!cloudflaredTunnelExists(host)) {
        this._pushLog(`No named tunnel "${host}" found — creating it.`);
        execFileSync('cloudflared', ['tunnel', 'create', host], { stdio: ['ignore', 'pipe', 'pipe'] });
      }
      this._pushLog(`Routing DNS for "${host}" to this tunnel.`);
      execFileSync('cloudflared', ['tunnel', 'route', 'dns', '--overwrite-dns', host, host], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.status = 'error';
      const detail = err.stderr ? err.stderr.toString().trim() : err.message;
      this.error = `Failed to provision tunnel "${host}": ${detail}`;
      throw Object.assign(new Error(this.error), { statusCode: 500 });
    }

    const args = ['tunnel', '--no-autoupdate', '--url', this.localUrl];
    if (parsedLocal.protocol === 'https:') {
      // Local dev HTTPS servers commonly use self-signed certs; cloudflared
      // refuses to proxy to them unless certificate verification is disabled.
      args.push('--no-tls-verify');
    }
    args.push('run', host);

    let child;
    try {
      child = spawn('cloudflared', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.status = 'error';
      this.error = `Failed to launch cloudflared: ${err.message}`;
      throw Object.assign(new Error(this.error), { statusCode: 500 });
    }

    this.process = child;

    const onOutput = (data) => {
      const text = data.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) this._pushLog(line.trim());
      }
      if (this.status === 'starting' && REGISTERED_RE.test(text)) {
        this.status = 'running';
        if (this.runningTimer) clearTimeout(this.runningTimer);
      }
    };

    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);

    child.on('error', (err) => {
      this.status = 'error';
      this.error = err.code === 'ENOENT'
        ? 'cloudflared executable not found on PATH. Install it from https://github.com/cloudflare/cloudflared and try again.'
        : `cloudflared process error: ${err.message}`;
      this.process = null;
      if (this.runningTimer) clearTimeout(this.runningTimer);
    });

    child.on('exit', (code, signal) => {
      const wasStopping = this.status === 'stopping';
      this.process = null;
      if (this.runningTimer) clearTimeout(this.runningTimer);
      if (wasStopping) {
        this.status = 'stopped';
        this.publicUrl = null;
      } else if (this.status !== 'error') {
        this.status = 'error';
        const detail = this.logs.slice(-3).join(' | ');
        this.error = `cloudflared exited unexpectedly (code=${code}, signal=${signal}).${detail ? ' ' + detail : ''}`;
      }
    });

    // Fallback in case cloudflared's log wording changes across versions:
    // treat "still alive after a grace period" as connected too.
    this.runningTimer = setTimeout(() => {
      if (this.status === 'starting' && this.process) {
        this.status = 'running';
      }
    }, ASSUME_RUNNING_AFTER_MS);

    return this.getStatus();
  }

  stop() {
    if (this.status === 'stopped') {
      return this.getStatus();
    }
    if (!this.process) {
      this.reset();
      return this.getStatus();
    }
    this.status = 'stopping';
    this.process.kill();
    return this.getStatus();
  }
}

class DnsTunnelManager {
  constructor() {
    this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => new DnsTunnelSlot(i));
  }

  _slot(id) {
    const idx = Number(id);
    if (!Number.isInteger(idx) || idx < 0 || idx >= SLOT_COUNT) {
      throw Object.assign(new Error(`Invalid tunnel id: ${id}`), { statusCode: 400 });
    }
    return this.slots[idx];
  }

  getAllStatus() {
    return this.slots.map((slot) => slot.getStatus());
  }

  getStatus(id) {
    return this._slot(id).getStatus();
  }

  start(id, payload) {
    return this._slot(id).start(payload);
  }

  stop(id) {
    return this._slot(id).stop();
  }
}

module.exports = new DnsTunnelManager();
