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

const nav = (route) => page.evaluate((r) => window.FT.ui.go(r), route);
// Runs fn with a daily-training definition, restoring the default afterwards
// even when fn fails, so one step cannot leak into the next.
async function withProgramme(steps, fn) {
  const reset = (st) => { const a = window.FT.app; a.settings.programme = st && { name: 'test', steps: st }; a.settings.programmeRun = null; a.run = null; a.settings.trainedOn = null; };
  await page.evaluate(reset, steps);
  try { await fn(); } finally { await page.evaluate(reset, null); }
}
async function step(name, fn) {
  try { await fn(); console.log('ok -', name); }
  catch (e) { console.log('not ok -', name); console.log(e); process.exitCode = 1; }
}

// The steps type straight away; the instruction card has its own steps.
// Finishing a daily training makes reading home's first choice for the day;
// steps about the training start from a day without one.
const notTrainedToday = () => page.evaluate(() => { window.FT.app.settings.trainedOn = null; });
const showCards = (on) => page.evaluate(async (v) => { window.FT.app.settings.showInstructions = v; await window.FT.ui.saveSettings(); }, on);
await page.goto(url);
await page.waitForFunction(() => window.FT && window.FT.app && window.FT.app.trainer);
await showCards(false);

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
  // the decision comes first; the speed chart is under Details (d), drawn on opening
  assert.equal(await page.locator('#details').getAttribute('open'), null);
  await page.keyboard.press('d');
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
  await page.keyboard.press('Delete');
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
  await page.locator('#allseq > summary').click();
  await page.getByRole('button', { name: 'All with enough evidence' }).click();
  await page.locator('tr[data-key]').first().click();
  await page.locator('#why h2').waitFor();
  if (shots) await page.screenshot({ path: shots + '/sequences.png', fullPage: true });
});

await step('export, delete everything, import restores the history', async () => {
  const dump = await page.evaluate(() => window.FT.app.store.exportAll().then((d) => JSON.stringify(d)));
  assert.ok(JSON.parse(dump).sessions.every((x) => x.enc === 1)); // backups carry compact sessions
  const stored = await page.evaluate(async () => {
    const a = window.FT.store.idbAdapter('lesstypos');
    const k = (await a.keys()).filter((x) => String(x).startsWith('session:'));
    return Promise.all(k.map((x) => a.get(x).then((r) => r.enc)));
  });
  assert.ok(stored.length && stored.every((e) => e === 1)); // stored compact in IndexedDB
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
  await page.getByRole('button', { name: 'Keyboard' }).click();
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
  await page.keyboard.press('e');
  await page.getByText('Kinds of slips').waitFor();
  await page.keyboard.press('s');
  assert.deepEqual(await page.evaluate(() => window.FT.app.settings.macros), ['th', 'qu']);
});

// Type the next untyped words until the effort question appears.
// After the timer or the text ends an exercise, keys are ignored for a moment.
const effortReady = () => page.waitForFunction(() => Date.now() >= (window.FT.app.effortGuardUntil || 0));
async function typeUntilEffort(limitMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if (await page.getByText('How much effort did that take?').isVisible()) { await effortReady(); return; }
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
  await page.keyboard.press('t');
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
  await notTrainedToday();
  assert.equal(await page.locator('tbody tr').count(), 5);
  if (shots) await page.screenshot({ path: shots + '/programme-summary.png', fullPage: true });
  const t = await page.evaluate(() => window.FT.app.store.listTexts().then((l) => l[0]));
  assert.ok(t.pos > 0, 'prose position advanced');
  await page.keyboard.press('Enter');
  await notTrainedToday();
});

await step('an interrupted programme can be resumed after a reload', async () => {
  await page.getByRole('button', { name: /Start daily training/ }).waitFor();
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
  await page.keyboard.press('h');
  await page.locator('[data-go="insights"][aria-current="page"]').waitFor({ timeout: 3000 });
  await page.locator('[data-stab="insights/progress"][aria-current="page"]').waitFor({ timeout: 3000 });
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
  await nav('insights/progress');
  assert.equal(await page.evaluate(() => window.FT.app.trainer.history().length), before + 1);
  // a "1" typed later inside a new exercise is just typing
  await page.locator('[data-go="home"]').click();
  await page.getByRole('button', { name: /Relaxed practice only/ }).click();
  await page.locator('.w').first().waitFor();
  await page.keyboard.type('1');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.FT.app.trainer.history().length), before + 1);
  assert.ok(await page.locator('#window').isVisible());
  await page.keyboard.press('Escape'); await page.keyboard.press('Delete');
});

await step('ending training with the mouse leaves no stale programme keys', async () => {
  await page.evaluate(() => { const a = window.FT.app; a.settings.programme = { name: 'x', steps: [{ type: 'warmup', minutes: 0.1, enabled: true }, { type: 'relaxed', minutes: 0.1, enabled: true }] }; });
  await page.locator('[data-go="home"]').click();
  await page.getByRole('button', { name: /Start (daily training|over)/ }).first().click();
  await typeUntilEffort();
  await page.keyboard.press('2');
  await page.getByRole('button', { name: /End training/ }).click();
  await page.getByRole('button', { name: /Press again to end/ }).click();
  await page.getByText('Daily training finished').waitFor();
  await notTrainedToday();
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
  await page.keyboard.press('Escape'); await page.keyboard.press('Delete');
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
  await effortReady();
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
  await nav('insights/progress');
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
  await nav('insights/errors');
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
  await page.getByText(/finished/).waitFor();
  await page.keyboard.press('d');
  await page.locator('.heatmap svg rect.key').first().waitFor();
});

await step('with a layout, Sequences shows performance by movement type', async () => {
  await nav('insights/focus');
  await page.locator('#moves > summary').click();            // folded away by default
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
  await page.keyboard.press('Escape'); await page.keyboard.press('Delete');
});


// ---------- keyboard and data safety ----------
const typeWords = async (n) => {
  const ws = await page.$$eval('.w', (e) => e.slice(0, 60).map((x) => x.textContent));
  await page.keyboard.type(ws.slice(0, n).join(' ') + ' ', { delay: 5 });
};
const typedCount = () => page.evaluate(() => document.querySelectorAll('.w .l.ok, .w .l.bad').length);

await step('Esc pauses typing; Esc resumes with the letters kept; Delete discards', async () => {
  await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
  await page.locator('.w').first().waitFor();
  await typeWords(3);
  const before = await typedCount();
  const saved = await page.evaluate(() => window.FT.app.trainer.history().length);
  await page.keyboard.press('Escape');
  await page.locator('#stopbar').getByText('Paused.').waitFor();
  await page.keyboard.press('Escape');                       // resume
  assert.ok(await page.locator('#stopbar').isHidden());
  assert.equal(await typedCount(), before);
  await typeWords(1);
  assert.ok(await typedCount() > before);
  await page.keyboard.press('Escape'); await page.keyboard.press('Delete');  // discard
  await page.locator('[data-go="home"][aria-current="page"]').waitFor();
  assert.equal(await page.locator('#window').count(), 0);
  assert.equal(await page.evaluate(() => window.FT.app.trainer.history().length), saved);
});

await step('Tab asks before restarting once typing has begun', async () => {
  await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
  await page.locator('.w').first().waitFor();
  await typeWords(2);
  const before = await typedCount();
  await page.keyboard.press('Tab');
  await page.getByText(/Press Tab again to restart/).waitFor();
  assert.equal(await typedCount(), before);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  assert.equal(await typedCount(), 0);
  await page.keyboard.press('Escape');
});

await step('a digit pressed as the timer ends is not saved as the effort rating', async () => {
  await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 0.05 }));
  await page.locator('.w').first().waitFor();
  const ws = await page.$$eval('.w', (e) => e.slice(0, 60).map((x) => x.textContent));
  const effort = page.getByText('How much effort did that take?');
  for (const w of ws) {                                      // keep typing until the timer ends
    if (await effort.isVisible()) break;
    await page.keyboard.type(w + ' ', { delay: 20 });
  }
  await effort.waitFor({ timeout: 10000 });
  await page.keyboard.press('5');                            // still in flight: ignored
  await page.waitForTimeout(100);
  assert.ok(await page.getByText('How much effort did that take?').isVisible());
  await page.getByText(/Press 1–5/).waitFor();
  await page.waitForTimeout(1100);
  await page.keyboard.press('2');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.FT.app.trainer.history().slice(-1)[0].effort), 2);
});

await step('between exercises Esc keeps the daily training; ending it asks first', async () => {
  await page.keyboard.press('p');
  await page.getByRole('button', { name: /Start (daily training|over)/ }).first().click();
  await page.locator('.w').first().waitFor();
  await typeWords(14);
  await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
  await page.getByText('How much effort did that take?').waitFor();
  await page.keyboard.press('2');
  await page.locator('#progbar').waitFor();
  await page.keyboard.press('Escape');                       // back home, training kept
  await page.getByRole('button', { name: /Resume/ }).waitFor();
  await page.getByRole('button', { name: /Resume/ }).click();
  await page.locator('.w').first().waitFor();
  await typeWords(14);
  await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
  await page.getByText('How much effort did that take?').waitFor();
  await page.keyboard.press('3');
  await page.locator('#progbar').waitFor();
  await page.keyboard.press('x');
  await page.getByText(/Press x again to end/).waitFor();
  assert.ok(await page.locator('#progbar').isVisible());
  await page.keyboard.press('x');
  await page.getByText('Daily training finished').waitFor();
  await notTrainedToday();
  await page.keyboard.press('Enter');
});

await step('rows of Sequences and Errors open with the keyboard, with j/k and with the arrows', async () => {
  for (const move of [['j', 'k'], ['ArrowDown', 'ArrowUp']]) {
    await page.keyboard.press('q');
    if (!(await page.locator('#allseq[open]').count())) await page.locator('#allseq > summary').click();
    await page.getByRole('button', { name: 'All with enough evidence' }).click();
    await page.locator('h1').focus();
    // from the opened row if there is one, else from the top
    const visible = () => [...document.querySelectorAll('[data-row]')].filter((b) => !b.closest('details:not([open])'));
    const start = await page.evaluate((v) => { const rows = eval(v)(); const sel = document.querySelector('.selected [data-row]'); return sel ? rows.indexOf(sel) : -1; }, visible.toString());
    await page.keyboard.press(move[0]);
    await page.keyboard.press(move[0]);
    await page.keyboard.press(move[1]);
    const at = await page.evaluate((v) => eval(v)().indexOf(document.activeElement), visible.toString());
    assert.equal(at, start < 0 ? 0 : start + 1);
    await page.keyboard.press('Enter');
    await page.locator('#why h2').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
  }
  await page.keyboard.press('p');                            // practise it
  await page.locator('.w').first().waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  await page.keyboard.press('j');
  if (await page.locator('tr[data-i]').count()) {
    await page.keyboard.press('Enter');
    await page.locator('#subex h2').waitFor();
  }
});

await step('after navigation, focus is on the page heading; a skip link and a status region exist', async () => {
  await page.keyboard.press('h');
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H1');
  assert.equal(await page.locator('a.skip[href="#view"]').count(), 1);
  assert.equal(await page.locator('[role="status"]').count(), 1);
});

await step('? lists the shortcuts of the current screen', async () => {
  await page.keyboard.press('p');
  await page.keyboard.press('?');
  const help = page.locator('#keyhelp');
  await help.waitFor();
  assert.match(await help.textContent(), /Enter/);
  assert.match(await help.textContent(), /Start daily training|Resume/);
  await page.keyboard.press('Escape');
  assert.equal(await help.count(), 0);
});

await step('importing a backup with statistics from an older model rebuilds them at once', async () => {
  const dump = JSON.parse(await page.evaluate(() => window.FT.app.store.exportAll().then((d) => JSON.stringify(d))));
  dump.profile.modelVersion = 1; dump.profile.history.forEach((h) => { delete h.keys; });
  await page.evaluate(async (d) => { await window.FT.app.store.importAll(d, { mode: 'replace' }); await window.FT.ui.reloadFromStore(false); }, dump);
  const v = await page.evaluate(() => [window.FT.app.trainer.profile().modelVersion, window.FT.MODEL_VERSION, window.FT.app.trainer.history().some((h) => h.keys)]);
  assert.equal(v[0], v[1]);
  assert.equal(v[2], true);
});


await step('three sections by number keys; tabs by [ ] and arrows; old addresses still work', async () => {
  await page.keyboard.press('1');
  await page.locator('[data-go="home"][aria-current="page"]').waitFor();
  await page.keyboard.press('2');
  await page.locator('[data-stab="insights/focus"][aria-current="page"]').waitFor();
  await page.keyboard.press(']');
  await page.locator('[data-stab="insights/errors"][aria-current="page"]').waitFor();
  await page.locator('[data-stab="insights/errors"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('[data-stab="insights/progress"][aria-current="page"]').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.stab), 'insights/progress');
  await page.keyboard.press('3');
  await page.locator('[data-stab="settings/typing"][aria-current="page"]').waitFor();
  assert.equal(await page.locator('#nav button').count(), 3);
  await page.evaluate(() => { location.hash = 'history'; });
  await page.waitForFunction(() => location.hash === '#insights/progress');
  await page.locator('[data-stab="insights/progress"][aria-current="page"]').waitFor();
  await page.evaluate(() => { location.hash = 'texts'; });
  await page.locator('[data-stab="settings/texts"][aria-current="page"]').waitFor();
});


await step('home: one primary action, a few alternatives by key, three numbers', async () => {
  await page.keyboard.press('1');
  assert.equal(await page.locator('.status > div').count(), 3);
  await page.getByRole('button', { name: /Enter/ }).first().waitFor();       // the key hint is on the button
  await page.keyboard.press('r');
  await page.locator('.w').first().waitFor();
  assert.match(await page.locator('.ex-head .name').textContent(), /Relaxed practice/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('b');
  await page.locator('.w').first().waitFor();
  assert.match(await page.locator('.ex-head .name').textContent(), /Benchmark/);
  await page.keyboard.press('Escape');
});


await step('in a text box, Esc leaves it and Ctrl+Enter submits it', async () => {
  await page.keyboard.press('t');
  await page.locator('#ttitle').fill('Ctrl Enter text');
  await page.locator('#tbody').fill('Some words for the prose exercise to read and type, long enough to pass the minimum of twenty words that a text needs before it is kept.');
  await page.locator('#tbody').press('Control+Enter');
  await page.getByText('Ctrl Enter text').first().waitFor();
  await page.locator('#tbody').focus();
  await page.keyboard.press('Escape');
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'tbody');
  await page.keyboard.press('1');                            // shortcuts work again
  await page.locator('[data-go="home"][aria-current="page"]').waitFor();
});



// ---- review of the UI iteration ----
await step('typing while paused never discards; Delete does', async () => {
  await page.keyboard.press('1');
  await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
  await page.locator('.w').first().waitFor();
  await typeWords(3);
  await page.keyboard.press('Escape');
  await page.keyboard.type('and done', { delay: 20 });       // habit: keeps typing while paused
  assert.ok(await page.locator('#window').isVisible());
  await page.locator('#stopbar').getByText('Paused.').waitFor();
  await page.keyboard.press('Delete');
  await page.locator('[data-go="home"][aria-current="page"]').waitFor();
});

await step('the skip link moves focus to the content and stays on the page', async () => {
  await page.keyboard.press('q');
  await page.locator('a.skip').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => location.hash), '#insights/focus');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'view');
});

await step('Enter on a focused effort button records that rating; Esc skips', async () => {
  for (const [keys, want] of [[['Tab', 'Tab', 'Tab', 'Tab', 'Enter'], 4], [['Escape'], null]]) {
    await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
    await page.locator('.w').first().waitFor();
    await typeWords(14);
    await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
    await page.getByText('How much effort did that take?').waitFor();
    if (want) { await page.locator('[data-effort="4"]').focus(); await page.keyboard.press('Enter'); }
    else for (const k of keys) await page.keyboard.press(k);
    await page.getByText(/finished/).waitFor();
    assert.equal(await page.evaluate(() => window.FT.app.trainer.history().slice(-1)[0].effort), want);
  }
});

await step('focus stays put after a filter pill or moving a daily-training step', async () => {
  await page.keyboard.press('q');
  if (!(await page.locator('#allseq[open]').count())) await page.locator('#allseq > summary').click();
  await page.locator('[data-tab="kept"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'kept');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'all');
  await page.evaluate(() => window.FT.ui.go('settings/training'));
  await page.locator('[data-down="0"]').focus();
  await page.keyboard.press('Enter');
  assert.match(await page.evaluate(() => document.activeElement.id || ''), /^(down|up)-1$/);
});

await step('list keys skip folded rows and continue from the opened row', async () => {
  await page.keyboard.press('q');
  if (await page.locator('#allseq[open]').count()) await page.locator('#allseq > summary').click();
  await page.waitForFunction(() => !document.querySelector('#allseq[open]'));
  const visible = await page.evaluate(() => [...document.querySelectorAll('[data-row]')].filter((b) => !b.closest('details:not([open])')).length);
  if (visible >= 3) {
    await page.locator('h1').focus();
    for (let i = 0; i < visible + 3; i++) await page.keyboard.press('j');
    const last = await page.evaluate(() => { const v = [...document.querySelectorAll('[data-row]')].filter((b) => !b.closest('details:not([open])')); return v.indexOf(document.activeElement); });
    assert.equal(last, visible - 1);
    await page.evaluate(() => [...document.querySelectorAll('[data-row]')].filter((b) => !b.closest('details:not([open])'))[1].click());
    await page.locator('#why h2').waitFor();
    await page.keyboard.press('j');
    const at = await page.evaluate(() => { const v = [...document.querySelectorAll('[data-row]')].filter((b) => !b.closest('details:not([open])')); return v.indexOf(document.activeElement); });
    assert.equal(at, 2);
  }
});

await step('? lists what the keys do on this screen, not shortcuts it overrides', async () => {
  await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
  await page.locator('.w').first().waitFor();
  await typeWords(14);
  await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
  await page.getByText('How much effort did that take?').waitFor();
  await page.keyboard.press('2');
  await page.getByText(/finished/).waitFor();
  await page.keyboard.press('?');
  const txt = await page.locator('#keyhelp').innerText();
  assert.match(txt, /d\s+Details/);
  assert.doesNotMatch(txt, /d\s+Settings: Data/);
  await page.keyboard.press('Escape');
});

await step('pausing in a burst round closes that round at the pause', async () => {
  await page.evaluate(() => { const a = window.FT.app; a.burstRun = 4000; a.burstRest = 3000; window.FT.ui.startExercise('bursts', { minutes: 0.3 }); });
  await page.locator('.w').first().waitFor();
  await typeWords(3);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');                        // resume: the rest after round 1
  await page.getByText(/Round 1: /).waitFor({ timeout: 3000 });
  await page.keyboard.press('Escape'); await page.keyboard.press('Delete');
  await page.evaluate(() => { const a = window.FT.app; a.burstRun = 0; a.burstRest = 0; });
});

await step('wording: one name for accuracy, places named as they appear', async () => {
  const src = await page.evaluate(() => [window.FT.difficulty, window.FT.chart].map((m) => Object.values(m).map(String).join('')).join(''));
  assert.doesNotMatch(src, /first-attempt (accuracy|error rate per key)|× first-attempt error/);
});


await step('a pasted backup with markup in its settings or an unknown step cannot break or script the app', async () => {
  const dump = JSON.parse(await page.evaluate(() => window.FT.app.store.exportAll().then((d) => JSON.stringify(d))));
  dump.settings.durationMin = '<img id="pwned" src="x" onerror="window.pwned=1">';
  dump.settings.programme = { name: 'x', steps: [{ type: 'relaxed', minutes: '<b id="bold">', enabled: true }, { type: 'nope', minutes: 3, enabled: true }] };
  await page.evaluate(async (d) => { await window.FT.app.store.importAll(d, { mode: 'replace' }); await window.FT.ui.reloadFromStore(false); }, dump);
  await page.keyboard.press('1');
  await page.getByRole('button', { name: /Relaxed practice only · 5 min/ }).waitFor();
  assert.equal(await page.locator('#pwned, #bold').count(), 0);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.match(await page.locator('.lead').textContent(), /relaxed practice 5 min\./);
});


await step('leaving mid-exercise pauses it instead of discarding', async () => {
  await page.keyboard.press('1');
  const before = await page.evaluate(() => window.FT.app.trainer.history().length);
  await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
  await page.locator('.w').first().waitFor();
  await typeWords(4);
  const address = await page.evaluate(() => location.hash);
  await page.locator('[data-go="insights"]').click();          // the nav
  await page.locator('#stopbar').getByText('Paused.').waitFor();
  assert.equal(await page.evaluate(() => location.hash), address); // the address does not move either
  assert.ok(await page.locator('#window').isVisible());
  await page.locator('a.brand').click();                       // the brand link
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50))); // let the address change be handled
  assert.ok(await page.locator('#window').isVisible());
  assert.equal(await page.evaluate(() => location.hash), address);
  await page.keyboard.press('Escape');                         // resume and keep typing
  await typeWords(1);
  await page.keyboard.press('Escape'); await page.keyboard.press('Delete');
  await page.locator('[data-go="home"][aria-current="page"]').waitFor();
  assert.equal(await page.evaluate(() => window.FT.app.trainer.history().length), before);
});

await step('a finished exercise waiting for its rating survives a reload', async () => {
  const before = await page.evaluate(() => window.FT.app.trainer.history().length);
  await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
  await page.locator('.w').first().waitFor();
  await typeWords(14);
  await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
  await page.getByText('How much effort did that take?').waitFor();
  await page.waitForFunction(() => window.FT.app.store.getDraft().then((d) => !!d));
  await page.reload();
  await page.waitForFunction(() => window.FT && window.FT.app && window.FT.app.trainer);
  await page.getByText('How much effort did that take?').waitFor();
  await effortReady();
  await page.keyboard.press('3');
  await page.getByText(/finished/).waitFor();
  const h = await page.evaluate(() => window.FT.app.trainer.history());
  assert.equal(h.length, before + 1);
  assert.equal(h[h.length - 1].effort, 3);
  await page.reload();
  await page.waitForFunction(() => window.FT && window.FT.app && window.FT.app.trainer);
  assert.equal(await page.getByText('How much effort did that take?').count(), 0);
});


// ---- review: UI bugs ----
await step('the address follows the screen, so reload and links land where you are', async () => {
  await page.keyboard.press('q');
  await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
  await page.locator('.w').first().waitFor();
  await page.keyboard.press('Escape');                          // nothing typed: leaves to Train
  await page.locator('[data-go="home"][aria-current="page"]').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#home');
});

await step('x, then d, then x ends the daily training', async () => {
  await withProgramme([{ type: 'relaxed', minutes: 0.1, enabled: true }, { type: 'warmup', minutes: 0.1, enabled: true }], async () => {
    await page.keyboard.press('1');
    await page.getByRole('button', { name: /Start (daily training|over)/ }).first().click();
    await typeUntilEffort();
    await page.keyboard.press('2');
    await page.locator('#progbar').waitFor();
    await page.keyboard.press('x');
    await page.keyboard.press('d');
    await page.keyboard.press('x');
    await page.getByText('Daily training finished').waitFor();
  await notTrainedToday();
    await page.keyboard.press('Enter');
  });
  await notTrainedToday();
});

await step('the current section tab looks selected', async () => {
  await page.keyboard.press('q');
  const bg = (sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor + getComputedStyle(el).fontWeight + getComputedStyle(el).borderColor);
  assert.notEqual(await bg('[data-stab="insights/focus"]'), await bg('[data-stab="insights/errors"]'));
});

await step('the first key of an exercise is recorded', async () => {
  await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
  await page.locator('.w').first().waitFor();
  await typeWords(14);
  await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
  await page.getByText('How much effort did that take?').waitFor();
  await page.keyboard.press('0');
  await page.getByText(/finished/).waitFor();
  const first = await page.evaluate(() => window.FT.app.store.listSessions().then((l) => l[l.length - 1].keys[0]));
  assert.equal(first.k, 'd');
});

await step('a finished text offers to start over instead of an empty exercise', async () => {
  await page.evaluate(async () => {
    const t = { id: 'done', title: 'Done text', words: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' '), pos: 20, addedAt: Date.now() };
    await window.FT.app.store.saveText(t);
  });
  await page.keyboard.press('t');
  const row = page.locator('tr', { hasText: 'Done text' });
  await row.getByRole('button', { name: /Start over/ }).click();
  await page.locator('.w').first().waitFor();
  assert.equal(await page.locator('.w').first().textContent(), 'one');
  await page.keyboard.press('Escape');
});

await step('with no daily-training step enabled, Train says so and points to the setting', async () => {
  await withProgramme([{ type: 'relaxed', minutes: 5, enabled: false }], async () => {
    await page.keyboard.press('1');
    await page.getByText(/No exercises are switched on/).waitFor();
    await page.keyboard.press('Enter');
    await page.locator('[data-stab="settings/training"][aria-current="page"]').waitFor();
  });
});


await step('reloading mid-exercise asks first', async () => {
  await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
  await page.locator('.w').first().waitFor();
  await typeWords(3);
  let asked = null;
  page.once('dialog', (d) => { asked = d.type(); d.dismiss(); });
  await page.reload({ timeout: 2000 }).catch(() => {});
  assert.equal(asked, 'beforeunload');
  assert.ok(await page.locator('#window').isVisible());
  await page.keyboard.press('Escape'); await page.keyboard.press('Delete');
});

await step('pausing in the last burst round keeps the exercise until you choose', async () => {
  await page.evaluate(() => { const a = window.FT.app; a.burstRun = 60000; a.burstRest = 1000; window.FT.ui.startExercise('bursts', { minutes: 1.5 }); });
  await page.locator('.w').first().waitFor();
  await typeWords(12);
  await page.keyboard.press('Escape');
  await page.locator('#stopbar').getByText('Paused.').waitFor();
  assert.ok(await page.locator('#window').isVisible());
  await page.keyboard.press('Enter');                         // save
  await page.getByText(/How much effort|finished/).first().waitFor();
  await page.evaluate(() => { const a = window.FT.app; a.burstRun = 0; a.burstRest = 0; });
  if (await page.getByText('How much effort did that take?').isVisible()) { await effortReady(); await page.keyboard.press('0'); }
});

await step('a rebuild finishing after you left does not touch the new screen', async () => {
  await page.evaluate(() => window.FT.ui.go('settings/data'));
  await page.locator('#rebuild').click();
  await page.keyboard.press('1');
  await page.locator('[data-go="home"][aria-current="page"]').waitFor();
  await page.waitForTimeout(500);
  assert.deepEqual(errors, []);
});


await step('the instruction card is shown in full, heading to keys, on desktop and phone', async () => {
  await showCards(true);
  const shownInFull = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s), r = el.getBoundingClientRect();
    return [[r.left + 2, r.top + 2], [r.right - 2, r.bottom - 2]].every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
  }, sel);
  try {
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => window.FT.ui.startExercise('bursts', { minutes: 3 }));
      await page.locator('#briefing').waitFor();
      assert.ok(await shownInFull('#briefing h2'), 'heading at ' + width);
      assert.ok(await shownInFull('#briefing p:last-child'), 'keys at ' + width);
      await page.keyboard.press('Escape');
    }
  } finally {
    await page.setViewportSize({ width: 1100, height: 800 });
    await showCards(false);
  }
});

await step('after a click on the instruction card, one Enter starts', async () => {
  await showCards(true);
  try {
    await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
    await page.locator('#briefing').click();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#briefing').count(), 0);
    await page.keyboard.press('Escape');
  } finally {
    await showCards(false);
  }
});

await step('an instruction card comes before the exercise; Enter starts, letters before it do nothing', async () => {
  await showCards(true);
  try {
    await page.evaluate(() => window.FT.ui.startExercise('bursts', { minutes: 1 }));
    const card = page.locator('#briefing');
    await card.waitFor();
    assert.match(await card.textContent(), /95%/);
    assert.equal(await page.locator('#capture').getAttribute('aria-describedby'), 'briefing');   // read out to screen readers
    await page.keyboard.type('abc');
    assert.equal(await page.locator('.w .l.ok, .w .l.bad').count(), 0);
    assert.ok(await card.isVisible());
    await page.keyboard.press('Enter');
    assert.equal(await card.isVisible(), false);
    assert.equal(await page.locator('#capture').getAttribute('aria-describedby'), null);
    await typeWords(1);
    assert.ok(await page.locator('.w .l.ok, .w .l.bad').count() > 0);
    await page.keyboard.press('Escape'); await page.keyboard.press('Delete');
    await page.evaluate(() => { window.FT.app.settings.showInstructions = false; });
    await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
    await page.locator('.w').first().waitFor();
    assert.equal(await page.locator('#briefing').count(), 0);
    await page.keyboard.press('Escape');
  } finally {
    await showCards(false);
  }
});


await step('a book from an EPUB: its stories appear, and you choose where to start', async () => {
  await page.keyboard.press('t');
  await page.locator('#tfile').setInputFiles(path.join(root, 'test', 'fixtures', 'books', 'snowdrop.epub'));
  await page.getByText(/2 chapters|chapters, starting at Snowdrop/).waitFor();
  await page.locator('#tsave').click();
  const row = page.locator('tr', { hasText: 'Snowdrop & Other Tales' });
  const start = row.locator('select[data-chapter]');
  await start.waitFor();
  assert.equal(await start.locator('option:checked').textContent(), 'Snowdrop');
  await start.selectOption({ label: 'The Pink' });
  await page.waitForFunction(() => window.FT.app.store.listTexts().then((l) => {
    const t = l.find((x) => x.title === 'Snowdrop & Other Tales');
    return t && t.pos === t.chapters.find((c) => c.title === 'The Pink').start;
  }));
  await page.locator('tr', { hasText: 'Snowdrop & Other Tales' }).getByRole('button', { name: /Type now/ }).click();
  await page.locator('.w').first().waitFor();
  assert.equal(await page.locator('.w').first().textContent(), 'There');
  assert.match(await page.locator('.ex-head').textContent(), /The Pink/);
  await page.keyboard.press('Escape');
});


await step('a long text added before chapters existed says how to get them', async () => {
  await page.evaluate(async () => {
    const words = Array.from({ length: 2500 }, (_, i) => 'word' + (i % 50));
    await window.FT.app.store.saveText({ id: 'old-plain', title: 'Old plain book', words, pos: 0, addedAt: 1 });
  });
  await page.keyboard.press('t');
  await page.locator('tr', { hasText: 'Old plain book' }).getByText(/add it again from its EPUB/).waitFor();
});


await step('with no texts, prose starts in Alice in Wonderland', async () => {
  await page.evaluate(async () => {
    for (const t of await window.FT.app.store.listTexts()) await window.FT.app.store.deleteText(t.id);
    window.FT.app.settings.currentText = null;
  });
  await nav('settings/texts');
  await page.locator('tr', { hasText: 'Alice' }).waitFor();
  await page.locator('tr', { hasText: 'Alice' }).getByRole('button', { name: /Type now/ }).click();
  await page.locator('.w').first().waitFor();
  assert.equal(await page.locator('.w').first().textContent(), 'Alice');
  assert.match(await page.locator('.ex-head').textContent(), /Down the Rabbit-Hole/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
});

await step('a paragraph ends with Enter: the next one starts on a new line, and a space there is marked', async () => {
  const text = { id: 'paras', title: 'Paragraphs', words: ['One', 'two.', 'Three', 'four.', 'Five', 'six.'], breaks: [1, 3], pos: 0 };
  await page.evaluate((t) => window.FT.ui.startExercise('prose', { text: t }), text);
  await page.locator('.w').first().waitFor();
  const top = (i) => page.locator('.w').nth(i).evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(await top(2) > await top(1), 'Three starts a new line');
  assert.equal(await page.locator('.w').nth(1).locator('.sep').textContent(), '¶');
  await page.keyboard.type('One two.', { delay: 30 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('Three four. ', { delay: 30 });     // a space where Enter was due
  assert.equal(await page.locator('.w').nth(1).locator('.sep.ok').count(), 1);
  assert.equal(await page.locator('.w').nth(3).locator('.sep.bad').count(), 1);
  assert.equal(await page.evaluate(() => window.FT.ui.app.current), 'typing');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
});

await step('a past exercise opens from the Progress log with keys only, details and all, and Esc returns', async () => {
  await nav('insights/progress');
  await page.locator('#alltable').waitFor();
  const firstWpm = await page.locator('#alltable tbody tr').first().locator('td').nth(3).textContent();
  await page.keyboard.press('j');
  await page.keyboard.press('Enter');
  await page.locator('h1', { hasText: /·/ }).waitFor();
  assert.equal(await page.locator('.tile b').first().textContent(), firstWpm);
  await page.keyboard.press('d');
  assert.ok(await page.locator('#details').evaluate((d) => d.open));
  await page.keyboard.press('Escape');
  await page.locator('#alltable').waitFor();
});

await step('home continues the book with c, in free reading: no time limit, the clock counts up', async () => {
  await page.keyboard.press('1');
  const read = page.getByRole('button', { name: /Continue reading/ });
  await read.waitFor();
  assert.match(await read.textContent(), /Alice|Snowdrop|·/);
  await page.keyboard.press('c');
  await page.locator('.w').first().waitFor();
  assert.equal(await page.locator('#timer').textContent(), '0:00');
  await page.keyboard.type(await page.locator('.w').first().textContent(), { delay: 20 });
  await page.waitForTimeout(1200);
  assert.match(await page.locator('#timer').textContent(), /^0:0[1-9]$/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
});

await step('once today’s daily training is done, Enter on home continues reading; the training stays on a', async () => {
  await page.evaluate(() => { const a = window.FT.app; a.settings.trainedOn = window.FT.days.number(Date.now()); });
  await page.keyboard.press('1');
  await page.getByRole('button', { name: /Daily training again/ }).waitFor();
  assert.match(await page.locator('#primary').textContent(), /Continue reading/);
  await page.keyboard.press('Enter');
  await page.locator('.w').first().waitFor();
  assert.equal(await page.locator('#timer').textContent(), '0:00');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  await page.evaluate(() => { window.FT.app.settings.trainedOn = null; });
});

await step('timed prose that runs out of time ends at the end of the sentence, not mid-sentence', async () => {
  const text = { id: 'sentences', title: 'Sentences', words: 'One two. Three four five. Six seven eight.'.split(' '), pos: 0 };
  await page.evaluate((t) => window.FT.ui.startExercise('prose', { text: t, minutes: 0.02 }), text);
  await page.locator('.w').first().waitFor();
  await page.keyboard.type('One two. Three ', { delay: 30 });
  await page.waitForTimeout(1500);                            // the 1.2 s are up mid-sentence
  await page.keyboard.type('four ', { delay: 30 });
  assert.equal(await page.evaluate(() => window.FT.ui.app.current), 'typing');
  await page.keyboard.type('five. ', { delay: 30 });
  await page.waitForFunction(() => window.FT.ui.app.current !== 'typing');
  await page.keyboard.press('0');                             // skip the effort rating
});

await step('the chapter choice steps with the arrow keys and keeps the focus', async () => {
  await nav('settings/texts');
  const select = page.locator('select[data-chapter="alice"]');
  await select.waitFor();
  await select.focus();
  const before = +(await select.inputValue());
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  const options = await select.locator('option').evaluateAll((os) => os.map((o) => +o.value));
  assert.equal(+(await page.locator('select[data-chapter="alice"]').inputValue()), options[options.indexOf(before) + 2]);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.chapter), 'alice');
});

await step('a page that finishes loading after an exercise has started does not replace it', async () => {
  await page.evaluate(() => { window.FT.ui.viewTexts(); window.FT.ui.startExercise('relaxed', { minutes: 1 }); });
  await page.waitForTimeout(300);
  assert.ok(await page.locator('#window').isVisible());
  await page.keyboard.press('Escape');
  await page.keyboard.press('1');
});

await step('"Prose needs a text" offers Alice in Wonderland on Enter, else the text box', async () => {
  const noTexts = () => page.evaluate(async () => {
    for (const t of await window.FT.app.store.listTexts()) await window.FT.app.store.deleteText(t.id);
    window.FT.app.settings.currentText = null;
  });
  const startProseTraining = async () => {
    await page.keyboard.press('1');
    await page.getByRole('button', { name: /Start (daily training|over)/ }).first().click();
    await page.getByText('Prose needs a text').waitFor();
  };
  await withProgramme([{ type: 'prose', minutes: 0.1, enabled: true }], async () => {
    await noTexts();
    await startProseTraining();
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Alice/);
    await page.keyboard.press('Enter');
    await page.locator('.w').first().waitFor();
    assert.equal(await page.locator('.w').first().textContent(), 'Alice');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Delete');
    await page.evaluate(async () => {                        // Alice already added and finished
      const t = await window.FT.app.store.getText('alice'); t.pos = t.words.length; await window.FT.app.store.saveText(t);
    });
    await startProseTraining();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tbody');
    await page.keyboard.press('Escape');
  });
  await page.keyboard.press('1');
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
