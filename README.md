# 🐈 Piano Cat

**[oddurs.github.io/piano-cat](https://oddurs.github.io/piano-cat/)**

Pick a classical masterpiece. Mime it at your webcam. Every stroke of your
hands plays the next beat — so if you slow down, the music slows down with you.
Play hard for *forte*, soft for *piano*, lift your hands to hold the pedal.
There is a cat, and it has opinions.

It is a toy. Nobody wins.

No camera? `SPACE` is a keystroke and everything else still works.

---

## How it works

### Your hands set the tempo

The camera is read by a hand landmarker — twenty-one points per hand, both
hands, on every frame the camera produces. A keystroke is a wrist falling, and
it fires on the *rising edge* of downward velocity rather than at the bottom of
the travel: the camera is already a frame or two behind you, and waiting for
the reversal puts the note another 30–50ms late, which is exactly where an
instrument stops feeling connected to your hands. Each fingertip is tracked
separately, so a hand is five levers rather than one average.

Reaching *towards* the camera counts too, at 55% of a drop. On a real piano the
key stops your hand and the motion is purely down; in the air there is nothing
to stop it, and people reach forward as much as they push down.

The model is served from this site's own origin, never a third-party CDN — see
[Privacy](#privacy). If it can't be loaded, the app falls back to a 64×36 luma
grid and frame-differencing, which needs no model at all and runs on anything
with a camera. You get a cruder instrument, not a broken one.

### Strikes are beat markers, not note triggers

From your strikes the conductor estimates a period and *predicts* where the
music should be at any instant, interpolating between beats. The playhead
chases that prediction through a damped follower, so a mistimed stroke bends
the tempo over ~80ms instead of yanking a fistful of notes out in one frame.
Stop playing and the prediction asymptotes into the next beat rather than
slamming into it — it reads as a ritardando settling onto a fermata.

A refractory window rejects strikes landing far inside the current beat.
Without it, a single spurious trigger both advances a beat *and* shortens the
period estimate, and the tempo bolts.

How much music one gesture covers is not a fixed number of pulses. The score is
read once and cut into gestures at the places the music is actually
articulated — bar lines, beats, the far side of a rest, the start of a chord —
because a fixed stride released eight notes for one wave and twenty-eight for
the next, and in the Moonlight Sonata eighty-three waves out of two hundred and
eighty released nothing at all.

### Intensity really is intensity

| Signal | Reads |
|---|---|
| Per-stroke strength | that note's velocity |
| Running motion level | the `pp`…`ff` mark, scaling everything |
| Velocity → timbre | each note's own lowpass, opening `520 × 2^(vel × 4.4)` Hz |
| Hand height | the damper pedal, held continuously |
| Left/right position | which strings answer sympathetically |

The timbre one matters most. Soft strikes come out felt and dark, hard ones
edged — the hammer behaviour that makes *forte* read as *forte* rather than
just louder. It is stated in octaves rather than hertz because a linear sweep
spent almost all its travel below mezzo-forte and then plateaued, which is the
definition of a volume knob.

The pedal is the other one. Raise your hands and everything you have played
keeps ringing and the room opens up; drop them and the whole instrument damps
at once, with a thud. It is the most expressive continuous control a pianist
has and it costs you nothing but lifting your hands.

On top of the sampler there is a quiet hammer knock on anything above *mezzo*,
strings that answer when you move near them, and mechanical noise — a key
coming back up, a damper landing. When your gestures get jittery the note
velocities scatter, so flailing genuinely sounds sloppier.

### The piano is a real piano

30 samples of the Salamander Grand, one every minor third from A0 to C8,
pitch-shifted in between, through a generated convolution room. Vendored into
the repo so the thing works offline. See
[`public/piano/ATTRIBUTION.md`](public/piano/ATTRIBUTION.md).

### The pieces

Eleven of them — Bach's Prelude in C and Minuet in G, Für Elise, the first
movement of the Moonlight Sonata, the Pathétique's Adagio, Sonata Facile, the
Rondo alla Turca, The Entertainer, Maple Leaf Rag, In the Hall of the Mountain
King, and Chopsticks.

The music is all public domain. The note data is **generated from published
digital editions** by `tools/import-kern.mjs` and `tools/import-midi.mjs`, and
the command that produced each file is written at the top of it, so any of them
can be rebuilt and checked. These are complete pieces with both hands, not
approximately-right first eight bars — the Moonlight is 1169 notes over 70
bars. The editors whose work this stands on are credited in
[`lib/scores/SOURCES.md`](lib/scores/SOURCES.md).

Chopsticks is the exception: it is a folk piece with no urtext, and its notes
are hand-written and labelled as an arrangement rather than an edition.

Every piece loops forever.

## Privacy

The page turns on your camera, so this is worth being precise about.

- **No video ever leaves the page.** Frames are read, measured and discarded.
  There is no upload and no analytics; the only things fetched at runtime are
  this site's own piano samples and hand model.
- **The hand model is served from this origin.** It is fetched at build time,
  checked against a pinned SHA-256, and shipped in the deployed artifact —
  specifically so that the model reading your camera is not pulled from
  somebody else's CDN at runtime.
- **A take is a few hundred numbers.** What you can save and share is what you
  *did* — the moments you struck, which hand, how hard, and four numbers
  describing the shape you asked for. No imagery is carried, and a shared take
  is encoded into the URL fragment rather than stored anywhere.
- **Settings stay local.** `localStorage` keeps the piece you last played, your
  sensitivity, wave size and volume. Nothing else.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:9393
```

`dev` runs under a supervisor: it restarts `next dev` if it dies, and reclaims
port 9393 from a stray server of its own (never from anything else — it names
what is holding the port and steps aside). `PORT=9394 npm run dev` moves it;
`npm run dev:raw` skips the supervisor entirely.

The camera needs a secure context — `localhost` counts, so dev works.

**Menu**

| Key | |
|---|---|
| `↑` `↓` | pick a piece |
| `P` | preview it |
| `ENTER` | play |

**Playing**

| Key | |
|---|---|
| `SPACE` | play a beat by hand, alternating hands |
| `Z` `X` | one key per hand, so the keyboard can play chords too |
| `P` | pause |
| `A` | autopilot |
| `R` | restart the take |
| `[` `]` | camera sensitivity |
| `-` `=` | beats per wave (conduct in 1, 2, 3 or 4) |
| `ESC` | back to the menu |

**When it ends** — the cat delivers a verdict on your steadiness, your dynamic
range and your tempo. `ENTER` plays it again, `W` watches your take back, `S`
copies a link to it, `ESC` returns to the list.

## Development

```bash
npm test        # regression tests for the beat follower
npm run typecheck
npm run shot    # render the canvas screens to .shots/*.png
npm run build   # static export to out/
npm run preview # serve the export
```

`npm test` has no browser, so it drives the timing core headlessly with
synthetic strike patterns — steady, accelerating, sloppy, stopped,
double-triggered — and asserts the properties that make it feel smooth: no note
clumping, no runaway tempo, monotonic playhead, clean looping. Because the
detectors are DOM-free, the same code path runs against a recorded clip as
against a live webcam.

`npm run shot` exists because the UI is pixel art and pixel art cannot be
reviewed by reasoning about it. It renders the menu, loading and play screens
to PNG contact sheets. Its first run caught a bow tie drawing on the cat's face.

The camera path cannot be verified headlessly, which is why `lib/capture.ts`
exists: press `D` then `C` while playing to download a clip, and the detectors
can be tuned against it in a test instead of by waving at a laptop.

### Layout

```
app/          Next.js app router — one client page, one canvas
lib/
  scores/       generated note data + SOURCES.md
  pieces.ts     the piece list and how each one is played
  audio.ts      the sampler; velocity drives level *and* brightness
  camera.ts     video in, hand landmarks or a luma grid out
  hand.ts       is that a hand, and is enough of it in shot?
  perception.ts observations in, playable intent out
  onset.ts      keystroke detection and expression
  signal.ts     the shapes the camera path passes around
  conductor.ts  the beat follower — the heart of the feel
  gesture.ts    where a gesture should land in a score
  capture.ts    record what the camera saw, replay it in tests
  take.ts       a performance you can keep, share and watch back
  px.ts         chunky drawing primitives
  cat.ts        the cat, the candelabra, the metronome
  render.ts     the play screen
  menu.ts       title, piece select, loading
  prefs.ts      the few things worth remembering
  base.ts       the asset prefix Pages needs
scripts/      build-time provisioning (the hand model)
tools/        headless test, screenshot and score-import harnesses
tests/        the regression suite
```

Everything is drawn into one 320×180 canvas, integer-scaled with
nearest-neighbour. A half pixel is a smear, so all coordinates snap to whole
numbers.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: `main` is always
deployable, so branch, open a PR and let CI gate it. Run `npm test` if you
touch the timing, and actually look at `npm run shot` output if you touch the
pixels.

## Deploying

Pushing to `main` builds a static export and publishes it to GitHub Pages via
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) — the same workflow that
gates pull requests, so nothing deploys that didn't pass. It sets
`NEXT_PUBLIC_BASE_PATH` to the repository name, which is why anything fetched
by hand goes through [`lib/base.ts`](lib/base.ts).

## Licence

The [MIT licence](LICENSE) covers the source code in this repository. Two
things in here are not covered by it:

- **The piano samples** in `public/piano/` are the Salamander Grand Piano by
  Alexander Holm, under CC-BY-3.0. Keep the attribution — see
  [`public/piano/ATTRIBUTION.md`](public/piano/ATTRIBUTION.md).
- **The scores** in `lib/scores/` are public-domain music, read from digital
  editions that are themselves the work of their editors. They are credited in
  [`lib/scores/SOURCES.md`](lib/scores/SOURCES.md).

The hand landmarker model is not vendored here at all — it is fetched at build
time from Google's MediaPipe model host and is subject to its own terms.
