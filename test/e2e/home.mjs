// Train (home): one way to train on Enter, a due benchmark beside it, every
// other way under More (m), and each of their keys working with More closed.
import assert from 'node:assert/strict';
import { step, freshPage, closePage, nav, current, seedExercises, visibleControls, isOpen, openMore, discard } from './harness.mjs';

const MORE = 'More m';
const home = async (page) => { await nav(page, 'home'); await page.locator('#primary').waitFor(); };
const exerciseName = (page) => page.locator('.ex-head .name').textContent();
// What a key pressed on home with More closed starts; leaves it untyped.
async function startedBy(page, key) {
  await home(page);
  assert.equal(await isOpen(page, 'more'), false);
  await page.keyboard.press(key);
  await page.locator('.w').first().waitFor();
  const name = await exerciseName(page);
  await page.keyboard.press('Escape');
  await page.locator('#primary').waitFor();
  return name;
}
// The last benchmark set, as if taken this many days ago.
const benchmarkDaysAgo = (page, days) => page.evaluate((ms) => {
  window.FT.ui.app.trainer.history().filter((h) => h.type === 'benchmark').forEach((h) => { h.startedAt -= ms; h.endedAt -= ms; });
}, days * 864e5);

export default async function homeScreen() {
  const page = await freshPage();
  await seedExercises(page, { count: 4, words: 120, slips: 0.03, slipsAfter: ['th', 'in', 're', 'an', 'er', 'on'] });
  await page.waitForFunction(() => window.FT.ui.app.trainer.targets().length > 0);

  await step('before today’s training, home shows the training on Enter and More, nothing else', async () => {
    await home(page);
    assert.deepEqual(await visibleControls(page), ['primary', MORE]);
    assert.match(await page.locator('#primary').textContent(), /^Start daily training/);
    assert.match(await page.locator('.home-start .lead').textContent(), /^20 min: warm-up 2, relaxed practice 5, speed bursts 3, prose 7, targeted practice 3$/);
    assert.match(await page.locator('.statusline').textContent(), /^[\d,]+ common words in use · \d+ in the focus list · last relaxed \d+ WPM, [\d.]+%$/);
  });

  await step('with More closed, c, r, b and f start reading, relaxed practice, the benchmark and the focus sequence', async () => {
    assert.equal(await startedBy(page, 'c'), 'Prose');
    assert.equal(await startedBy(page, 'r'), 'Relaxed practice');
    assert.equal(await startedBy(page, 'b'), 'Benchmark');
    assert.match(await startedBy(page, 'f'), /^Targeted practice ./);
  });

  await step('m opens More on its first row, j moves down it, m closes it; ? lists every key, those under More too', async () => {
    await home(page);
    await page.keyboard.press('m');
    assert.equal(await isOpen(page, 'more'), true);
    assert.deepEqual(await visibleControls(page), ['primary', MORE, 'read', 'start', 'bench', 'one']);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'read');
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'start');
    await page.keyboard.press('m');
    assert.equal(await isOpen(page, 'more'), false);
    await page.keyboard.press('?');
    const help = await page.locator('#keyhelp').textContent();
    for (const row of [/EnterStart daily training/, /cContinue reading/, /rRelaxed practice only/, /bBenchmark/, /fPractise/, /mMore ways to train/]) assert.match(help, row);
    await page.keyboard.press('Escape');
  });

  await step('More stays open when home is drawn again', async () => {
    await home(page);
    await openMore(page);
    await page.evaluate(() => window.FT.ui.redraw());
    assert.equal(await isOpen(page, 'more'), true);
  });

  await step('a redraw keeps the focus on the summary of More', async () => {
    await home(page);
    await page.locator('#more > summary').focus();
    await page.evaluate(() => window.FT.ui.redraw());
    assert.ok(await page.evaluate(() => document.activeElement.matches('#more > summary')));
  });

  await step('once today’s training is done, Enter continues reading, and the training again waits under More on a', async () => {
    await seedExercises(page, { run: 'run-today' });
    await home(page);
    assert.match(await page.locator('#primary').textContent(), /^Continue reading/);
    assert.match(await page.locator('.home-start .lead').textContent(), /^Alice’s Adventures in Wonderland · /);
    assert.deepEqual(await visibleControls(page), ['primary', MORE]);
    assert.match(await page.locator('#again').textContent(), /Daily training again/);
    await page.keyboard.press('a');
    await page.locator('.w').first().waitFor();
    assert.equal(await exerciseName(page), 'Warm-up');
    await discard(page);
    assert.equal(await current(page), 'home');
  });

  await step('a benchmark that is due shows its row beside the training; one taken lately waits under More', async () => {
    await seedExercises(page, { count: 3, type: 'benchmark', set: 'set-old', seed: 2 });
    await home(page);
    assert.ok(!(await visibleControls(page)).includes('bench'));
    await benchmarkDaysAgo(page, 8);
    await home(page);
    assert.deepEqual(await visibleControls(page), ['primary', 'bench', MORE]);
    assert.match(await page.locator('#bench').textContent(), /Benchmark.*due \(last 8 days ago\)/);
  });

  await closePage(page);
}
