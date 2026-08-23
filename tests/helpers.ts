// Synthetic hands. A keystroke is a fall and a lift; everything the detector
// believes about you it has to get from that shape alone.

import { PIECES } from '../lib/pieces'
import type { Sample } from '../lib/perception'

const ease = (v: number) => v * v * (3 - 2 * v)

/** y of a hand striking once every `period` seconds, 0..1 down the frame. */
export function strikingY(t: number, period: number, depth = 0.18, top = 0.42) {
  const ph = ((t % period) + period) % period / period
  const d = ph < 0.35 ? ph / 0.35 : 1 - (ph - 0.35) / 0.65
  return top + depth * ease(Math.max(0, Math.min(1, d)))
}

export type Player = { side: 'L' | 'R'; period: number | null; x: number }

/** A clip at `fps`, with each named hand either striking or held still. */
export function clip(seconds: number, players: Player[], fps = 30): Sample[] {
  const out: Sample[] = []
  for (let i = 0; i * (1 / fps) < seconds; i++) {
    const t = i / fps
    out.push({
      t,
      capturedAt: t - 0.012,
      energy: 0.02,
      hands: players.map((p) => {
        const y = p.period ? strikingY(t, p.period) : 0.5
        return { x: p.x, y, sy: y, z: 0, spread: 0.5, conf: 1 }
      }),
    })
  }
  return out
}

/**
 * A Piano that records instead of making noise. `clock` stands in for the
 * audio clock: set it to the frame's time before calling update() and `when`
 * is the absolute moment each note was scheduled to sound, which is the only
 * thing that decides whether a run is even.
 */
export function fakePiano() {
  const clock = { now: 0 }
  const played: { midi: number; vel: number; at: number; when: number }[] = []
  const thuds: number[] = []
  return {
    played,
    thuds,
    clock,
    ready: true,
    pedal: 0,
    play: (s: { midi: number; vel: number; at?: number }) =>
      played.push({ midi: s.midi, vel: s.vel, at: s.at ?? 0, when: clock.now + (s.at ?? 0) }),
    thud: (v: number) => thuds.push(v),
    stir: () => {},
    setPedal: () => {},
    setResonance: () => {},
    allOff: () => {},
  }
}

/** Pieces by name, because a test that says PIECES[3] breaks the moment
 *  somebody adds a piece and starts asserting things about a different one. */
export function piece(id: string) {
  const p = PIECES.find((x) => x.id === id)
  if (!p) throw new Error(`no piece called ${id}`)
  return p
}

/** The quickest thing to play to its end, for tests about endings. */
export const SHORTEST = 'chopsticks'

/** How many strokes of a hand it takes to play a piece through. One stroke is
 *  one gesture now, not a fixed number of pulses, so this has to ask the plan. */
export function strokesToFinish(p: { gestures: number[]; stride: number }) {
  return Math.ceil(p.gestures.length / p.stride) + 4
}

/** A piece whose two hands keep out of each other's register from the first
 *  bar, for tests that need to tell the staves apart by ear. The Bach prelude
 *  cannot do this: its hands share every pitch for the first several bars. */
export const TWO_VOICE = 'minuet-g'
