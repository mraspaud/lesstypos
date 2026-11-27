// The typing screen: letters, the caret and lines, corrections, multi-letter
// keys, paragraphs, the instruction card, and what is recorded.
import assert from 'node:assert/strict';
import { step, freshPage, closePage, shots, PHONE, DESKTOP, nav, saveSettings, showCards, startExercise, typeWords, untypedWords,
  typedCount, finishWithEffort, discard } from './harness.mjs';

const wrongFirstLetter = (w) => (w[0] === 'z' ? 'y' : 'z') + w.slice(1);
// The last typed copies of these words have no wrong letters.
const lastTypedAreClean = (page, words) => page.evaluate((t) => [...document.querySelectorAll('.w')]
  .filter((e) => t.includes(e.textContent) && e.querySelector('.ok')).slice(-t.length).every((e) => !e.querySelector('.bad')), words);

export default async function typing() {
  const page = await freshPage();

  await step('typing an exercise with a corrected error, stopping and rating effort', async () => {
    await nav(page, 'home');
    await page.getByRole('button', { name: /Relaxed practice only/ }).click();
    await page.locator('.w').first().waitFor();
    const words = await page.$$eval('.w', (els) => els.slice(0, 60).map((e) => e.textContent));
    for (let i = 0; i < 40; i++) {
      if (i === 3) { await page.keyboard.type('x', { delay: 20 }); await page.keyboard.press('Backspace'); }
      await page.keyboard.type(words[i] + ' ', { delay: 15 });
    }
    if (shots) await page.screenshot({ path: shots + '/typing.png' });
    assert.ok(await page.$eval('#caret', (c) => c.getBoundingClientRect().height > 0));
    // the caret sits at the next letter to type: probe inside a word of at
    // least three letters, so the next letter is in the same word
    let probe = 40;
    while (words[probe].length < 3) { await page.keyboard.type(words[probe] + ' ', { delay: 15 }); probe++; }
    await page.keyboard.type(words[probe].slice(0, 2), { delay: 20 });
    const caretGap = () => {
      const c = document.getElementById('caret').getBoundingClientRect();
      const next = document.querySelector('.w .l:not(.ok):not(.bad):not(.extra)').getBoundingClientRect();
      return { dx: Math.abs(c.left - next.left), dy: Math.abs((c.top + c.bottom) / 2 - (next.top + next.bottom) / 2) };
    };
    const caretAtNext = (gap) => gap.dx < 3 && gap.dy < 6;
    // the caret glides to its place
    await page.waitForFunction(([measure, near]) => eval(near)(eval(measure)()), [caretGap.toString(), caretAtNext.toString()], { timeout: 2000 }).catch(() => {});
    const gap = await page.evaluate((measure) => eval(measure)(), caretGap.toString());
    assert.ok(caretAtNext(gap), 'caret off by ' + JSON.stringify(gap));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Finish and save/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.getByText('How much effort did that take?').waitFor();
    await page.getByText('No effort', { exact: true }).waitFor();          // labelled end points of the scale
    await page.getByText('Maximum effort', { exact: true }).waitFor();
    await page.keyboard.press('2');
    await page.getByText(/finished/).waitFor();
    const tiles = await page.$$eval('.tile b', (b) => b.map((x) => x.textContent));
    assert.ok(+tiles[0] > 0, 'wpm ' + tiles[0]);
    assert.ok(/9\d\.\d%|100\.0%/.test(tiles[1]), 'accuracy ' + tiles[1]);
    // the decision comes first; the speed chart is under Details (d), drawn on opening
    assert.equal(await page.locator('#details').getAttribute('open'), null);
    await page.keyboard.press('d');
    await page.locator('#chart svg path.run').waitFor();
    await page.locator('#chart svg').scrollIntoViewIfNeeded();
    const box = await page.locator('#chart svg').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('#chart .tip:not([hidden])').waitFor();
    if (shots) await page.screenshot({ path: shots + '/summary.png', fullPage: true });
  });

  await step('Enter on a summary practises again', async () => {
    await page.keyboard.press('Enter');
    await page.locator('.w').first().waitFor();
    assert.equal(await typedCount(page), 0);
    await page.keyboard.press('Escape');                       // nothing typed: leaves
  });

  await step('the current line stays in the middle while typing many lines', async () => {
    await startExercise(page, 'relaxed', { minutes: 5 });
    const words = await untypedWords(page, 110);
    const lines = [];
    for (const w of words) {
      await page.keyboard.type(w + ' ', { delay: 2 });
      lines.push(await page.evaluate(() => {
        const c = document.getElementById('caret').getBoundingClientRect(), w = document.getElementById('window').getBoundingClientRect();
        return Math.floor((c.top + c.height / 2 - w.top) / (w.height / 3));
      }));
    }
    const first = lines.indexOf(1);
    assert.ok(first > 0 && lines.slice(first).every((l) => l === 1), lines.join(''));
    await discard(page);
  });

  await step('backspace corrects the previous word when it has an error', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    const [w] = await untypedWords(page, 1);
    await page.keyboard.type(wrongFirstLetter(w) + ' ', { delay: 10 });
    for (let i = 0; i < w.length + 1; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type(w + ' ', { delay: 10 });
    assert.ok(await lastTypedAreClean(page, [w]));
    await discard(page);
  });

  await step('backspace reaches a mistake behind a correctly typed word', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    const w = await untypedWords(page, 2);
    await page.keyboard.type(wrongFirstLetter(w[0]) + ' ' + w[1] + ' ', { delay: 10 });
    for (let i = 0; i < w[0].length + w[1].length + 2; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type(w.join(' ') + ' ', { delay: 10 });
    assert.ok(await lastTypedAreClean(page, w));
    await discard(page);
  });

  await step('backspace reaches back through two wrong words', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    const w = await untypedWords(page, 2);
    await page.keyboard.type(w.map(wrongFirstLetter).join(' ') + ' ', { delay: 10 });
    for (let i = 0; i < w[0].length + w[1].length + 2; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type(w.join(' ') + ' ', { delay: 10 });
    assert.ok(await lastTypedAreClean(page, w));
    await discard(page);
  });

  await step('backspace with no recent mistake explains why nothing happens', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 6, 10);
    await page.keyboard.press('Backspace');
    await page.getByText(/Nothing to fix nearby/).waitFor({ timeout: 2000 });
    await discard(page);
  });

  await step('Ctrl+Backspace clears the word being typed', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    const [w] = await untypedWords(page, 1);
    await page.keyboard.type(w.slice(0, 1) + 'zq', { delay: 10 });
    assert.equal(await typedCount(page), Math.min(3, w.length));
    await page.keyboard.press('Control+Backspace');
    assert.equal(await typedCount(page), 0);
    await page.keyboard.type(w + ' ', { delay: 10 });
    assert.ok(await lastTypedAreClean(page, [w]));
    await discard(page);
  });

  await step('a space before the end of a word stays in it as a red letter; Backspace fixes it', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    const first = page.locator('.w').first();
    const word = await first.textContent();
    await page.keyboard.type(word.slice(0, -1) + ' ', { delay: 20 });
    assert.equal(await first.locator('.l.bad').count(), 1);
    assert.equal(await page.locator('.w').nth(1).locator('.l.ok, .l.bad').count(), 0);   // still in the first word
    await page.keyboard.press('Backspace');
    await page.keyboard.type(word.slice(-1) + ' ', { delay: 20 });
    assert.equal(await first.locator('.l.bad').count(), 0);
    await discard(page);
  });

  await step('a space after a left-out letter ends the word; the next word is typed clean', async () => {
    const text = { id: 'omission', title: 'Omission', words: ['also', 'this', 'more', 'words', 'here'], pos: 0 };
    await startExercise(page, 'prose', { text });
    await page.keyboard.type('aso this ', { delay: 20 });
    assert.equal(await page.locator('.w').nth(0).locator('.l.ok').count(), 1);    // a
    assert.equal(await page.locator('.w').nth(0).locator('.l.bad').count(), 3);   // l s o: where they were due, the left-out l onward
    assert.equal(await page.locator('.w').nth(1).locator('.l.bad').count(), 0);
    assert.equal(await page.locator('.w').nth(1).locator('.l.ok').count(), 4);
    await discard(page);
  });

  await step('in stop mode a wrong letter holds the typing until it is corrected', async () => {
    await saveSettings(page, { errorMode: 'stop' });
    try {
      await startExercise(page, 'relaxed', { minutes: 1 });
      const [w] = await untypedWords(page, 1);
      await page.keyboard.type(wrongFirstLetter(w) + ' ', { delay: 10 });   // the rest of the word is not taken
      assert.equal(await typedCount(page), 1);
      assert.equal(await page.locator('.w').first().locator('.l.bad').count(), 1);
      await page.keyboard.press('Backspace');
      await page.keyboard.type(w + ' ', { delay: 10 });
      assert.ok(await lastTypedAreClean(page, [w]));
      await discard(page);
    } finally { await saveSettings(page, { errorMode: 'continue' }); }
  });

  await step('a wrong multi-letter press shows as one mark, and the rest of the word still matches', async () => {
    await saveSettings(page, { macros: ['th'] });
    await startExercise(page, 'prose', { text: { id: 'presses', title: 'Presses', pos: 0, words: ['you', 'the', 'cat', 'and', 'more', 'words', 'here'] } });
    const word = (i) => page.locator('.w').nth(i);
    await page.keyboard.insertText('th');                 // the th key, where y was meant
    await page.keyboard.type('ou ', { delay: 20 });
    assert.equal(await word(0).locator('.press-bad').count(), 1);
    assert.equal(await word(0).locator('.press-bad').textContent(), 'y');
    assert.equal(await word(0).locator('.l.ok').count(), 2);  // o and u match
    await page.keyboard.type('xe ', { delay: 20 });       // one key where the th key was meant
    assert.equal(await word(1).locator('.press-bad').count(), 1);
    assert.equal(await word(1).locator('.press-bad').textContent(), 'th');
    await page.keyboard.type('cbt ', { delay: 20 });      // an ordinary wrong letter keeps its own mark
    assert.equal(await word(2).locator('.press-bad').count(), 0);
    assert.equal(await word(2).locator('.l.bad').count(), 1);
    if (shots) await page.screenshot({ path: shots + '/press-marks.png' });
    await discard(page);
    await saveSettings(page, { macros: [] });
  });

  await step('a paragraph ends with Enter: the next one starts on a new line, and a space there is marked', async () => {
    await startExercise(page, 'prose', { text: { id: 'paras', title: 'Paragraphs', words: ['One', 'two.', 'Three', 'four.', 'Five', 'six.'], breaks: [1, 3], pos: 0 } });
    const top = (i) => page.locator('.w').nth(i).evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(await top(2) > await top(1), 'Three starts a new line');
    assert.equal(await page.locator('.w').nth(1).locator('.sep').textContent(), '¶');
    await page.keyboard.type('One two.', { delay: 30 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('Three four. ', { delay: 30 });     // a space where Enter was due
    assert.equal(await page.locator('.w').nth(1).locator('.sep.ok').count(), 1);
    assert.equal(await page.locator('.w').nth(3).locator('.sep.bad').count(), 1);
    assert.equal(await page.evaluate(() => window.FT.ui.app.current), 'typing');
    await discard(page);
  });

  await step('Enter where a space was due ends the word with a red space mark', async () => {
    await startExercise(page, 'prose', { text: { id: 'paras', title: 'Paragraphs', words: ['One', 'two.', 'Three', 'four.', 'Five', 'six.'], breaks: [1, 3], pos: 0 } });
    await page.keyboard.type('One', { delay: 30 });
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.w').nth(0).locator('.sep.bad').textContent(), '␣');
    await page.keyboard.type('two.', { delay: 30 });
    assert.equal(await page.locator('.w').nth(1).locator('.l.ok').count(), 4);
    await discard(page);
  });

  await step('in stop mode the wrong separator is refused', async () => {
    await saveSettings(page, { errorMode: 'stop' });
    try {
      await startExercise(page, 'prose', { text: { id: 'paras', title: 'Paragraphs', words: ['One', 'two.', 'Three', 'four.', 'Five', 'six.'], breaks: [1, 3], pos: 0 } });
      await page.keyboard.type('One', { delay: 30 });
      await page.keyboard.press('Enter');                        // a space was due
      await page.keyboard.type(' two. ', { delay: 30 });          // Enter is due after two.
      await page.keyboard.press('Enter');
      const shown = await page.$$eval('.w', (els) => els.slice(0, 2).map((e) => e.querySelectorAll('.bad').length));
      assert.deepEqual(shown, [0, 0]);
      assert.equal(await page.locator('.w').nth(2).locator('.l.ok, .l.bad').count(), 0);
      await page.keyboard.type('Three', { delay: 30 });
      assert.equal(await page.locator('.w').nth(2).locator('.l.ok').count(), 5);
      await discard(page);
    } finally { await saveSettings(page, { errorMode: 'continue' }); }
  });

  await step('the first key of an exercise is recorded', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    await typeWords(page, 14);
    await finishWithEffort(page, 0);
    await page.getByText(/finished/).waitFor();
    const first = await page.evaluate(() => window.FT.ui.app.store.listSessions().then((l) => l[l.length - 1].keys[0]));
    assert.equal(first.k, 'd');
  });

  // ---------- the instruction card ----------
  await step('an instruction card comes before the exercise; Enter starts, letters before it do nothing', async () => {
    await showCards(page, true);
    try {
      await page.evaluate(() => window.FT.ui.startExercise('bursts', { minutes: 1 }));
      const card = page.locator('#briefing');
      await card.waitFor();
      assert.match(await card.textContent(), /95%/);
      assert.equal(await page.locator('#capture').getAttribute('aria-describedby'), 'briefing');   // read out to screen readers
      await page.keyboard.type('abc');
      assert.equal(await typedCount(page), 0);
      assert.ok(await card.isVisible());
      await page.keyboard.press('Enter');
      assert.equal(await card.isVisible(), false);
      assert.equal(await page.locator('#capture').getAttribute('aria-describedby'), null);
      await typeWords(page, 1);
      assert.ok(await typedCount(page) > 0);
      await discard(page);
    } finally { await showCards(page, false); }
  });

  await step('with instruction cards off, an exercise starts at once', async () => {
    await startExercise(page, 'relaxed', { minutes: 1 });
    assert.equal(await page.locator('#briefing').count(), 0);
    await page.keyboard.press('Escape');
  });

  await step('after a click on the instruction card, one Enter starts', async () => {
    await showCards(page, true);
    try {
      await page.evaluate(() => window.FT.ui.startExercise('relaxed', { minutes: 1 }));
      await page.locator('#briefing').click();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#briefing').count(), 0);
      await page.keyboard.press('Escape');
    } finally { await showCards(page, false); }
  });

  await step('the instruction card is shown in full, heading to keys, on desktop and phone', async () => {
    await showCards(page, true);
    const shownInFull = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s), r = el.getBoundingClientRect();
      return [[r.left + 2, r.top + 2], [r.right - 2, r.bottom - 2]].every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
    }, sel);
    try {
      for (const viewport of [DESKTOP, PHONE]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => window.FT.ui.startExercise('bursts', { minutes: 3 }));
        await page.locator('#briefing').waitFor();
        assert.ok(await shownInFull('#briefing h2'), 'heading at ' + viewport.width);
        assert.ok(await shownInFull('#briefing p:last-child'), 'keys at ' + viewport.width);
        await page.keyboard.press('Escape');
      }
    } finally {
      await page.setViewportSize(DESKTOP);
      await showCards(page, false);
    }
  });

  await closePage(page);
}
