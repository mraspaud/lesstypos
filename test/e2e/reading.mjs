// Texts and reading: adding texts (pasted, EPUB, text file), choosing,
// deleting and starting over, the place in the book, and home's way back in.
import assert from 'node:assert/strict';
import path from 'node:path';
import { step, freshPage, closePage, root, nav, startExercise, typeWords, finishWithEffort, rateEffort, seedExercises, seedText,
  storedText, removeTexts, discard, current } from './harness.mjs';

const rowOf = (page, title) => page.locator('tr', { hasText: title });
const firstWord = async (page) => (await page.locator('.w').first().textContent()).replace('¶', '');
const numbered = (n, prefix = 'w') => Array.from({ length: n }, (_, i) => prefix + i);
const SHORT = 'one two three four five six seven eight nine ten eleven twelve'.split(' ');
const TWENTY = SHORT.concat('thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' '));
const currentPos = (page) => page.evaluate(async () => { const a = window.FT.app; return (await a.store.getText(a.settings.currentText)).pos; });
// Reads n words of the book on view, then saves without a rating.
async function readAndSave(page, n) {
  await page.locator('.w').first().waitFor();
  await typeWords(page, n, 8);
  await finishWithEffort(page, 0);
}

export default async function reading() {
  const page = await freshPage();

  await step('a text can be added for prose', async () => {
    await nav(page, 'settings/texts');
    await page.fill('#ttitle', 'Test text');
    await page.fill('#tbody', Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? 'Don’t' : 'word' + i)).join(' '));
    await page.getByRole('button', { name: 'Add text' }).click();
    await rowOf(page, 'Test text').first().waitFor();
  });

  await step('in a text box, Esc leaves it and Ctrl+Enter submits it', async () => {
    await nav(page, 'settings/texts');
    await page.locator('#ttitle').fill('Ctrl Enter text');
    await page.locator('#tbody').fill('Some words for the prose exercise to read and type, long enough to pass the minimum of twenty words that a text needs before it is kept.');
    await page.locator('#tbody').press('Control+Enter');
    await rowOf(page, 'Ctrl Enter text').first().waitFor();
    await page.locator('#tbody').focus();
    await page.keyboard.press('Escape');
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'tbody');
    await page.keyboard.press('1');                            // shortcuts work again
    await page.locator('[data-go="home"][aria-current="page"]').waitFor();
  });

  await step('another text can be made current, and a text deleted after a second press', async () => {
    await nav(page, 'settings/texts');
    await rowOf(page, 'Ctrl Enter text').locator('.pill', { hasText: 'current' }).waitFor();   // the latest added is current
    await rowOf(page, 'Test text').getByRole('button', { name: 'Make current' }).click();
    await rowOf(page, 'Test text').locator('.pill', { hasText: 'current' }).waitFor();
    assert.equal(await page.evaluate(() => window.FT.app.settings.currentText), await page.evaluate(async () => (await window.FT.app.store.listTexts()).find((t) => t.title === 'Test text').id));
    await rowOf(page, 'Ctrl Enter text').getByRole('button', { name: 'Delete' }).click();
    await rowOf(page, 'Ctrl Enter text').getByRole('button', { name: /again to delete/ }).click();
    await rowOf(page, 'Ctrl Enter text').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(async () => (await window.FT.app.store.listTexts()).some((t) => t.title === 'Ctrl Enter text')), false);
  });

  await step('a text file can be added: its book is read, then saved', async () => {
    await nav(page, 'settings/texts');
    await page.locator('#tfile').setInputFiles(path.join(root, 'test', 'fixtures', 'books', 'snowdrop.txt'));
    await page.getByText(/^Read: /).waitFor();
    assert.notEqual(await page.locator('#ttitle').inputValue(), '');
    const title = await page.locator('#ttitle').inputValue();
    await page.locator('#tsave').click();
    await rowOf(page, title).first().waitFor();
  });

  await step('the last words of a text can be finished, and the place moves to the end', async () => {
    const text = { id: 'short', title: 'Short', words: SHORT, pos: 6 };
    await seedText(page, text);
    await startExercise(page, 'prose', { text: await storedText(page, 'short') });
    await page.keyboard.type('seven eight nine ten eleven twelve', { delay: 10 }); // no space after the last word
    await rateEffort(page, 2);
    await page.getByText(/Your place is saved/).waitFor();
    await page.waitForFunction(() => window.FT.app.store.getText('short').then((t) => t.pos === 12), null, { timeout: 3000 });
  });

  await step('a finished text offers to start over instead of an empty exercise', async () => {
    await seedText(page, { id: 'done', title: 'Done text', words: TWENTY, pos: 20 }, { current: false });
    await nav(page, 'settings/texts');
    await rowOf(page, 'Done text').getByRole('button', { name: /Start over/ }).click();
    await page.locator('.w').first().waitFor();
    assert.equal(await firstWord(page), 'one');
    await page.keyboard.press('Escape');
  });

  await step('a book from an EPUB: its stories appear, and you choose where to start', async () => {
    await nav(page, 'settings/texts');
    await page.locator('#tfile').setInputFiles(path.join(root, 'test', 'fixtures', 'books', 'snowdrop.epub'));
    await page.getByText(/2 chapters|chapters, starting at Snowdrop/).waitFor();
    await page.locator('#tsave').click();
    const start = rowOf(page, 'Snowdrop & Other Tales').locator('select[data-chapter]');
    await start.waitFor();
    assert.equal(await start.locator('option:checked').textContent(), 'Snowdrop');
    await start.selectOption({ label: 'The Pink' });
    await page.waitForFunction(() => window.FT.app.store.listTexts().then((l) => {
      const t = l.find((x) => x.title === 'Snowdrop & Other Tales');
      return t && t.pos === t.chapters.find((c) => c.title === 'The Pink').start;
    }));
    await rowOf(page, 'Snowdrop & Other Tales').getByRole('button', { name: /Type now/ }).click();
    await page.locator('.w').first().waitFor();
    assert.equal(await firstWord(page), 'There');
    assert.match(await page.locator('.ex-head').textContent(), /The Pink/);
    await page.keyboard.press('Escape');
  });

  await step('a long text added before chapters existed says how to get them', async () => {
    await seedText(page, { id: 'old-plain', title: 'Old plain book', words: Array.from({ length: 2500 }, (_, i) => 'word' + (i % 50)), addedAt: 1 }, { current: false });
    await nav(page, 'settings/texts');
    await rowOf(page, 'Old plain book').getByText(/add it again from its EPUB/).waitFor();
  });

  await step('prose runs on through the book without a gap, and the place saved is where typing stopped', async () => {
    await seedText(page, { id: 'long', title: 'Long', words: numbered(700), pos: 10 }, { current: false });
    await startExercise(page, 'prose', { text: await storedText(page, 'long'), free: true });
    const typed = [];
    for (let i = 0; i < 130; i++) {
      const [w] = await page.evaluate(() => [[...document.querySelectorAll('.w')].find((e) => !e.querySelector('.ok,.bad,.extra')).textContent]);
      typed.push(w);
      await page.keyboard.type(w + ' ', { delay: 4 });
    }
    assert.deepEqual(typed.slice(118, 123), ['w128', 'w129', 'w130', 'w131', 'w132']);
    await finishWithEffort(page, 0);
    await page.waitForFunction(() => window.FT.app.store.getText('long').then((t) => t.pos === 140));
    await page.evaluate(() => window.FT.app.store.deleteText('long'));
  });

  await step('with no texts, prose starts in Alice in Wonderland', async () => {
    await removeTexts(page);
    await nav(page, 'settings/texts');
    await rowOf(page, 'Alice').waitFor();
    await rowOf(page, 'Alice').getByRole('button', { name: /Type now/ }).click();
    await page.locator('.w').first().waitFor();
    assert.equal(await firstWord(page), 'Alice');
    assert.match(await page.locator('.ex-head').textContent(), /Down the Rabbit-Hole/);
    await discard(page);
  });

  await step('home continues the book with c, in free reading: no time limit, the clock counts up', async () => {
    await nav(page, 'home');
    await page.getByRole('button', { name: /Continue reading: Alice/ }).waitFor();   // once home knows the current book
    await page.keyboard.press('c');
    await page.locator('.w').first().waitFor();
    assert.equal(await page.locator('#timer').textContent(), '0:00');
    await page.keyboard.type(await firstWord(page), { delay: 20 });
    await page.waitForFunction(() => /^0:0[1-9]$/.test(document.getElementById('timer').textContent));
    await discard(page);
  });

  await step('reading from home continues exactly where the book was left, also after prose read another way', async () => {
    await nav(page, 'home');
    await page.getByRole('button', { name: /Continue reading/ }).waitFor();
    await page.keyboard.press('c');
    await readAndSave(page, 12);   // at least 10 words are saved
    await nav(page, 'settings/texts');
    await rowOf(page, 'current').getByRole('button', { name: /Type now/ }).click();
    await readAndSave(page, 13);
    await page.waitForFunction(() => window.FT.app.store.getDraft().then((d) => !d));   // saved
    const pos = await currentPos(page);
    const expected = await page.evaluate(async () => { const a = window.FT.app; const t = await a.store.getText(a.settings.currentText); return t.words[t.pos]; });
    await nav(page, 'home');
    await page.getByRole('button', { name: /Continue reading/ }).waitFor();
    await page.keyboard.press('c');
    await page.locator('.w').first().waitFor();
    assert.equal(await firstWord(page), expected, 'starts at word ' + pos);
    await discard(page);
  });

  await step('once today’s daily training is done, Enter on home continues reading; the training stays on a', async () => {
    await seedExercises(page, { run: 'run-today' });
    await nav(page, 'home');
    await page.getByRole('button', { name: /Daily training again/ }).waitFor();
    assert.match(await page.locator('#primary').textContent(), /Continue reading/);
    await page.keyboard.press('Enter');
    await page.locator('.w').first().waitFor();
    assert.equal(await page.locator('#timer').textContent(), '0:00');
    await discard(page);
  });

  await step('home goes back to the start of the chapter being read', async () => {
    await page.evaluate(async () => {
      const a = window.FT.app; const t = await a.store.getText('alice');
      t.pos = t.chapters[1].start + 40; await a.store.saveText(t); a.settings.currentText = 'alice';
    });
    await nav(page, 'home');
    const back = page.getByRole('button', { name: /Start of this chapter/ });
    await back.waitFor();
    await back.click();
    await page.locator('.w').first().waitFor();
    assert.equal(await firstWord(page), await page.evaluate(async () => { const t = await window.FT.app.store.getText('alice'); return t.words[t.chapters[1].start]; }));
    await discard(page);
  });

  await step('a book deleted since home was drawn is not brought back by continuing it', async () => {
    const t = await storedText(page, 'alice');
    t.pos = t.chapters[1].start + 40;
    const restore = () => page.evaluate((text) => window.FT.ui.app.store.saveText(text), t);
    try {
      for (const name of [/Start of this chapter/, /Continue reading/]) {
        await restore();
        await nav(page, 'settings/typing');
        await nav(page, 'home');
        await page.getByRole('button', { name }).waitFor();
        await page.evaluate(() => window.FT.ui.app.store.deleteText('alice'));
        await page.getByRole('button', { name }).click();
        await page.locator('#notice', { hasText: /no longer stored/ }).waitFor();
        assert.equal(await current(page), 'home');
        assert.ok(!(await storedText(page, 'alice')), String(name));
      }
    } finally { await restore(); }
  });

  await step('timed prose that runs out of time ends at the end of the sentence, not mid-sentence', async () => {
    await startExercise(page, 'prose', { text: { id: 'sentences', title: 'Sentences', words: 'One two. Three four five. Six seven eight.'.split(' '), pos: 0 }, minutes: 0.02 });
    await page.keyboard.type('One two. Three ', { delay: 30 });
    await page.getByText('Time is up: finish the sentence.').waitFor();   // the 1.2 s are up mid-sentence
    await page.keyboard.type('four ', { delay: 30 });
    assert.equal(await page.evaluate(() => window.FT.ui.app.current), 'typing');
    await page.keyboard.type('five. ', { delay: 30 });
    await page.locator('#notice', { hasText: /too short to analyse/ }).waitFor();   // five words: ended, and not saved
  });

  await step('any text can start over, after a second press', async () => {
    await page.evaluate(async () => { const a = window.FT.app; const t = await a.store.getText('alice'); t.pos = 500; await a.store.saveText(t); });
    await nav(page, 'settings/texts');
    await rowOf(page, 'Alice').getByRole('button', { name: 'Start over' }).click();
    assert.equal((await storedText(page, 'alice')).pos, 500);   // the first press only asks
    await rowOf(page, 'Alice').getByRole('button', { name: /again to start over/ }).click();
    await page.waitForFunction(async () => (await window.FT.app.store.getText('alice')).pos === 0);
    await rowOf(page, 'Alice').getByText(/word 0 of/).waitFor();   // the page shows it
  });

  await step('the chapter choice steps with the arrow keys and keeps the focus', async () => {
    await nav(page, 'settings/texts');
    const select = page.locator('select[data-chapter="alice"]');
    await select.waitFor();
    await select.focus();
    const before = +(await select.inputValue());
    const options = await select.locator('option').evaluateAll((os) => os.map((o) => +o.value));
    const twoOn = options[options.indexOf(before) + 2];
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction((p) => window.FT.app.store.getText('alice').then((t) => t.pos === p), twoOn);
    assert.equal(+(await page.locator('select[data-chapter="alice"]').inputValue()), twoOn);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.chapter), 'alice');
  });

  await closePage(page);
}
