// Session 12 tests: the first-run guide is not skipped because of an empty chat saved by an earlier
// launch. Run: bash handover/verification/run-s12-tests.sh
// (The macOS traffic-light maths is a Rust unit test in src-tauri/src/mac_chrome.rs.)
import './s5-setup';
import { hasRealChats, loadSetup, saveSetup } from '../../src/setup/state';

let pass = 0, fail = 0;
const results: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; results.push(`  ✓ ${name}`); }
  catch (e) { fail++; results.push(`  ✗ ${name}\n      ${(e as Error).stack?.split('\n').slice(0, 3).join('\n      ')}`); }
}
function eq(a: unknown, b: unknown, msg = '') { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg} expected ${B}, got ${A}`); }

async function main() {
  await test('empty or broken saved chats do not count as earlier use', () => {
    eq(hasRealChats(null), false);
    eq(hasRealChats('[]'), false);
    eq(hasRealChats(JSON.stringify([{ id: 'a', title: '', messages: [] }])), false);
    eq(hasRealChats('{not json'), false);
    eq(hasRealChats(JSON.stringify([null, { id: 'b' }])), false);
    eq(hasRealChats(JSON.stringify([{ id: 'a', messages: [] }, { id: 'b', messages: [{ role: 'user', content: 'x' }] }])), true);
  });
  await test('guide shows on a launch after one that only saved an empty New chat', () => {
    localStorage.clear();
    localStorage.setItem('lotus.sessions.v1', JSON.stringify([{ id: 'a', title: '', messages: [] }]));
    localStorage.setItem('lotus.island.v1', JSON.stringify({ enabled: true }));
    eq(loadSetup().done, false);
  });
  await test('finished, skipped and old dismiss flag still keep the guide closed', () => {
    localStorage.clear();
    saveSetup({ done: true, outcome: 'finished' });
    eq(loadSetup().done, true);
    localStorage.clear();
    localStorage.setItem('lotus.setup.dismissed', '1');
    eq(loadSetup().done, true);
  });

  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
void main();
