# LessTypos

An adaptive typing trainer for experienced touch typists. It aims for **effortless** speed rather than maximum speed.

LessTypos records every keystroke and finds the letter sequences that cost you errors or hesitation, including sequences that cross word boundaries. It then weaves those sequences into ordinary words in later exercises. Vocabulary grows only while first-attempt accuracy stays high and typing feels comfortable. There is no speed requirement.

It is a static web app with no server and no account. Open `index.html` directly in a browser. Data stays in the browser's IndexedDB, and you can export it at any time.

## Status

In daily use. One keypress starts a daily training: warm-up, relaxed practice, speed bursts with an adaptive target, prose from a book (an EPUB or a Project Gutenberg text, by chapter; *Alice's Adventures in Wonderland* comes with the app) and targeted practice. A benchmark (3 × 1 min) measures progress on a fixed kind of text. The Insights pages show the focus list, errors (including a keyboard heatmap) and progress over time. See `docs/plan.md`.

## How the analysis works

Methods follow published work where it exists. Our own choices are marked "design choice" in the code comments.

| What | Method | Where |
|---|---|---|
| Error classification (corrected and uncorrected substitutions, insertions, omissions) | Input-stream analysis, Wobbrock & Myers (2006); ambiguous alignments weighted 1/N, MacKenzie & Soukoreff (2002) | `js/align.js` |
| Error rates, KSPC | Soukoreff & MacKenzie (2003) | `js/metrics.js` |
| Timing cleaning | IKI > 5 s treated as a pause (Dhakal et al. 2018); only correct keystrokes that follow correct ones are timed (Behmer & Crump 2017); outlier trimming per Van Selst & Jolicoeur (1994); word-initial keystrokes kept as a separate population (Salthouse 1986; Logan & Crump 2011) | `js/timing.js` |
| Weak sequences | Contexts of 1–4 characters, each judged against its shorter suffix (n-gram backoff). Empirical-Bayes beta-binomial for errors and a normal model for log-time ratio. A context is flagged only when it is credibly worse than its parent (P > 0.95) and the difference is large enough to matter | `js/judgement.js` (evidence in `js/evidence.js`) |
| Consolidation | weak → improving → consolidating (intervals growing in sessions) → mastered, with retention checks; in the spirit of spaced repetition | `js/stages.js` |
| Difficulty | Continuous vocabulary frontier. A dead-band controller on first-attempt accuracy (98.5–99.5%), held back when hesitation, rhythm or perceived effort are worse than usual | `js/difficulty.js` |
| Fluency index (experimental, design choice) | The relaxed speed the sequence statistics predict on a frozen 1,000-word text: keystroke-level prediction (Card, Moran & Newell 1980) with each keystroke timed from its longest well-observed context (Gentner 1983; Salthouse 1986), on the arithmetic mean of what is left of each clean interval once its context's ratio is taken out, each error charged its measured cost: the time around the mistake beyond the clean pace (Salthouse 1986; post-error slowing, Kalfaoğlu & Stafford 2014; Dhakal et al. 2018), pooled over the errors, and each keystroke its share of the pauses over 5 s, which measured speed includes. A declared multi-letter key is one press. Scaled by recent relaxed practice (A) or by practice rated effort 1–2 only (B). Not validated: each benchmark is compared with the prediction made before it. Beside it, measured: flow speed and the share of time that pauses over 5 s and corrections take | `js/fluency.js`, `js/progress.js` |
| Unbiased sample | About 20% of words are random picks drawn from their own random-number stream, so targeted practice never influences them | `js/generator.js` |

## Development

```bash
npm test          # unit tests (node:test, no dependencies)
npm run e2e       # end-to-end in Chromium via Playwright, against file://index.html
node tools/bundle.mjs dist/lesstypos.html   # optional single-file build
```

The browser code is plain classic scripts that share a `window.FT` namespace: the domain logic in `js/*.js` (testable in Node), and the views in `js/ui/*.js`, which register on `FT.ui`. ES modules and `fetch()` are avoided, so `index.html` also works when opened from local disk. The tests load the same scripts, in `index.html` order, into a `vm` context.

## Licences

The code is Apache-2.0. `data/en.words.js` is generated from [wordfreq](https://github.com/rspeer/wordfreq) and is CC-BY-SA 4.0 (regenerate with `tools/make_wordlist.py`). `data/alice.js` holds Lewis Carroll's *Alice's Adventures in Wonderland* (1865), which is in the public domain; it is extracted from a Project Gutenberg EPUB with `tools/make_book.js`, keeping only the title, author, chapter titles and words.
