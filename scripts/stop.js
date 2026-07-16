const { spawnSync } = require('node:child_process');
const path = require('node:path');

const targets = [
  { name: 'server', dir: path.join(__dirname, '..', 'server') },
  { name: 'frontend', dir: path.join(__dirname, '..', 'frontend') },
];

for (const { name, dir } of targets) {
  console.log(`Stopping ${name}...`);
  const result = spawnSync('npm', ['run', 'stop'], { cwd: dir, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`Failed to stop ${name} (exit code ${result.status}).`);
  }
}
