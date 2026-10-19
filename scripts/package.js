// Builds the dashboard and syncs a standalone, runnable copy of the app into the build-app folder.
// Usage: npm run package [-- <targetDir>]   (or set BUILD_APP_DIR)
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const target = path.resolve(
  process.argv[2] || process.env.BUILD_APP_DIR || path.join(root, '..', 'build-app')
);

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`"${cmd} ${args.join(' ')}" failed (exit code ${result.status}).`);
    process.exit(result.status || 1);
  }
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function replaceDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

console.log('Building frontend...');
run('npm', ['run', 'build'], path.join(root, 'frontend'));

const dist = path.join(root, 'frontend', 'dist', 'frontend');
const server = path.join(root, 'server');

// Remember the old dependency manifests so we only reinstall when they change.
const oldPkg = readIfExists(path.join(target, 'package.json'));
const oldLock = readIfExists(path.join(target, 'package-lock.json'));

console.log(`Syncing into ${target}...`);
fs.mkdirSync(target, { recursive: true });
replaceDir(path.join(server, 'src'), path.join(target, 'src'));
replaceDir(path.join(dist, 'browser'), path.join(target, 'public'));
fs.mkdirSync(path.join(target, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(server, 'scripts', 'stop.js'), path.join(target, 'scripts', 'stop.js'));
fs.copyFileSync(path.join(dist, '3rdpartylicenses.txt'), path.join(target, '3rdpartylicenses.txt'));
fs.copyFileSync(path.join(server, 'package.json'), path.join(target, 'package.json'));
if (fs.existsSync(path.join(server, 'package-lock.json'))) {
  fs.copyFileSync(path.join(server, 'package-lock.json'), path.join(target, 'package-lock.json'));
}
for (const file of fs.readdirSync(path.join(root, 'packaging'))) {
  fs.copyFileSync(path.join(root, 'packaging', file), path.join(target, file));
}

const depsChanged =
  oldPkg !== readIfExists(path.join(target, 'package.json')) ||
  oldLock !== readIfExists(path.join(target, 'package-lock.json')) ||
  !fs.existsSync(path.join(target, 'node_modules'));

if (depsChanged) {
  console.log('Dependencies changed, installing production packages...');
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], target);
} else {
  console.log('Dependencies unchanged, skipping npm install.');
}

console.log(`\nbuild-app updated: ${target}`);
console.log('If it is currently running, restart it to pick up the changes.');
