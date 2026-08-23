// Where a gesture of your hand should land in a piece of music.
//
// A wave used to advance a fixed number of pulses, the same number all the way
// through. Against a real score that is badly wrong in both directions: in the
// Entertainer one wave released eight notes and the next twenty-eight, and in
// the Moonlight Sonata eighty-three waves out of two hundred and eighty
// released nothing whatsoever. Waving at something that answers a third of the
// time does not feel like an instrument that missed you; it feels like one
// that is ignoring you.
//
// So the score is read once and cut into gestures. The cuts are kept close to
// an even span — the music has to keep its own tempo, and a wave that covers
// four pulses where the last covered one would play that stretch four times
// too fast — but within that tolerance they are pulled onto the places the
// music itself is articulated: bar lines, beats, the far side of a rest, the
// start of a chord. And a gesture that would release nothing is merged into
// its neighbour, always.

import type { NoteEv } from './pieces'

/** how far a cut may be pulled from its ideal spot, as a share of the span */
const PULL = 0.2
/**
 * Spans a bar can sensibly be counted in. It has to divide the bar: three
 * sixteenths is a perfectly reasonable length of time and a hopeless way to
 * count 4/4, because the cuts walk off the barline and never come back.
 */
function spansFor(pulsesPerBar: number) {
  // Thirds of a bar belong to bars that have thirds. Offered them anyway, the
  // Moonlight Sonata — four pulses to the bar — chose to be counted in
  // two-thirds of a pulse, which is not a thing anybody has ever done.
  const divisors = pulsesPerBar % 3 === 0 ? [1, 2, 3, 4, 6] : [1, 2, 4, 8]
  const out = new Set<number>()
  for (const d of divisors) {
    const v = +(pulsesPerBar / d).toFixed(4)
    if (v >= 0.4 && v <= 4) out.add(v)
  }
  for (const m of [1, 2, 3]) if (pulsesPerBar * m <= 4) out.add(pulsesPerBar * m)
  return [...out].sort((a, b) => a - b)
}
/** how much a cut prefers to keep the span the last one set */
const STEADY = 3

export type GesturePlan = {
  /** pulse positions, ascending, starting at 0 */
  at: number[]
  /** what each one releases, for anyone who wants to check the work */
  weight: number[]
}

export function planGestures(
  notes: NoteEv[],
  loopAt: number,
  pulsesPerBar: number,
  targetSpan: number,
): GesturePlan {
  if (!notes.length || targetSpan <= 0) return { at: [0], weight: [notes.length] }

  // Settle on a span the music can actually be counted in before going
  // looking for places to put the cuts. Left as an arbitrary number of pulses,
  // the snap has two equally good candidates on either side of it and takes
  // them alternately — in the Bach prelude, which is a continuous stream of
  // identical sixteenths, that came out as spans of 0.75 and 1.0 in turn and
  // swung the steadiest music ever written by a third.
  // Chosen by ratio, not by difference: tempo is heard in octaves, so half
  // the target is exactly as wrong as twice it, and subtracting says
  // otherwise.
  targetSpan = spansFor(pulsesPerBar).reduce((a, b) =>
    Math.abs(Math.log2(b / targetSpan)) < Math.abs(Math.log2(a / targetSpan)) ? b : a)

  // what happens at each moment the music does anything
  const onsets = new Map<number, { n: number; v: number; end: number }>()
  for (const n of notes) {
    const at = +n.b.toFixed(4)
    const e = onsets.get(at) ?? { n: 0, v: 0, end: 0 }
    e.n += 1
    e.v = Math.max(e.v, n.v)
    e.end = Math.max(e.end, n.b + n.d)
    onsets.set(at, e)
  }
  const times = [...onsets.keys()].sort((a, b) => a - b)

  // how good a place each moment is to put a gesture
  const strength = new Map<number, number>()
  const consider = (t: number) => {
    if (t < 0 || t >= loopAt) return
    let s = 0
    const bar = Math.abs(t % pulsesPerBar) < 1e-6
    const beat = Math.abs(t - Math.round(t)) < 1e-6
    if (bar) s += 6
    else if (beat) s += 3
    else if (Math.abs((t * 2) - Math.round(t * 2)) < 1e-6) s += 1
    const o = onsets.get(+t.toFixed(4))
    if (o) {
      s += 2 + Math.min(2, o.n / 3)
      // an accent is the composer telling you where the gesture goes
      s += o.v > 0.72 ? 1.5 : 0
    }
    strength.set(+t.toFixed(4), s)
  }
  for (let t = 0; t < loopAt; t += 0.5) consider(t)
  for (const t of times) consider(t)

  // coming out of a rest is the strongest cue there is: the music stopped and
  // is about to start again, and that is exactly where a player breathes
  let prevEnd = 0
  for (const t of times) {
    if (t - prevEnd > 0.24) {
      strength.set(+t.toFixed(4), (strength.get(+t.toFixed(4)) ?? 0) + 4)
    }
    prevEnd = Math.max(prevEnd, onsets.get(t)!.end)
  }

  // walk the piece, aiming for an even span and letting the music pull
  const at: number[] = [0]
  const pull = targetSpan * PULL
  let cur = 0
  while (true) {
    const ideal = cur + targetSpan
    if (ideal >= loopAt - targetSpan * 0.5) break
    let best = ideal
    let bestScore = -Infinity
    const lastSpan = at.length > 1 ? at[at.length - 1] - at[at.length - 2] : targetSpan
    for (const [t, s] of strength) {
      if (t <= cur + targetSpan * 0.35 || t < ideal - pull || t > ideal + pull) continue
      const near = 1 - Math.abs(t - ideal) / pull
      // an even hand beats a clever one: only leave the established span when
      // the music is clearly asking for it
      const steady = Math.abs((t - cur) - lastSpan) < 1e-6 ? STEADY : 0
      const score = s + near * 2.5 + steady
      if (score > bestScore) { bestScore = score; best = t }
    }
    at.push(+best.toFixed(4))
    cur = best
  }

  // nothing to release is not a gesture. Fold it back into the one before it.
  const weightOf = (from: number, to: number) =>
    times.filter((t) => t >= from - 1e-6 && t < to - 1e-6)
      .reduce((a, t) => a + onsets.get(t)!.n, 0)

  const kept: number[] = [at[0]]
  for (let i = 1; i < at.length; i++) {
    const to = i + 1 < at.length ? at[i + 1] : loopAt
    if (weightOf(at[i], to) === 0) continue
    kept.push(at[i])
  }

  const weight = kept.map((t, i) => weightOf(t, i + 1 < kept.length ? kept[i + 1] : loopAt))
  return { at: kept, weight }
}

/** A span in pulses that takes about `seconds` at this tempo. */
export const spanFor = (pulseBpm: number, seconds: number) => (pulseBpm / 60) * seconds
