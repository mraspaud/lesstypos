# LessTypos

An adaptive typing trainer for experienced touch typists. It aims for **effortless** speed rather than maximum speed.

LessTypos records every keystroke and finds the letter sequences that cost you errors or hesitation, including sequences that cross word boundaries. It then weaves those sequences into ordinary words in later exercises. Vocabulary grows only while first-attempt accuracy stays high and typing feels comfortable. There is no speed requirement.

It is a static web app with no server and no account. Open `index.html` directly in a browser. Data stays in the browser's IndexedDB, and you can export it at any time.

## Status

This is the first milestone: relaxed adaptive practice, targeted practice for a single sequence, and analysis pages for sequences, substitutions, history and data. A daily programme (warm-up, speed bursts, prose from pasted text, targeted practice) comes next. See `docs/plan.md`.

## How the analysis works

Methods follow published work where it exists. Our own choices are marked "design choice" in the code comments.

| What | Method | Where |
|---|---|---|
| Error classification (corrected and uncorrected substitutions, insertions, omissions) | Input-stream analysis, Wobbrock & Myers (2006); ambiguous alignments weighted 1/N, MacKenzie & Soukoreff (2002) | `js/align.js` |
| Error rates, KSPC | Soukoreff & MacKenzie (2003) | `js/metrics.js` |
| Timing cleaning | IKI > 5 s treated as a pause (Dhakal et al. 2018); only correct keystrokes that follow correct ones are timed (Behmer & Crump 2017); outlier trimming per Van Selst & Jolicoeur (1994); word-initial keystrokes kept as a separate population (Salthouse 1986; Logan & Crump 2011) | `js/timing.js` |
| Weak sequences | Contexts of 1–4 characters, each judged against its shorter suffix (n-gram backoff). Empirical-Bayes beta-binomial for errors and a normal model for log-time ratio. A context is flagged only when it is credibly worse than its parent (P > 0.95) and the difference is large enough to matter | `js/model.js` |
| Consolidation | weak → improving → consolidating (intervals growing in sessions) → mastered, with retention checks; in the spirit of spaced repetition | `js/model.js` |
| Difficulty | Continuous vocabulary frontier. A dead-band controller on first-attempt accuracy (98.5–99.5%), held back when hesitation, rhythm or perceived effort are worse than usual | `js/difficulty.js` |
| Unbiased sample | About 20% of words are random picks drawn from their own random-number stream, so targeted practice never influences them | `js/generator.js` |

## Development

```bash
npm test          # unit tests (node:test, no dependencies)
npm run e2e       # end-to-end in Chromium via Playwright, against file://index.html
node tools/bundle.mjs dist/lesstypos.html   # optional single-file build
```

The browser code is plain classic scripts (`js/*.js`) that share a `window.FT` namespace. ES modules and `fetch()` are avoided, so `index.html` also works when opened from local disk. The tests load the same scripts, in `index.html` order, into a `vm` context.

## Licences

The code is Apache-2.0. `data/en.words.js` is generated from [wordfreq](https://github.com/rspeer/wordfreq) and is CC-BY-SA 4.0 (regenerate with `tools/make_wordlist.py`).
