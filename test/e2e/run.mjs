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
  const words = await page.$$eval('.w', (els) => els.slice(0, 41).map((e) => e.textContent));
  for (let i = 0; i < 40; i++) {
    if (i === 3) { await page.keyboard.type('x', { delay: 20 }); await page.keyboard.press('Backspace'); }
    await page.keyboard.type(words[i] + ' ', { delay: 15 });
  }
  if (shots) await page.screenshot({ path: shots + '/typing.png' });
  const caretOk = await page.$eval('#caret', (c) => c.getBoundingClientRect().height > 0);
  assert.ok(caretOk);
  // the caret sits at the next letter to type
  await page.keyboard.type(words[40].slice(0, 2), { delay: 20 });
  await page.waitForTimeout(250);
  const gap = await page.evaluate(() => {
    const c = document.getElementById('caret').getBoundingClientRect();
    const next = document.querySelector('.w .l:not(.ok):not(.bad):not(.extra)').getBoundingClientRect();
    return { dx: Math.abs(c.left - next.left), dy: Math.abs((c.top + c.bottom) / 2 - (next.top + next.bottom) / 2) };
  });
  assert.ok(gap.dx < 3 && gap.dy < 6, 'caret off by ' + JSON.stringify(gap));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Finish and save/ }).waitFor();
  await page.keyboard.press('Enter');
  await page.getByText('How much effort did that take?').waitFor();
  await page.keyboard.press('2');
  await page.getByText(/finished/).waitFor();
  const tiles = await page.$$eval('.tile b', (b) => b.map((x) => x.textContent));
  assert.ok(+tiles[0] > 0, 'wpm ' + tiles[0]);
  assert.ok(/9\d\.\d%|100\.0%/.test(tiles[1]), 'accuracy ' + tiles[1]);
  // the speed chart is drawn and responds to hover
  await page.locator('#chart svg path.run').waitFor();
  const box = await page.locator('#chart svg').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('#tip:not([hidden])').waitFor();
  if (shots) await page.screenshot({ path: shots + '/summary.png', fullPage: true });
});

await step('the current line stays in the middle while typing many lines', async () => {
  await page.keyboard.press('Enter');
  await page.locator('.w').first().waitFor();
  const words = await page.$$eval('.w', (els) => els.slice(0, 110).map((e) => e.textContent));
  const lines = [];
  for (let i = 0; i < 110; i++) {
    await page.keyboard.type(words[i] + ' ', { delay: 2 });
    lines.push(await page.evaluate(() => {
      const c = document.getElementById('caret').getBoundingClientRect(), w = document.getElementById('window').getBoundingClientRect();
      return Math.floor((c.top + c.height / 2 - w.top) / (w.height / 3));
    }));
  }
  const first = lines.indexOf(1);
  assert.ok(first > 0 && lines.slice(first).every((l) => l === 1), lines.join(''));
});

await step('backspace corrects the previous word when it has an error', async () => {
  const w = await page.$$eval('.w', (els) => els.filter((e) => !e.querySelector('.ok,.bad')).slice(0, 2).map((e) => e.textContent));
  const wrong = (w[0][0] === 'z' ? 'y' : 'z') + w[0].slice(1);
  await page.keyboard.type(wrong + ' ', { delay: 10 });
  for (let i = 0; i < w[0].length + 1; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type(w[0] + ' ', { delay: 10 });
  const ok = await page.evaluate((target) => {
    const done = [...document.querySelectorAll('.w')].filter((e) => e.textContent === target && e.querySelector('.ok'));
    return done.length > 0 && !done[done.length - 1].querySelector('.bad');
  }, w[0]);
  assert.ok(ok);
});

await step('backspace reaches a mistake behind a correctly typed word', async () => {
  const w = await page.$$eval('.w', (els) => els.filter((e) => !e.querySelector('.ok,.bad')).slice(0, 2).map((e) => e.textContent));
  const bad = (x) => (x[0] === 'z' ? 'y' : 'z') + x.slice(1);
  await page.keyboard.type(bad(w[0]) + ' ' + w[1] + ' ', { delay: 10 });
  for (let i = 0; i < w[0].length + w[1].length + 2; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type(w[0] + ' ' + w[1] + ' ', { delay: 10 });
  const bads = await page.evaluate((t) => [...document.querySelectorAll('.w')].filter((e) => t.includes(e.textContent) && e.querySelector('.ok')).slice(-2).map((e) => e.querySelectorAll('.bad').length), [w[0], w[1]]);
  assert.deepEqual(bads, [0, 0]);
});

await step('backspace reaches back through two wrong words', async () => {
  const w = await page.$$eval('.w', (els) => els.filter((e) => !e.querySelector('.ok,.bad')).slice(0, 3).map((e) => e.textContent));
  const bad = (x) => (x[0] === 'z' ? 'y' : 'z') + x.slice(1);
  await page.keyboard.type(bad(w[0]) + ' ' + bad(w[1]) + ' ', { delay: 10 });
  for (let i = 0; i < w[0].length + w[1].length + 2; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type(w[0] + ' ' + w[1] + ' ', { delay: 10 });
  const bads = await page.evaluate((t) => [...document.querySelectorAll('.w')].filter((e) => t.includes(e.textContent) && e.querySelector('.ok')).slice(-2).map((e) => e.querySelectorAll('.bad').length), [w[0], w[1]]);
  assert.deepEqual(bads, [0, 0]);
});

await step('backspace with no recent mistake explains why nothing happens', async () => {
  const w = await page.$$eval('.w', (els) => els.filter((e) => !e.querySelector('.ok,.bad')).slice(0, 6).map((e) => e.textContent));
  await page.keyboard.type(w.join(' ') + ' ', { delay: 10 });
  await page.keyboard.press('Backspace');
  await page.getByText(/Nothing to fix nearby/).waitFor({ timeout: 2000 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
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
