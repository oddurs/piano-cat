// A performance you can keep.
//
// A take is what you *did*, not what you looked like doing it: the moments you
// struck, which hand, how hard, and four numbers describing the shape you were
// asking for. There is no imagery in here at any point and there must never
// be — `Sample.hands` from the camera is landmark coordinates, and not even
// those are carried this far. A take is a few hundred numbers, and that is a
// property worth being able to state without going and checking.

import type { Report } from './conductor'
import type { Side } from './signal'

/** how often the continuous half of a performance is sampled */
const SHAPE_HZ = 12
const B = 255

export type Take = {
  piece: string
  seconds: number
  strokes: { t: number; side: Side; strength: number }[]
  shape: { t: number; dyn: number; height: number; spread: number }[]
  report: Report
}

export class TakeRecorder {
  private t0 = 0
  private nextShape = 0
  private take: Take | null = null

  start(piece: string, now: number) {
    this.t0 = now
    this.nextShape = 0
    this.take = { piece, seconds: 0, strokes: [], shape: [], report: null as unknown as Report }
  }

  stroke(now: number, side: Side, strength: number) {
    const t = this.take
    if (!t) return
    t.strokes.push({ t: +(now - this.t0).toFixed(3), side, strength: +strength.toFixed(3) })
  }

  sample(now: number, dyn: number, height: number, spread: number) {
    const t = this.take
    if (!t) return
    const at = now - this.t0
    if (at < this.nextShape) return
    this.nextShape = at + 1 / SHAPE_HZ
    t.shape.push({
      t: +at.toFixed(3),
      dyn: +dyn.toFixed(3),
      height: +height.toFixed(3),
      spread: +spread.toFixed(3),
    })
  }

  finish(now: number, report: Report): Take | null {
    const t = this.take
    if (!t || !t.strokes.length) return null

    // Recording starts when the piece does, but a performance starts when you
    // do — and between them sit the count-in and however long you took to
    // raise your hands. Shipping that silence at the front of a shared link
    // means the first thing it plays is nothing.
    const t0 = t.strokes[0].t
    t.strokes = t.strokes.map((s) => ({ ...s, t: +(s.t - t0).toFixed(3) }))
    t.shape = t.shape
      .filter((s) => s.t >= t0)
      .map((s) => ({ ...s, t: +(s.t - t0).toFixed(3) }))
    t.seconds = +(now - this.t0 - t0).toFixed(2)
    t.report = report
    this.take = null
    return t
  }

  get recording() { return this.take !== null }
}

// ------------------------------------------------------------------ the wire

/**
 * Compact enough to live in a URL. Everything is quantised — a hundredth of a
 * second of timing and a 255th of a dynamic are both far below what anyone can
 * hear, and the difference between this and pretty-printed JSON is the
 * difference between a link you can send and one you can't.
 */
export function encodeTake(t: Take): string {
  const strokes: number[] = []
  for (const s of t.strokes) {
    strokes.push(Math.round(s.t * 100), s.side === 'L' ? 0 : 1, Math.round(s.strength * B))
  }
  const shape: number[] = []
  for (const s of t.shape) {
    shape.push(Math.round(s.dyn * B), Math.round(s.height * B), Math.round(s.spread * B))
  }
  const r = t.report
  const packed = [
    1, t.piece, Math.round(t.seconds * 100), strokes, shape,
    [Math.round(r.steadiness * B), Math.round(r.range * B), r.notes, r.strokes, Math.round(r.bpm)],
    r.grade, r.line,
  ]
  return b64url(new TextEncoder().encode(JSON.stringify(packed)))
}

export function decodeTake(s: string): Take | null {
  try {
    const packed = JSON.parse(new TextDecoder().decode(unb64url(s)))
    if (!Array.isArray(packed) || packed[0] !== 1) return null
    const [, piece, cs, st, sh, rep, grade, line] = packed
    const strokes: Take['strokes'] = []
    for (let i = 0; i + 2 < st.length; i += 3) {
      strokes.push({ t: st[i] / 100, side: st[i + 1] ? 'R' : 'L', strength: st[i + 2] / B })
    }
    const shape: Take['shape'] = []
    for (let i = 0, k = 0; i + 2 < sh.length; i += 3, k++) {
      shape.push({ t: k / SHAPE_HZ, dyn: sh[i] / B, height: sh[i + 1] / B, spread: sh[i + 2] / B })
    }
    return {
      piece,
      seconds: cs / 100,
      strokes,
      shape,
      report: {
        steadiness: rep[0] / B, range: rep[1] / B, notes: rep[2],
        strokes: rep[3], bpm: rep[4], grade, line,
      },
    }
  } catch {
    return null
  }
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

// ---------------------------------------------------------------- the replay

/** Hands the recorded performance back one frame at a time. */
export class TakePlayer {
  private i = 0
  private t = 0

  constructor(public take: Take) {}

  /** Advance by dt and return whatever the player did in that slice. */
  advance(dt: number) {
    this.t += dt
    const strokes: Take['strokes'] = []
    while (this.i < this.take.strokes.length && this.take.strokes[this.i].t <= this.t) {
      strokes.push(this.take.strokes[this.i++])
    }
    return { strokes, shape: this.shapeAt(this.t), t: this.t }
  }

  private shapeAt(t: number) {
    const sh = this.take.shape
    if (!sh.length) return { dyn: 0.5, height: 0.5, spread: 0.5 }
    const k = Math.min(sh.length - 1, Math.max(0, Math.floor(t * SHAPE_HZ)))
    return sh[k]
  }

  get done() { return this.i >= this.take.strokes.length && this.t > this.take.seconds }
  get progress() { return Math.min(1, this.t / Math.max(0.001, this.take.seconds)) }
  reset() { this.i = 0; this.t = 0 }
}

// ------------------------------------------------------------------- storage

const KEY = 'piano-cat.last-take'

export function saveTake(t: Take) {
  try { localStorage.setItem(KEY, encodeTake(t)) } catch { /* private window, fine */ }
}

export function loadTake(): Take | null {
  try {
    const s = localStorage.getItem(KEY)
    return s ? decodeTake(s) : null
  } catch {
    return null
  }
}
