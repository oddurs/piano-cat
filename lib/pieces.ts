// Abridged, hand-transcribed arrangements. Public domain works; the note data
// here is a simplification meant to be recognisable, not urtext.

export type NoteEv = {
  p: number   // midi pitch
  b: number   // start, in pulses (a "pulse" = one thing you mime)
  d: number   // duration, in pulses
  v: number   // 0..1 velocity
  h?: -1 | 1  // which hand plays it. -1 left, 1 right. Falls back to register.
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
  resonance: number[]   // midi notes the strings ring in sympathy with
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
      out.push({ p: l1, b: t, d: 2, v: 0.62, h: -1 })
      out.push({ p: l2, b: t + 0.25, d: 1.75, v: 0.58, h: -1 })
      const fig = [r1, r2, r3, r1, r2, r3]
      fig.forEach((p, k) => out.push({ p, b: t + 0.5 + k * 0.25, d: 0.3, v: k === 2 || k === 5 ? 0.7 : 0.6, h: 1 }))
    }
  })
  const last = BACH_BARS.length * 4
  out.push(...chord('C2 C3 E3 G3 C4 E4', last, 4, 0.72))
  return out
}

// ------------------------------------------------------------------ Für Elise

function furElise(): NoteEv[] {
  const o: NoteEv[] = []
  const rh = (n: string, b: number, d = 0.5, v = 0.72) => o.push({ p: m(n), b, d, v, h: 1 })
  const lh = (n: string, b: number, d = 1, v = 0.5) => o.push({ p: m(n), b, d, v, h: -1 })

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
      ps.forEach((p, j) => o.push({ p, b: t + k + j / 3, d: 0.34, v: 0.42, h: 1 }))
  }
  const oct = (a: string, b: string, t: number, d: number) => {
    o.push({ p: m(a), b: t, d, v: 0.5, h: -1 }, { p: m(b), b: t, d, v: 0.46, h: -1 })
  }
  const mel = (n: string, b: number, d: number) => o.push({ p: m(n), b, d, v: 0.85, h: 1 })

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
  const r = (n: string, b: number, d: number, v = 0.75) => o.push({ p: m(n), b, d, v, h: 1 })
  const l = (n: string, b: number, d: number, v = 0.5) => o.push({ p: m(n), b, d, v, h: -1 })

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


// ------------------------------------------------------------- Chopsticks

/**
 * The Celebrated Chop Waltz, Euphemia Allen, 1877. Written to be played with
 * the sides of both hands, which makes it the one piece here that is *about*
 * having two of them — and the only one anybody has ever played as a duet on
 * purpose.
 */
function chopsticks(): NoteEv[] {
  const o: NoteEv[] = []
  const chop = (a: string, b: string, bar: number, v = 0.72) => {
    for (let k = 0; k < 3; k++) {
      o.push({ p: m(a), b: bar * 3 + k, d: 0.9, v: k === 0 ? v + 0.08 : v, h: 1 })
      o.push({ p: m(b), b: bar * 3 + k, d: 0.9, v: k === 0 ? v + 0.08 : v, h: 1 })
    }
  }
  const oom = (root: string, fifth: string, bar: number) => {
    o.push({ p: m(root), b: bar * 3, d: 1, v: 0.55, h: -1 })
    o.push({ p: m(fifth), b: bar * 3 + 1, d: 1, v: 0.4, h: -1 })
    o.push({ p: m(fifth), b: bar * 3 + 2, d: 1, v: 0.4, h: -1 })
  }

  const pairs: [string, string][] = [
    ['F4', 'G4'], ['F4', 'G4'], ['E4', 'G4'], ['E4', 'G4'],
    ['D4', 'B4'], ['D4', 'B4'], ['C4', 'E4'], ['C4', 'E4'],
  ]
  const bass: [string, string][] = [
    ['C2', 'G2'], ['C2', 'G2'], ['C2', 'G2'], ['C2', 'G2'],
    ['G2', 'D3'], ['G2', 'D3'], ['C2', 'G2'], ['C2', 'G2'],
  ]
  pairs.forEach(([a, b], i) => { chop(a, b, i); oom(bass[i][0], bass[i][1], i) })

  // the little turn everybody plays at the end of the phrase
  o.push({ p: m('C4'), b: 24, d: 1, v: 0.8, h: 1 })
  o.push({ p: m('E4'), b: 24, d: 1, v: 0.8, h: 1 })
  o.push({ p: m('G4'), b: 24, d: 1, v: 0.8, h: 1 })
  o.push({ p: m('C5'), b: 24, d: 1, v: 0.85, h: 1 })
  o.push({ p: m('C2'), b: 24, d: 1, v: 0.7, h: -1 })
  o.push({ p: m('C3'), b: 24, d: 1, v: 0.6, h: -1 })
  return o
}

// ---------------------------------------------------------- The Entertainer

/** Scott Joplin, 1902. The main strain, where the right hand lands between
 *  the beats and the left hand refuses to. */
function entertainer(): NoteEv[] {
  const o: NoteEv[] = []
  const r = (n: string, b: number, d = 1, v = 0.76) => o.push({ p: m(n), b, d, v, h: 1 })
  const bass = (n: string, b: number) => o.push({ p: m(n), b, d: 1.6, v: 0.58, h: -1 })
  const stride = (names: string, b: number) =>
    names.split(/\s+/).forEach((n) => o.push({ p: m(n), b, d: 1.4, v: 0.42, h: -1 }))

  // pickup run
  r('D5', 0); r('E5', 1); r('C5', 2)
  // main strain, in eighth-note pulses
  r('A4', 4); r('B4', 5); r('G4', 6); r('D4', 7)
  r('E4', 8); r('C4', 9)
  r('C5', 12); r('D5', 13); r('D#5', 14); r('E5', 15)
  r('C5', 16); r('E5', 17); r('C5', 18); r('E5', 19)
  r('C5', 20, 2); r('A4', 22); r('B4', 23)
  r('C5', 24); r('D5', 25); r('E5', 26); r('B4', 27)
  r('D5', 28); r('C5', 29, 3)

  // oom-pah, stubbornly on the beat while the tune is not
  for (let bar = 0; bar < 4; bar++) {
    const t = bar * 8
    const root = bar === 2 ? 'G2' : 'C2'
    const fifth = bar === 2 ? 'D3' : 'G2'
    bass(root, t); stride(bar === 2 ? 'B3 D4 G4' : 'E3 G3 C4', t + 2)
    bass(fifth, t + 4); stride(bar === 2 ? 'B3 D4 G4' : 'E3 G3 C4', t + 6)
  }
  return o
}

// ------------------------------------------------- In the Hall of the Mountain King

/**
 * Grieg, 1875. The one piece here that is a vehicle rather than a tune: it
 * exists to be started as quietly and slowly as you can bear and finished as
 * fast and as loud as you can manage, and both of those are yours to do.
 */
function mountainKing(): NoteEv[] {
  const o: NoteEv[] = []
  const theme = ['A3', 'B3', 'C4', 'D4', 'C4', 'A3', 'C4', 'B3']
  const answer = ['G#3', 'B3', 'D4', 'B3', 'G#3', 'B3', 'D4', 'B3']
  const high = ['A4', 'B4', 'C5', 'D5', 'C5', 'A4', 'C5', 'B4']

  const say = (notes: string[], bar: number, v: number) =>
    notes.forEach((n, k) => o.push({ p: m(n), b: bar * 8 + k, d: 0.85, v, h: 1 }))
  const tread = (root: string, bar: number, v: number) => {
    for (let k = 0; k < 4; k++) {
      o.push({ p: m(root), b: bar * 8 + k * 2, d: 1.6, v, h: -1 })
    }
  }

  say(theme, 0, 0.36); tread('A2', 0, 0.3)
  say(answer, 1, 0.4); tread('E2', 1, 0.32)
  say(theme, 2, 0.5); tread('A2', 2, 0.42)
  say(answer, 3, 0.56); tread('E2', 3, 0.46)
  say(high, 4, 0.68); tread('A2', 4, 0.56)
  say(answer, 5, 0.74); tread('E2', 5, 0.6)
  say(high, 6, 0.86); tread('A2', 6, 0.7)

  // it does not end so much as arrive
  for (const n of ['A2', 'A3', 'E4', 'A4']) o.push({ p: m(n), b: 56, d: 4, v: 0.95, h: n === 'A2' ? -1 : 1 })
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
    resonance: [48, 55, 60, 64, 67, 72, 79],
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
    resonance: [45, 52, 57, 60, 64, 69, 76],
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
    resonance: [37, 49, 56, 61, 64, 68, 73],
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
    resonance: [43, 50, 55, 59, 62, 67, 74],
    notes: minuet(),
  },
  {
    id: 'chopsticks',
    title: 'Chopsticks',
    composer: 'E. Allen',
    short: 'Allen',
    blurb: 'A waltz for the sides of both hands. Deeply silly. Weirdly hard.',
    pulseBpm: 150, pulsesPerBar: 3, stride: 1, loopAt: 27, release: 0.18,
    accent: '#8ef07a', accent2: '#2c6b24',
    resonance: [48, 55, 60, 64, 67, 72, 76],
    notes: chopsticks(),
  },
  {
    id: 'entertainer',
    title: 'The Entertainer',
    composer: 'S. Joplin',
    short: 'Joplin',
    blurb: 'Ragtime. The tune lands between the beats; the bass never does.',
    pulseBpm: 168, pulsesPerBar: 8, stride: 2, loopAt: 32, release: 0.2,
    accent: '#ffa64d', accent2: '#8a4a12',
    resonance: [48, 55, 60, 64, 67, 72, 79],
    notes: entertainer(),
  },
  {
    id: 'mountain-king',
    title: 'Mountain King',
    composer: 'E. Grieg',
    short: 'Grieg',
    blurb: 'Start it as slowly and quietly as you dare. Do not stay there.',
    pulseBpm: 132, pulsesPerBar: 8, stride: 2, loopAt: 64, release: 0.22,
    accent: '#c69bff', accent2: '#4a2a80',
    resonance: [45, 52, 57, 61, 64, 69, 76],
    notes: mountainKing(),
  },
]

for (const p of PIECES) p.notes.sort((a, b) => a.b - b.b || a.p - b.p)
