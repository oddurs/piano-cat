# Piano Cat

A webcam toy: you mime a classical piece, your hand strokes drive the beat, a
pixel cat plays along. Next.js static export, deployed to GitHub Pages.

## Verify before you claim

There is no browser in the agent environment, so two harnesses stand in:

```bash
npm test        # tools/sim.mjs  — drives the beat follower headlessly
npm run shot    # tools/shot.mjs — renders the canvas screens to .shots/*.png
npm run typecheck
```

**Run `npm run shot` and actually look at the PNGs before claiming anything
about the visuals.** Pixel art cannot be reviewed by reasoning about it; the
first run of that harness caught a bow tie rendering on the cat's face, hidden
paws, and a tail that read as a stray arm.

**Touch `lib/conductor.ts` or `lib/pieces.ts` → run `npm test`.** It asserts the
properties that make the toy feel smooth rather than jerky, and it has already
caught a real bar-alignment bug in Für Elise.

The camera path (`lib/motion.ts`) genuinely cannot be verified here. Its
thresholds are inference. Say so rather than implying otherwise, and keep the
escape hatches working: the sensitivity slider, `AUTO`, and `SPACE` as a manual
keystroke.

## Invariants

- **The canvas is 320×180**, integer-scaled with nearest-neighbour. Every
  coordinate snaps to a whole pixel — a half pixel is a visible smear. Draw
  through `lib/px.ts`, never with arbitrary float rects.
- **No runtime dependencies beyond React/Next.** No CDN, no audio library, no
  ML model. The piano samples are vendored deliberately.
- **Anything fetched by hand must go through `lib/base.ts`.** On Pages the site
  lives under `/piano-cat/`, so a bare `/piano/A4.mp3` 404s.
- **Strikes are beat markers, not note triggers.** If you find yourself
  snapping or clamping the playhead on a strike, that is the bug that made this
  feel jerky in the first place — see the comment on the `Conductor` class.
- **Animation is locked to musical phase, not the wall clock.** The cat bobbing
  on a free-running sine drifts out of time with its own playing and looks
  broken.
- The scores in `lib/pieces.ts` are hand-transcribed and abridged. They are not
  urtext and the README says so; keep it that way rather than implying accuracy
  that isn't there.

## Git workflow

`main` is always deployable — merging to it publishes to Pages. So:

- **Never commit to `main` directly.** Branch from fresh `origin/main`, open a
  PR, let CI gate it, squash-merge. `/ship` runs the whole cycle.
- **Branch names** are kebab-case and describe the change: `fix-onset-jitter`,
  `add-chopin-nocturne`.
- **Commit subjects** are imperative and under ~70 characters. The body says
  *why*, not which files moved. **No Claude attribution trailer, ever.**
- **One branch ↔ one worktree ↔ one PR**, through to a squash-merge.
- A `pre-push` hook (wired by `npm install` via `core.hooksPath`) runs typecheck
  and `npm test` before anything leaves the machine. If you find yourself
  reaching for `SKIP_HOOKS=1`, fix the code instead.
- `gh pr merge --auto --squash` is the merge command — it waits for green CI and
  deletes the branch. Do not merge around a red check.
- Dependabot patch bumps auto-merge once CI is green; minor and major bumps wait
  for a human, because this project's feel lives in timing constants.

`main` carries a ruleset: no force-pushes, no deletion, PRs with a passing
`check` job. Repository admins can bypass it, so you will never be locked out —
but bypassing is a decision, not a shortcut. Inspect it with
`gh api repos/oddurs/piano-cat/rulesets`.

## Worktrees

Per-task isolation, sited outside the working copy:

```fish
git fetch origin
git worktree add -b <task> ../piano-cat-wt/<task> origin/main
# each worktree needs its own npm install — node_modules is not shared
git worktree remove ../piano-cat-wt/<task>   # after the PR merges
git branch -d <task>; git worktree prune
```

`.next/`, `out/`, `.shots/` and `node_modules/` are all gitignored and all
per-worktree, so nothing leaks between them.

## Deploying

Push to `main`. `.github/workflows/deploy.yml` typechecks, tests, builds a
static export with `NEXT_PUBLIC_BASE_PATH=/<repo>`, and publishes to Pages.
Never commit `out/`.
