// Deciding whether the thing in front of the camera is a hand, and whether
// enough of it is in the picture to play with.
//
// A landmark set comes back whether or not what it is looking at is a hand,
// and whether or not all of it is in shot. Half a hand at the edge of frame
// still has twenty-one coordinates and they still move — so with no checks at
// all, a shoulder leaving the picture plays a chord, and so does somebody
// walking past behind you.
//
// No DOM in here, so every one of these judgements is testable.

import type { Observation } from './perception'

export type LM = { x: number; y: number; z: number }

const WRIST = 0
const PALM = [0, 5, 9, 13, 17]
const TIPS = [8, 12, 16]
const THUMB_TIP = 4
const PINKY_TIP = 20
const MIDDLE_MCP = 9
/** thumb, index, middle, ring, little */
const FINGERS = [4, 8, 12, 16, 20]
/** how much a press towards the camera counts alongside a press downwards */
const PRESS_DEPTH = 0.55

/** at least this much of the hand has to be inside the picture */
export const MIN_FRAMED = 0.7
/** and it has to be near enough that its landmarks mean something */
export const MIN_PALM = 0.045

export function readHand(lm: LM[], score: number): Observation | null {
  if (!lm || lm.length < 21) return null

  let inside = 0
  for (const p of lm) if (p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99) inside++
  const framed = inside / lm.length
  if (framed < MIN_FRAMED) return null

  let px = 0
  let py = 0
  for (const i of PALM) { px += lm[i].x; py += lm[i].y }
  px /= PALM.length
  py /= PALM.length

  let sy = 0
  let pz = 0
  for (const i of TIPS) sy += lm[i].y
  sy /= TIPS.length
  for (const i of PALM) pz += lm[i].z ?? 0
  pz /= PALM.length

  const palm = Math.hypot(lm[MIDDLE_MCP].x - lm[WRIST].x, lm[MIDDLE_MCP].y - lm[WRIST].y) || 1e-3
  // a hand across the room is a few pixels of noise wearing a confident label
  if (palm < MIN_PALM) return null
  const span = Math.hypot(lm[THUMB_TIP].x - lm[PINKY_TIP].x, lm[THUMB_TIP].y - lm[PINKY_TIP].y) / palm

  return {
    x: 1 - px,                                     // mirrored to match the backdrop
    y: py,
    sy,
    z: pz,
    // Each finger's own press. Averaging them first hid the thing worth
    // seeing: one finger falling while the rest of the hand stays put is a
    // note, and it barely moves an average at all.
    fingers: FINGERS.map((i) => lm[i].y - (lm[i].z ?? 0) * PRESS_DEPTH),
    spread: Math.max(0, Math.min(1, (span - 0.7) / 1.1)),
    // the model's own confidence, tempered by how much of the hand we can see
    // and how close it is — a hand at the very edge is a hand we are guessing
    conf: Math.max(0, Math.min(1, score * (0.45 + framed * 0.55) * Math.min(1, palm / 0.07))),
  }
}
