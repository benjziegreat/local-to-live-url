// Builds the system tray app (Electron) and syncs it into the build-app folder.
// Usage: npm run package [-- <targetDir>]   (or set BUILD_APP_DIR)
//
// The target keeps its data/ (Cloudflare logins, tunnel credentials), bin/
// (downloaded cloudflared) and logs/ folders; everything else is replaced.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const target = path.resolve(
  process.argv[2] || process.env.BUILD_APP_DIR || path.join(root, '..', 'build-app')
);
const KEEP_IN_TARGET = new Set(['data', 'bin', 'logs']);
const APP_NAME = 'LocalToLiveUrl';
const MIN_NODE = [22, 12];

function run(cmd, args, cwd, extraEnv = {}) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true, env: { ...process.env, ...extraEnv } });
  if (result.status !== 0) {
    console.error(`"${cmd} ${args.join(' ')}" failed (exit code ${result.status}).`);
    process.exit(result.status || 1);
  }
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// Electron's tooling needs Node 22.12+. On older Node, re-run this script under a
// temporary Node 22 from npx instead of requiring a system upgrade.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
  console.log(`Node ${process.versions.node} is older than ${MIN_NODE.join('.')}; re-running with Node 22 via npx...`);
  const result = spawnSync('npx', ['-y', 'node@22', JSON.stringify(__filename), ...process.argv.slice(2).map((a) => JSON.stringify(a))], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, BUILD_APP_DIR: target },
  });
  process.exit(result.status ?? 1);
}

async function main() {
  refuseIfRunning();

  const electronDir = path.join(root, 'node_modules', 'electron');
  if (!fs.existsSync(path.join(electronDir, 'dist'))) {
    console.log('Downloading the Electron runtime...');
    run(JSON.stringify(process.execPath), [JSON.stringify(path.join(electronDir, 'install.js'))], root);
  }

  console.log('Building frontend...');
  run('npm', ['run', 'build'], path.join(root, 'frontend'));

  const assets = path.join(root, 'desktop', 'assets');
  if (!fs.existsSync(path.join(assets, 'icon.ico'))) {
    run(JSON.stringify(process.execPath), [JSON.stringify(path.join(__dirname, 'make-icon.js'))], root);
  }

  const stage = stageApp(assets);
  const built = await buildExe(stage, assets);
  syncToTarget(built);

  console.log(`\nTray app updated: ${path.join(target, `${APP_NAME}.exe`)}`);
}

/** The exe can't be replaced while it's running from the target folder. */
function refuseIfRunning() {
  if (process.platform !== 'win32') return;
  const query = `Get-CimInstance Win32_Process -Filter "Name='${APP_NAME}.exe'" | ForEach-Object { $_.ExecutablePath }`;
  const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8' }).stdout || '';
  const targetExe = path.join(target, `${APP_NAME}.exe`).toLowerCase();
  if (out.split(/\r?\n/).some((p) => p.trim().toLowerCase() === targetExe)) {
    fail(`${APP_NAME} is running from ${target}. Quit it from its tray icon (right-click > Quit), then run this again.`);
  }
}

/** Lays out the Electron app: shell + server + compiled dashboard + production deps. */
function stageApp(assets) {
  const stage = path.join(root, 'desktop', '.stage', 'app');
  const server = path.join(root, 'server');
  console.log(`Staging app in ${stage}...`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  for (const file of ['main.js', 'preload.js']) {
    fs.copyFileSync(path.join(root, 'desktop', file), path.join(stage, file));
  }
  fs.cpSync(assets, path.join(stage, 'assets'), { recursive: true });
  fs.cpSync(path.join(server, 'src'), path.join(stage, 'server', 'src'), { recursive: true });
  fs.cpSync(path.join(root, 'frontend', 'dist', 'frontend', 'browser'), path.join(stage, 'server', 'public'), { recursive: true });
  fs.copyFileSync(path.join(root, 'frontend', 'dist', 'frontend', '3rdpartylicenses.txt'), path.join(stage, '3rdpartylicenses.txt'));

  const serverPkg = JSON.parse(fs.readFileSync(path.join(server, 'package.json'), 'utf8'));
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const pkg = {
    name: serverPkg.name,
    productName: 'Local to Live URL',
    version: rootPkg.version,
    private: true,
    main: 'main.js',
    dependencies: serverPkg.dependencies,
  };
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2));
  const lock = path.join(server, 'package-lock.json');
  if (fs.existsSync(lock)) fs.copyFileSync(lock, path.join(stage, 'package-lock.json'));

  console.log('Installing production dependencies...');
  run('npm', [fs.existsSync(lock) ? 'ci' : 'install', '--omit=dev', '--no-audit', '--no-fund'], stage);
  const deps = Object.keys(pkg.dependencies || {});
  const check = spawnSync(process.execPath, ['-e', deps.map((d) => `require(${JSON.stringify(d)})`).join(';')], { cwd: stage });
  if (check.status !== 0) fail('Production dependencies failed to load after install.');
  return stage;
}

/** Wraps the staged app into a native exe folder and hardens it. */
async function buildExe(stage, assets) {
  const { packager } = require('@electron/packager');
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  const outDir = path.join(root, 'desktop', '.out');

  console.log('Packaging the tray app with Electron...');
  const [appPath] = await packager({
    dir: stage,
    out: outDir,
    name: APP_NAME,
    executableName: APP_NAME,
    electronVersion: require('electron/package.json').version,
    icon: path.join(assets, 'icon.ico'),
    overwrite: true,
    asar: false,
    prune: false, // the stage already holds production dependencies only
    quiet: true,
    win32metadata: {
      CompanyName: 'Formbird',
      FileDescription: 'Local to Live URL',
      ProductName: 'Local to Live URL',
    },
  });

  const exe = path.join(appPath, process.platform === 'win32' ? `${APP_NAME}.exe` : APP_NAME);
  // The exe must never act as a bare Node runtime (e.g. when ELECTRON_RUN_AS_NODE
  // is inherited from a VS Code terminal) or accept debugger/NODE_OPTIONS flags.
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
  });
  return appPath;
}

function syncToTarget(built) {
  console.log(`Syncing into ${target}...`);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(target)) {
    if (!KEEP_IN_TARGET.has(entry)) fs.rmSync(path.join(target, entry), { recursive: true, force: true });
  }
  fs.cpSync(built, target, { recursive: true });
  for (const file of fs.readdirSync(path.join(root, 'packaging'))) {
    fs.copyFileSync(path.join(root, 'packaging', file), path.join(target, file));
  }
}

main().catch((err) => fail(err.stack || err.message));
