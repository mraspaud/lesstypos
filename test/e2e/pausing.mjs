// Pausing, leaving and restarting: nothing typed is lost without asking.
import assert from 'node:assert/strict';
import { step, freshPage, closePage, nav, startExercise, typeWords, typedCount, historyLength, discard } from './harness.mjs';

const onHome = (page) => page.locator('[data-go="home"][aria-current="page"]').waitFor();
const paused = (page) => page.locator('#stopbar').getByText('Paused.').waitFor();

export default async function pausing() {
  const page = await freshPage();

  await step('Esc pauses typing; Esc resumes with the letters kept; Delete discards', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 3);
    const before = await typedCount(page);
    const saved = await historyLength(page);
    await page.keyboard.press('Escape');
    await paused(page);
    await page.keyboard.press('Escape');                       // resume
    assert.ok(await page.locator('#stopbar').isHidden());
    assert.equal(await typedCount(page), before);
    await typeWords(page, 1);
    assert.ok(await typedCount(page) > before);
    await discard(page);
    await onHome(page);
    assert.equal(await page.locator('#window').count(), 0);
    assert.equal(await historyLength(page), saved);
  });

  await step('Tab asks before restarting once typing has begun', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 2);
    const before = await typedCount(page);
    await page.keyboard.press('Tab');
    await page.getByText(/Press Tab again to restart/).waitFor();
    assert.equal(await typedCount(page), before);
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => !document.querySelector('.w .l.ok, .w .l.bad'));
    await page.keyboard.press('Escape');
  });

  await step('typing while paused never discards; Delete does', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 3);
    await page.keyboard.press('Escape');
    await page.keyboard.type('and done', { delay: 20 });       // habit: keeps typing while paused
    assert.ok(await page.locator('#window').isVisible());
    await paused(page);
    await page.keyboard.press('Delete');
    await onHome(page);
  });

  await step('leaving mid-exercise pauses it instead of discarding', async () => {
    await nav(page, 'insights/progress');                        // so that the brand link would change the address
    const before = await historyLength(page);
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 4);
    const address = await page.evaluate(() => location.hash);
    await page.locator('[data-go="insights"]').click();          // the nav
    await paused(page);
    assert.equal(await page.evaluate(() => location.hash), address); // the address does not move either
    assert.ok(await page.locator('#window').isVisible());
    const handled = page.evaluate(() => new Promise((r) => addEventListener('hashchange', () => setTimeout(r), { once: true })));
    await page.locator('a.brand').click();                       // the brand link
    await handled;                                               // its address change is handled (and undone)
    assert.ok(await page.locator('#window').isVisible());
    await page.keyboard.press('Escape');                         // resume and keep typing
    await typeWords(page, 1);
    await discard(page);
    await onHome(page);
    assert.equal(await historyLength(page), before);
  });

  await step('reloading mid-exercise asks first', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 3);
    let asked = null;
    page.once('dialog', (d) => { asked = d.type(); d.dismiss(); });
    await page.reload({ timeout: 2000 }).catch(() => {});
    assert.equal(asked, 'beforeunload');
    assert.ok(await page.locator('#window').isVisible());
    await discard(page);
  });

  await step('the address follows the screen, so reload and links land where you are', async () => {
    await nav(page, 'insights/focus');
    await startExercise(page, 'relaxed', { minutes: 1 });
    await page.keyboard.press('Escape');                          // nothing typed: leaves to Train
    await onHome(page);
    assert.equal(await page.evaluate(() => location.hash), '#home');
  });

  await step('a page that finishes loading after an exercise has started does not replace it', async () => {
    await page.evaluate(() => { window.FT.ui.viewTexts(); window.FT.ui.startExercise('relaxed', { minutes: 1 }); });
    await page.evaluate(() => window.FT.app.store.listTexts().then(() => window.FT.app.store.listTexts()));   // the texts page's data has come
    assert.ok(await page.locator('#window').isVisible());
    await page.keyboard.press('Escape');
  });

  await closePage(page);
}
