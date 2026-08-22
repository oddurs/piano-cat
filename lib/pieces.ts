// Abridged, hand-transcribed arrangements. Public domain works; the note data
// here is a simplification meant to be recognisable, not urtext.

export type NoteEv = {
  p: number   // midi pitch
  b: number   // start, in pulses (a "pulse" = one thing you mime)
  d: number   // duration, in pulses
  v: number   // 0..1 velocity
}

export type Piece = {
  id: string
  title: string
  composer: string
  short: string        // surname only, for the tight menu row
  blurb: string
  pulseBpm: number      // suggested pulses (beats) per minute
  pulsesPerBar: number
  stride: number        // beats advanced by one stroke of your hand
  loopAt: number        // pulse count at which the take starts over
  release: number       // seconds of release ramp (pedal-ish feel)
  accent: string        // hex, drives the palette
  accent2: string
  notes: NoteEv[]
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** "C#4" | "Bb2" | "Ds1" -> midi number (C4 = 60) */
export function m(name: string): number {
  const s = /^([A-G])([#sb]?)(-?\d)$/.exec(name.trim())
  if (!s) throw new Error(`bad note name: ${name}`)
  let v = STEP[s[1]]
  if (s[2] === '#' || s[2] === 's') v += 1
  if (s[2] === 'b') v -= 1
  return v + (parseInt(s[3], 10) + 1) * 12
}

const chord = (names: string, b: number, d: number, v: number): NoteEv[] =>
  names.split(/\s+/).map((n) => ({ p: m(n), b, d, v }))

// ---------------------------------------------------------------- Bach BWV 846

// Each bar is two identical halves of eight sixteenths:
//   L1 L2 R1 R2 R3 R1 R2 R3, with L1/L2 held under the whole half-bar.
const BACH_BARS = [
  'C3 E3 G3 C4 E4',
  'C3 D3 A3 D4 F4',
  'B2 D3 G3 D4 F4',
  'C3 E3 G3 C4 E4',
  'C3 E3 A3 E4 A4',
  'C3 D3 F#3 A3 D4',
  'B2 D3 G3 D4 G4',
  'B2 C3 E3 G3 C4',
  'A2 C3 E3 G3 C4',
  'D2 A2 D3 F#3 C4',
  'G2 B2 D3 G3 B3',
  'G2 Bb2 E3 G3 C#4',
  'F2 A2 D3 A3 D4',
  'F2 Ab2 D3 F3 B3',
  'E2 G2 C3 G3 C4',
  'E2 F2 A2 C3 F3',
  'D2 F2 A2 C3 F3',
  'G2 D3 G3 B3 F4',
  'C2 E3 G3 C4 E4',
]

function bachPrelude(): NoteEv[] {
  const out: NoteEv[] = []
  BACH_BARS.forEach((bar, i) => {
    const [l1, l2, r1, r2, r3] = bar.split(/\s+/).map(m)
    for (let h = 0; h < 2; h++) {
      const t = i * 4 + h * 2
      out.push({ p: l1, b: t, d: 2, v: 0.62 })
      out.push({ p: l2, b: t + 0.25, d: 1.75, v: 0.58 })
      const fig = [r1, r2, r3, r1, r2, r3]
      fig.forEach((p, k) => out.push({ p, b: t + 0.5 + k * 0.25, d: 0.3, v: k === 2 || k === 5 ? 0.7 : 0.6 }))
    }
  })
  const last = BACH_BARS.length * 4
  out.push(...chord('C2 C3 E3 G3 C4 E4', last, 4, 0.72))
  return out
}

// ------------------------------------------------------------------ Für Elise

function furElise(): NoteEv[] {
  const o: NoteEv[] = []
  const rh = (n: string, b: number, d = 0.5, v = 0.72) => o.push({ p: m(n), b, d, v })
  const lh = (n: string, b: number, d = 1, v = 0.5) => o.push({ p: m(n), b, d, v })

  // pickup
  rh('E5', 0); rh('D#5', 0.5)

  const theme = (t: number) => {           // 3 pulses: the famous figure
    rh('E5', t); rh('D#5', t + 0.5); rh('E5', t + 1)
    rh('B4', t + 1.5); rh('D5', t + 2); rh('C5', t + 2.5)
  }
  const bassAm = (t: number) => { lh('A2', t); lh('E3', t + 1); lh('A3', t + 2) }
  const bassE = (t: number) => { lh('E2', t); lh('E3', t + 1); lh('G#3', t + 2) }

  theme(1)
  rh('A4', 4, 3); bassAm(4)
  rh('C4', 7, 1); rh('E4', 8, 1); rh('A4', 9, 1); bassAm(7)
  rh('B4', 10, 3); bassE(10)
  rh('E4', 13, 1); rh('G#4', 14, 1); rh('B4', 15, 1); bassE(13)
  rh('C5', 16, 1); rh('E4', 17, 1); bassAm(16)
  rh('E5', 18); rh('D#5', 18.5)            // pickup back into the theme

  theme(19)
  rh('A4', 22, 3); bassAm(22)
  rh('C4', 25, 1); rh('E4', 26, 1); rh('A4', 27, 1); bassAm(25)
  rh('B4', 28, 3); bassE(28)
  rh('E4', 31, 1); rh('C5', 32, 1); rh('B4', 33, 1); bassE(31)
  rh('A4', 34, 3, 0.8); bassAm(34)

  // The piece opens on the last eighth of a bar. Shift everything so bar lines
  // land on multiples of 3 — otherwise the beat pips, the downbeat rules and
  // the metric accent all sit one eighth out, and the loop never re-aligns.
  return o.map((n) => ({ ...n, b: n.b + 2 }))
}

// ----------------------------------------------------------- Moonlight, mvt I

function moonlight(): NoteEv[] {
  const o: NoteEv[] = []
  // one bar of triplet arpeggios: `fig` repeated on each of `beats` pulses
  const trip = (fig: string, t: number, beats: number) => {
    const ps = fig.split(/\s+/).map(m)
    for (let k = 0; k < beats; k++)
      ps.forEach((p, j) => o.push({ p, b: t + k + j / 3, d: 0.34, v: 0.42 }))
  }
  const oct = (a: string, b: string, t: number, d: number) => {
    o.push({ p: m(a), b: t, d, v: 0.5 }, { p: m(b), b: t, d, v: 0.46 })
  }
  const mel = (n: string, b: number, d: number) => o.push({ p: m(n), b, d, v: 0.85 })

  trip('G#3 C#4 E4', 0, 4); oct('C#2', 'C#3', 0, 4)
  trip('G#3 C#4 E4', 4, 4); oct('C#2', 'C#3', 4, 4)

  trip('A3 C#4 E4', 8, 2); oct('A1', 'A2', 8, 2)
  trip('A3 D4 F#4', 10, 2); oct('F#1', 'F#2', 10, 2)

  trip('G#3 B#3 F#4', 12, 2); oct('G#1', 'G#2', 12, 2)
  trip('G#3 C#4 E4', 14, 2); oct('G#1', 'G#2', 14, 2)

  trip('G#3 C#4 E4', 16, 4); oct('C#2', 'C#3', 16, 4)
  mel('G#4', 16, 1.5); mel('G#4', 17.5, 0.5); mel('G#4', 18, 1); mel('G#4', 19, 1)

  trip('G#3 C#4 E4', 20, 4); oct('C#2', 'C#3', 20, 4)
  mel('G#4', 20, 1.5); mel('G#4', 21.5, 0.5); mel('G#4', 22, 2)

  trip('A3 C#4 E4', 24, 2); oct('A1', 'A2', 24, 2)
  trip('A3 D4 F#4', 26, 2); oct('F#1', 'F#2', 26, 2)
  mel('A4', 24, 2); mel('F#4', 26, 2)

  trip('G#3 B#3 F#4', 28, 2); oct('G#1', 'G#2', 28, 2)
  trip('G#3 C#4 E4', 30, 2); oct('G#1', 'G#2', 30, 2)
  mel('G#4', 28, 4)

  trip('G#3 C#4 E4', 32, 4); oct('C#2', 'C#3', 32, 4)
  mel('C#4', 32, 4)
  return o
}

// ------------------------------------------------------------- Minuet in G

function minuet(): NoteEv[] {
  const o: NoteEv[] = []
  const r = (n: string, b: number, d: number, v = 0.75) => o.push({ p: m(n), b, d, v })
  const l = (n: string, b: number, d: number, v = 0.5) => o.push({ p: m(n), b, d, v })

  r('D5', 0, 1); r('G4', 1, .5); r('A4', 1.5, .5); r('B4', 2, .5); r('C5', 2.5, .5)
  l('G2', 0, 1); l('B2', 1, 1); l('D3', 2, 1)

  r('D5', 3, 1); r('G4', 4, 1); r('G4', 5, 1)
  l('G2', 3, 1); l('D3', 4, 1); l('B2', 5, 1)

  r('E5', 6, 1); r('C5', 7, .5); r('D5', 7.5, .5); r('E5', 8, .5); r('F#5', 8.5, .5)
  l('C3', 6, 1); l('E3', 7, 1); l('G3', 8, 1)

  r('G5', 9, 1); r('G4', 10, 1); r('G4', 11, 1)
  l('G2', 9, 1); l('D3', 10, 1); l('B2', 11, 1)

  r('C5', 12, 1); r('D5', 13, .5); r('C5', 13.5, .5); r('B4', 14, .5); r('A4', 14.5, .5)
  l('C3', 12, 1); l('E3', 13, 1); l('G3', 14, 1)

  r('B4', 15, 1); r('C5', 16, .5); r('B4', 16.5, .5); r('A4', 17, .5); r('G4', 17.5, .5)
  l('G2', 15, 1); l('D3', 16, 1); l('B2', 17, 1)

  r('A4', 18, 1); r('B4', 19, .5); r('A4', 19.5, .5); r('G4', 20, .5); r('F#4', 20.5, .5)
  l('D3', 18, 1); l('A2', 19, 1); l('D3', 20, 1)

  r('G4', 21, 3, .8)
  l('G2', 21, 3); l('B2', 21, 3); l('D3', 21, 3)
  return o
}

export const PIECES: Piece[] = [
  {
    id: 'bach-prelude',
    title: 'Prelude in C',
    composer: 'J.S. Bach',
    short: 'Bach',
    blurb: 'Sixteen notes a bar, all the same shape. You cannot lose. Probably.',
    pulseBpm: 58, pulsesPerBar: 4, stride: 1, loopAt: 80, release: 0.4,
    accent: '#5ff2d6', accent2: '#1b6b7a',
    notes: bachPrelude(),
  },
  {
    id: 'fur-elise',
    title: 'Für Elise',
    composer: 'L. van Beethoven',
    short: 'Beethoven',
    blurb: 'Everyone knows the first eight notes. The cat knows the rest.',
    pulseBpm: 88, pulsesPerBar: 3, stride: 1, loopAt: 39, release: 0.3,
    accent: '#ffb3d1', accent2: '#8a3a6b',
    notes: furElise(),
  },
  {
    id: 'moonlight',
    title: 'Moonlight Sonata',
    composer: 'L. van Beethoven',
    short: 'Beethoven',
    blurb: 'Slow. Very slow. Wave like you have somewhere sad to be.',
    pulseBpm: 46, pulsesPerBar: 4, stride: 1, loopAt: 36, release: 1.5,
    accent: '#9fb8ff', accent2: '#26356e',
    notes: moonlight(),
  },
  {
    id: 'minuet-g',
    title: 'Minuet in G',
    composer: 'J.S. Bach (attr.)',
    short: 'Bach',
    blurb: 'A dance. Three to a bar. Do not fall over.',
    pulseBpm: 96, pulsesPerBar: 3, stride: 1, loopAt: 24, release: 0.26,
    accent: '#ffe27a', accent2: '#7a5a12',
    notes: minuet(),
  },
]

for (const p of PIECES) p.notes.sort((a, b) => a.b - b.b || a.p - b.p)
