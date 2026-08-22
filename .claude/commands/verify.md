---
description: Run every check this repo can run without a browser
---

Run all three gates and report the real output of each:

1. `npm run typecheck`
2. `npm test` — the beat-follower regression suite; name any check that fails
3. `npm run shot` — then **read** `.shots/play.png` and `.shots/menu.png` and
   describe what is actually on screen: the cat's proportions and mood, whether
   any element overlaps another, whether text collides, whether the keyboard,
   metronome and candelabra render correctly.

Then state plainly what remains unverified. The camera path in `lib/motion.ts`
cannot be exercised headlessly — its onset thresholds are inference, and saying
so is part of the report.
