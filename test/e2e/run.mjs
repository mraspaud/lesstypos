// End-to-end checks in Chromium against file://…/index.html, one themed file
// at a time, each on a fresh page with its own stored state.
// Run: node test/e2e/run.mjs [theme…]   (uses the pre-installed Playwright;
// with theme names, only those files run; SHOTS=dir saves screenshots)
import assert from 'node:assert/strict';
import { launch, close, step, scriptErrors, results } from './harness.mjs';

const THEMES = ['typing', 'pausing', 'effort', 'daily', 'bursts', 'reading', 'insights', 'navigation', 'data'];
const chosen = process.argv.slice(2);
const unknown = chosen.filter((t) => !THEMES.includes(t));
if (unknown.length) { console.error('unknown theme: ' + unknown.join(', ') + ' (one of ' + THEMES.join(', ') + ')'); process.exit(2); }

await launch();
try {
  for (const theme of chosen.length ? chosen : THEMES) {
    console.log('# ' + theme);
    const { default: run } = await import('./' + theme + '.mjs');
    await run();
  }
  await step('no script errors', async () => { assert.deepEqual(scriptErrors(), []); });
} finally {
  await close();
}
const { passed, failed } = results();
console.log('# ' + passed + ' passed, ' + failed + ' failed');
