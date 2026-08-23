import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Perception } from '../lib/perception'
import { replay } from '../lib/capture'
import { clip, strikingY } from './helpers'

/** one synthetic hand: all five fingers pressing together unless said otherwise */
const hand = (x: number, y: number, z = 0, sy = y) => {
  const press = sy - z * 0.55
  return { x, y, sy, z, fingers: [press, press, press, press, press], spread: 0.5, conf: 1 }
}

test('every deliberate keystroke becomes a stroke — none are swallowed', () => {
  const period = 0.5
  const seconds = 6
  const frames = replay(clip(seconds, [{ side: 'R', period, x: 0.68 }]), new Perception())
  const strokes = frames.flatMap((f) => f.strokes)
  const expected = Math.floor(seconds / period)
  assert.ok(
    Math.abs(strokes.length - expected) <= 1,
    `expected ~${expected} strokes, got ${strokes.length}`,
  )
})

test('a trill is not thinned out', () => {
  const period = 0.16               // just over 6 strokes a second, per hand
  const seconds = 4
  const frames = replay(clip(seconds, [{ side: 'R', period, x: 0.68 }], 60), new Perception())
  const strokes = frames.flatMap((f) => f.strokes)
  const expected = Math.floor(seconds / period)
  assert.ok(
    strokes.length >= expected - 2,
    `expected at least ${expected - 2} strokes, got ${strokes.length}`,
  )
})

test('a hand held still plays nothing while the other hand plays', () => {
  const frames = replay(
    clip(6, [
      { side: 'L', period: null, x: 0.3 },
      { side: 'R', period: 0.5, x: 0.7 },
    ]),
    new Perception(),
  )
  const strokes = frames.flatMap((f) => f.strokes)
  assert.ok(strokes.length > 6, `expected the right hand to play, got ${strokes.length}`)
  assert.equal(strokes.filter((s) => s.side === 'L').length, 0)
})

test('both hands are read independently', () => {
  const frames = replay(
    clip(6, [
      { side: 'L', period: 0.75, x: 0.3 },
      { side: 'R', period: 0.4, x: 0.7 },
    ]),
    new Perception(),
  )
  const strokes = frames.flatMap((f) => f.strokes)
  const left = strokes.filter((s) => s.side === 'L').length
  const right = strokes.filter((s) => s.side === 'R').length
  assert.ok(left >= 6, `left hand: ${left}`)
  assert.ok(right >= 12, `right hand: ${right}`)
  assert.ok(right > left, 'the faster hand should produce more strokes')
})

test('replaying a clip twice gives exactly the same performance', () => {
  const c = clip(5, [{ side: 'R', period: 0.45, x: 0.6 }])
  const a = replay(c, new Perception()).flatMap((f) => f.strokes)
  const b = replay(c, new Perception()).flatMap((f) => f.strokes)
  assert.deepEqual(a.map((s) => [s.t, s.side]), b.map((s) => [s.t, s.side]))
})

test('the pedal range is learned while you play, with no calibration step', () => {
  const p = new Perception()
  // hands sweep from high (y=0.15) to low (y=0.8) in the course of playing
  const sweep = Array.from({ length: 60 }, (_, i) => {
    const t = i / 30
    const y = 0.15 + (i / 59) * 0.65
    return { t, capturedAt: t, energy: 0, hands: [hand(0.5, y)] }
  })
  for (const s of sweep) p.ingest(s)

  const high = p.ingest({ t: 3, capturedAt: 3, energy: 0, hands: [hand(0.5, 0.15, 0)] })
  const low = p.ingest({ t: 3.1, capturedAt: 3.1, energy: 0, hands: [hand(0.5, 0.8, 0)] })
  assert.ok(high.height > 0.9, `hands up should read as pedal down: ${high.height}`)
  assert.ok(low.height < 0.1, `hands down should damp: ${low.height}`)
})


test('a room that is never learned still has a usable pedal', () => {
  // Somebody who keeps their hands in a narrow band should still be able to
  // reach both ends of the pedal rather than being stuck at half.
  const p = new Perception()
  const at = (t: number, y: number) =>
    p.ingest({ t, capturedAt: t, energy: 0, hands: [hand(0.5, y)] })
  for (let i = 0; i < 30; i++) at(i / 30, 0.5)
  assert.ok(at(1.1, 0.3).height > 0.75, 'lifting still opens the dampers')
  assert.ok(at(1.2, 0.72).height < 0.25, 'lowering still closes them')
})

test('the pedal range is learned at the same speed on any display', () => {
  const learn = (fps: number) => {
    const p = new Perception()
    const dt = 1 / fps
    for (let i = 0; i * dt < 2; i++) {
      const t = i * dt
      // hold the hands high for two seconds
      p.ingest({ t, capturedAt: t, energy: 0, hands: [hand(0.5, 0.18, 0)] })
    }
    // then read where the middle of the range now sits
    return p.ingest({
      t: 2.1, capturedAt: 2.1, energy: 0,
      hands: [hand(0.5, 0.45, 0)],
    }).height
  }
  const a = learn(30), b = learn(60), c = learn(144)
  assert.ok(Math.abs(a - b) < 0.02, `30Hz gave ${a.toFixed(3)}, 60Hz gave ${b.toFixed(3)}`)
  assert.ok(Math.abs(b - c) < 0.02, `60Hz gave ${b.toFixed(3)}, 144Hz gave ${c.toFixed(3)}`)
})

test('reaching forward plays a note, not only pressing down', () => {
  // In the air there is no key to stop your hand, so people push towards the
  // camera as readily as they push down. Reading only the vertical threw half
  // of that away and left them waving harder at something that ignored them.
  const p = new Perception()
  const strokes: string[] = []
  const fps = 30
  for (let i = 0; i * (1 / fps) < 6; i++) {
    const t = i / fps
    // hand stays at a constant height; only its depth moves, in and out
    const ph = ((t % 0.5) / 0.5)
    const z = ph < 0.35 ? -(ph / 0.35) * 0.22 : -(1 - (ph - 0.35) / 0.65) * 0.22
    const f = p.ingest({
      t, capturedAt: t, energy: 0.02,
      hands: [hand(0.62, 0.5, z)],
    })
    for (const s of f.strokes) strokes.push(s.side)
  }
  assert.ok(strokes.length >= 8, `a forward press should play: got ${strokes.length} strokes in 6s`)
})

test('a hand that neither drops nor presses stays silent', () => {
  const p = new Perception()
  let n = 0
  for (let i = 0; i * (1 / 30) < 5; i++) {
    const t = i / 30
    // drifting sideways only — no press in any direction
    const x = 0.4 + Math.sin(t * 2) * 0.15
    n += p.ingest({
      t, capturedAt: t, energy: 0.02,
      hands: [hand(x, 0.5)],
    }).strokes.length
  }
  assert.equal(n, 0, `moving sideways should not play notes, got ${n}`)
})

test('one finger tapping is a note, even with the hand held still', () => {
  // The commonest thing anybody actually does, and the old detector watched a
  // single averaged point which one finger barely moves at all.
  const p = new Perception()
  let n = 0
  for (let i = 0; i * (1 / 30) < 6; i++) {
    const t = i / 30
    const ph = ((t % 0.5) / 0.5)
    const tap = ph < 0.35 ? 0.5 + (ph / 0.35) * 0.16 : 0.5 + (1 - (ph - 0.35) / 0.65) * 0.16
    // the hand sits still; the index finger works
    n += p.ingest({
      t, capturedAt: t, energy: 0.02,
      hands: [{ x: 0.66, y: 0.5, sy: 0.5, z: 0, fingers: [0.5, tap, 0.5, 0.5, 0.5], spread: 0.5, conf: 1 }],
    }).strokes.length
  }
  assert.ok(n >= 8, `a tapping finger should play: got ${n} strokes in 6s`)
})

test('a delicate gesture is still heard', () => {
  // Somebody playing quietly gets a small movement, and a fixed floor simply
  // does not hear them. The reply to not being heard is to wave harder, which
  // is the opposite of what an instrument should be teaching anyone.
  const play = (depth: number) => {
    const p = new Perception()
    let n = 0
    for (let i = 0; i * (1 / 30) < 8; i++) {
      const t = i / 30
      const y = strikingY(t, 0.55, depth, 0.45)
      n += p.ingest({
        t, capturedAt: t, energy: 0.02,
        hands: [{ x: 0.66, y, sy: y, z: 0, fingers: [y, y, y, y, y], spread: 0.5, conf: 1 }],
      }).strokes.length
    }
    return n
  }
  assert.ok(play(0.18) >= 11, `a normal gesture: ${play(0.18)}`)
  assert.ok(play(0.07) >= 9, `a small one should still be heard: ${play(0.07)}`)
})

test('a flatter hand plays a harder note', () => {
  const at = (moving: number) => {
    const p = new Perception()
    const out: number[] = []
    for (let i = 0; i * (1 / 30) < 4; i++) {
      const t = i / 30
      // gently, so the difference is visible rather than clipped at full
      const y = strikingY(t, 0.5, 0.07, 0.47)
      const fingers = Array.from({ length: 5 }, (_, k) => (k < moving ? y : 0.5))
      for (const s of p.ingest({
        t, capturedAt: t, energy: 0.02,
        hands: [{ x: 0.66, y: 0.5, sy: 0.5, z: 0, fingers, spread: 0.5, conf: 1 }],
      }).strokes) out.push(s.strength)
    }
    return out.reduce((a, b) => a + b, 0) / Math.max(1, out.length)
  }
  assert.ok(at(5) > at(1) * 1.15, `five fingers ${at(5).toFixed(2)} vs one ${at(1).toFixed(2)}`)
})

test('onsets are not rounded to the camera frame', () => {
  // The crossing happens between frames, so where in between is worth
  // knowing: at thirty frames a second, rounding to the frame throws away up
  // to a thirtieth of a second of the tempo you are actually setting.
  const p = new Perception()
  const ts: number[] = []
  for (let i = 0; i * (1 / 30) < 6; i++) {
    const t = i / 30
    const y = strikingY(t, 0.47)
    for (const s of p.ingest({
      t, capturedAt: t, energy: 0.02,
      hands: [{ x: 0.66, y, sy: y, z: 0, fingers: [y, y, y, y, y], spread: 0.5, conf: 1 }],
    }).strokes) ts.push(s.t)
  }
  assert.ok(ts.length > 6, `only ${ts.length} strokes`)
  const onFrame = ts.filter((t) => Math.abs(t * 30 - Math.round(t * 30)) < 1e-6).length
  assert.ok(onFrame < ts.length, 'every onset landed exactly on a frame boundary')
})
