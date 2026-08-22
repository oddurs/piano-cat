// Record what the camera saw, replay it later. Tuning an onset detector by
// standing in front of a laptop and waving is how you end up with an
// instrument that eats half your gestures; this is how you stop doing that.

import type { Perception, Sample } from './perception'
import type { PlayFrame } from './signal'

export class Recorder {
  private clip: Sample[] = []
  private seconds: number

  constructor(seconds = 30) { this.seconds = seconds }

  push(s: Sample) {
    this.clip.push(s)
    while (this.clip.length && s.t - this.clip[0].t > this.seconds) this.clip.shift()
  }

  get length() { return this.clip.length }
  get span() { return this.clip.length ? this.clip[this.clip.length - 1].t - this.clip[0].t : 0 }

  /** Rebase to t=0 so a clip is comparable with any other clip. */
  toJSON(): Sample[] {
    if (!this.clip.length) return []
    const t0 = this.clip[0].t
    return this.clip.map((s) => ({ ...s, t: s.t - t0, capturedAt: s.capturedAt - t0 }))
  }

  download(name = 'piano-cat-clip.json') {
    const blob = new Blob([JSON.stringify(this.toJSON())], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }

  clear() { this.clip = [] }
}

/** Feed a recorded clip through a fresh Perception. Deterministic — the same
 *  clip always yields the same strokes, which is what makes tests possible. */
export function replay(clip: Sample[], p: Perception): PlayFrame[] {
  p.reset()
  return clip.map((s) => p.ingest(s))
}

// ------------------------------------------------------------------- probe

/** Rolling latency figures, in milliseconds. */
export class Probe {
  private xs: number[] = []
  constructor(private size = 120) {}

  add(seconds: number) {
    this.xs.push(seconds * 1000)
    if (this.xs.length > this.size) this.xs.shift()
  }

  private pct(q: number) {
    if (!this.xs.length) return 0
    const s = [...this.xs].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]
  }

  get p50() { return this.pct(0.5) }
  get p95() { return this.pct(0.95) }
  get n() { return this.xs.length }
  clear() { this.xs = [] }
}
