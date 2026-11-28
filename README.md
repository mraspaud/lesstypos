# LessTypos

An adaptive typing trainer for experienced touch typists. It aims for **effortless** speed rather than maximum speed.

LessTypos records every keystroke and finds the letter sequences that cost you errors or hesitation, including sequences that cross word boundaries. It then weaves those sequences into ordinary words in later exercises. Vocabulary grows only while less common words cost at most twice the errors of your 100 most common words, or fewer than 0.5% errors, and typing feels comfortable. There is no speed requirement.

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
| Difficulty | Continuous vocabulary frontier, a staircase with a dead band (Levitt 1971), on relaxed practice's unbiased words only (never the target carriers). The first-attempt error rate on the less common words (rank 100 and beyond), pooled across exercises (at least 300 words), is compared with the typist's own error rate on the 100 most common words of the same exercises (reaching further back when those hold fewer than 500, as at a large vocabulary), each with a beta posterior and a uniform prior (Gelman et al. 2013). It advances when the less common words credibly (P > 0.9) have at most 2× the errors or under 0.5% errors, retreats when they credibly have more than 3×, and otherwise holds (user decisions: the ratio band, and under 0.5% errors growing whatever the ratio; design choices: the 3× bound, the pool sizes (up to 2,000 less common words, so that exactly 1.7× the errors grows on evidence) and how evidence carries over a step). Each exercise tests the pool again, so a typist exactly on a bound steps across it far more often than a single test would (about 4 in 10 within 20 exercises). An advance is held back when hesitation, rhythm or perceived effort are worse than usual. Never below the 200 most common words. Fixing or releasing the vocabulary is stored with the raw exercises, so a rebuild replays it in order | `js/difficulty.js` |
| Fluency index (experimental, design choice) | The relaxed speed the sequence statistics predict on a frozen 1,000-word text: keystroke-level prediction (Card, Moran & Newell 1980) with each keystroke timed from its longest well-observed context (Gentner 1983; Salthouse 1986), on the arithmetic mean of what is left of each clean interval once its context's ratio is taken out, each error charged its measured cost: the time around the mistake beyond the clean pace (Salthouse 1986; post-error slowing, Kalfaoğlu & Stafford 2014; Dhakal et al. 2018), pooled over the errors, and each keystroke its share of the pauses over 5 s, which measured speed includes. A declared multi-letter key is one press. Scaled by recent relaxed practice (A) or by practice rated effort 1–2 only (B). Not validated: each benchmark is compared with the prediction made before it. Beside it, measured: flow speed and the share of time that pauses over 5 s and corrections take | `js/fluency.js`, `js/progress.js` |
| Slips (Errors page) | Substitutions per press of the intended key (a declared multi-letter key such as th is a key of its own, so a th press is not a t opportunity), shrunk toward a base rate per pair. Letters typed early, which occur later in the word, are sequencing errors (premature, a post-hoc tag) and are counted apart from finger confusions. A pair is confirmed like a sequence: credibly above the base rate (P > 0.95 under its beta posterior; Efron & Morris 1975) by enough to matter (at least 0.5 points and 1.25×, the design choices that flag a sequence), and seen in 2 separate sessions (user decision). Swapped letters are their own class (Salthouse 1986) | `js/subs.js` |
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
