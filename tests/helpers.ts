// Synthetic hands. A keystroke is a fall and a lift; everything the detector
// believes about you it has to get from that shape alone.

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
        return { x: p.x, y, sy: y, spread: 0.5, conf: 1 }
      }),
    })
  }
  return out
}

/** A Piano that records instead of making noise. */
export function fakePiano() {
  const played: { midi: number; vel: number; at: number }[] = []
  const thuds: number[] = []
  return {
    played,
    thuds,
    ready: true,
    pedal: 0,
    play: (s: { midi: number; vel: number; at?: number }) =>
      played.push({ midi: s.midi, vel: s.vel, at: s.at ?? 0 }),
    thud: (v: number) => thuds.push(v),
    stir: () => {},
    setPedal: () => {},
    setResonance: () => {},
    allOff: () => {},
  }
}
