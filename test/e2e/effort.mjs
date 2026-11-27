// After an exercise: the effort rating, the summary and its keys, and the
// conditions of the sitting.
import assert from 'node:assert/strict';
import { step, freshPage, closePage, nav, reload, startExercise, typeWords, finishWithEffort, effortQuestion, effortReady, history,
  historyLength, practise, seedExercises, discard, untilResolved } from './harness.mjs';

const lastEffort = (page) => page.evaluate(() => window.FT.ui.app.trainer.history().slice(-1)[0].effort);
const storedTags = (page) => page.evaluate(async () => (await window.FT.ui.app.store.getSession(window.FT.ui.app.trainer.history().at(-1).id)).tags);
// The last exercise, as if done hours ago.
const hoursAgo = (page, hours) => page.evaluate((ms) => { const last = window.FT.ui.app.trainer.history().at(-1); last.startedAt -= ms; last.endedAt -= ms; }, hours * 3600e3);
const storedTagsOf = (page, ids) => page.evaluate((list) => Promise.all(list.map(async (id) => (await window.FT.ui.app.store.getSession(id)).tags || null)), ids);
const lastIds = (page, n) => page.evaluate((count) => window.FT.ui.app.trainer.history().slice(-count).map((h) => h.id), n);
// Pauses and saves the exercise on view; waits for the effort question.
async function saveAndAsk(page) {
  await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
  await effortQuestion(page).waitFor();
}

export default async function effort() {
  const page = await freshPage();

  await step('a digit pressed as the timer ends is not saved as the effort rating', async () => {
    await startExercise(page, 'relaxed', { minutes: 0.05 });
    const words = await page.$$eval('.w', (e) => e.slice(0, 60).map((x) => x.textContent));
    for (const w of words) {                                   // keep typing until the timer ends
      if (await effortQuestion(page).isVisible()) break;
      await page.keyboard.type(w + ' ', { delay: 20 });
    }
    await effortQuestion(page).waitFor({ timeout: 10000 });
    const before = await historyLength(page);
    await page.keyboard.press('5');                            // still in flight: ignored
    assert.ok(await effortQuestion(page).isVisible());
    assert.equal(await page.locator('#effortkeys').textContent(), '1–5 rate · Enter skip');
    assert.equal(await page.locator('#effortkeys .legendkey').getAttribute('id'), null);   // a legend key without an id
    await effortReady(page);
    await page.keyboard.press('2');
    await page.waitForFunction((n) => window.FT.ui.app.trainer.history().length > n, before);
    assert.equal(await lastEffort(page), 2);
  });

  await step('the effort question shows the scale first, then its keys, then why it is asked', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 14);
    await saveAndAsk(page);
    const order = await page.locator('.effort > *').evaluateAll((els) => els.map((e) => e.id || e.className || e.tagName));
    assert.deepEqual(order, ['H1', 'scale', 'effortkeys', 'effortwhy']);
    assert.match(await page.locator('#effortwhy').textContent(), /compare speed at the same effort.*0 and Esc also skip/);
    await effortReady(page);
    await page.keyboard.press('0');
    await page.getByText(/finished/).waitFor();
    assert.equal(await lastEffort(page), null);
  });

  await step('skip, clicked, saves the exercise without a rating', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 14);
    await saveAndAsk(page);
    await effortReady(page);
    await page.locator('#effortkeys .legendkey').click();
    await page.getByText(/finished/).waitFor();
    assert.equal(await lastEffort(page), null);
  });

  await step('Enter on a focused effort button records that rating', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 14);
    await saveAndAsk(page);
    await page.locator('[data-effort="4"]').focus();
    await page.keyboard.press('Enter');
    await page.getByText(/finished/).waitFor();
    assert.equal(await lastEffort(page), 4);
  });

  await step('Esc on the effort question saves the exercise without a rating', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 14);
    await saveAndAsk(page);
    await page.keyboard.press('Escape');
    await page.getByText(/finished/).waitFor();
    assert.equal(await lastEffort(page), null);
  });

  await step('leaving the effort question saves the exercise and leaves no stray key handler', async () => {
    const before = await historyLength(page);
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 14);
    await saveAndAsk(page);
    await nav(page, 'insights/progress');
    assert.equal(await historyLength(page), before + 1);
    // a "1" typed later inside a new exercise is just typing
    await startExercise(page, 'relaxed', { minutes: 1 });
    await page.keyboard.type('1');
    await page.waitForFunction(() => document.querySelectorAll('.w .l.bad').length === 1);
    assert.equal(await historyLength(page), before + 1);
    await discard(page);
  });

  await step('a finished exercise waiting for its rating survives a reload', async () => {
    const before = await historyLength(page);
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 14);
    await saveAndAsk(page);
    await untilResolved(page, () => window.FT.ui.app.store.getDraft().then((d) => !!d));
    await reload(page);
    await effortQuestion(page).waitFor();
    await effortReady(page);
    await page.keyboard.press('3');
    await page.getByText(/finished/).waitFor();
    const h = await history(page);
    assert.equal(h.length, before + 1);
    assert.equal(h[h.length - 1].effort, 3);
    await untilResolved(page, () => window.FT.ui.app.store.getDraft().then((d) => !d));
    await reload(page);
    assert.equal(await effortQuestion(page).count(), 0);
  });

  await step('? lists what the keys do on this screen, not shortcuts it overrides', async () => {
    await practise(page);
    await page.keyboard.press('?');
    const txt = await page.locator('#keyhelp').innerText();
    assert.match(txt, /d\s+Details/);
    assert.doesNotMatch(txt, /d\s+Settings: Data/);
    await page.keyboard.press('Escape');
  });

  // ---------- conditions ----------
  await step('an exercise in the same sitting takes its conditions', async () => {
    await seedExercises(page, { tags: ['home', 'wrist-rest'] });
    await practise(page);
    await page.getByText(/Conditions: #home #wrist-rest/).waitFor();
    assert.deepEqual(await storedTags(page), ['home', 'wrist-rest']);
  });

  await step('an exercise starting a new sitting asks for its conditions, offering the last ones', async () => {
    await hoursAgo(page, 3);
    await practise(page);
    await page.locator('#tags').waitFor();
    assert.equal(await page.locator('#tags').inputValue(), '#home #wrist-rest');
    await page.keyboard.press('Escape');
    await page.keyboard.press('#');                                     // the summary keeps its keys; # goes to the tags
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tags');
    await page.keyboard.press('Escape');
  });

  await step('the tags of a sitting are saved with Enter', async () => {
    await page.locator('#tags').fill('#Desk');
    await page.locator('#tags').press('Enter');
    await page.getByText(/Saved: #desk/).waitFor();
    await untilResolved(page, async () => {
      const s = await window.FT.ui.app.store.getSession(window.FT.ui.app.trainer.history().at(-1).id);
      return JSON.stringify(s.tags) === '["desk"]';
    });
  });

  await step('Change on a summary in the same sitting retags every exercise of the sitting', async () => {
    await practise(page);
    await page.getByText(/Conditions: #desk/).waitFor();
    await page.keyboard.press('#');
    await page.locator('#tags').waitFor();
    assert.equal(await page.locator('#tags').inputValue(), '#desk');
    await page.locator('#tags').fill('#desk #tired');
    await page.locator('#tags').press('Enter');
    await page.getByText(/Saved: #desk #tired/).waitFor();
    const [earlier, before, last] = await lastIds(page, 3);
    assert.deepEqual(await storedTagsOf(page, [before, last]), [['desk', 'tired'], ['desk', 'tired']]);
    assert.deepEqual(await storedTagsOf(page, [earlier]), [['home', 'wrist-rest']]);   // another sitting
  });

  await step('a past summary shows its exercise’s conditions and changes them for it only', async () => {
    const [earlier, before] = await lastIds(page, 3);
    await nav(page, 'insights/progress');
    await page.locator('[data-past="' + earlier + '"]').click();
    await page.getByText(/Conditions: #home #wrist-rest/).waitFor();
    await page.getByRole('button', { name: /Change/ }).click();
    await page.locator('#tags').fill('#office');
    await page.locator('#tags').press('Enter');
    await page.getByText(/Saved: #office/).waitFor();
    assert.deepEqual(await storedTagsOf(page, [earlier, before]), [['office'], ['desk', 'tired']]);
  });

  await closePage(page);
}
