# 🐈 Piano Cat

**[oddurs.github.io/piano-cat](https://oddurs.github.io/piano-cat/)**

Pick a classical masterpiece. Mime it at your webcam. Every stroke of your
hands plays the next beat — so if you slow down, the music slows down with you.
Wave big for *forte*, small for *piano*. There is a cat, and it has opinions.

It is a toy. Nobody wins.

---

## How it works

### Your hands set the tempo

The webcam is downsampled to a 64×36 luma grid and frame-differenced. No ML
model, no download — it runs on anything with a camera. Bursts in the motion
energy are strikes; the running level is your dynamic; where the motion sits in
frame decides how the registers are balanced.

Strikes are treated as **beat markers, not note triggers**. From them the
conductor estimates a period and *predicts* where the music should be at any
instant, interpolating between beats. The playhead chases that prediction
through a damped follower, so a mistimed stroke bends the tempo over ~80ms
instead of yanking a fistful of notes out in one frame. Stop waving and the
prediction asymptotes into the next beat rather than slamming into it — it
reads as a ritardando settling onto a fermata.

A refractory window rejects strikes landing far inside the current beat.
Without it, a single spurious camera trigger both advances a beat *and*
shortens the period estimate, and the tempo bolts.

### Intensity really is intensity

Three things feed the dynamics, so it is expressive rather than a volume knob:

| Signal | Reads |
|---|---|
| Per-stroke strength | that note's velocity |
| Running motion level | the `pp`…`ff` mark, scaling everything |
| Velocity → timbre | each note's own lowpass at `480 + vel¹·⁵ × 11000` Hz |

That last one matters most. Soft strikes come out felt and dark, hard ones
edged — the hammer behaviour that makes *forte* read as *forte* rather than
just louder.

On top of that: the left third of frame versus the right tilts the balance
between bass and treble, hand height brightens or mellows the tone (a
poor-man's *una corda*), and when your gestures get jittery the note velocities
scatter. Flailing genuinely sounds sloppier.

### The piano is a real piano

30 samples of the Salamander Grand, one every minor third from A0 to C8,
pitch-shifted in between, through a generated convolution room. Vendored into
the repo so the thing works offline. See
[`public/piano/ATTRIBUTION.md`](public/piano/ATTRIBUTION.md).

### The pieces

Bach's Prelude in C (BWV 846), Für Elise, the first movement of the Moonlight
Sonata, and the Minuet in G. All public domain — but the note data in
[`lib/pieces.ts`](lib/pieces.ts) is **hand-transcribed and abridged**, meant to
be recognisable rather than urtext. Every piece loops forever.

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

The camera needs a secure context — `localhost` counts, so dev works. No
camera? `SPACE` is a keystroke and everything else still works.

| Key | |
|---|---|
| `SPACE` | play a beat by hand |
| `A` | autopilot |
| `R` | restart the take |
| `[` `]` | camera sensitivity |
| `-` `=` | beats per wave (conduct in 1, 2, 3 or 4) |
| `ESC` | back to the menu |

## Development

```bash
npm test        # regression tests for the beat follower
npm run shot    # render the canvas screens to .shots/*.png
npm run build   # static export to out/
npm run preview # serve the export
```

`npm test` has no browser, so it drives the timing core headlessly with
synthetic strike patterns — steady, accelerating, sloppy, stopped,
double-triggered — and asserts the properties that make it feel smooth: no note
clumping, no runaway tempo, monotonic playhead, clean looping.

`npm run shot` exists because the UI is pixel art and pixel art cannot be
reviewed by reasoning about it. It renders the menu, loading and play screens
to PNG contact sheets. Its first run caught a bow tie drawing on the cat's face.

### Layout

```
app/          Next.js app router — one client page, one canvas
lib/
  pieces.ts     hand-transcribed scores
  audio.ts      the sampler; velocity drives level *and* brightness
  motion.ts     webcam → energy, onsets, dynamics
  conductor.ts  the beat follower — the heart of the feel
  px.ts         chunky drawing primitives
  cat.ts        the cat, the candelabra, the metronome
  render.ts     the play screen
  menu.ts       title, piece select, loading
tools/        headless test + screenshot harnesses
```

Everything is drawn into one 320×180 canvas, integer-scaled with
nearest-neighbour. A half pixel is a smear, so all coordinates snap to whole
numbers.

## Deploying

Pushing to `main` builds a static export and publishes it to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The workflow
sets `NEXT_PUBLIC_BASE_PATH` to the repository name, which is why anything
fetched by hand goes through [`lib/base.ts`](lib/base.ts).

## Licence

Code is [MIT](LICENSE). The piano samples are CC-BY-3.0 — keep the attribution.
