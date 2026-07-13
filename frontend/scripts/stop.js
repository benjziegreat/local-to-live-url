const { execSync } = require('node:child_process');

const PORT = Number(process.env.PORT) || 4200;

function findWindowsPids(port) {
  const out = execSync('netstat -ano', { encoding: 'utf8' });
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (match && Number(match[1]) === port) pids.add(match[2]);
  }
  return [...pids];
}

function findPosixPids(port) {
  try {
    return execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch (err) {
    if (err.status === 1) return []; // lsof exits 1 when nothing matches
    throw err;
  }
}

const pids = process.platform === 'win32' ? findWindowsPids(PORT) : findPosixPids(PORT);

if (pids.length === 0) {
  console.log(`No process listening on port ${PORT}.`);
  process.exit(0);
}

for (const pid of pids) {
  execSync(process.platform === 'win32' ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`);
  console.log(`Stopped process ${pid} on port ${PORT}.`);
}
