import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { isolatedDatabaseUrl } from './lib/test-database.mjs';
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
if (!args.length) throw new Error('Provide the test command after with-test-postgres.mjs.');
let container;
let running;
function execute(command, argv, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { env, stdio: 'inherit' });
    running = child;
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve(undefined) : reject(new Error(`Isolated test command failed (${signal ?? code}).`)));
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { running?.kill(signal); });
try {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    container = `elo-test-${randomBytes(6).toString('hex')}`;
    const password = randomBytes(24).toString('hex');
    const result = spawnSync('docker', ['run', '-d', '--name', container, '--label', 'elo.integration=true',
      '-e', 'POSTGRES_USER=elo_test', '-e', 'POSTGRES_DB=elo_test', '-e', 'POSTGRES_PASSWORD',
      '-p', '127.0.0.1::5432', 'postgres:16-alpine'], { env: { ...process.env, POSTGRES_PASSWORD: password }, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Cannot start isolated Postgres. Start Docker or provide a loopback TEST_DATABASE_URL with an elo_test database.');
    const portResult = spawnSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' });
    const port = portResult.stdout.trim().split(':').at(-1);
    if (!/^\d+$/.test(port ?? '')) throw new Error('Could not resolve the isolated Postgres port.');
    url = `postgresql://elo_test:${password}@127.0.0.1:${port}/elo_test`;
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'elo_test'], { stdio: 'ignore' }).status === 0) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Isolated Postgres did not become ready.');
  }
  url = isolatedDatabaseUrl(url);
  const env = { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url, TEST_DATABASE_URL: url, ELO_TEST_DATABASE: '1' };
  await execute(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], env);
  await execute(args[0], args.slice(1), env);
} finally {
  if (container) spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
}
