// Fails fast if the Rust crates and the npm packages are on different major.minor releases.
// This is the same rule `tauri build` enforces, with a clearer message.
//
// Crate versions come from `cargo metadata` (what the build will actually resolve, so a missing or
// stale Cargo.lock cannot cause a false result). If `cargo` is not available the script falls back
// to parsing src-tauri/Cargo.lock and says so.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = `${root}src-tauri/Cargo.toml`;
const lockPath = `${root}src-tauri/Cargo.lock`;
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const npm = { ...pkg.dependencies, ...pkg.devDependencies };

const pairs = [
  ['tauri', '@tauri-apps/api'],
  ['tauri-plugin-dialog', '@tauri-apps/plugin-dialog'],
  ['tauri-plugin-http', '@tauri-apps/plugin-http'],
  ['tauri-plugin-opener', '@tauri-apps/plugin-opener'],
];
const minor = (v) => v.replace(/^[^\d]*/, '').split('.').slice(0, 2).join('.');

// --- crate versions -------------------------------------------------------------------------
function fromCargoMetadata() {
  const r = spawnSync('cargo', ['metadata', '--format-version', '1', '--manifest-path', manifest],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return { error: r.error.code === 'ENOENT' ? '`cargo` was not found' : String(r.error) };
  if (r.status !== 0) return { error: `\`cargo metadata\` failed: ${(r.stderr || '').trim().split('\n').pop()}` };
  const meta = JSON.parse(r.stdout);
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  // Prefer the version our own crate depends on directly; fall back to the highest one present.
  const rootNode = meta.resolve?.nodes?.find((n) => n.id === meta.resolve.root);
  const direct = new Map((rootNode?.deps ?? []).map((d) => [byId.get(d.pkg)?.name, byId.get(d.pkg)?.version]));
  const versions = (name) => meta.packages.filter((p) => p.name === name).map((p) => p.version);
  return { get: (name) => direct.get(name) ?? versions(name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] };
}
function fromLockfile() {
  if (!existsSync(lockPath)) return { error: 'src-tauri/Cargo.lock does not exist' };
  const lock = readFileSync(lockPath, 'utf8');
  return { get: (name) => new RegExp(`name = "${name}"\\r?\\nversion = "([^"]+)"`).exec(lock)?.[1] };
}

let source = 'cargo metadata';
let crates = fromCargoMetadata();
if (crates.error) {
  console.warn(`note: ${crates.error}; reading src-tauri/Cargo.lock instead.`);
  source = 'Cargo.lock';
  crates = fromLockfile();
  if (crates.error) { console.error(`error: ${crates.error}.`); process.exit(1); }
}
console.log(`Rust crate versions read from ${source}:`);

// --- compare --------------------------------------------------------------------------------
let bad = 0;
for (const [c, n] of pairs) {
  const cv = crates.get(c), nv = npm[n];
  if (!cv || !nv) { console.error(`? ${c} / ${n}: missing in ${!cv ? 'the Rust dependency tree' : 'package.json'}`); bad++; continue; }
  const ok = minor(cv) === minor(nv);
  console.log(`${ok ? 'ok      ' : 'MISMATCH'} ${c} ${cv}  <->  ${n} ${nv}`);
  if (!ok) bad++;
}

// --- warn (do not fail) about a second copy of @tauri-apps/api in the bundle ------------------
try {
  const lockfile = JSON.parse(readFileSync(`${root}package-lock.json`, 'utf8')).packages ?? {};
  const top = lockfile['node_modules/@tauri-apps/api']?.version;
  for (const [path, p] of Object.entries(lockfile)) {
    if (path !== 'node_modules/@tauri-apps/api' && path.endsWith('/node_modules/@tauri-apps/api') && top && minor(p.version) !== minor(top)) {
      console.warn(`warn     nested @tauri-apps/api ${p.version} at ${path} differs from top-level ${top}; ` +
        'that plugin talks to the Rust core through a different API minor than the one the build checks.');
    }
  }
} catch { /* no package-lock.json: nothing to inspect */ }

if (bad) {
  console.error('\nTauri crates and npm packages must share the same major.minor. Update both together:\n  cargo update -p <crate>   (in src-tauri)\n  npm install --save-exact <package>@<version>');
  process.exit(1);
}
