const { spawn } = require('node:child_process');

const TRYCLOUDFLARE_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const MAX_LOG_LINES = 200;

/**
 * Tracks the single cloudflared quick-tunnel child process for this admin page.
 * cloudflared prints its assigned https://<random>.trycloudflare.com URL to
 * stderr once the tunnel handshake completes, so we scrape stdout+stderr for it.
 */
class TunnelManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.status = 'stopped'; // stopped | starting | running | stopping | error
    this.localUrl = null;
    this.publicUrl = null;
    this.startedAt = null;
    this.error = null;
    this.process = null;
    this.logs = [];
  }

  getStatus() {
    return {
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

  start(localUrl) {
    if (this.status === 'starting' || this.status === 'running') {
      throw Object.assign(new Error('A tunnel is already starting or running. Stop it first.'), { statusCode: 409 });
    }

    let parsed;
    try {
      parsed = new URL(localUrl);
    } catch {
      throw Object.assign(new Error('localUrl must be a valid URL, e.g. https://localhost:4443'), { statusCode: 400 });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw Object.assign(new Error('localUrl must use http or https'), { statusCode: 400 });
    }

    this.reset();
    this.status = 'starting';
    this.localUrl = parsed.toString();
    this.startedAt = new Date().toISOString();

    const args = ['tunnel', '--no-autoupdate', '--url', this.localUrl];
    if (parsed.protocol === 'https:') {
      // Local dev HTTPS servers commonly use self-signed certs; cloudflared
      // refuses to proxy to them unless certificate verification is disabled.
      args.push('--no-tls-verify');
    }

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
      if (this.status === 'starting') {
        const match = text.match(TRYCLOUDFLARE_URL_RE);
        if (match) {
          this.publicUrl = match[0];
          this.status = 'running';
        }
      }
    };

    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);

    child.on('error', (err) => {
      // e.g. ENOENT when cloudflared isn't installed / not on PATH
      this.status = 'error';
      this.error = err.code === 'ENOENT'
        ? 'cloudflared executable not found on PATH. Install it from https://github.com/cloudflare/cloudflared and try again.'
        : `cloudflared process error: ${err.message}`;
      this.process = null;
    });

    child.on('exit', (code, signal) => {
      const wasStopping = this.status === 'stopping';
      this.process = null;
      if (wasStopping) {
        this.status = 'stopped';
        this.publicUrl = null;
      } else if (this.status !== 'error') {
        this.status = 'error';
        this.error = `cloudflared exited unexpectedly (code=${code}, signal=${signal}).`;
      }
    });

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

module.exports = new TunnelManager();
