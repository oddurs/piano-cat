# Contributing

Thanks for looking. This is a toy, and contributions that keep it feeling like
one are very welcome.

## The one rule that matters

**`main` is always deployable.** Merging to it publishes to GitHub Pages. So
never commit to `main` directly: branch from a fresh `origin/main`, open a pull
request, and let CI gate it.

```bash
git fetch origin
git switch -c fix-onset-jitter origin/main
# …work…
gh pr create
```

Branch names are kebab-case and describe the change: `fix-onset-jitter`,
`add-chopin-nocturne`. Commit subjects are imperative and under ~70 characters;
the body says *why*, not which files moved.

## Verify before you claim

There is no browser in CI, so two harnesses stand in for one:

```bash
npm test        # drives the beat follower headlessly
npm run shot    # renders the canvas screens to .shots/*.png
npm run typecheck
```

- **Touched `lib/conductor.ts`, `lib/onset.ts`, `lib/gesture.ts` or
  `lib/pieces.ts`? Run `npm test`.** It asserts the properties that make the
  toy feel smooth rather than jerky, and it has already caught a real
  bar-alignment bug in Für Elise.
- **Touched anything visual? Run `npm run shot` and actually look at the
  PNGs.** Pixel art cannot be reviewed by reasoning about it. The first run of
  that harness caught a bow tie rendering on the cat's face, hidden paws, and a
  tail that read as a stray arm.
- **The camera path cannot be verified headlessly.** Its thresholds are
  inference. Say so in the PR rather than implying otherwise. If you can, press
  `D` then `C` while playing to download a clip, and tune against that in a
  test instead of by waving at a laptop.

A `pre-push` hook (wired by `npm install`) runs typecheck and tests before
anything leaves your machine. If you find yourself reaching for `SKIP_HOOKS=1`,
fix the code instead.

The pull request template asks what you ran and what it printed. "Should work"
is not an answer to that question.

## House style

A few invariants this project will not trade away:

- **The canvas is 320×180**, integer-scaled with nearest-neighbour. Every
  coordinate snaps to a whole pixel — a half pixel is a visible smear. Draw
  through `lib/px.ts`, never with arbitrary float rects.
- **No runtime dependencies beyond React, Next and the hand landmarker.** No
  CDN, no audio library. The piano samples are vendored deliberately and the
  model is self-hosted deliberately — the page turns on somebody's camera, and
  what reads that camera should come from our own origin.
- **Anything fetched by hand goes through `lib/base.ts`.** On Pages the site
  lives under `/piano-cat/`, so a bare `/piano/A4.mp3` 404s.
- **Strikes are beat markers, not note triggers.** If you find yourself
  snapping or clamping the playhead on a strike, that is the bug that made this
  feel jerky in the first place — see the comment on the `Conductor` class.
- **Animation is locked to musical phase, not the wall clock.** A cat bobbing
  on a free-running sine drifts out of time with its own playing.
- **Don't overstate the scores.** They are generated from the published
  editions credited in `lib/scores/SOURCES.md`. Keep that provenance accurate
  in both directions: don't claim urtext, and don't call generated data
  hand-typed.

## Adding a piece

Scores are generated, not typed. Use the importers:

```bash
node tools/import-kern.mjs <name> <url> [--bpm N] [--pulse D] [--from BAR] [--to BAR]
node tools/import-midi.mjs <name> <url> [--bpm N] [--pulse D] [--from BAR] [--to BAR]
```

The command that produced a file is written at the top of it so it can be
rebuilt. Then add the piece to `lib/pieces.ts`, credit the edition in
`lib/scores/SOURCES.md`, and run `npm test` — the gesture cutter has opinions
about time signatures.

Only public-domain music, and only from an edition you can name.

## Dependencies

Dependabot patch bumps auto-merge once CI is green. Minor and major bumps wait
for a human, because this project's feel lives in timing constants and a
surprise framework bump is not something to discover from a deploy.

## Reporting things

Bugs and ideas both go to
[issues](https://github.com/oddurs/piano-cat/issues). For anything
security-shaped, see [SECURITY.md](SECURITY.md) instead.

If the instrument ate your gestures or felt jerky, that is a real bug and worth
reporting — say what piece, what you were doing with your hands, and what it
did instead. A downloaded clip (`D` then `C`) is the most useful thing you can
attach.
