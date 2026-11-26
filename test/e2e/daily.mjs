// The daily training: its steps, the bar between them, ending, resuming,
// a text for prose, and the conditions asked at the end.
import assert from 'node:assert/strict';
import { step, freshPage, closePage, shots, nav, reload, setProgramme, withProgramme, startTraining, leaveTrainingSummary, typeWords,
  typeUntilEffort, finishWithEffort, seedText, storedText, removeTexts, testTimings, realTimings, discard } from './harness.mjs';

const ALL_STEPS = ['warmup', 'relaxed', 'bursts', 'prose', 'targeted'];
const between = (page) => page.locator('#progbar').waitFor();
const finished = (page) => page.getByText('Daily training finished').waitFor();
const steps = (...types) => types.map((type) => ({ type, minutes: 0.1, enabled: true }));
// Types the exercise on view until it ends, and rates it.
async function typeStep(page, rating = 2) { await typeUntilEffort(page); await page.keyboard.press(String(rating)); await between(page); }
const sentence = (n) => Array.from({ length: n }, (_, i) => (i % 5 === 0 ? 'Don’t' : 'word' + i)).join(' ').split(' ');

// What two presses of key on home, in one go, start.
async function startedByTwoPresses(key, { withBook }) {
  const page = await freshPage();
  try {
    await page.evaluate(async (book) => {
      const U = window.FT.ui, app = window.FT.app;
      app.settings.programme = { name: 'test', steps: [{ type: 'prose', minutes: 1, enabled: true }] };   // starts once the text is read
      if (book) await U.addBundled();
      window.started = { programmes: 0, exercises: 0 };
      const startProgramme = U.startProgramme, startExercise = U.startExercise;
      U.startProgramme = (...a) => { window.started.programmes++; return startProgramme(...a); };
      U.startExercise = (...a) => { window.started.exercises++; return startExercise(...a); };
      U.go('home');
    }, withBook);
    await page.getByRole('button', { name: /Start daily training/ }).waitFor();
    await page.evaluate((k) => {
      for (let i = 0; i < 2; i++) document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    }, key);
    await page.locator('.w').first().waitFor();
    await page.evaluate(() => window.FT.app.store.listTexts().then(() => new Promise((r) => setTimeout(r, 100))));   // the second press's work, if any, has settled
    return await page.evaluate(() => window.started);
  } finally { await closePage(page); }
}

export default async function daily() {
  const page = await freshPage();

  await step('home offers daily training and relaxed practice', async () => {
    await page.getByRole('button', { name: /Start daily training · 20 min/ }).waitFor();
    await page.getByRole('button', { name: /Relaxed practice only/ }).waitFor();
    if (shots) await page.screenshot({ path: shots + '/home.png' });
  });

  await step('the daily programme runs every exercise with effort ratings and ends with a summary', async () => {
    await seedText(page, { id: 'test', title: 'Test text', words: sentence(30) });
    await testTimings(page, { burstRoundMs: 2500, burstRestMs: 1200 });
    try {
      await setProgramme(page, ALL_STEPS);
      await startTraining(page);
      for (let i = 0; i < ALL_STEPS.length; i++) {
        await page.locator('.w').first().waitFor();
        await typeStep(page);
        if (ALL_STEPS[i] === 'bursts') assert.ok(await page.getByText(/^Rounds$/).isVisible(), 'burst rounds table');
        if (ALL_STEPS[i] === 'prose') assert.ok(await page.getByText(/Your place is saved/).isVisible(), 'prose position');
        if (shots && ALL_STEPS[i] === 'bursts') await page.screenshot({ path: shots + '/bursts-summary.png', fullPage: true });
        await page.keyboard.press('Enter');
      }
      await finished(page);
      assert.equal(await page.locator('tbody tr').count(), ALL_STEPS.length);
      if (shots) await page.screenshot({ path: shots + '/programme-summary.png', fullPage: true });
      assert.ok((await storedText(page, 'test')).pos > 0, 'prose position advanced');
      await leaveTrainingSummary(page);
    } finally { await realTimings(page); }
  });

  await step('an interrupted programme can be resumed after a reload', async () => {
    await startTraining(page);
    await page.locator('.w').first().waitFor();
    await typeStep(page);
    await page.waitForFunction(() => window.FT.app.store.load().then((d) => d.settings.programmeRun && d.settings.programmeRun.results.length === 1));
    await reload(page);
    await page.getByRole('button', { name: /Resume: relaxed practice \(2 of 5\)/ }).waitFor();
    await setProgramme(page, ALL_STEPS);   // a new run next time
  });

  await step('between exercises, r repeats the last one and n skips the next; the summary lists the skipped one', async () => {
    await setProgramme(page, ['warmup', 'relaxed']);
    await startTraining(page);
    await typeStep(page);
    await page.keyboard.press('r');                             // the warm-up again
    await page.locator('.ex-head .name', { hasText: /Warm-up/ }).waitFor();
    await typeStep(page);
    assert.match(await page.locator('#progbar').textContent(), /Next: Relaxed practice/);
    await page.keyboard.press('n');                             // skip the relaxed practice
    await page.locator('#progbar', { hasText: 'That was the last exercise.' }).waitFor();
    await page.keyboard.press('Enter');
    await finished(page);
    const rows = await page.locator('tbody tr').allTextContents();
    assert.equal(rows.length, 3);
    assert.equal(rows.filter((r) => /Warm-up/.test(r)).length, 2);
    assert.match(rows.find((r) => /Relaxed/.test(r)), /skipped/);
    await leaveTrainingSummary(page);
  });

  await step('ending training with the mouse leaves no stale programme keys', async () => {
    await setProgramme(page, ['warmup', 'relaxed']);
    await startTraining(page);
    await typeStep(page);
    await page.getByRole('button', { name: /End training/ }).click();
    await page.getByRole('button', { name: /Press again to end/ }).click();
    await finished(page);
    await page.keyboard.press('Escape');   // out of the tags box
    await page.keyboard.press('r');        // must do nothing, and not throw
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /Relaxed practice only/ }).waitFor();
  });

  await step('between exercises Esc keeps the daily training; ending it asks first', async () => {
    await setProgramme(page, ['relaxed', 'warmup', 'targeted'], 1);
    await startTraining(page);
    await page.locator('.w').first().waitFor();
    await typeWords(page, 14);
    await finishWithEffort(page, 2);
    await between(page);
    await page.keyboard.press('Escape');                       // back home, training kept
    await page.getByRole('button', { name: /Resume/ }).click();
    await page.locator('.w').first().waitFor();
    await typeWords(page, 14);
    await finishWithEffort(page, 3);
    await between(page);
    await page.keyboard.press('x');
    await page.getByText(/Press x again to end/).waitFor();
    assert.ok(await page.locator('#progbar').isVisible());
    await page.keyboard.press('x');
    await finished(page);
    await leaveTrainingSummary(page);
  });

  await step('x, then d, then x ends the daily training', async () => {
    await withProgramme(page, steps('relaxed', 'warmup'), async () => {
      await startTraining(page);
      await typeStep(page);
      await page.keyboard.press('x');
      await page.keyboard.press('d');
      await page.keyboard.press('x');
      await finished(page);
      await leaveTrainingSummary(page);
    });
  });

  await step('the end of the daily training asks for the conditions; Enter saves them to every exercise of the training', async () => {
    await withProgramme(page, steps('relaxed', 'warmup'), async () => {
      await startTraining(page);
      await typeStep(page);
      await page.keyboard.press('Enter');
      await typeStep(page);
      await page.keyboard.press('Enter');
      await finished(page);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'tags');
      await page.locator('#tags').fill('#Home wrist-rest');
      await page.keyboard.press('Enter');
      await page.getByText(/Saved: #home #wrist-rest/).waitFor();
      const tagged = await page.evaluate(async () => {
        const h = window.FT.app.trainer.history().slice(-2);
        return Promise.all(h.map(async (x) => [x.tags, (await window.FT.app.store.getSession(x.id)).tags]));
      });
      assert.deepEqual(tagged, [[['home', 'wrist-rest'], ['home', 'wrist-rest']], [['home', 'wrist-rest'], ['home', 'wrist-rest']]]);
      await page.keyboard.press('Enter');   // Done
      await page.locator('[data-go="home"][aria-current="page"]').waitFor();
    });
  });

  await step('with no daily-training step enabled, Train says so and points to the setting', async () => {
    await withProgramme(page, [{ type: 'relaxed', minutes: 5, enabled: false }], async () => {
      await nav(page, 'home');
      await page.getByText(/No exercises are switched on/).waitFor();
      await page.keyboard.press('Enter');
      await page.locator('[data-stab="settings/training"][aria-current="page"]').waitFor();
    });
  });

  await step('"Prose needs a text" offers Alice in Wonderland on Enter, else the text box', async () => {
    const startProseTraining = async () => {
      await startTraining(page);
      await page.getByText('Prose needs a text').waitFor();
    };
    await withProgramme(page, steps('prose'), async () => {
      await removeTexts(page);
      await startProseTraining();
      assert.match(await page.evaluate(() => document.activeElement.textContent), /Alice/);
      await page.keyboard.press('Enter');
      await page.locator('.w').first().waitFor();
      assert.equal(await page.locator('.w').first().textContent(), 'Alice');
      await discard(page);
      await page.evaluate(async () => {                        // Alice already added and finished
        const t = await window.FT.app.store.getText('alice'); t.pos = t.words.length; await window.FT.app.store.saveText(t);
      });
      await startProseTraining();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'tbody');
      await page.keyboard.press('Escape');
    });
  });

  await step('a text added where prose needs one starts the prose exercise', async () => {
    await withProgramme(page, steps('prose'), async () => {
      await startTraining(page);
      await page.getByText('Prose needs a text').waitFor();
      await page.locator('#ttitle').fill('Needed text');
      await page.locator('#tbody').fill(sentence(30).join(' '));
      await page.locator('#tsave').click();
      await page.locator('.ex-head', { hasText: 'Needed text' }).waitFor();
      await discard(page);
    });
  });

  await step('two fast Enters in the text box where prose needs a text add it and start prose once', async () => {
    await withProgramme(page, steps('prose'), async () => {
      await removeTexts(page);
      await startTraining(page);
      await page.getByText('Prose needs a text').waitFor();
      await page.locator('#tbody').fill(sentence(30).join(' '));
      await page.locator('#ttitle').fill('Entered twice');
      await page.locator('#ttitle').press('Enter');
      await page.locator('#ttitle').press('Enter').catch(() => {});   // the form may be gone already
      await page.locator('.ex-head', { hasText: 'Entered twice' }).waitFor();
      await page.waitForTimeout(300);
      const titles = (await page.evaluate(() => window.FT.ui.app.store.listTexts())).map((t) => t.title);
      assert.deepEqual(titles, ['Entered twice']);
      await discard(page);
    });
  });

  await step('two fast Enters on home start the daily training once', async () => {
    assert.deepEqual(await startedByTwoPresses('Enter', { withBook: true }), { programmes: 1, exercises: 1 });
  });

  await step('two fast presses of c on home start reading the bundled book once', async () => {
    assert.deepEqual(await startedByTwoPresses('c', { withBook: false }), { programmes: 0, exercises: 1 });
  });

  await closePage(page);
}
