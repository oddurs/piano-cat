import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readHand, type LM } from '../lib/hand'
import { Perception } from '../lib/perception'
import { strikingY } from './helpers'

/** twenty-one landmarks in the shape of a hand, centred where you put it */
function landmarks(cx: number, cy: number, size = 0.12): LM[] {
  const at = (dx: number, dy: number): LM => ({ x: cx + dx * size, y: cy + dy * size, z: 0 })
  return [
    at(0, 0.9),                                             // wrist
    at(-0.6, 0.5), at(-0.8, 0.1), at(-0.9, -0.2), at(-1, -0.5),   // thumb
    at(-0.3, 0), at(-0.35, -0.5), at(-0.35, -0.8), at(-0.35, -1), // index
    at(0, 0), at(0, -0.55), at(0, -0.9), at(0, -1.1),             // middle
    at(0.3, 0), at(0.32, -0.5), at(0.32, -0.8), at(0.32, -1),     // ring
    at(0.6, 0.1), at(0.66, -0.3), at(0.7, -0.6), at(0.72, -0.8),  // little
  ]
}

test('a hand in the middle of the picture is read confidently', () => {
  const h = readHand(landmarks(0.5, 0.5), 0.95)
  assert.ok(h, 'a whole hand in shot should be readable')
  assert.ok(h!.conf > 0.8, `confidence was ${h!.conf.toFixed(2)}`)
  assert.equal(h!.fingers.length, 5)
})

test('a hand mostly out of the picture is refused', () => {
  // half of it past the left edge, which still produces twenty-one
  // coordinates that still move
  assert.equal(readHand(landmarks(-0.06, 0.5), 0.95), null)
  assert.equal(readHand(landmarks(0.5, 1.04), 0.95), null)
})

test('a hand right across the room is refused', () => {
  // far away, so its landmarks are a few pixels of noise
  assert.equal(readHand(landmarks(0.5, 0.5, 0.03), 0.95), null)
})

test('a hand the model is unsure about is read, but not confidently', () => {
  const sure = readHand(landmarks(0.5, 0.5), 0.95)!
  const unsure = readHand(landmarks(0.5, 0.5), 0.5)!
  assert.ok(unsure.conf < sure.conf * 0.7, `${unsure.conf.toFixed(2)} vs ${sure.conf.toFixed(2)}`)
})

test('a hand near the edge counts for less than one in the middle', () => {
  const middle = readHand(landmarks(0.5, 0.5), 0.95)!
  const edge = readHand(landmarks(0.12, 0.5), 0.95)!
  assert.ok(edge.conf < middle.conf, `${edge.conf.toFixed(2)} vs ${middle.conf.toFixed(2)}`)
})

// ------------------------------------------------ what actually gets played

const hand = (x: number, y: number, conf = 1) => ({
  x, y, sy: y, z: 0, fingers: [y, y, y, y, y], spread: 0.5, conf,
})

test('with the model watching, movement that is not a hand plays nothing', () => {
  // This is the whole complaint: the instrument kept playing when you took
  // your hands out of the picture, because anything moving in frame was
  // enough. If the camera can see hands, hands are what it plays.
  const p = new Perception()
  let n = 0
  for (let i = 0; i * (1 / 30) < 8; i++) {
    const t = i / 30
    n += p.ingest({
      t, capturedAt: t, watching: 'hands',
      energy: 0.3 + Math.sin(t * 9) * 0.25,      // a great deal of movement
      hands: [],                                  // none of it hand-shaped
    }).strokes.length
  }
  assert.equal(n, 0, `something that is not a hand played ${n} notes`)
})

test('a hand the model is unsure about plays nothing either', () => {
  const p = new Perception()
  let n = 0
  for (let i = 0; i * (1 / 30) < 8; i++) {
    const t = i / 30
    const y = strikingY(t, 0.5)
    n += p.ingest({
      t, capturedAt: t, watching: 'hands', energy: 0.02,
      hands: [hand(0.66, y, 0.3)],
    }).strokes.length
  }
  assert.equal(n, 0, `a guess played ${n} notes`)
})

test('and a hand it is sure about plays properly', () => {
  const p = new Perception()
  let n = 0
  for (let i = 0; i * (1 / 30) < 8; i++) {
    const t = i / 30
    const y = strikingY(t, 0.5)
    n += p.ingest({
      t, capturedAt: t, watching: 'hands', energy: 0.02,
      hands: [hand(0.66, y, 0.9)],
    }).strokes.length
  }
  assert.ok(n >= 12, `a hand in plain sight only played ${n} notes`)
})

test('with no hand model at all, whole-frame movement still plays', () => {
  // The fallback is not gone — it is the only thing a machine without the
  // model has, and there it is the right answer rather than a safety net.
  const p = new Perception()
  let n = 0
  for (let i = 0; i * (1 / 30) < 8; i++) {
    const t = i / 30
    n += p.ingest({
      t, capturedAt: t, watching: 'pixels',
      energy: 0.05 + Math.max(0, Math.sin(t * 12)) * 0.3,
      hands: [],
    }).strokes.length
  }
  assert.ok(n >= 6, `the fallback played only ${n} notes`)
})
