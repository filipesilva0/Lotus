// Compiles lotusd into one self-contained executable where Tauri expects a sidecar:
//   src-tauri/binaries/lotusd-<rust target triple>[.exe]
// Usage: bun scripts/build.ts [target-triple]   (default: this machine's triple from `rustc -vV`)
// `universal-apple-darwin` builds both Mac targets and joins them with `lipo` (macOS only).

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BUN_TARGET: Record<string, string> = {
  // "baseline" builds run on x64 CPUs without AVX2 too.
  'x86_64-pc-windows-msvc': 'bun-windows-x64-baseline',
  'x86_64-unknown-linux-gnu': 'bun-linux-x64-baseline',
  'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
  'x86_64-apple-darwin': 'bun-darwin-x64',
  'aarch64-apple-darwin': 'bun-darwin-arm64',
};

const root = join(import.meta.dir, '..');
const outDir = join(root, '..', 'src-tauri', 'binaries');
mkdirSync(outDir, { recursive: true });

function hostTriple(): string {
  const r = Bun.spawnSync(['rustc', '-vV']);
  const m = /host: (\S+)/.exec(r.stdout.toString());
  if (!m) throw new Error('Could not read the Rust target triple (is rustc installed?). Pass one, e.g. x86_64-pc-windows-msvc.');
  return m[1];
}

function run(cmd: string[]) {
  console.log('$', cmd.join(' '));
  const r = Bun.spawnSync(cmd, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) throw new Error(`${cmd[0]} failed (${r.exitCode})`);
}

function compile(triple: string): string {
  const target = BUN_TARGET[triple];
  if (!target) throw new Error(`No Bun target for ${triple}. Known: ${Object.keys(BUN_TARGET).join(', ')}`);
  const out = join(outDir, `lotusd-${triple}${triple.includes('windows') ? '.exe' : ''}`);
  run(['bun', 'build', 'src/main.ts', '--compile', '--minify', '--sourcemap=none', `--target=${target}`, '--outfile', out]);
  return out;
}

const triple = process.argv[2] ?? hostTriple();
if (triple === 'universal-apple-darwin') {
  const parts = ['x86_64-apple-darwin', 'aarch64-apple-darwin'].map(compile);
  const out = join(outDir, 'lotusd-universal-apple-darwin');
  rmSync(out, { force: true });
  run(['lipo', '-create', '-output', out, ...parts]);
} else {
  compile(triple);
}
