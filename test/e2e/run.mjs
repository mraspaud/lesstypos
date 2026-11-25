// End-to-end check in Chromium against file://…/index.html.
// Run: node test/e2e/run.mjs   (uses the pre-installed Playwright)
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const url = 'file://' + path.join(root, 'index.html');
const shots = process.env.SHOTS;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });

async function step(name, fn) {
  try { await fn(); console.log('ok -', name); }
  catch (e) { console.log('not ok -', name); console.log(e); process.exitCode = 1; }
}

await page.goto(url);
await page.waitForFunction(() => window.FT && window.FT.app && window.FT.app.trainer);

await step('home shows the practice start', async () => {
  await page.getByRole('button', { name: 'Start practice' }).waitFor();
  if (shots) await page.screenshot({ path: shots + '/home.png' });
});

await step('typing an exercise with a corrected error, stopping and rating effort', async () => {
  await page.keyboard.press('Enter');
  await page.locator('.w').first().waitFor();
  const words = await page.$$eval('.w', (els) => els.slice(0, 40).map((e) => e.textContent));
  for (let i = 0; i < words.length; i++) {
    if (i === 3) { await page.keyboard.type('x', { delay: 20 }); await page.keyboard.press('Backspace'); }
    await page.keyboard.type(words[i] + ' ', { delay: 15 });
  }
  if (shots) await page.screenshot({ path: shots + '/typing.png' });
  const caretOk = await page.$eval('#caret', (c) => c.getBoundingClientRect().height > 0);
  assert.ok(caretOk);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Finish and save/ }).waitFor();
  await page.keyboard.press('Enter');
  await page.getByText('How much effort did that take?').waitFor();
  await page.keyboard.press('2');
  await page.getByText(/finished/).waitFor();
  const tiles = await page.$$eval('.tile b', (b) => b.map((x) => x.textContent));
  assert.ok(+tiles[0] > 0, 'wpm ' + tiles[0]);
  assert.ok(/9\d\.\d%|100\.0%/.test(tiles[1]), 'accuracy ' + tiles[1]);
  if (shots) await page.screenshot({ path: shots + '/summary.png', fullPage: true });
});

await step('progress persists across a reload', async () => {
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => window.FT && window.FT.app && window.FT.app.trainer);
  await page.keyboard.press('h');
  await page.locator('tbody tr').first().waitFor();
  assert.equal(await page.locator('tbody tr').count(), 1);
});

await step('sequences page explains a sequence', async () => {
  await page.keyboard.press('q');
  await page.getByRole('button', { name: 'All with enough evidence' }).click();
  await page.locator('tr[data-key]').first().click();
  await page.locator('#why h2').waitFor();
  if (shots) await page.screenshot({ path: shots + '/sequences.png', fullPage: true });
});

await step('export, delete everything, import restores the history', async () => {
  const dump = await page.evaluate(() => window.FT.app.store.exportAll().then((d) => JSON.stringify(d)));
  await page.keyboard.press('d');
  const del = page.getByRole('button', { name: 'Delete everything' });
  await del.click();
  await page.getByRole('button', { name: 'Click again to confirm' }).click();
  await page.getByText('Done.').waitFor();
  assert.equal(await page.evaluate(() => window.FT.app.trainer.history().length), 0);
  await page.fill('#paste', dump);
  await page.getByRole('button', { name: 'Import pasted backup' }).click();
  await page.getByText(/Imported/).waitFor();
  assert.equal(await page.evaluate(() => window.FT.app.trainer.history().length), 1);
});

await step('settings accept a layout and multi-letter keys', async () => {
  await page.keyboard.press('s');
  await page.fill('#macros', 'th qu');
  await page.locator('#macros').dispatchEvent('change');
  await page.fill('#layoutText', 'q w e\na s d\n0 1 2\n0 1 2');
  await page.locator('#layoutText').dispatchEvent('change');
  await page.getByText(/Layout read: 6 keys/).waitFor();
  assert.deepEqual(await page.evaluate(() => window.FT.app.settings.macros), ['th', 'qu']);
});

await step('phone width has no horizontal scroll', async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const k of ['p', 'q', 'h', 's', 'd']) {
    await page.keyboard.press(k);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'overflow on ' + k + ': ' + over);
  }
});

await step('no script errors', async () => { assert.deepEqual(errors, []); });
await browser.close();
