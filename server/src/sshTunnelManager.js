const { spawn } = require('node:child_process');

const MAX_LOG_LINES = 200;
const ASSUME_RUNNING_AFTER_MS = 4000;

/**
 * Tracks the single `ssh -R` reverse-tunnel child process for the
 * "Tunnel to Public IP url" admin option. Unlike cloudflared, OpenSSH prints
 * nothing on a successful `-N -R` forward, so there is no banner to scrape.
 * Failures (auth, DNS, connection refused) exit quickly, so we treat the
 * process surviving a short grace period as a successful connection.
 */
class SshTunnelManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.status = 'stopped'; // stopped | starting | running | stopping | error
    this.localUrl = null;
    this.publicUrl = null;
    this.publicIp = null;
    this.remotePort = null;
    this.startedAt = null;
    this.error = null;
    this.process = null;
    this.logs = [];
    if (this.runningTimer) clearTimeout(this.runningTimer);
    this.runningTimer = null;
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

  start({ localUrl, publicIp, sshUser, sshPort, remotePort, privateKeyPath }) {
    if (this.status === 'starting' || this.status === 'running') {
      throw Object.assign(new Error('A tunnel is already starting or running. Stop it first.'), { statusCode: 409 });
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

    const host = (publicIp || '').trim();
    if (!host) {
      throw Object.assign(new Error('Public IP / domain is required'), { statusCode: 400 });
    }
    const user = (sshUser || '').trim();
    if (!user) {
      throw Object.assign(new Error('SSH user is required'), { statusCode: 400 });
    }
    const port = Number(sshPort) || 22;
    const remote = Number(remotePort);
    if (!Number.isInteger(remote) || remote < 1 || remote > 65535) {
      throw Object.assign(new Error('Remote port must be an integer between 1 and 65535'), { statusCode: 400 });
    }

    const localHost = parsedLocal.hostname;
    const localPort = parsedLocal.port || (parsedLocal.protocol === 'https:' ? '443' : '80');

    this.reset();
    this.status = 'starting';
    this.localUrl = parsedLocal.toString();
    this.publicIp = host;
    this.remotePort = remote;
    this.startedAt = new Date().toISOString();

    const args = [
      '-N',
      '-p', String(port),
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      '-R', `0.0.0.0:${remote}:${localHost}:${localPort}`,
    ];
    if (privateKeyPath && privateKeyPath.trim()) {
      args.push('-i', privateKeyPath.trim());
    }
    args.push(`${user}@${host}`);

    let child;
    try {
      child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.status = 'error';
      this.error = `Failed to launch ssh: ${err.message}`;
      throw Object.assign(new Error(this.error), { statusCode: 500 });
    }

    this.process = child;

    const onOutput = (data) => {
      const text = data.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) this._pushLog(line.trim());
      }
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);

    child.on('error', (err) => {
      this.status = 'error';
      this.error = err.code === 'ENOENT'
        ? 'ssh executable not found on PATH. Install the OpenSSH client and try again.'
        : `ssh process error: ${err.message}`;
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
        this.error = `ssh exited unexpectedly (code=${code}, signal=${signal}).${detail ? ' ' + detail : ''}`;
      }
    });

    // OpenSSH prints nothing on a successful -N -R forward, so treat
    // "still alive after a short grace period" as connected.
    this.runningTimer = setTimeout(() => {
      if (this.status === 'starting' && this.process) {
        this.status = 'running';
        this.publicUrl = `${parsedLocal.protocol}//${host}:${remote}`;
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

module.exports = new SshTunnelManager();
