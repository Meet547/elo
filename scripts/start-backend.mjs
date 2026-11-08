import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const name of ['SESSION_SECRET','BACKEND_PROXY_SECRET','OLLAMA_API_KEY','DATABASE_URL']) {
  if (!process.env[name]) throw new Error(`${name} must be configured on Render.`);
}
if ([process.env.SESSION_SECRET,process.env.BACKEND_PROXY_SECRET].some(value=>value.includes('replace-with'))) throw new Error('Replace the example secrets before deploying.');
if (process.env.SESSION_SECRET.length < 32 || process.env.BACKEND_PROXY_SECRET.length < 32) throw new Error('Signing/proxy secrets must contain at least 32 characters.');
const file = process.env.DATABASE_URL.slice(5);
if (!process.env.DATABASE_URL.startsWith('file:') || !isAbsolute(file)) throw new Error('DATABASE_URL must point to an absolute file on the Render disk.');
mkdirSync(dirname(file), {recursive:true});
// Some SQLite engine versions require the file to exist on first connection.
// Append mode creates an empty file without truncating an existing database.
closeSync(openSync(file, "a"));
// deploy never resets data. Unapplied committed migrations are applied before serving.
const migrate = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {stdio:'inherit',env:process.env});
if (migrate.status !== 0) process.exit(migrate.status || 1);
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','backend/.app','--hostname','0.0.0.0','--port',process.env.PORT || '4000'],{stdio:'inherit',env:process.env});
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code || 0));
