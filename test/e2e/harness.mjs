// Shared harness of the end-to-end checks: one Chromium, a fresh page (with
// its own storage) per themed file, the steps' report, and the gestures most
// steps share: starting an exercise, typing it, rating its effort.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const url = 'file://' + path.join(root, 'index.html');
export const shots = process.env.SHOTS;
export const DESKTOP = { width: 1100, height: 800 };
export const PHONE = { width: 390, height: 800 };

let browser = null;
const errors = [];
const report = { passed: 0, failed: 0 };

export async function launch() { browser = await chromium.launch(); }
export async function close() { await browser.close(); }
export const scriptErrors = () => errors.slice();
export const results = () => Object.assign({}, report);

export async function step(name, fn) {
  try { await fn(); report.passed++; console.log('ok -', name); }
  catch (e) { report.failed++; console.log('not ok -', name); console.log(e); process.exitCode = 1; }
}

// ---------- pages ----------
const EFFORT_QUESTION = 'How much effort did that take?';
export const ready = (page) => page.waitForFunction(() => window.FT && window.FT.ui && window.FT.ui.app.trainer);

// A new page in its own browser context, so its storage starts empty.
// cards: whether instruction cards come before exercises (off, so steps type at once).
// The web fonts are answered empty, so no step waits on the network.
const WEB_FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
export async function freshPage({ viewport = DESKTOP, colorScheme = 'light', cards = false } = {}) {
  const context = await browser.newContext({ viewport, colorScheme });
  await context.route(WEB_FONTS, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await ready(page);
  await showCards(page, cards);
  return page;
}
export async function closePage(page) { await page.context().close(); }
export async function reload(page) { await page.reload(); await ready(page); }

export const nav = (page, route) => page.evaluate((r) => window.FT.ui.go(r), route);
export const showCards = (page, on) => page.evaluate(async (v) => { window.FT.ui.app.settings.showInstructions = v; await window.FT.ui.saveSettings(); }, on);
// Settings changed and saved as the settings page would.
export const saveSettings = (page, change) => page.evaluate(async (c) => { Object.assign(window.FT.ui.app.settings, c); await window.FT.ui.saveSettings(); }, change);
export const history = (page) => page.evaluate(() => window.FT.ui.app.trainer.history());
export const historyLength = (page) => page.evaluate(() => window.FT.ui.app.trainer.history().length);
export const current = (page) => page.evaluate(() => window.FT.ui.app.current);
export const activeId = (page) => page.evaluate(() => document.activeElement.id);
export const exportBackup = (page) => page.evaluate(() => window.FT.ui.app.store.exportAll().then((d) => JSON.parse(JSON.stringify(d))));
export async function importBackup(page, backup, mode = 'replace') {
  await page.evaluate(async ([d, m]) => { await window.FT.ui.app.store.importAll(d, { mode: m }); await window.FT.ui.reloadFromStore(m === 'merge'); }, [backup, mode]);
}

// ---------- the daily training ----------
// After a daily training today, home offers reading first and the training
// second; steps about the training start it with whichever is shown.
export const START_TRAINING = /Start (daily training|over)|Daily training again/;
const steps = (types, minutes = 0.1) => types.map((type) => ({ type, minutes, enabled: true }));
export async function setProgramme(page, types, minutes) {
  await saveSettings(page, { programme: { name: 'test', steps: steps(types, minutes) }, programmeRun: null });
  await page.evaluate(() => { window.FT.ui.app.run = null; });
}
// Runs fn with a daily-training definition (step objects), restoring the
// default afterwards even when fn fails.
export async function withProgramme(page, stepList, fn) {
  const reset = (st) => { const a = window.FT.ui.app; a.settings.programme = st && { name: 'test', steps: st }; a.settings.programmeRun = null; a.run = null; };
  await page.evaluate(reset, stepList);
  try { await fn(); } finally { await page.evaluate(reset, null); }
}
export async function startTraining(page) {
  await nav(page, 'home');
  await page.getByRole('button', { name: START_TRAINING }).first().click();
}
// The training summary opens in its tags box: Escape leaves it unsaved, then Enter is Done.
export async function leaveTrainingSummary(page) { await page.keyboard.press('Escape'); await page.keyboard.press('Enter'); }

// ---------- exercises ----------
export async function startExercise(page, type, opts = {}) {
  await page.evaluate(([t, o]) => window.FT.ui.startExercise(t, o), [type, opts]);
  await page.locator('.w').first().waitFor();
}
export const untypedWords = (page, n) => page.evaluate((count) =>
  [...document.querySelectorAll('.w')].filter((e) => !e.querySelector('.ok,.bad,.extra')).slice(0, count).map((e) => e.textContent), n);
// Quotes typed as on a plain keyboard; the paragraph mark is typed as a space.
const asTyped = (w) => w.replace('¶', '').replace(/[‘’]/g, "'");
// Types the next n untyped words, each with a space.
export async function typeWords(page, n, delay = 5) {
  const words = await untypedWords(page, n);
  await page.keyboard.type(words.map(asTyped).join(' ') + ' ', { delay });
}
export async function typeNextWord(page, delay = 8) {
  const [w] = await untypedWords(page, 1);
  if (w == null) return false;
  await page.keyboard.type(asTyped(w) + ' ', { delay });
  return true;
}
export const typedCount = (page) => page.evaluate(() => document.querySelectorAll('.w .l.ok, .w .l.bad').length);

// After the timer or the text ends an exercise, keys are ignored for a moment.
export const effortReady = (page) => page.waitForFunction(() => Date.now() >= (window.FT.ui.app.effortGuardUntil || 0));
export const effortQuestion = (page) => page.getByText(EFFORT_QUESTION);
// Types the next words until the effort question appears and takes keys.
export async function typeUntilEffort(page, limitMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if (await effortQuestion(page).isVisible()) { await effortReady(page); return; }
    if (!(await typeNextWord(page))) await page.waitForFunction(() => window.FT.ui.app.current !== 'typing' || [...document.querySelectorAll('.w')].some((e) => !e.querySelector('.ok,.bad,.extra')));
  }
  throw new Error('exercise did not end');
}
// Answers the effort question once it takes keys ('0' skips).
export async function rateEffort(page, rating) {
  await effortQuestion(page).waitFor();
  await effortReady(page);
  await page.keyboard.press(String(rating));
}
// Pauses, saves, and answers the effort question.
export async function finishWithEffort(page, rating = 2) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Finish and save/ }).waitFor();
  await page.keyboard.press('Enter');
  await rateEffort(page, rating);
}
// A short relaxed exercise, typed, saved and rated; ends on its summary.
export async function practise(page, { words = 14, rating = 2 } = {}) {
  await startExercise(page, 'relaxed', { minutes: 1 });
  await typeWords(page, words);
  await finishWithEffort(page, rating);
  await page.getByText(/finished/).waitFor();
}
// Pauses the exercise on view and discards it.
export async function discard(page) { await page.keyboard.press('Escape'); await page.keyboard.press('Delete'); }

// ---------- stored state ----------
// Exercises typed and saved in the page as the typing screen would, without
// the keyboard: words typed at an uneven pace with a few corrected slips.
// opts: { count, type, words, slips (share of letters), slipsAfter (pairs whose
// second letter slips half the time: weak sequences), effort, run, tags,
// set (a benchmark set), seed }.
export async function seedExercises(page, opts = {}) {
  const o = Object.assign({ count: 1, type: 'relaxed', words: 60, slips: 0.04, slipsAfter: [], effort: 2, run: null, tags: null, set: null, seed: 1 }, opts);
  await page.evaluate(async (o) => {
    const FT = window.FT, U = FT.ui, app = FT.ui.app, rng = FT.rng(o.seed);
    const before = (await app.store.listSessions()).length;
    for (let i = 0; i < o.count; i++) {
      const ex = app.trainer.newExercise({ type: o.type, run: o.run });
      const session = FT.session.create(ex.words.slice(0, o.words), { equivalence: U.equivalence(), macros: U.macros() });
      let t = 1000;
      const press = (data) => session.input({ kind: 'text', data, t: (t += 90 + rng() * 120) });
      for (const w of session.state().words.slice()) {
        Array.from(w.target).forEach((ch, i) => {
          const weak = i > 0 && o.slipsAfter.includes(w.target[i - 1] + ch);
          if (rng() < (weak ? 0.5 : o.slips)) { press(ch === 'z' ? 'x' : 'z'); session.input({ kind: 'back', t: (t += 150) }); }
          press(ch);
        });
        press(' ');
      }
      const typed = { type: o.type, startedAt: Date.now() - (o.count - i) * 60e3, words: session.state().words.filter((w) => w.committed), keys: [],
        firstKeyAt: 1000, pauses: [], opts: { run: o.run }, text: null, rounds: null, textFinished: false };
      const info = U.recordExercise(typed);
      if (o.tags) info.raw.tags = o.tags;
      if (o.set) info.raw.set = o.set;
      info.effort = o.effort;
      U.saveExercise(info);
    }
    await new Promise((resolve) => {
      const saved = () => app.store.listSessions().then((l) => (l.length >= before + o.count ? resolve() : setTimeout(saved, 20)));
      saved();
    });
  }, o);
}
// A text for prose, stored (and made the current one unless current: false).
export async function seedText(page, text, { current = true } = {}) {
  await page.evaluate(async ([t, c]) => {
    const app = window.FT.ui.app;
    await app.store.saveText(Object.assign({ addedAt: Date.now(), pos: 0 }, t));
    if (c) { app.settings.currentText = t.id; await window.FT.ui.saveSettings(); }
  }, [text, current]);
}
export const storedText = (page, id) => page.evaluate((i) => window.FT.ui.app.store.getText(i), id);
export async function removeTexts(page) {
  await page.evaluate(async () => {
    for (const t of await window.FT.ui.app.store.listTexts()) await window.FT.ui.app.store.deleteText(t.id);
    window.FT.ui.app.settings.currentText = null;
  });
}
// A layout with multi-letter keys (th, qu), as typed in Settings: Keyboard.
export const THORNIUM = 'z b w h g " : . / j x @\n( s c n t k , a e i m )\n[ f p l d v = u o y th ]\nqu r space \'\n' +
  '0 0 1 2 3 3 6 6 7 8 9 9\n0 0 1 2 3 3 6 6 7 8 9 9\n0 0 1 2 3 3 6 6 7 8 9 9\n4 4 5 5';
// Shorter burst rounds and benchmark trials (0 keeps the real lengths).
export const testTimings = (page, t) => page.evaluate((x) => Object.assign(window.FT.ui.testing, x), t);
export const realTimings = (page) => testTimings(page, { burstRoundMs: 0, burstRestMs: 0, benchmarkMinutes: 0 });
