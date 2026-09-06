// dev.mjs — `npm run dev`: the API (dist, on :4100) and the Vite dev server (:5174) side by side.
//
// Why it exists: LLD §8 S5 asks for one command that runs both with prefixed output and stops cleanly by
// PID — never a blanket `taskkill /IM node.exe`, which would also kill the agent and any other Node the
// operator is running. Each child is spawned as `node` directly (not through `npm run`), so there are no
// grandchildren to orphan, and Ctrl-C stops exactly the two PIDs this script started. The API is run from
// its built `dist` the way production does; if it has not been built yet, this says so and exits rather
// than spawning a process that will immediately fail.
//
// What it must never do: kill by process name, or keep running after either child exits.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apiEntry = join(root, 'apps', 'api', 'dist', 'main.js');
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

if (!existsSync(apiEntry)) {
  console.error('[dev] apps/api/dist/main.js is missing — run `npm run build` first, then `npm run dev`.');
  process.exit(1);
}

/** Spawn a `node` child, prefixing each of its output lines so the two servers are legible in one terminal. */
function child(label, args, cwd) {
  const proc = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (stream, sink) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) sink.write(`[${label}] ${line}\n`);
    });
    stream.on('end', () => {
      if (buffer) sink.write(`[${label}] ${buffer}\n`);
    });
  };
  prefix(proc.stdout, process.stdout);
  prefix(proc.stderr, process.stderr);
  return proc;
}

const api = child('api', ['--env-file-if-exists=.env', apiEntry], root);
const web = child('web', [viteBin], join(root, 'apps', 'web'));

let stopping = false;
/** Stop the other child by PID (never by name) and leave with the first child's code. */
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const proc of [api, web]) {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
  }
  process.exit(code);
}

api.on('exit', (code) => { console.error(`[dev] api exited (${code}); stopping web.`); stopAll(code ?? 1); });
web.on('exit', (code) => { console.error(`[dev] web exited (${code}); stopping api.`); stopAll(code ?? 1); });
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

console.log('[dev] api → http://127.0.0.1:4100  ·  web → http://127.0.0.1:5174  (Ctrl-C stops both)');
