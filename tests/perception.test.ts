import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Perception } from '../lib/perception'
import { replay } from '../lib/capture'
import { clip } from './helpers'

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
    return { t, capturedAt: t, energy: 0, hands: [{ x: 0.5, y, sy: y, z: 0, spread: 0.5, conf: 1 }] }
  })
  for (const s of sweep) p.ingest(s)

  const high = p.ingest({ t: 3, capturedAt: 3, energy: 0, hands: [{ x: 0.5, y: 0.15, sy: 0.15, z: 0, spread: 0.5, conf: 1 }] })
  const low = p.ingest({ t: 3.1, capturedAt: 3.1, energy: 0, hands: [{ x: 0.5, y: 0.8, sy: 0.8, z: 0, spread: 0.5, conf: 1 }] })
  assert.ok(high.height > 0.9, `hands up should read as pedal down: ${high.height}`)
  assert.ok(low.height < 0.1, `hands down should damp: ${low.height}`)
})


test('a room that is never learned still has a usable pedal', () => {
  // Somebody who keeps their hands in a narrow band should still be able to
  // reach both ends of the pedal rather than being stuck at half.
  const p = new Perception()
  const at = (t: number, y: number) =>
    p.ingest({ t, capturedAt: t, energy: 0, hands: [{ x: 0.5, y, sy: y, z: 0, spread: 0.5, conf: 1 }] })
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
      p.ingest({ t, capturedAt: t, energy: 0, hands: [{ x: 0.5, y: 0.18, sy: 0.18, z: 0, spread: 0.5, conf: 1 }] })
    }
    // then read where the middle of the range now sits
    return p.ingest({
      t: 2.1, capturedAt: 2.1, energy: 0,
      hands: [{ x: 0.5, y: 0.45, sy: 0.45, z: 0, spread: 0.5, conf: 1 }],
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
      hands: [{ x: 0.62, y: 0.5, sy: 0.5, z, spread: 0.5, conf: 1 }],
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
      hands: [{ x, y: 0.5, sy: 0.5, z: 0, spread: 0.5, conf: 1 }],
    }).strokes.length
  }
  assert.equal(n, 0, `moving sideways should not play notes, got ${n}`)
})
