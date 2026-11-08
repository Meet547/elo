import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const name of ['SESSION_SECRET','BACKEND_PROXY_SECRET','OLLAMA_API_KEY','DATABASE_URL','DIRECT_DATABASE_URL']) {
  if (!process.env[name]) throw new Error(`${name} must be configured on Render.`);
}
if ([process.env.SESSION_SECRET,process.env.BACKEND_PROXY_SECRET].some(value=>value.includes('replace-with'))) throw new Error('Replace the example secrets before deploying.');
if (process.env.SESSION_SECRET.length < 32 || process.env.BACKEND_PROXY_SECRET.length < 32) throw new Error('Signing/proxy secrets must contain at least 32 characters.');
if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL) || !/^postgres(?:ql)?:\/\//.test(process.env.DIRECT_DATABASE_URL)) throw new Error('Postgres runtime and direct migration URLs must be configured.');
// deploy never resets data. Unapplied committed migrations are applied before serving.
const migrate = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {stdio:'inherit',env:process.env});
if (migrate.status !== 0) process.exit(migrate.status || 1);
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','backend/.app','--hostname','0.0.0.0','--port',process.env.PORT || '4000'],{stdio:'inherit',env:process.env});
const worker=spawn(process.execPath,['scripts/deadline-worker.mjs'],{stdio:'inherit',env:process.env});
let stopping=false;
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{stopping=true;child.kill(signal);worker.kill(signal);});
worker.on('exit',code=>{if(!stopping){console.error(JSON.stringify({event:'deadline_worker_stopped'}));child.kill('SIGTERM');process.exit(code||1);}});
child.on('exit',code=>{stopping=true;worker.kill('SIGTERM');process.exit(code||0);});
