# LessTypos: working agreements

## Workflow
- **Strict TDD per functionality**: the unit is a behaviour, not a function. Each cycle:
  1. **Red**: write the failing test and see it fail.
  2. **Green**: write the minimal code that passes.
  3. **Refactor**: remove duplication, name things, split long functions. Keep the tests green, and commit the refactor separately from the feature.
- **Refactoring goal**: clear, maintainable, self-documenting code. Names and structure carry the meaning, so comments are rarely needed. Keep only research citations, "design choice" labels and the occasional non-obvious *why*; delete comments that restate the code.
- **Tests are code too**: refactor them in the same way (shared builders, clear names, no duplication) and keep each test about one behaviour.
- **Global review after each plan item**:
  - A fresh reviewer that isn't anchored on the implementer's reasoning audits the whole codebase, tests included. It covers bugs and refactoring equally, at small scale (functions, names, duplication) and large scale (module boundaries, responsibilities, data flow): correctness, methods versus the README and plan, design smells, test gaps.
  - Findings are fixed test-first.
  - Only then is the item done.
- Commit after each green cycle and push to the feature branch. No PR unless asked.
- Ground methods in published research and cite it in code comments. Mark our own synthesis as "design choice". Never present invented methods as established ones.

## Commands
- Unit tests: `node --test "test/*.test.js"` (Node's built-in runner, no dependencies). `test/helpers/load.js` loads the browser scripts in `index.html` order into a `vm` context.
- End-to-end: `node test/e2e/run.mjs` (Playwright Chromium against `file://…/index.html`, about 2 minutes).
- Single-file build: `node tools/bundle.mjs [out.html] [--fragment]`.
- Bundled book: `node tools/make_book.js path/to/pg11.epub` writes `data/alice.js`.
- Word list: `python tools/make_wordlist.py en 30000` (needs `wordfreq`, `english-words`).

## Architecture
- Static app with no build step. Classic `<script>` files share `window.FT`, so `index.html` works from `file://`. Don't use ES modules or `fetch()` of local files.
- Domain logic lives in `js/*.js`, is pure where possible, and is tested in Node. Views live in `js/ui/*.js` and register on `FT.ui`.
- Raw sessions are the source of truth. The profile (model, substitutions, difficulty, burst target, history) is derived and can be rebuilt with `FT.trainer.rebuild`. Bump `FT.MODEL_VERSION` when derived statistics change meaning.

## Product decisions (from the user; don't change without asking)
- The goal is effortless speed. Accuracy gates vocabulary difficulty, there is no WPM floor, and only relaxed practice changes difficulty.
- A sequence is flagged only when the deficit is credible and replicated in 2 sessions.
- About 20% of words are an unbiased random sample, kept separate in the statistics.
- Speed bursts never feed the sequence model or difficulty.
- Effort is rated after each exercise. Benchmark trials are the exception: they are measurement only, so no rating.
- Leaving an exercise in progress pauses it; nothing is saved or discarded without asking.
- Prose accepts the exact character or its ASCII equivalent.
- Themes are Kanagawa Paper: Canvas (light) and Ink (dark).
