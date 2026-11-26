// Speed bursts (rounds and rests) and the benchmark (three timed trials).
import assert from 'node:assert/strict';
import { step, freshPage, closePage, shots, nav, startExercise, typeWords, typeNextWord, effortQuestion, effortReady, testTimings,
  realTimings, discard } from './harness.mjs';

const resting = (page) => page.locator('#timer').evaluate((el) => /Rest/.test(el.textContent));
const typedOk = (page) => page.evaluate(() => document.querySelectorAll('.w .ok').length);

export default async function bursts() {
  const page = await freshPage();

  await step('backspace is ignored during the rest between burst rounds', async () => {
    await testTimings(page, { burstRoundMs: 1500, burstRestMs: 4000 });
    try {
      await startExercise(page, 'bursts', { minutes: 0.2 });
      const t0 = Date.now();
      while (!(await resting(page)) && Date.now() - t0 < 10000) await typeNextWord(page, 5);
      const before = await typedOk(page);
      for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
      assert.equal(await typedOk(page), before);
      await discard(page);
    } finally { await realTimings(page); }
  });

  await step('pausing in a burst round closes that round at the pause', async () => {
    await testTimings(page, { burstRoundMs: 4000, burstRestMs: 3000 });
    try {
      await startExercise(page, 'bursts', { minutes: 0.3 });
      await typeWords(page, 3);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');                        // resume: the rest after round 1
      await page.getByText(/Round 1: /).waitFor({ timeout: 3000 });
      await discard(page);
    } finally { await realTimings(page); }
  });

  await step('pausing in the last burst round keeps the exercise until you choose', async () => {
    await testTimings(page, { burstRoundMs: 60000, burstRestMs: 1000 });
    try {
      await startExercise(page, 'bursts', { minutes: 1.5 });
      await typeWords(page, 12);
      await page.keyboard.press('Escape');
      await page.locator('#stopbar').getByText('Paused.').waitFor();
      assert.ok(await page.locator('#window').isVisible());
      await page.keyboard.press('Enter');                         // save
      await effortQuestion(page).waitFor();
      await effortReady(page);
      await page.keyboard.press('0');
      await page.getByText(/finished/).waitFor();
    } finally { await realTimings(page); }
  });

  await step('keys typed just after an exercise times out do not jump to other pages', async () => {
    await testTimings(page, { benchmarkMinutes: 0.05 });
    try {
      await nav(page, 'home');
      await page.getByRole('button', { name: /Benchmark/ }).click();
      await page.locator('.w').first().waitFor();
      const t0 = Date.now();
      while (await page.locator('#window').isVisible() && Date.now() - t0 < 15000) await page.keyboard.type('the ', { delay: 10 });
      await page.keyboard.type('qehsd', { delay: 20 });   // all of these are page shortcuts
      await page.getByText(/Trial 1 of 3 done/).waitFor({ timeout: 3000 });
    } finally { await realTimings(page); }
  });

  await step('a benchmark set runs three trials and shows the median', async () => {
    await testTimings(page, { benchmarkMinutes: 0.08 });
    try {
      await nav(page, 'home');
      await page.getByRole('button', { name: /Benchmark/ }).click();
      for (let trial = 1; trial <= 3; trial++) {
        await page.locator('.w').first().waitFor();
        const done = page.getByText(trial < 3 ? /Trial \d of 3 done/ : 'Benchmark result');
        const t0 = Date.now();
        while (!(await done.isVisible()) && Date.now() - t0 < 30000) {
          if (!(await typeNextWord(page))) await done.waitFor();
        }
        if (trial < 3) await page.keyboard.press('Enter');
      }
      await page.getByText('Benchmark result').waitFor();
      await page.getByText('WPM (median of 3 trials)').waitFor();
      if (shots) await page.screenshot({ path: shots + '/benchmark.png', fullPage: true });
      const n = await page.evaluate(() => { const b = window.FT.ui.app.trainer.history().filter((h) => h.type === 'benchmark'); const last = b[b.length - 1].benchmarkSet; return b.filter((h) => h.benchmarkSet === last).length; });
      assert.equal(n, 3);
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: /Benchmark/ }).waitFor();
    } finally { await realTimings(page); }
  });

  await closePage(page);
}
