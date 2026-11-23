#!/usr/bin/env node
// Stop the AICSS dev servers: whatever is listening on the API port (server/.env PORT, default 4110)
// and the Angular port (4210). Extra ports can be passed: `npm run stop -- 3000 5000`.
//
// Killing only the listening process is not enough: `node --watch` (API) restarts it at once.
// So we walk up from each listener through its node/npm/cmd/sh parents (npm run dev ->
// concurrently -> node --watch / ng serve) and stop that whole tree, stopping at the
// terminal shell (PowerShell, bash, VS Code, ...), which is left running.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const root = path.resolve(__dirname, '..');

function apiPort() {
  try {
    const env = fs.readFileSync(path.join(root, 'server', '.env'), 'utf8');
    const m = /^\s*PORT\s*=\s*"?(\d+)"?/m.exec(env);
    if (m) return Number(m[1]);
  } catch {
    /* no .env: use the default */
  }
  return 4110;
}

const ports = [...new Set([apiPort(), 4210, ...process.argv.slice(2).map(Number).filter(Boolean)])];

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** pid -> { ppid, name } for every running process. */
function processTable() {
  const table = new Map();
  if (isWin) {
    const json = run(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress"',
    );
    for (const p of JSON.parse(json || '[]')) table.set(p.ProcessId, { ppid: p.ParentProcessId, name: String(p.Name).toLowerCase() });
  } else {
    for (const line of run('ps -A -o pid=,ppid=,comm=').split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      if (m) table.set(Number(m[1]), { ppid: Number(m[2]), name: path.basename(m[3].trim()).toLowerCase() });
    }
  }
  return table;
}

/** PIDs listening on a TCP port. */
function listeners(port) {
  const pids = new Set();
  if (isWin) {
    // No "-p tcp": that lists IPv4 only, and the Angular dev server listens on IPv6 ([::1]:4210).
    for (const line of run('netstat -ano').split('\n')) {
      const cols = line.trim().split(/\s+/);
      // Proto  Local Address  Foreign Address  State  PID
      if (cols[0] === 'TCP' && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) pids.add(Number(cols[4]));
    }
  } else {
    for (const pid of run(`lsof -nP -ti tcp:${port} -sTCP:LISTEN`).split('\n')) if (pid.trim()) pids.add(Number(pid));
  }
  pids.delete(0);
  return [...pids];
}

// Parents we climb through: the dev-server launch chain. Anything else (a shell, VS Code) ends the climb.
const LAUNCHERS = isWin ? new Set(['node.exe', 'cmd.exe', 'conhost.exe']) : new Set(['node', 'npm', 'npx', 'sh']);

/** Highest ancestor of `pid` that is still part of the node/npm launch chain. */
function treeRoot(pid, table) {
  let top = pid;
  const seen = new Set([pid]);
  for (;;) {
    const parent = table.get(top)?.ppid;
    if (!parent || seen.has(parent) || parent === process.pid || parent === process.ppid) break;
    const info = table.get(parent);
    if (!info || !LAUNCHERS.has(info.name)) break;
    seen.add(parent);
    top = parent;
  }
  return top;
}

function killTree(pid) {
  if (isWin) return run(`taskkill /PID ${pid} /T /F`) !== '';
  try {
    // Kill descendants first, then the process itself.
    for (const child of run(`pgrep -P ${pid}`).split('\n').filter(Boolean)) killTree(Number(child));
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

const table = processTable();
const roots = new Map();
for (const port of ports) {
  const pids = listeners(port);
  if (!pids.length) {
    console.log(`  port ${port}: nothing running`);
    continue;
  }
  for (const pid of pids) {
    const top = treeRoot(pid, table);
    roots.set(top, [...(roots.get(top) ?? []), port]);
    console.log(`  port ${port}: pid ${pid} (${table.get(pid)?.name ?? '?'})`);
  }
}

if (!roots.size) {
  console.log('No AICSS servers were running.');
  process.exit(0);
}

for (const [pid, onPorts] of roots) {
  const ok = killTree(pid);
  console.log(`${ok ? 'Stopped' : 'Could not stop'} process tree ${pid} (${table.get(pid)?.name ?? '?'}) serving port ${onPorts.join(', ')}`);
}

// Confirm the ports are free.
setTimeout(() => {
  const still = ports.filter((p) => listeners(p).length);
  if (still.length) {
    console.error(`Still in use: ${still.join(', ')}. Try again, or close the terminal running "npm run dev".`);
    process.exit(1);
  }
  console.log(`Ports ${ports.join(', ')} are free.`);
}, 1500);
