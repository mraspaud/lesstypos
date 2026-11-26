// Settings and data: the keyboard layout, backups (export, import by paste
// or file, replace or merge), rebuilding and deleting.
import assert from 'node:assert/strict';
import { step, freshPage, closePage, nav, exportBackup, importBackup, historyLength, seedExercises, practise, THORNIUM } from './harness.mjs';

const importMessage = (page) => page.getByText(/^Imported/).waitFor();

export default async function data() {
  const page = await freshPage();
  await seedExercises(page);

  await step('export, delete everything, import restores the history', async () => {
    const backup = await exportBackup(page);
    assert.ok(backup.sessions.length && backup.sessions.every((x) => x.enc === 1)); // backups carry compact sessions
    const stored = await page.evaluate(async () => {
      const a = window.FT.store.idbAdapter('lesstypos');
      const k = (await a.keys()).filter((x) => String(x).startsWith('session:'));
      return Promise.all(k.map((x) => a.get(x).then((r) => r.enc)));
    });
    assert.ok(stored.length && stored.every((e) => e === 1)); // stored compact in IndexedDB
    await nav(page, 'settings/data');
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await page.getByRole('button', { name: 'Click again to confirm' }).click();
    await page.getByText('Done.').waitFor();
    assert.equal(await historyLength(page), 0);
    await page.fill('#paste', JSON.stringify(backup));
    await page.getByRole('button', { name: 'Import pasted backup' }).click();
    await importMessage(page);
    assert.equal(await historyLength(page), 1);
  });

  await step('a backup chosen as a file merges with the current data', async () => {
    const backup = await exportBackup(page);
    await practise(page);                                         // one more exercise, not in the backup
    const other = await freshPage();
    try {
      await seedExercises(other, { seed: 2 });                    // an exercise of another browser
      const file = { name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(await exportBackup(other))) };
      await nav(page, 'settings/data');
      await page.locator('#impmode').selectOption('merge');
      await page.locator('#file').setInputFiles(file);
      await importMessage(page);
      assert.equal(await historyLength(page), backup.sessions.length + 2);
    } finally { await closePage(other); }
  });

  await step('importing a backup with statistics from an older model rebuilds them at once', async () => {
    const backup = await exportBackup(page);
    backup.profile.modelVersion = 1; backup.profile.history.forEach((h) => { delete h.keyPresses; });
    await importBackup(page, backup);
    const [version, current, rebuilt] = await page.evaluate(() => [window.FT.app.trainer.profile().modelVersion, window.FT.MODEL_VERSION,
      window.FT.app.trainer.history().some((h) => h.keyPresses)]);
    assert.equal(version, current);
    assert.equal(rebuilt, true);
  });

  await step('a pasted backup with markup in its settings or an unknown step cannot break or script the app', async () => {
    const backup = await exportBackup(page);
    backup.settings.durationMin = '<img id="pwned" src="x" onerror="window.pwned=1">';
    backup.settings.programme = { name: 'x', steps: [{ type: 'relaxed', minutes: '<b id="bold">', enabled: true }, { type: 'nope', minutes: 3, enabled: true }] };
    await importBackup(page, backup);
    await page.keyboard.press('1');
    await page.getByRole('button', { name: /Relaxed practice only · 5 min/ }).waitFor();
    assert.equal(await page.locator('#pwned, #bold').count(), 0);
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    assert.match(await page.locator('.lead').textContent(), /relaxed practice 5 min\./);
  });

  await step('a rebuild finishing after you left does not touch the new screen', async () => {
    await nav(page, 'settings/data');
    await page.evaluate(() => { window.trainerBefore = window.FT.app.trainer; });
    await page.locator('#rebuild').click();
    await page.keyboard.press('1');
    await page.locator('[data-go="home"][aria-current="page"]').waitFor();
    await page.waitForFunction(() => window.FT.app.trainer !== window.trainerBefore);   // the rebuild has finished
    assert.equal(await page.locator('#resetmsg').count(), 0);
  });

  await step('settings accept a layout and multi-letter keys', async () => {
    await nav(page, 'settings/keyboard');
    await page.fill('#macros', 'th qu');
    await page.locator('#macros').dispatchEvent('change');
    await page.fill('#layoutText', THORNIUM);
    await page.locator('#layoutText').dispatchEvent('change');
    await page.getByText(/Layout read: 40 keys, multi-letter: th qu/).waitFor();
    await page.getByText('From your layout: th qu').waitFor();
    assert.deepEqual(await page.evaluate(() => window.FT.app.settings.macros), ['th', 'qu']);
  });

  await step('slips of an exercise show on the Errors page by kind', async () => {
    await nav(page, 'home');
    await page.getByRole('button', { name: /Relaxed practice only/ }).click();
    await page.locator('.w').first().waitFor();
    const words = await page.$$eval('.w', (e) => e.slice(0, 14).map((x) => x.textContent));
    for (const w of words) await page.keyboard.type((w.length > 2 && w[0] !== 'z' ? 'z' + w.slice(1) : w) + ' ', { delay: 5 });
    await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
    await page.getByText('How much effort did that take?').waitFor();
    await page.keyboard.press('2');
    await page.keyboard.press('e');
    await page.getByText('Kinds of slips').waitFor();
  });

  await closePage(page);
}
