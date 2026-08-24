// The shape of what the camera tells us, and nothing else. No DOM, no audio —
// so the detectors in ./onset.ts and the follower in ./conductor.ts can be
// driven from a recorded clip in a test as easily as from a live webcam.

export type Side = 'L' | 'R'
export const SIDES: Side[] = ['L', 'R']

/** One hand, as we care about it. Positions are 0..1 of the frame, mirrored
 *  so that moving your right hand moves the hand we call R. */
export type Hand = {
  side: Side
  present: boolean
  conf: number
  x: number          // 0 = far left of frame, 1 = far right
  y: number          // 0 = top, 1 = bottom
  vy: number         // frame-heights per second, positive = falling
  speed: number      // total wrist speed, frame-heights per second
  spread: number     // 0..1 finger span — a fist vs an open hand
  lastStroke: number // seconds since this hand last struck, Infinity if never
}

export const restingHand = (side: Side): Hand => ({
  side, present: false, conf: 0, x: side === 'L' ? 0.32 : 0.68, y: 0.55,
  vy: 0, speed: 0, spread: 0.5, lastStroke: Infinity,
})

/** A keystroke, the moment we are confident one is happening. */
export type Stroke = {
  side: Side
  t: number          // seconds, on the same clock as everything else
  strength: number   // 0..1, hammer speed
  x: number          // where across the frame it happened
  latency: number    // camera capture -> this decision, in seconds
}

/** Everything one video frame yields. The renderer, the conductor and the
 *  instrument all read from this and nothing else. */
export type PlayFrame = {
  t: number
  hands: Record<Side, Hand>
  strokes: Stroke[]
  tracked: boolean   // true when we are really seeing hands, not just pixels
  energy: number     // 0..1 raw movement right now
  dyn: number        // 0..1 how loud you are asking to be
  wild: number       // 0..1 how uneven you are being
  height: number     // 0..1 mean hand height, 1 = high -> pedal down
  spread: number     // 0..1 mean hand spread -> voicing width
  travel: number     // 0..1 how fast your hands are moving *right now*
  /** ok: playing. partly: something hand-shaped, too little of it to trust.
   *  none: nothing hand-shaped at all. */
  framing: 'ok' | 'partly' | 'none'
  pixels: Uint8Array
  motionMask: Uint8Array
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Frame-rate independent one-pole coefficient. `tau` is the time to close
 *  ~63% of the gap, in seconds. */
export const lerpRate = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1e-4, tau))
