// lotusd: Lotus's background core.
//
// Started by the Lotus app (src-tauri/src/core.rs) with:
//   lotusd --data <app data folder> --studio <Lotus Studio folder> [--watch-stdin]
//   env LOTUSD_TOKEN=<random session token>
// Prints one line when it is ready to serve:
//   LOTUSD_READY {"port":53121,"pid":4242,"version":"0.1.0"}
// With --watch-stdin it exits when its standard input closes, so it never outlives the app that
// started it (even if that app crashes).

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db';
import { startServer, VERSION } from './server';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

if (flag('version')) { console.log(VERSION); process.exit(0); }

const dataDir = arg('data');
const studio = arg('studio');
const token = process.env.LOTUSD_TOKEN ?? '';
if (!dataDir || !studio) { console.error('usage: lotusd --data <folder> --studio <folder> [--port N] [--watch-stdin]'); process.exit(2); }
if (token.length < 32) { console.error('lotusd: LOTUSD_TOKEN must be set (32+ characters).'); process.exit(2); }

const logDir = join(dataDir, 'logs');
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, 'lotusd.log');
const log = (msg: string) => {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { appendFileSync(logFile, line); } catch { /* read-only folder: stderr only */ }
  process.stderr.write(line);
};

let db: ReturnType<typeof openDb>;
try {
  db = openDb(dataDir);
} catch (e) {
  log(`could not open ${join(dataDir, 'lotus.db')}: ${(e as Error).message}`);
  console.log(`LOTUSD_FAILED ${JSON.stringify({ error: `Lotus could not open its database: ${(e as Error).message}` })}`);
  process.exit(1);
}

const origins = (process.env.LOTUSD_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const server = startServer({ db, studio, token, port: Number(arg('port') ?? 0), origins, log });

let stopping = false;
function stop(why: string) {
  if (stopping) return;
  stopping = true;
  log(`stopping (${why})`);
  try { server.builtins.shutdown(); } catch { /* nothing running */ }
  try { server.stop(true); } catch { /* already stopped */ }
  try { db.sql.close(); } catch { /* already closed */ }
  process.exit(0);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

if (flag('watch-stdin')) {
  // The app keeps our stdin open for as long as it runs; EOF means it is gone.
  void (async () => {
    try { for await (const _ of Bun.stdin.stream()) { /* ignore input */ } } catch { /* closed */ }
    stop('the Lotus app closed');
  })();
}

log(`lotusd ${VERSION} on 127.0.0.1:${server.port} · ${db.path} · fts5=${db.fts}`);
console.log(`LOTUSD_READY ${JSON.stringify({ port: server.port, pid: process.pid, version: VERSION })}`);
