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

await step('home offers daily training and relaxed practice', async () => {
  await page.getByRole('button', { name: /Start daily training · 20 min/ }).waitFor();
  await page.getByRole('button', { name: /Relaxed practice only/ }).waitFor();
  if (shots) await page.screenshot({ path: shots + '/home.png' });
});

await step('typing an exercise with a corrected error, stopping and rating effort', async () => {
  await page.getByRole('button', { name: /Relaxed practice only/ }).click();
  await page.locator('.w').first().waitFor();
  const words = await page.$$eval('.w', (els) => els.slice(0, 60).map((e) => e.textContent));
  for (let i = 0; i < 40; i++) {
    if (i === 3) { await page.keyboard.type('x', { delay: 20 }); await page.keyboard.press('Backspace'); }
    await page.keyboard.type(words[i] + ' ', { delay: 15 });
  }
  if (shots) await page.screenshot({ path: shots + '/typing.png' });
  const caretOk = await page.$eval('#caret', (c) => c.getBoundingClientRect().height > 0);
  assert.ok(caretOk);
  // the caret sits at the next letter to type
  // probe inside a word of at least three letters, so the next letter is in the same word
  let probe = 40;
  while (words[probe].length < 3) { await page.keyboard.type(words[probe] + ' ', { delay: 15 }); probe++; }
  await page.keyboard.type(words[probe].slice(0, 2), { delay: 20 });
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
  await page.getByText('No effort', { exact: true }).waitFor();          // labelled end points of the scale
  await page.getByText('Maximum effort', { exact: true }).waitFor();
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
  await page.keyboard.press('Enter'); // "Practise again" from the summary
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
  await page.locator('#alltable tbody tr').first().waitFor();
  assert.equal(await page.locator('#alltable tbody tr').count(), 1);
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
  const thornium = 'z b w h g " : . / j x @\n( s c n t k , a e i m )\n[ f p l d v = u o y th ]\nqu r space \'\n' +
    '0 0 1 2 3 3 6 6 7 8 9 9\n0 0 1 2 3 3 6 6 7 8 9 9\n0 0 1 2 3 3 6 6 7 8 9 9\n4 4 5 5';
  await page.fill('#layoutText', thornium);
  await page.locator('#layoutText').dispatchEvent('change');
  await page.getByText(/Layout read: 40 keys, multi-letter: th qu/).waitFor();
  await page.getByText('From your layout: th qu').waitFor();
  // finish a short exercise with deliberate slips, then see their kinds on the Errors page
  await page.locator('[data-go="home"]').click();
  await page.getByRole('button', { name: /Relaxed practice only/ }).click();
  await page.locator('.w').first().waitFor();
  const ws = await page.$$eval('.w', (e) => e.slice(0, 14).map((x) => x.textContent));
  for (const w of ws) await page.keyboard.type((w.length > 2 && w[0] !== 'z' ? 'z' + w.slice(1) : w) + ' ', { delay: 5 });
  await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
  await page.getByText('How much effort did that take?').waitFor();
  await page.keyboard.press('2');
  await page.locator('[data-go="errors"]').click();
  await page.getByText('Kinds of slips').waitFor();
  await page.locator('[data-go="preferences"]').click();
  assert.deepEqual(await page.evaluate(() => window.FT.app.settings.macros), ['th', 'qu']);
});

// Type the next untyped words until the effort question appears.
async function typeUntilEffort(limitMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if (await page.getByText('How much effort did that take?').isVisible()) return;
    const w = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.w')].find((e) => !e.querySelector('.ok,.bad,.extra'));
      return el ? el.textContent : null;
    });
    if (w == null) { await page.waitForTimeout(100); continue; }
    await page.keyboard.type(w.replace(/[\u2018\u2019]/g, "'") + ' ', { delay: 8 });
  }
  throw new Error('exercise did not end');
}

await step('a text can be added for prose', async () => {
  await page.locator('[data-go="texts"]').click();
  await page.fill('#ttitle', 'Test text');
  const body = Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? 'Don\u2019t' : 'word' + i)).join(' ');
  await page.fill('#tbody', body);
  await page.getByRole('button', { name: 'Add text' }).click();
  await page.getByText('Test text').first().waitFor();
});

await step('the daily programme runs every exercise with effort ratings and ends with a summary', async () => {
  await page.evaluate(() => {
    const app = window.FT.app;
    app.burstRun = 2500; app.burstRest = 1200;
    app.settings.programme = { name: 'Daily training', steps: ['warmup', 'relaxed', 'bursts', 'prose', 'targeted'].map((type) => ({ type, minutes: 0.1, enabled: true })) };
  });
  await page.locator('[data-go="home"]').click();
  await page.getByRole('button', { name: /Start daily training/ }).click();
  for (let i = 0; i < 5; i++) {
    await page.locator('.w').first().waitFor();
    await typeUntilEffort();
    await page.keyboard.press('2');
    await page.locator('#progbar').waitFor();
    if (i === 2) assert.ok(await page.getByText(/^Rounds$/).isVisible(), 'burst rounds table');
    if (i === 3) assert.ok(await page.getByText(/Your place is saved/).isVisible(), 'prose position');
    if (shots && i === 2) await page.screenshot({ path: shots + '/bursts-summary.png', fullPage: true });
    await page.keyboard.press('Enter');
  }
  await page.getByText('Daily training finished').waitFor();
  assert.equal(await page.locator('tbody tr').count(), 5);
  if (shots) await page.screenshot({ path: shots + '/programme-summary.png', fullPage: true });
  const t = await page.evaluate(() => window.FT.app.store.listTexts().then((l) => l[0]));
  assert.ok(t.pos > 0, 'prose position advanced');
  await page.keyboard.press('Enter');
});

await step('an interrupted programme can be resumed after a reload', async () => {
  await page.keyboard.press('Enter'); // start a new programme
  await page.locator('.w').first().waitFor();
  await typeUntilEffort();
  await page.keyboard.press('2');
  await page.locator('#progbar').waitFor();
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => window.FT && window.FT.app && window.FT.app.trainer);
  await page.getByRole('button', { name: /Resume: relaxed practice \(2 of 5\)/ }).waitFor();
});


// ---- regressions found by the review ----
await step('the navigation marks the current page', async () => {
  await page.locator('[data-go="history"]').click();
  await page.locator('[data-go="history"][aria-current="page"]').waitFor({ timeout: 3000 });
});

await step('leaving the effort question saves the exercise and leaves no stray key handler', async () => {
  await page.locator('[data-go="home"]').click();
  const before = await page.evaluate(() => window.FT.app.trainer.history().length);
  await page.getByRole('button', { name: /Relaxed practice only/ }).click();
  await page.locator('.w').first().waitFor();
  const ws = await page.$$eval('.w', (e) => e.slice(0, 14).map((x) => x.textContent));
  await page.keyboard.type(ws.join(' ') + ' ', { delay: 5 });
  await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
  await page.getByText('How much effort did that take?').waitFor();
  await page.locator('[data-go="history"]').click();
  assert.equal(await page.evaluate(() => window.FT.app.trainer.history().length), before + 1);
  // a "1" typed later inside a new exercise is just typing
  await page.locator('[data-go="home"]').click();
  await page.getByRole('button', { name: /Relaxed practice only/ }).click();
  await page.locator('.w').first().waitFor();
  await page.keyboard.type('1');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.FT.app.trainer.history().length), before + 1);
  assert.ok(await page.locator('#window').isVisible());
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
});

await step('ending training with the mouse leaves no stale programme keys', async () => {
  await page.evaluate(() => { const a = window.FT.app; a.settings.programme = { name: 'x', steps: [{ type: 'warmup', minutes: 0.1, enabled: true }, { type: 'relaxed', minutes: 0.1, enabled: true }] }; });
  await page.locator('[data-go="home"]').click();
  await page.getByRole('button', { name: /Start (daily training|over)/ }).first().click();
  await typeUntilEffort();
  await page.keyboard.press('2');
  await page.getByRole('button', { name: /End training/ }).click();
  await page.getByText('Daily training finished').waitFor();
  await page.keyboard.press('r');   // must do nothing, and not throw
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Relaxed practice only/ }).waitFor();
});

await step('backspace is ignored during the rest between burst rounds', async () => {
  await page.evaluate(() => { const a = window.FT.app; a.burstRun = 1500; a.burstRest = 4000; window.FT.ui.startExercise('bursts', { minutes: 0.2 }); });
  await page.locator('.w').first().waitFor();
  const t0 = Date.now();
  while (!/Rest/.test(await page.locator('#timer').textContent()) && Date.now() - t0 < 10000) {
    const w = await page.evaluate(() => { const el = [...document.querySelectorAll('.w')].find((e) => !e.querySelector('.ok,.bad,.extra')); return el && el.textContent; });
    await page.keyboard.type(w + ' ', { delay: 5 });
  }
  const done = () => page.evaluate(() => document.querySelectorAll('.w .ok').length);
  const before = await done();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
  assert.equal(await done(), before);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.evaluate(() => { const a = window.FT.app; a.burstRun = 0; a.burstRest = 0; });
});

await step('the last words of a text can be finished, and the place moves to the end', async () => {
  const id = await page.evaluate(async () => {
    const t = { id: 'short', title: 'Short', words: 'one two three four five six seven eight nine ten eleven twelve'.split(' '), pos: 6, addedAt: Date.now() };
    await window.FT.app.store.saveText(t);
    window.FT.ui.startExercise('prose', { text: t });
    return t.id;
  });
  await page.locator('.w').first().waitFor();
  await page.keyboard.type('seven eight nine ten eleven twelve', { delay: 10 }); // no space after the last word
  await page.getByText('How much effort did that take?').waitFor({ timeout: 5000 });
  await page.keyboard.press('2');
  await page.getByText(/Your place is saved/).waitFor();
  await page.waitForFunction((i) => window.FT.app.store.getText(i).then((t) => t.pos === 12), id, { timeout: 3000 });
});

await step('keys typed just after an exercise times out do not jump to other pages', async () => {
  await page.locator('[data-go="home"]').click();
  await page.evaluate(() => { window.FT.app.benchMinutes = 0.05; });
  await page.getByRole('button', { name: /Benchmark/ }).click();
  await page.locator('.w').first().waitFor();
  const t0 = Date.now();
  while (await page.locator('#window').isVisible() && Date.now() - t0 < 15000) await page.keyboard.type('the ', { delay: 10 });
  await page.keyboard.type('qehsd', { delay: 20 });   // all of these are page shortcuts
  await page.getByText(/Trial 1 of 3 done/).waitFor({ timeout: 3000 });
  await page.locator('[data-go="home"]').click();
});

await step('a benchmark set runs three trials and shows the median', async () => {
  await page.locator('[data-go="home"]').click();
  await page.evaluate(() => { window.FT.app.benchMinutes = 0.08; });
  await page.getByRole('button', { name: /Benchmark/ }).click();
  for (let trial = 1; trial <= 3; trial++) {
    await page.locator('.w').first().waitFor();
    const t0 = Date.now();
    while (!(await page.getByText(trial < 3 ? /Trial \d of 3 done/ : 'Benchmark result').isVisible()) && Date.now() - t0 < 30000) {
      const w = await page.evaluate(() => { const el = [...document.querySelectorAll('.w')].find((e) => !e.querySelector('.ok,.bad,.extra')); return el && el.textContent; });
      if (w) await page.keyboard.type(w + ' ', { delay: 8 }); else await page.waitForTimeout(100);
    }
    if (trial < 3) await page.keyboard.press('Enter');
  }
  await page.getByText('Benchmark result').waitFor();
  await page.getByText('WPM (median of 3 trials)').waitFor();
  if (shots) await page.screenshot({ path: shots + '/benchmark.png', fullPage: true });
  const n = await page.evaluate(() => { const b = window.FT.app.trainer.history().filter((h) => h.type === 'benchmark'); const last = b[b.length - 1].set; return b.filter((h) => h.set === last).length; });
  assert.equal(n, 3);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Benchmark/ }).waitFor();
});

await step('History shows progress charts with tooltips and tables', async () => {
  await page.locator('[data-go="history"]').click();
  for (const title of ['Relaxed speed', 'Benchmark', 'Common-pair timing', 'Accuracy', 'Effort signals (experimental)']) {
    await page.locator('.progress-chart h3', { hasText: title }).waitFor();
  }
  const chart = page.locator('.progress-chart').first();
  await chart.locator('svg circle.pt').first().waitFor();
  const box = await chart.locator('svg').boundingBox();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await chart.locator('.tip:not([hidden])').waitFor();
  assert.ok((await chart.locator('details table tbody tr').count()) >= 1);
  if (shots) await page.screenshot({ path: shots + '/history.png', fullPage: true });
});

await step('with a layout, the Errors page and summaries show a keyboard heatmap', async () => {
  await page.locator('[data-go="errors"]').click();
  const hm = page.locator('.heatmap').first();
  await hm.locator('svg rect.key').first().waitFor();
  assert.ok(await hm.locator('svg rect.key').count() >= 30);
  await hm.locator('text=\u2423').first().waitFor();
  await hm.getByRole('button', { name: /Where wrong presses land/ }).click();
  await hm.locator('svg rect.key').first().waitFor();
  const box = await hm.locator('svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
  if (shots) await page.screenshot({ path: shots + '/heatmap.png', fullPage: true });
  // the summary of a finished exercise has one too
  await page.locator('[data-go="home"]').click();
  await page.getByRole('button', { name: /Relaxed practice only/ }).click();
  await page.locator('.w').first().waitFor();
  const ws = await page.$$eval('.w', (e) => e.slice(0, 14).map((x) => x.textContent));
  await page.keyboard.type(ws.join(' ') + ' ', { delay: 5 });
  await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
  await page.getByText('How much effort did that take?').waitFor();
  await page.keyboard.press('2');
  await page.locator('.heatmap svg rect.key').first().waitFor();
});

await step('with a layout, Sequences shows performance by movement type', async () => {
  await page.locator('[data-go="sequences"]').click();
  const t = page.locator('#movement');
  await t.locator('td', { hasText: 'alternation' }).first().waitFor();
  await t.locator('[data-key]').first().click();
  await page.locator('#why h2').waitFor();
});

await step('a wrong multi-letter press shows as one mark, and the rest of the word still matches', async () => {
  await page.locator('[data-go="home"]').click();
  await page.evaluate(() => window.FT.ui.startExercise('prose', { text: { id: 'presses', title: 'Presses', pos: 0, words: ['you', 'the', 'cat', 'and', 'more', 'words', 'here'] } }));
  await page.locator('.w').first().waitFor();
  const word = (i) => page.locator('.w').nth(i);
  await page.keyboard.insertText('th');                 // the th key, where y was meant
  await page.keyboard.type('ou ', { delay: 20 });
  assert.equal(await word(0).locator('.press-bad').count(), 1);
  assert.equal(await word(0).locator('.press-bad').textContent(), 'y');
  assert.equal(await word(0).locator('.l.ok').count(), 2);  // o and u match
  await page.keyboard.type('xe ', { delay: 20 });       // one key where the th key was meant
  assert.equal(await word(1).locator('.press-bad').count(), 1);
  assert.equal(await word(1).locator('.press-bad').textContent(), 'th');
  await page.keyboard.type('cbt ', { delay: 20 });      // an ordinary wrong letter keeps its own mark
  assert.equal(await word(2).locator('.press-bad').count(), 0);
  assert.equal(await word(2).locator('.l.bad').count(), 1);
  if (shots) await page.screenshot({ path: shots + '/press-marks.png' });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
});

await step('phone width has no horizontal scroll', async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const k of ['p', 't', 'q', 'h', 's', 'd']) {
    await page.keyboard.press(k);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'overflow on ' + k + ': ' + over);
  }
});

await step('no script errors', async () => { assert.deepEqual(errors, []); });
await browser.close();
