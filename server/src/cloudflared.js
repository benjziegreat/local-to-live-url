const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Locates (or downloads) the cloudflared binary and manages Cloudflare logins
 * ("profiles"). Each profile is an isolated home directory holding its own
 * `.cloudflared/cert.pem`, so several Cloudflare accounts can live side by side
 * and the dashboard can switch between them. The built-in "system" profile is
 * the machine's normal ~/.cloudflared login.
 */

const APP_ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.CLOUDFLARE_DATA_DIR || path.join(APP_ROOT, 'data');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const ACTIVE_FILE = path.join(DATA_DIR, 'active-profile.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BIN_DIR = path.join(APP_ROOT, 'bin');
const EXE = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
const SYSTEM_PROFILE = 'system';
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const TOKEN_BLOCK_RE = /-----BEGIN ARGO TUNNEL TOKEN-----([\s\S]+?)-----END ARGO TUNNEL TOKEN-----/;
const LOGIN_URL_RE = /https:\/\/dash\.cloudflare\.com\/argotunnel\S+/;

function httpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

// ---------------------------------------------------------------- settings

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...readSettings(), ...patch }, null, 2));
}

// ---------------------------------------------------------------- binary

/**
 * After "Uninstall", copies of cloudflared outside this app are ignored, so the
 * app behaves like a machine that never had it (only bin/ counts) until the
 * user re-enables them.
 */
function systemBinaryIgnored() {
  return readSettings().ignoreSystemBinary === true;
}

function candidatePaths() {
  const list = [{ path: path.join(BIN_DIR, EXE), source: 'bundled' }];
  if (systemBinaryIgnored()) return list;
  if (process.env.CLOUDFLARED_PATH) list.unshift({ path: process.env.CLOUDFLARED_PATH, source: 'CLOUDFLARED_PATH' });
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    list.push({ path: path.join(dir, EXE), source: 'PATH' });
  }
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
      if (base) list.push({ path: path.join(base, 'cloudflared', EXE), source: 'installed' });
    }
    if (process.env.LOCALAPPDATA) {
      list.push({ path: path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', EXE), source: 'installed' });
    }
  } else {
    for (const dir of ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']) {
      list.push({ path: path.join(dir, EXE), source: 'installed' });
    }
  }
  return list;
}

let binaryCache = null;

function findBinary({ refresh = false } = {}) {
  if (binaryCache && !refresh && fs.existsSync(binaryCache.path)) return binaryCache;
  binaryCache = null;
  for (const candidate of candidatePaths()) {
    try {
      if (!fs.statSync(candidate.path).isFile()) continue;
      const version = execFileSync(candidate.path, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
      binaryCache = { ...candidate, version };
      break;
    } catch {
      // Not there, or not runnable; try the next location.
    }
  }
  return binaryCache;
}

/** Path to cloudflared, or a 412 error the dashboard turns into an "install it" prompt. */
function binaryPath() {
  const found = findBinary();
  if (!found) {
    throw httpError(
      'cloudflared is not installed on this machine. Open the "Cloudflare setup" tab to install it.',
      412
    );
  }
  return found.path;
}

function downloadAssetName() {
  const arch = { x64: 'amd64', ia32: '386', arm64: 'arm64', arm: 'arm' }[process.arch];
  if (process.platform === 'win32') {
    // Windows on ARM runs the amd64 build under emulation.
    return `cloudflared-windows-${arch === '386' ? '386' : 'amd64'}.exe`;
  }
  if (process.platform === 'linux' && arch) return `cloudflared-linux-${arch}`;
  return null;
}

const install = { status: 'idle', error: null }; // idle | downloading | error

async function runInstall() {
  const asset = downloadAssetName();
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  const target = path.join(BIN_DIR, EXE);
  const temp = `${target}.download`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    fs.mkdirSync(BIN_DIR, { recursive: true });
    fs.writeFileSync(temp, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
    fs.renameSync(temp, target);
    if (!findBinary({ refresh: true })) throw new Error('downloaded file could not be run');
    install.status = 'idle';
  } catch (err) {
    fs.rmSync(temp, { force: true });
    install.status = 'error';
    install.error = `Could not install cloudflared: ${err.message}`;
  }
}

/** Deletes the app's downloaded copy and hides any system copy, simulating a fresh machine. */
function uninstall() {
  if (install.status === 'downloading') throw httpError('A download is in progress. Wait for it to finish.', 409);
  try {
    fs.rmSync(path.join(BIN_DIR, EXE), { force: true });
  } catch (err) {
    throw httpError(`Could not delete ${path.join(BIN_DIR, EXE)}: ${err.message}`, 500);
  }
  writeSettings({ ignoreSystemBinary: true });
  install.error = null;
  findBinary({ refresh: true });
}

function useSystemBinary() {
  writeSettings({ ignoreSystemBinary: false });
  findBinary({ refresh: true });
}

function startInstall() {
  if (!downloadAssetName()) {
    throw httpError('Automatic install is not supported on this OS. On macOS run: brew install cloudflared', 400);
  }
  if (install.status !== 'downloading') {
    install.status = 'downloading';
    install.error = null;
    runInstall();
  }
}

// ---------------------------------------------------------------- profiles

function profileHome(name) {
  return name === SYSTEM_PROFILE ? os.homedir() : path.join(PROFILES_DIR, name, 'home');
}

function certPath(name) {
  return path.join(profileHome(name), '.cloudflared', 'cert.pem');
}

/** Folder where this app keeps the per-tunnel credential JSON files for a profile. */
function tunnelCredDir(name) {
  return path.join(PROFILES_DIR, name, 'tunnels');
}

function accountFromPem(text) {
  try {
    const match = text.match(TOKEN_BLOCK_RE);
    const token = JSON.parse(Buffer.from(match[1].replace(/\s/g, ''), 'base64').toString('utf8'));
    return { accountId: token.accountID || null, zoneId: token.zoneID || null };
  } catch {
    return { accountId: null, zoneId: null };
  }
}

function readAccount(file) {
  try {
    return accountFromPem(fs.readFileSync(file, 'utf8'));
  } catch {
    return { accountId: null, zoneId: null };
  }
}

function listProfileNames() {
  let custom = [];
  try {
    custom = fs
      .readdirSync(PROFILES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== SYSTEM_PROFILE && PROFILE_NAME_RE.test(d.name))
      .map((d) => d.name);
  } catch {
    // No profiles yet.
  }
  return [SYSTEM_PROFILE, ...custom.sort()];
}

function activeProfile() {
  try {
    const { name } = JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'));
    if (listProfileNames().includes(name)) return name;
  } catch {
    // Fall through to the default.
  }
  return SYSTEM_PROFILE;
}

function assertProfile(name) {
  if (!listProfileNames().includes(name)) throw httpError(`Unknown Cloudflare profile "${name}"`, 404);
}

function createProfile(name) {
  const clean = String(name || '').trim();
  if (!PROFILE_NAME_RE.test(clean) || clean.toLowerCase() === SYSTEM_PROFILE) {
    throw httpError('Profile name must be 1-32 letters, digits, "-" or "_" (and not "system").', 400);
  }
  if (listProfileNames().includes(clean)) throw httpError(`Profile "${clean}" already exists`, 409);
  fs.mkdirSync(path.join(profileHome(clean), '.cloudflared'), { recursive: true });
  return clean;
}

function setActiveProfile(name) {
  assertProfile(name);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ name }));
}

function deleteProfile(name) {
  if (name === SYSTEM_PROFILE) throw httpError('The system profile cannot be deleted.', 400);
  assertProfile(name);
  if (login.status === 'waiting' && login.profile === name) cancelLogin();
  fs.rmSync(path.join(PROFILES_DIR, name), { recursive: true, force: true });
  if (activeProfile() === name) setActiveProfile(SYSTEM_PROFILE);
}

function importCert(name, pem) {
  assertProfile(name);
  const text = String(pem || '');
  if (!accountFromPem(text).accountId) {
    throw httpError('That is not a valid cloudflared cert.pem (missing "ARGO TUNNEL TOKEN" block).', 400);
  }
  const file = certPath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o600 });
}

/**
 * Logs a profile out of Cloudflare. The cert.pem is moved to a timestamped
 * backup (never deleted), and the app's cached tunnel credentials are cleared so
 * the next start fetches them again, as on a fresh machine.
 */
function logout(name) {
  assertProfile(name);
  if (login.status === 'waiting' && login.profile === name) cancelLogin();
  const cert = certPath(name);
  let backup = null;
  if (fs.existsSync(cert)) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
    backup = `${cert}.backup-${stamp}`;
    fs.renameSync(cert, backup);
  }
  fs.rmSync(tunnelCredDir(name), { recursive: true, force: true });
  return backup;
}

/** Environment that points cloudflared at a profile's login. */
function profileEnv(name) {
  const env = { ...process.env, TUNNEL_ORIGIN_CERT: certPath(name) };
  if (name !== SYSTEM_PROFILE) {
    env.HOME = profileHome(name);
    env.USERPROFILE = profileHome(name);
  }
  return env;
}

/** Everything a named-tunnel command needs, or a 412 error prompting the user to log in. */
function activeContext() {
  const bin = binaryPath();
  const profile = activeProfile();
  if (!fs.existsSync(certPath(profile))) {
    throw httpError(
      `Not logged in to Cloudflare (profile "${profile}"). Open the "Cloudflare setup" tab to log in or import a cert.pem.`,
      412
    );
  }
  const credDir = tunnelCredDir(profile);
  fs.mkdirSync(credDir, { recursive: true });
  return { bin, profile, env: profileEnv(profile), credDir };
}

// ---------------------------------------------------------------- browser login

const login = { status: 'idle', profile: null, url: null, error: null, process: null }; // idle | waiting | done | error

function startLogin(name) {
  assertProfile(name);
  const bin = binaryPath();
  if (login.status === 'waiting') cancelLogin();

  const cert = certPath(name);
  if (fs.existsSync(cert)) {
    if (name === SYSTEM_PROFILE) {
      throw httpError('The system profile is already logged in. Create a new profile to use another account.', 409);
    }
    // cloudflared refuses to overwrite an existing cert; keep the old one as a backup.
    fs.renameSync(cert, `${cert}.bak`);
  }
  fs.mkdirSync(path.dirname(cert), { recursive: true });

  Object.assign(login, { status: 'waiting', profile: name, url: null, error: null });
  const child = spawn(bin, ['tunnel', 'login'], { env: profileEnv(name), stdio: ['ignore', 'pipe', 'pipe'] });
  login.process = child;

  const onOutput = (data) => {
    const match = data.toString().match(LOGIN_URL_RE);
    if (match && !login.url) login.url = match[0];
  };
  child.stdout.on('data', onOutput);
  child.stderr.on('data', onOutput);
  child.on('error', (err) => {
    Object.assign(login, { status: 'error', error: err.message, process: null });
  });
  child.on('exit', () => {
    if (login.process !== child) return;
    login.process = null;
    if (fs.existsSync(cert)) {
      fs.rmSync(`${cert}.bak`, { force: true });
      login.status = 'done';
    } else {
      if (fs.existsSync(`${cert}.bak`)) fs.renameSync(`${cert}.bak`, cert);
      if (login.status === 'waiting') {
        Object.assign(login, { status: 'error', error: 'Login did not complete (cancelled or timed out).' });
      }
    }
  });
}

function cancelLogin() {
  const child = login.process;
  if (child) {
    login.status = 'error';
    login.error = 'Login cancelled.';
    child.kill();
  }
}

// ---------------------------------------------------------------- status

function getStatus({ refresh = false } = {}) {
  const binary = findBinary({ refresh });
  const active = activeProfile();
  return {
    binary: binary
      ? { found: true, path: binary.path, version: binary.version, source: binary.source }
      : { found: false, path: null, version: null, source: null },
    canInstall: downloadAssetName() !== null,
    systemBinaryIgnored: systemBinaryIgnored(),
    install: { status: install.status, error: install.error },
    activeProfile: active,
    profiles: listProfileNames().map((name) => {
      const hasCert = fs.existsSync(certPath(name));
      return {
        name,
        builtIn: name === SYSTEM_PROFILE,
        active: name === active,
        loggedIn: hasCert,
        ...(hasCert ? readAccount(certPath(name)) : { accountId: null, zoneId: null }),
      };
    }),
    login: { status: login.status, profile: login.profile, url: login.url, error: login.error },
  };
}

module.exports = {
  binaryPath,
  activeContext,
  getStatus,
  startInstall,
  uninstall,
  useSystemBinary,
  createProfile,
  logout,
  setActiveProfile,
  deleteProfile,
  importCert,
  startLogin,
  cancelLogin,
};
