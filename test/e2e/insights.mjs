// Insights: the focus list and a sequence's evidence, errors and the
// keyboard heatmap, progress charts and the exercise log; by keyboard and mouse.
import assert from 'node:assert/strict';
import { step, freshPage, closePage, shots, nav, reload, saveSettings, seedExercises, practise, THORNIUM, isOpen } from './harness.mjs';

const SEEDED = 7;
// The rows of a list that are not folded away, and where the focus is among them.
const visibleRows = () => [...document.querySelectorAll('[data-row]')].filter((b) => !b.closest('details:not([open])'));
const focusedRow = (page) => page.evaluate((v) => eval(v)().indexOf(document.activeElement), visibleRows.toString());
const chartTitled = (page, title) => page.locator('.progress-chart', { has: page.locator('h3', { hasText: title }) });
const headings = (page, table) => page.locator(table + ' thead th').allTextContents();
const openMoreMeasures = async (page) => { if (!(await isOpen(page, 'moremeasures'))) await page.locator('#moremeasures > summary').click(); };
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

  await step('the log shows the 8 latest exercises in 6 columns; a shows them all, in every column, and back', async () => {
    await seedExercises(page, { count: 3, words: 60, seed: 5 });   // more than the log shows at first
    await nav(page, 'insights/progress');
    await page.getByRole('heading', { name: 'Recent exercises' }).waitFor();
    assert.equal(await page.locator('#alltable tbody tr').count(), 8);
    assert.deepEqual(await headings(page, '#alltable'), ['When', 'Exercise', 'Min', 'WPM', 'Accuracy', 'Effort']);
    await page.keyboard.press('a');
    await page.getByRole('heading', { name: 'All exercises' }).waitFor();
    assert.equal(await page.locator('#alltable tbody tr').count(), SEEDED + 3);
    assert.deepEqual(await headings(page, '#alltable'), ['When', 'Exercise', 'Min', 'WPM', 'Accuracy', 'Effort', 'Random words', 'Hesitation', 'Rhythm', 'Vocabulary']);
    await page.keyboard.press('a');
    assert.equal(await page.locator('#alltable tbody tr').count(), 8);
    await page.keyboard.press('?');
    assert.match(await page.locator('#keyhelp').textContent(), /aAll exercises and columns/);
    await page.keyboard.press('Escape');
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

  await step('Progress leads with relaxed speed, accuracy and the benchmark; each keeps one sentence, its method under About this measure', async () => {
    await nav(page, 'insights/progress');
    assert.deepEqual(await page.locator('.progress-grid.headline .progress-chart h3').allTextContents(), ['Relaxed speed', 'Accuracy', 'Benchmark']);
    const relaxed = chartTitled(page, 'Relaxed speed');
    assert.equal(await relaxed.locator('p.lead').textContent(), 'Median WPM per day of relaxed practice.');
    const about = relaxed.locator('details.about');
    assert.equal(await about.evaluate((d) => d.open), false);
    assert.ok(!(await about.locator('p').isVisible()));
    await about.locator('summary').click();
    assert.match(await about.locator('p').textContent(), /^Fill shows rated effort/);
    await about.locator('summary').click();
  });

  await step('the other measures fold under More measures, which opens with the keyboard', async () => {
    await nav(page, 'insights/progress');
    assert.equal(await isOpen(page, 'moremeasures'), false);
    assert.ok(!(await page.locator('.progress-chart h3', { hasText: 'Common-pair timing' }).isVisible()));
    await page.locator('#moremeasures > summary').focus();
    await page.keyboard.press('Enter');
    for (const title of ['Common-pair timing', 'Effort signals (experimental)']) await page.locator('.progress-chart h3', { hasText: title }).waitFor();
  });

  await step('Conditions keeps its table; its method is under About this comparison', async () => {
    await nav(page, 'insights/progress');
    const about = page.locator('#conditionsabout');
    assert.equal(await about.evaluate((d) => d.open), false);
    assert.match(await about.textContent(), /bootstrap; Efron & Tibshirani 1993/);
  });

  await step('History shows progress charts with tooltips and tables', async () => {
    await nav(page, 'insights/progress');
    await openMoreMeasures(page);
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

  await step('Errors gives slip rates per press with the counts beside them, marks confirmed pairs, and folds letters typed early apart', async () => {
    await seedExercises(page, { count: 2, words: 120, slips: 0.01, early: 0.1, seed: 9 });
    await nav(page, 'insights/errors');
    const table = page.locator('#slips');
    assert.deepEqual(await headings(page, '#slips'), ['Intended', 'Typed', 'Kind', 'Rate per press', 'Times', 'Recent examples']);
    assert.match(await table.locator('tbody tr td.num').first().getAttribute('title'), /^[\d.]+ of \d+ presses of /);
    assert.match(await table.locator('tbody tr td').nth(4).textContent(), /^[\d.]+ of \d+$/);
    assert.ok(await table.locator('.pill.confirmed').count() >= 1);
    assert.equal(await isOpen(page, 'premature'), false);             // folded away by default
    await page.locator('#premature > summary').click();
    assert.ok(await page.locator('#premature tbody tr').count() >= 1);
    assert.match(await page.locator('#premature').textContent(), /later in the word/);
    if (shots) await page.screenshot({ path: shots + '/errors.png', fullPage: true });
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
  await longLog();
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
    await openMoreMeasures(page);
    const chart = chartTitled(page, 'Fluency (experimental)');
    await chart.locator('svg circle.pt.second').waitFor();             // one day: points, no lines
    assert.match(await chart.locator('p.lead').textContent(), /^An experimental prediction, not a measurement/);
    await chart.locator('details.about > summary').click();
    const method = await chart.locator('details.about > p').first().textContent();
    assert.match(method, /Kalfaoğlu & Stafford 2014/);
    assert.match(method, /error rates still come from all your practice; only its speed scale and correction cost come from the exercises you rated effort 1–2/);
    assert.match(await chart.locator('#timebreakdown').textContent(),
      /^Flow speed \d+ WPM: your speed if corrections took no extra time, without pauses over 5 s · pauses over 5 s and corrections take \d+% of your typing time \(about [\d.]+ s per error\)/);
    await chart.locator('svg').scrollIntoViewIfNeeded();
    const box = await chart.locator('svg').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    assert.match(await chart.locator('.tip:not([hidden])').textContent(), /WPM predicted.*effortless \d+ WPM, coverage \d+%/s);
    assert.ok((await chart.locator('details.tableview table tbody tr').count()) >= 1);
    const check = chart.locator('#fluencycheck');
    assert.equal(await check.locator('tbody tr').count(), 1);
    assert.ok(await check.locator('.tablewrap').evaluate((w) => w.scrollWidth <= w.clientWidth), 'the benchmark check fits its column');
    assert.match(await check.textContent(), /Predicted speed was off by [\d.]+ WPM on average over 1 benchmark, (over|under)-predicting/);
    if (shots) await page.screenshot({ path: shots + '/fluency.png', fullPage: true });
  });

  await closePage(page);
}

// A log longer than a screen: the whole of it, and the folds opened on
// Progress, stay as they were while the page is drawn again.
async function longLog() {
  const page = await freshPage();
  await seedExercises(page, { count: 21, seed: 6 });
  const rows = (page) => page.locator('#alltable tbody tr').count();

  await step('folds without an id stay open when a shows the whole log: About this measure, Show as table', async () => {
    await nav(page, 'insights/progress');
    const relaxed = chartTitled(page, 'Relaxed speed');
    await relaxed.locator('details.about > summary').click();
    await relaxed.locator('details.tableview > summary').click();
    await page.keyboard.press('a');
    await page.getByRole('heading', { name: 'All exercises' }).waitFor();
    assert.ok(await relaxed.locator('details.about').evaluate((d) => d.open), 'About this measure');
    assert.ok(await relaxed.locator('details.tableview').evaluate((d) => d.open), 'Show as table');
  });

  await step('the whole log stays after the way back from a past exercise, and Progress entered anew shows the recent ones', async () => {
    await nav(page, 'insights/progress');
    await page.keyboard.press('a');
    await page.getByRole('heading', { name: 'All exercises' }).waitFor();
    await page.locator('#alltable tbody tr').nth(19).locator('[data-row]').focus();
    await page.keyboard.press('Enter');
    await page.locator('#backlog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'All exercises' }).waitFor();
    assert.ok(await rows(page) >= 20);
    await nav(page, 'home');
    await nav(page, 'insights/progress');
    await page.getByRole('heading', { name: 'Recent exercises' }).waitFor();
    assert.equal(await rows(page), 8);
  });

  await closePage(page);
}
