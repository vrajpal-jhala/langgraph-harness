import { mkdirSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataPath = process.env.DATA_PATH;

if (!dataPath) {
  console.error('Error: DATA_PATH is not set in backend/.env');
  process.exit(1);
}

mkdirSync(`${dataPath}/postgres`, { recursive: true });
mkdirSync(`${dataPath}/redis`, { recursive: true });
mkdirSync(`${dataPath}/app`, { recursive: true });

const composeArgs = [
  'compose',
  '--env-file',
  'backend/.env',
  '-f',
  'docker-compose.dev.yml',
];

const up = spawnSync('docker', [...composeArgs, 'up', '-d', '--wait'], {
  stdio: 'inherit',
  cwd: root,
});
if (up.status !== 0) process.exit(up.status ?? 1);

const migrate = spawnSync('npm', ['run', 'migrate'], {
  stdio: 'inherit',
  cwd: `${root}/backend`,
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const services = spawn('npm', ['run', 'dev:services'], {
  stdio: 'inherit',
  cwd: root,
});

let exited = false;
function shutdown(code) {
  if (exited) return;
  exited = true;
  spawnSync('docker', [...composeArgs, 'down'], {
    stdio: 'inherit',
    cwd: root,
  });
  process.exit(code ?? 0);
}

services.on('exit', (code) => shutdown(code));
// no-op: stops Node's default immediate exit so shutdown() above still runs
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});
