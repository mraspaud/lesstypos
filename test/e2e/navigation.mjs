// Moving around: sections and tabs by keys, focus and announcements, the
// key help, the dark theme, and phone screens.
import assert from 'node:assert/strict';
import { step, freshPage, closePage, nav, reload, seedExercises, startExercise, typeWords, effortQuestion, setProgramme, startTraining,
  typeUntilEffort, current, PHONE, DESKTOP } from './harness.mjs';

const onSection = (page, route) => page.locator('[data-go="' + route + '"][aria-current="page"]').waitFor();
const onTab = (page, route) => page.locator('[data-stab="' + route + '"][aria-current="page"]').waitFor();
const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const horizontalOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

export default async function navigation() {
  const page = await freshPage();
  await seedExercises(page, { count: 2 });

  await step('the navigation marks the current page', async () => {
    await page.keyboard.press('h');
    await onSection(page, 'insights');
    await onTab(page, 'insights/progress');
  });

  await step('after navigation, focus is on the page heading; a skip link and a status region exist', async () => {
    await page.keyboard.press('p');
    await page.waitForFunction(() => document.activeElement.tagName === 'H1');
    assert.equal(await page.locator('a.skip[href="#view"]').count(), 1);
    assert.equal(await page.locator('[role="status"]').count(), 1);
  });

  await step('? lists the shortcuts of the current screen', async () => {
    await page.keyboard.press('p');
    await page.keyboard.press('?');
    const help = page.locator('#keyhelp');
    await help.waitFor();
    assert.match(await help.textContent(), /Enter/);
    assert.match(await help.textContent(), /Start daily training|Daily training again|Resume/);
    await page.keyboard.press('Escape');
    assert.equal(await help.count(), 0);
  });

  await step('three sections by number keys; tabs by [ ] and arrows; old addresses still work', async () => {
    await page.keyboard.press('1');
    await onSection(page, 'home');
    await page.keyboard.press('2');
    await onTab(page, 'insights/focus');
    await page.keyboard.press(']');
    await onTab(page, 'insights/errors');
    await page.locator('[data-stab="insights/errors"]').focus();
    await page.keyboard.press('ArrowRight');
    await onTab(page, 'insights/progress');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.stab), 'insights/progress');
    await page.keyboard.press('3');
    await onTab(page, 'settings/typing');
    assert.equal(await page.locator('#nav button').count(), 3);
    await page.evaluate(() => { location.hash = 'history'; });
    await page.waitForFunction(() => location.hash === '#insights/progress');
    await onTab(page, 'insights/progress');
    await page.evaluate(() => { location.hash = 'texts'; });
    await onTab(page, 'settings/texts');
  });

  // Each address change the app makes arrives later as its own hashchange:
  // a late one must not pull the user away from what they did since.
  await step('an exercise started right after two quick navigations stays on view', async () => {
    await page.keyboard.press('1');
    await onSection(page, 'home');
    await page.evaluate(() => { const U = window.FT.ui; U.go('settings/texts'); U.go('settings/data'); U.startExercise('relaxed'); });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
    assert.equal(await current(page), 'typing');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Delete');
  });

  await step('home: one primary action, the alternatives by key, the numbers on one line', async () => {
    await page.keyboard.press('1');
    assert.equal((await page.locator('.statusline').textContent()).split(' · ').length, 3);
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

  await step('the footer shows on Train and Settings only; key hints have no fill', async () => {
    const footerShown = () => page.locator('body > .shell > footer').isVisible();
    for (const [route, shown] of [['home', true], ['settings/typing', true], ['settings/data', true], ['insights/focus', false], ['insights/progress', false]]) {
      await nav(page, route);
      assert.equal(await footerShown(), shown, route);
    }
    await startExercise(page, 'relaxed', { minutes: 1 });
    assert.equal(await footerShown(), false, 'typing');
    await page.keyboard.press('Escape');
    await nav(page, 'home');
    assert.equal(await page.locator('#primary kbd').evaluate((k) => getComputedStyle(k).backgroundColor), 'rgba(0, 0, 0, 0)');
  });

  await step('the skip link moves focus to the content and stays on the page', async () => {
    await page.keyboard.press('q');
    await page.locator('a.skip').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement.id === 'view');
    assert.equal(await page.evaluate(() => location.hash), '#insights/focus');
  });

  await step('the dark theme (Ink) is chosen in Settings: Appearance and kept after a reload', async () => {
    const light = await background(page);
    await nav(page, 'settings/appearance');
    await page.locator('#theme').selectOption('dark');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.notEqual(await background(page), light);
    await reload(page);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.locator('#theme').selectOption('system');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    assert.equal(await background(page), light);
  });

  await step('following the system, a dark system gives the dark theme', async () => {
    const dark = await freshPage({ colorScheme: 'dark' });
    try {
      assert.equal(await dark.evaluate(() => document.documentElement.dataset.theme), 'dark');
      assert.notEqual(await background(dark), await background(page));
    } finally { await closePage(dark); }
  });

  await step('phone width has no horizontal scroll on any page', async () => {
    await page.setViewportSize(PHONE);
    try {
      for (const k of ['p', 't', 'q', 'e', 'h', 's', 'd']) {
        await page.keyboard.press(k);
        assert.ok(await horizontalOverflow(page) <= 0, 'overflow on ' + k + ': ' + await horizontalOverflow(page));
      }
    } finally { await page.setViewportSize(DESKTOP); }
  });

  await step('phone width has no horizontal scroll while typing, rating effort, between exercises and on a summary', async () => {
    await page.setViewportSize(PHONE);
    try {
      await startExercise(page, 'relaxed', { minutes: 1 });
      await typeWords(page, 14);
      assert.ok(await horizontalOverflow(page) <= 0, 'typing');
      await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
      await effortQuestion(page).waitFor();
      assert.ok(await horizontalOverflow(page) <= 0, 'effort');
      await page.keyboard.press('2');
      await page.getByText(/finished/).waitFor();
      assert.ok(await horizontalOverflow(page) <= 0, 'summary');
      await setProgramme(page, ['warmup', 'relaxed']);
      await startTraining(page);
      await typeUntilEffort(page);
      await page.keyboard.press('2');
      await page.locator('#progbar').waitFor();
      assert.ok(await horizontalOverflow(page) <= 0, 'between exercises');
      await page.keyboard.press('Escape');
    } finally { await page.setViewportSize(DESKTOP); }
  });

  await closePage(page);
}
