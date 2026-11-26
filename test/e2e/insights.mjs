// Insights: the focus list and a sequence's evidence, errors and the
// keyboard heatmap, progress charts and the exercise log; by keyboard and mouse.
import assert from 'node:assert/strict';
import { step, freshPage, closePage, shots, nav, reload, saveSettings, seedExercises, practise, THORNIUM } from './harness.mjs';

const SEEDED = 7;
// The rows of a list that are not folded away, and where the focus is among them.
const visibleRows = () => [...document.querySelectorAll('[data-row]')].filter((b) => !b.closest('details:not([open])'));
const focusedRow = (page) => page.evaluate((v) => eval(v)().indexOf(document.activeElement), visibleRows.toString());
const openAllSequences = async (page) => {
  if (!(await page.locator('#allseq[open]').count())) await page.locator('#allseq > summary').click();
  await page.getByRole('button', { name: 'All with enough evidence' }).click();
};

export default async function insights() {
  const page = await freshPage();
  await saveSettings(page, { layoutText: THORNIUM });
  await seedExercises(page, { count: SEEDED - 3, words: 120, slips: 0.03, slipsAfter: ['th', 'in', 're', 'an', 'er', 'on'] });
  await seedExercises(page, { count: 3, type: 'benchmark', set: 'set-1', seed: 2 });

  await step('the exercise log lists every saved exercise, also after a reload', async () => {
    await reload(page);
    await page.keyboard.press('h');
    await page.locator('#alltable tbody tr').first().waitFor();
    assert.equal(await page.locator('#alltable tbody tr').count(), SEEDED);
  });

  await step('sequences page explains a sequence', async () => {
    await page.keyboard.press('q');
    await openAllSequences(page);
    await page.locator('tr[data-key]').first().click();
    await page.locator('#why h2').waitFor();
    assert.match(await page.locator('#why').textContent(), /observations across \d+ sessions?\./);
    if (shots) await page.screenshot({ path: shots + '/sequences.png', fullPage: true });
  });

  await step('rows of Sequences and Errors open with the keyboard, with j/k and with the arrows', async () => {
    for (const [down, up] of [['j', 'k'], ['ArrowDown', 'ArrowUp']]) {
      await page.keyboard.press('q');
      await openAllSequences(page);
      await page.locator('h1').focus();
      // from the opened row if there is one, else from the top
      const start = await page.evaluate((v) => { const rows = eval(v)(); const sel = document.querySelector('.selected [data-row]'); return sel ? rows.indexOf(sel) : -1; }, visibleRows.toString());
      await page.keyboard.press(down);
      await page.keyboard.press(down);
      await page.keyboard.press(up);
      assert.equal(await focusedRow(page), start < 0 ? 0 : start + 1);
      await page.keyboard.press('Enter');
      await page.locator('#why h2').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
    }
    await page.keyboard.press('p');                            // practise it
    await page.locator('.w').first().waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('e');
    await page.locator('tr[data-i]').first().waitFor();
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await page.locator('#subex h2').waitFor();
  });

  await step('list keys skip folded rows and continue from the opened row', async () => {
    await page.keyboard.press('q');
    if (await page.locator('#allseq[open]').count()) await page.locator('#allseq > summary').click();
    await page.waitForFunction(() => !document.querySelector('#allseq[open]'));
    const visible = await page.evaluate((v) => eval(v)().length, visibleRows.toString());
    assert.ok(visible >= 3, 'rows shown: ' + visible);
    await page.locator('h1').focus();
    for (let i = 0; i < visible + 3; i++) await page.keyboard.press('j');
    assert.equal(await focusedRow(page), visible - 1);
    await page.evaluate((v) => eval(v)()[1].click(), visibleRows.toString());
    await page.locator('#why h2').waitFor();
    await page.keyboard.press('j');
    assert.equal(await focusedRow(page), 2);
  });

  await step('focus stays put after a filter pill or moving a daily-training step', async () => {
    await page.keyboard.press('q');
    if (!(await page.locator('#allseq[open]').count())) await page.locator('#allseq > summary').click();
    await page.locator('[data-tab="kept"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'kept');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'all');
    await nav(page, 'settings/training');
    await page.locator('[data-down="0"]').focus();
    await page.keyboard.press('Enter');
    assert.match(await page.evaluate(() => document.activeElement.id || ''), /^(down|up)-1$/);
  });

  await step('History shows progress charts with tooltips and tables', async () => {
    await nav(page, 'insights/progress');
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

  await step('Insights: Progress has a Conditions section', async () => {
    await nav(page, 'insights/progress');
    await page.getByRole('heading', { name: 'Conditions' }).waitFor();
  });

  await step('a past exercise opens from the Progress log with keys only, details and all, and Esc returns', async () => {
    await nav(page, 'insights/progress');
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

  await step('an exercise whose record is gone says so once, on that page only', async () => {
    await page.evaluate(() => { window.FT.ui.app.trainer.history().push({ id: 'gone', type: 'relaxed', startedAt: Date.now(), durationMs: 60000, words: 60, wpm: 40, firstAttemptAccuracy: 0.99, frontier: 200 }); });
    try {
      await nav(page, 'insights/progress');
      await page.locator('[data-past="gone"]').click();
      await page.locator('#notice', { hasText: /no longer stored/ }).waitFor();
      await nav(page, 'settings/typing');
      assert.equal(await page.locator('#notice').isHidden(), true);
    } finally { await page.evaluate(() => { window.FT.ui.app.trainer.history().pop(); }); }
  });

  await step('a click anywhere in a row of the exercise log opens that exercise', async () => {
    await nav(page, 'insights/progress');
    const row = page.locator('#alltable tbody tr').first();
    const wpm = await row.locator('td').nth(3).textContent();
    await row.locator('td').nth(3).click();
    await page.locator('h1', { hasText: /·/ }).waitFor();
    assert.equal(await page.locator('.tile b').first().textContent(), wpm);
    await page.keyboard.press('Escape');
  });

  await step('with a layout, the Errors page shows a keyboard heatmap of errors and of where wrong presses land', async () => {
    await nav(page, 'insights/errors');
    const heatmap = page.locator('.heatmap').first();
    await heatmap.locator('svg rect.key').first().waitFor();
    assert.ok(await heatmap.locator('svg rect.key').count() >= 30);
    await heatmap.locator('text=␣').first().waitFor();
    await heatmap.getByRole('button', { name: /Where wrong presses land/ }).click();
    await heatmap.locator('svg rect.key').first().waitFor();
    if (shots) await page.screenshot({ path: shots + '/heatmap.png', fullPage: true });
  });

  await step('with a layout, the summary of an exercise has a heatmap under Details', async () => {
    await practise(page);
    await page.keyboard.press('d');
    await page.locator('.heatmap svg rect.key').first().waitFor();
  });

  await step('with a layout, Sequences shows performance by movement type', async () => {
    await nav(page, 'insights/focus');
    await page.locator('#moves > summary').click();            // folded away by default
    const table = page.locator('#movement');
    await table.locator('td', { hasText: 'alternation' }).first().waitFor();
    await table.locator('[data-key]').first().click();
    await page.locator('#why h2').waitFor();
  });

  await step('the current section tab looks selected', async () => {
    await page.keyboard.press('q');
    const look = (sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor + getComputedStyle(el).fontWeight + getComputedStyle(el).borderColor);
    assert.notEqual(await look('[data-stab="insights/focus"]'), await look('[data-stab="insights/errors"]'));
  });


  await closePage(page);
  await fluencyIndex();
}

// The experimental fluency index: its chart (two series, coverage in the
// tooltip, a table), the measured breakdown of recent typing time and the
// benchmark check, once relaxed practice covers enough of the reference text.
async function fluencyIndex() {
  const page = await freshPage();
  await seedExercises(page, { count: 6, words: 120, effort: 2, seed: 3 });
  await seedExercises(page, { count: 3, type: 'benchmark', set: 'set-1', seed: 4 });

  await step('Progress shows the fluency index and checks it against the benchmark', async () => {
    await nav(page, 'insights/progress');
    const chart = page.locator('.progress-chart', { has: page.locator('h3', { hasText: 'Fluency (experimental)' }) });
    await chart.locator('svg circle.pt.second').waitFor();             // one day: points, no lines
    assert.match(await chart.locator('p.muted').first().textContent(), /experimental prediction, not a measurement/);
    assert.match(await chart.locator('p.muted').first().textContent(), /Kalfaoğlu & Stafford 2014/);
    assert.match(await chart.locator('#timebreakdown').textContent(),
      /^Flow speed \d+ WPM \(keystrokes without errors\) · corrections cost \d+% of your typing time \(about [\d.]+ s each\)/);
    await chart.locator('svg').scrollIntoViewIfNeeded();
    const box = await chart.locator('svg').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    assert.match(await chart.locator('.tip:not([hidden])').textContent(), /WPM predicted.*effortless \d+ WPM, coverage \d+%/s);
    assert.ok((await chart.locator('details.tableview table tbody tr').count()) >= 1);
    const check = chart.locator('#fluencycheck');
    assert.equal(await check.locator('tbody tr').count(), 1);
    assert.match(await check.textContent(), /Predicted speed was off by [\d.]+ WPM on average over 1 benchmark, (over|under)-predicting/);
    if (shots) await page.screenshot({ path: shots + '/fluency.png', fullPage: true });
  });

  await closePage(page);
}
