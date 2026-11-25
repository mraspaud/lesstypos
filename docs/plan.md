# LessTypos: adaptive typing fluency trainer, static files

## Context
The spec describes a typing trainer for experienced touch typists. Its goal is effortless speed, not peak speed. The user wants:
- A browser app with no server, using browser storage.
- Several files are fine, as long as opening `index.html` from local disk works.
- Also renderable as a claude.ai Artifact before any repo exists.

This is a greenfield build. The user asked that methods be grounded in existing research rather than invented; sources are cited inline. Where something is our own synthesis, it is labelled **[design choice]**.

## Constraints and feasibility
- **Bundled content.** Project Gutenberg and most text sites send no CORS headers, and Artifacts restrict network hosts. So:
  - Word lists and one or two public-domain books ship as files.
  - The user can import a `.txt`/`.epub` by file picker, paste or drag-and-drop.
- **Storage.**
  - IndexedDB holds keystroke events and sequence statistics; localStorage holds settings. Every storage call is wrapped in try/catch.
  - JSON export/import exists from day one as the real backup.
  - An Artifact's origin survives republishes to the same URL.
- **File layout that works from `file://`.**
  - Chrome blocks `type="module"` scripts and `fetch()` over `file://`, but classic `<script src>` tags work.
  - So: `index.html` + `css/app.css` + classic `js/*.js` scripts sharing `window.FT`.
  - Data ships as JS files that assign globals, e.g. `data/en.words.js` sets `FT.data.en = "the\nof\n…"`.
  - The same tree is published to the Artifact via its `files` map.
  - No build step and no framework (vanilla JS, small inline-SVG charts).

## Modules (`js/`)
| File | Contents |
|---|---|
| `store.js` | IndexedDB, settings, export/import, reset |
| `corpus.js` | Rank pools, word→n-gram index |
| `layout.js` | Optional layout declaration and movement classification |
| `input.js` | Keystroke capture, multi-character key detection |
| `align.js` | Wobbrock–Myers input-stream error analysis |
| `metrics.js` | Error rates, WPM, timing cleaning |
| `model.js` | Sequence statistics |
| `generator.js` | Word selection |
| `difficulty.js` | Difficulty controller |
| `ui.js` | Typing screen, summaries, sequence table, settings |

## Methods

**Input capture.**
- `keydown`, `keyup` and `beforeinput` events with `performance.now()` timestamps. Key-up times are what make rollover measurable.
- Multi-character outputs (e.g. `th`, `qu`) are detected in two ways:
  - an input event carrying more than one character;
  - characters arriving less than about 10 ms apart, a configurable **[design choice]** threshold.
- The user can also declare them. Each counts as one motor event for timing, and all its characters count for WPM.

**Error analysis.**
- The full input stream is logged.
- The Wobbrock & Myers (2006, ACM TOCHI 13(4)) input-stream algorithm runs per word or segment: FLAG-STREAM, MSD matrix, all optimal alignments, stream-align, position values.
- It classifies corrected and uncorrected substitutions, insertions and omissions, plus corrected no-errors. A single insertion does not cascade into false substitutions.
- When several alignments are equally good, each gets weight 1/(number of alignments) (MacKenzie & Soukoreff 2002). This also feeds the substitution matrix.
- Transposition is checked post hoc (Salthouse 1986's error classes). A "premature" tag marks a character that appears later in the word.
- Metrics follow Soukoreff & MacKenzie (2003):
  - Keystroke classes C, INF, IF, F; corrected, uncorrected and total error rates; KSPC; conscientiousness.
  - **First-attempt accuracy = 1 − total error rate.**
  - WPM = (characters/5)/minutes.

**Timing cleaning and normalisation.**
- IKI = gap between successive keydowns. Gaps over 5 s are pauses, not hesitations (Dhakal et al. 2018).
- Only correct keystrokes that follow a correct keystroke are timed (Behmer & Crump 2017). The keystroke just after an error is excluded, since errors cause slowing (Salthouse 1986).
- Outliers are trimmed per context with the Van Selst & Jolicoeur (1994) moving criterion.
- Each context's IKI is compared as a ratio to the user's mean IKI over the session's common bigrams, within the same exercise type (Dhakal et al. normalisation). A slow day therefore doesn't make everything look weak.
- Word-initial transitions (space → first letter) are a separate population: they run about 20% slower (Salthouse; Logan & Crump's outer/inner loop). They are compared only with each other.
- Rollover rate is recorded as a fluency indicator. Dhakal et al. found it correlates r = .73 with WPM.

**Sequence model.**
- **Contexts.** A keystroke's outcome (error yes/no, normalised IKI) is attributed to the contexts ending at that character: unigram, bigram and trigram, spaces included, plus a 4-gram when counts allow. Gentner and Salthouse found timing depends on the 2–3 preceding characters, which justifies trigrams as the main unit.
- **Error rates.**
  - A beta-binomial prior with empirical-Bayes shrinkage (Efron & Morris 1975).
  - The prior is centred on the context's backoff parent, its shorter suffix. A trigram is judged against its bigram, and a bigram against its unigram. This is the hierarchy n-gram smoothing uses (Chen & Goodman 1998; Katz and Kneser-Ney).
  - Flag a context only when P(rate > parent rate) > 0.95. This blocks blaming every overlapping n-gram and tells "rare" apart from "weak".
- **Latency.** Same structure: a normal model on the normalised IKI ratio, shrunk toward the parent.
- **Recency.** Each observation is weighted by a power-law decay of its age. This is the shape of the FSRS forgetting curve (R = (1 + f·t/S)^−d), applied here as an evidence weight **[design choice]**. Recent sessions dominate, while one bad day can't wipe out a long record.
- **States:** insufficient evidence, weak (errors), hesitant (latency), improving, mastered, regressed. They come from posterior intervals and their trend.
- **Priority** = credible excess cost × the context's frequency in the language **[design choice, keybr-like: practise what matters most]**. Keybr's per-key confidence (target/smoothed time) is the prior art, but it is letters only. No published study validates targeting individual n-grams, so the dashboard shows the evidence behind every flag.

**Word generator.**
- Words come from rank pools, mixed smoothly around a continuous "frontier rank".
- Words are boosted by their contexts' priorities, with a recency penalty against repeats.
- About 20% of words are unbiased random picks, so the model keeps getting fair observations.
- For weak cross-word contexts (e.g. `d th`), word pairs are chosen to produce them.

**Difficulty controller.**
- An Elo-style learner/item model gives each word a predicted probability of a correct first attempt (Pelánek 2016; Pelánek et al., UMUAI, with uncertainty step U(n) = α/(1+βn)). Word difficulty is seeded from its n-gram estimates.
- Rarer words are admitted while the predicted probability stays at or above about 0.99.
- Around that sits a dead-band controller on windowed (≥150 words) relaxed-mode first-attempt accuracy:
  - above 99.5%, the frontier moves out;
  - below 98.5%, it moves in;
  - inside the band, nothing changes.
- This is a staircase idea (Levitt 1971) adapted to a 99% target, which the classic k-down rule cannot reach **[design choice]**. The 85% rule (Wilson et al. 2019) is deliberately not used: its assumptions don't fit motor fluency at 99% accuracy.
- Persisted per language, with a manual override.

**Optional layout declaration.**
- Format: rows of characters plus a matching finger-digit grid, genkey-style; row-stagger and column-stagger presets. Importing libdof `.dof` (with explicit coordinates, good for splits) comes later.
- Each bigram and trigram is classified with the community definitions (Getreuer glossary, Keyboard layouts doc, layouts.wiki):
  - same-finger bigram (SFB) and same-finger skipgram (SFS);
  - lateral stretch (LSB);
  - full and half scissor;
  - inward and outward roll;
  - alternation, redirect, one-hand roll.
- Used for explanations ("`rn` is an SFB on your layout") and for grouping the sequence table by movement type.
- In the MVP it is not a model input; later it may become a covariate. Without a layout, everything is layout-agnostic.

**Progress under moving difficulty** (later milestones).
- A fixed benchmark: median of 3×60 s English 5k tests.
- Perceived effort rated 1–5.
- A model-predicted relaxed WPM on a fixed reference text, as a comparable fluency index.

## Refinements (user review, these override anything above)
1. **Multi-character outputs.**
   - Declared macros are the primary mechanism.
   - Automatic detection is opt-in. When on, it only *marks* a pair as a candidate macro, with a confidence score. It never merges events.
   - Raw per-character timestamps are always stored. A declared macro produces one motor event for timing, but every character counts for WPM.
2. **Difficulty.**
   - Accuracy is the gate: the frontier advances only when windowed accuracy is ≥ 99.5%.
   - Advancement also needs no worse hesitation and rhythm than the user's recent baseline:
     - hesitation rate = share of cleaned IKIs above 2× the context's expected ratio;
     - rhythm = coefficient of variation of within-word IKI.
   - If the user rated recent perceived effort at 4 or more, the frontier holds instead of advancing.
   - There is no WPM floor.
   - Every advance, hold or retreat is logged with its reasons and shown in the summary.
3. **Consolidation and maintenance** (in the spirit of spaced repetition, adapted to motor skills **[design choice]**). Each flagged context moves through these stages:
   - *weak*: high exposure.
   - *improving*: once the posterior is no longer credibly worse than its parent, it keeps moderate exposure in **varied** words. The generator caps reuse of the same carrier word.
   - *consolidating*: exposure intervals (counted in sessions and days) grow geometrically after each successful review.
   - *mastered*: a rare retention check.
   - *regressed*: a failed check sends it back to *improving*.
   - "Successful review" = no credible deficit across at least *k* observations in at least *m* distinct words.
4. **Fluency index.**
   - Labelled experimental. Its prediction is logged before each benchmark and compared with the result, so its error is visible.
   - The primary metric stays measured relaxed WPM and accuracy (and later the benchmark).
5. **Programme early.**
   - Milestone 2 becomes the daily programme: warm-up, relaxed, bursts, prose, targeted.
   - Prose works from **pasted text** with a saved position. The book library comes later.
6. **Substitution analysis.**
   - Each aligned substitution is stored with its expected char, actual char, the ±3 characters around it, the word, timestamp, whether it was corrected, and exercise type.
   - Rates are normalised as P(actual = y | expected = x) = count(x→y) / opportunities(x), with the same beta shrinkage.
   - It is computed independently of the sequence-weakness model.
7. **Unbiased sample.**
   - Every generated word is tagged `source: random | frontier | target | maintenance`.
   - The model learns from all of them, but the progress statistics (accuracy, WPM, per-context trends) can be filtered to `random` only. The summary reports both.
8. **Persistence, and the file-structure discrepancy clarified.**
   - The project is **multi-file**: `index.html` + `js/` + `data/`. It works by opening `index.html` from disk. The "single HTML file" in an earlier draft is superseded.
   - The Artifact publishes the same tree via its `files` map.
   - A tiny `tools/bundle.mjs` (node) can additionally inline everything into one `fluentype.html` for sharing. It is optional.
   - Raw events, sessions and model state carry a schema version. Each version has a migration function, so history is never dropped on upgrade.
   - Export writes the full JSON (raw events included); import is validated, and reset can be selective.
   - Storage usage is shown in settings. If quota fails, a warning prompts an export.
9. **Philosophy.**
   - The summary and dashboard compare speed at matched accuracy and effort, in both directions. Lower effort at the same speed is reported as progress.
   - Live stats stay hidden in relaxed mode.
   - The model is transparent: a "why" panel per context shows its counts, posterior, parent and stage.

## Repository and workflow
- **Repo:** github.com/mraspaud/fluentype. Attach it with add_repo (push access) and clone to `/home/user/fluentype`.
- Work on a feature branch and push there; no PR unless asked. Commit after each green functionality.
- **Strict TDD, one functionality per cycle.** The unit is a behaviour, e.g. "an insertion mid-word is classified as an insertion, and later characters stay correct", or "the frontier holds when accuracy is in the band". Each cycle:
  - write the failing test;
  - run it and see it fail;
  - write the minimal code;
  - see it pass;
  - refactor;
  - commit.
- **Test stack:** Node's built-in `node:test` + `node:assert`, with no dependencies. `test/helpers/load.js` loads the classic `js/*.js` scripts, in `index.html` order, into a `vm` context with a fake `window`. Tests therefore exercise exactly the code the browser runs.
- UI behaviour gets Playwright tests on the pre-installed Chromium against `file://…/index.html`. They are driven by scripted key events and need fake timers for IKIs.
- Commands: `node --test test/` and `node test/e2e/run.mjs`. A `package.json` exists only for scripts, with no runtime deps.
- **Functionality backlog for the MVP, in TDD order:**
  1. Text stream: render target, cursor and typed state.
  2. Keystroke capture with timestamps and declared macros.
  3. Input-stream error classification (Wobbrock–Myers).
  4. Session metrics (Soukoreff–MacKenzie, WPM).
  5. Timing cleaning and normalisation.
  6. Context statistics with hierarchical shrinkage and flags.
  7. Recency weighting.
  8. Consolidation stages.
  9. Substitution statistics.
  10. Word generator with source tags and an unbiased sample.
  11. Difficulty controller with reasons.
  12. Persistence, export/import and migrations.
  13. Relaxed-mode screen and summary.
  14. Sequence "why" table.
  15. Layout declaration and movement tags.

## Incremental plan
1. **MVP (this build).**
   - Typing UI.
   - Embedded wordfreq English list (top ~30k, filtered, CC-BY-SA attribution).
   - Error analysis and metrics; timing cleaning; sequence model; generator; difficulty controller.
   - Relaxed mode with live stats hidden, plus an end-of-exercise summary.
   - Sequence table with the evidence behind each flag.
   - Optional layout and multi-character key settings; export/import/reset.
2. **Daily programme.** Warm-up, speed bursts, targeted exercises, prose from pasted text with a saved position, the default 20-minute programme with auto-advance, effort rating, simple editing of durations and order.
3. **Books.** Library, txt/epub import, typography normalisation.
4. **M5.** Charts, benchmark, effort trends, substitution matrix, goals.
5. **M6.** French and Swedish (wordfreq), spontaneous writing, accessibility, repo.

## Word-list generation
- Create a scratch venv and `pip install wordfreq`.
- Run `top_n_list('en', 40000)`.
- Keep lowercase alphabetic words (apostrophes allowed), drop entries that are only proper nouns, and apply a small profanity filter.
- Keep the first ~30k and write them to `data/en.words.js` with an attribution header.

## Verification
- `node` unit checks of `align.js` against the worked examples in Wobbrock & Myers, plus the classic "quickly" vs "qucehkly" example.
- Playwright on the pre-installed Chromium, loading `file:///…/index.html`:
  - Scripted typing with known errors, insertions and `th` bursts.
  - Assert the error classes, WPM and accuracy.
  - Assert that a seeded slow trigram gets flagged while its bigram and letters do not.
  - Assert that data survives a reload and an export → reset → import round-trip.
- Publish as an Artifact and check the light and dark themes and phone width.

Output goes to the cloned repo at `/home/user/fluentype/`.
