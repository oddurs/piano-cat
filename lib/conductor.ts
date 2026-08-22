import type { NoteEv, Piece } from './pieces'
import type { Piano } from './audio'
import { clamp, lerpRate, SIDES, type Side } from './signal'

export type Expression = {
  dyn: number                          // 0..1 overall loudness you are asking for
  wild: number                         // 0..1 scruffiness -> velocity scatter
  height: number                       // 0..1 hands high -> pedal down, brighter
  spread: number                       // 0..1 open hands -> wider voicing
  travel: number                       // 0..1 how fast you are moving right now
  present: Record<Side, boolean>       // which hands are actually on the instrument
  x: Record<Side, number>              // 0..1 where each hand is across the frame
  /** false when you are playing from the keyboard or on auto — then both
   *  staves are always engaged, because there is no hand to hold back. */
  twoHanded: boolean
}

export type StrikeKind = 'start' | 'beat' | 'chord' | 'ornament' | 'over'
export type FiredNote = { p: number; vel: number; t: number; kind: 'note' | 'ornament' }

/** What the performance was like, once there is a whole one to judge. */
export type Report = {
  steadiness: number   // 0..1, how even your pulse was
  range: number        // 0..1, how much of the dynamic range you used
  notes: number
  strokes: number
  bpm: number
  grade: string
  line: string         // what the cat makes of it
}

const DYN_MARKS: [number, string][] = [
  [0.10, 'ppp'], [0.20, 'pp'], [0.34, 'p'], [0.48, 'mp'],
  [0.62, 'mf'], [0.78, 'f'], [0.92, 'ff'], [1.01, 'fff'],
]
export const dynMark = (d: number) => DYN_MARKS.find(([t]) => d < t)?.[1] ?? 'fff'

/** Two hands within this of each other are one gesture: a chord, not a beat. */
const CHORD_WINDOW = 0.095
/** A staff whose hand has gone quiet fades to this rather than vanishing. */
const GHOST = 0.2
/** Notes that arrive in a clump get spread by this much, per distinct beat... */
const FLOURISH = 0.018
/** ...but the whole flourish still has to read as one gesture. */
const FLOURISH_MAX = 0.15

const staffOf = (n: NoteEv): Side => (n.h === -1 ? 'L' : n.h === 1 ? 'R' : n.p < 60 ? 'L' : 'R')

/**
 * Beat follower.
 *
 * Your strikes are beat markers, not note triggers. From them we estimate a
 * period and then *predict* where the music should be at any instant,
 * interpolating between beats. Stop waving and the prediction asymptotes into
 * the next beat rather than slamming into it — it reads as a ritardando
 * settling onto a fermata.
 *
 * Two rules matter more than any of that, though:
 *
 *  1. A stroke that lands on the beat moves the playhead *now*, not once a
 *     damped follower has caught up. Notes that get skipped past come out as
 *     a flourish over the next few tens of milliseconds instead of a fistful
 *     in one frame.
 *  2. Nothing you do is ever thrown away. A stroke too close to the last one
 *     is not a mistimed beat to be swallowed, it is an ornament — and it
 *     sounds. An instrument that ignores you is not an instrument.
 */
export class Conductor {
  piece: Piece
  private piano: Piano
  private notes: NoteEv[]
  private idx = 0

  /** pulses per stroke of your hand. 1 = you wave every beat. */
  stride: number
  pos = 0                  // absolute pulses, monotonic
  private beatOrigin = 0   // pos of the most recent stroke
  period: number           // seconds per stroke
  started = false
  loops = 0

  private lastStrikeAt = -1
  private lastSide: Side = 'R'
  private strikeCount = 0
  private hit: Record<Side, number> = { L: 0.6, R: 0.6 }
  /** 0..1 how much each hand is currently part of the performance */
  engage: Record<Side, number> = { L: 1, R: 1 }
  private held: Record<Side, NoteEv[]> = { L: [], R: [] }
  private lastOf: Partial<Record<Side, NoteEv>> = {}
  private pendingWrap = 0
  /** Have we ever seen both hands at once? Until we have, neither staff rests. */
  private everBoth = false

  /**
   * A performance ends. Looping forever is what a toy does; a piece that
   * stops on its last chord is something you can finish, be judged on, and
   * play again on purpose. Encore turns the wrap back on.
   */
  loop = false
  finished = false
  private tally = { strokes: 0, notes: 0, dynLo: 1, dynHi: 0, steadySum: 0, steadyN: 0 }

  intervals: number[] = []
  lastFired: FiredNote[] = []
  strikeFlash = 0
  ornamentFlash = 0
  lastHand: -1 | 1 = -1
  phase = 0                // 0..1 through the current stroke
  pedal = 0

  constructor(piece: Piece, piano: Piano) {
    this.piece = piece
    this.piano = piano
    this.notes = piece.notes
    this.stride = piece.stride
    this.period = (60 / piece.pulseBpm) * piece.stride
    piano.setResonance(piece.resonance)
  }

  get playhead() { return this.pos % this.piece.loopAt }
  /** musical beats per minute, not strokes per minute */
  get bpm() { return (60 / this.period) * this.stride }
  get beatInBar() { return Math.floor(this.playhead) % this.piece.pulsesPerBar }
  get progress() { return this.playhead / this.piece.loopAt }
  get idleFor() { return this.lastStrikeAt < 0 ? 0 : performance.now() / 1000 - this.lastStrikeAt }

  /** 0 = metronomic, 1 = shambolic */
  get unsteadiness() {
    if (this.intervals.length < 3) return 0
    const xs = this.intervals.slice(-8)
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
    return Math.min(1, sd / mean / 0.45)
  }

  setStride(s: number) {
    this.period = (this.period / this.stride) * s
    this.stride = s
    this.beatOrigin = this.pos
  }

  // ----------------------------------------------------------------- strikes

  /**
   * You mimed a keystroke. Always audible, one way or another — the return
   * value says which way.
   */
  strike(now: number, strength: number, side: Side): StrikeKind {
    if (this.finished) return 'over'
    this.tally.strokes += 1
    this.hit[side] += (strength - this.hit[side]) * 0.55
    this.engage[side] = 1
    this.lastHand = side === 'L' ? -1 : 1

    if (!this.started) {
      this.started = true
      this.lastStrikeAt = now
      this.lastSide = side
      this.beatOrigin = 0
      this.strikeCount = 1
      this.strikeFlash = 1
      return 'start'
    }

    const gap = now - this.lastStrikeAt

    // Both hands together is a chord, not two beats. The staff that was
    // holding back gets its notes now, at full weight.
    if (gap < CHORD_WINDOW && side !== this.lastSide) {
      this.lastSide = side
      this.strikeFlash = Math.max(this.strikeFlash, 0.8)
      this.reinforce(side, now, strength)
      return 'chord'
    }

    // Long enough to swallow a hand bouncing, short enough that a genuine
    // change of pace always gets through. Anything inside it still sounds.
    const refractory = clamp(this.period * 0.34, 0.1, 0.28)
    if (gap < refractory) {
      this.ornament(side, strength, now)
      return 'ornament'
    }

    this.lastSide = side
    this.strikeFlash = 1

    if (gap < 3.5) {
      const ratio = gap / this.period
      // Believe a new tempo more while you're settling in, much less when it
      // looks like a stumble rather than a real change of pace.
      let trust = this.strikeCount < 5 ? 0.45 : 0.26
      if (ratio < 0.65 || ratio > 1.6) trust *= 0.35
      this.period = clamp(this.period * (1 - trust) + gap * trust, 0.28, 2.6)
      this.intervals.push(gap)
      if (this.intervals.length > 16) this.intervals.shift()
    }
    this.lastStrikeAt = now
    this.beatOrigin += this.stride
    this.strikeCount += 1

    // The beat moves *now*. update() runs in the same frame and the notes on
    // this beat sound with the gesture that asked for them.
    this.advance(this.beatOrigin)
    return 'beat'
  }

  /** The only place pos ever moves. Anywhere else and a take that rolls over
   *  mid-strike loses its wrap, and the piece goes quiet for good. */
  private advance(to: number) {
    if (to <= this.pos) return
    // Stated as a bound rather than a crossing: once pos sits exactly on
    // loopAt the floor has already ticked over, so a crossing test stops
    // firing and the playhead walks straight off the end of the piece.
    if (!this.loop && to >= this.piece.loopAt) {
      this.pos = this.piece.loopAt
      this.finished = true
      return
    }
    const was = Math.floor(this.pos / this.piece.loopAt)
    this.pos = to
    const now = Math.floor(this.pos / this.piece.loopAt)
    // Only record that a wrap is owed. Resetting the note cursor here dropped
    // whatever was left of the take between the last note played and the loop
    // point — a small hole at the top of every repeat. update() has the
    // context to actually play those before starting again.
    if (now !== was) this.pendingWrap += now - was
  }

  /** A flourish between the beats: a note from this staff, light and quick. */
  private ornament(side: Side, strength: number, now: number) {
    this.ornamentFlash = 1
    this.piano.thud(0.25 + strength * 0.4, side === 'L' ? -0.35 : 0.35)

    const head = this.playhead
    let pick: NoteEv | undefined
    for (let i = this.idx; i < this.notes.length; i++) {
      const n = this.notes[i]
      if (n.b > head + 2) break
      if (staffOf(n) === side) { pick = n; break }
    }
    pick ??= this.lastOf[side]
    if (!pick) return

    const secPerPulse = this.period / this.stride
    const vel = clamp(pick.v * (0.3 + strength * 0.4) * (0.5 + this.engage[side] * 0.5), 0.05, 0.7)
    this.piano.play({
      midi: pick.p,
      vel,
      dur: Math.min(0.35, pick.d) * secPerPulse,
      release: this.piece.release * 0.6,
      pan: (pick.p < 60 ? -0.22 : 0.18) + (side === 'L' ? -0.12 : 0.12),
    })
    this.lastFired.push({ p: pick.p, vel, t: now, kind: 'ornament' })
  }

  /** The other hand joining in a moment late: play what it was holding back. */
  private reinforce(side: Side, now: number, strength: number) {
    const waiting = this.held[side]
    this.held[side] = []
    if (!waiting.length) { this.ornament(side, strength, now); return }
    const secPerPulse = this.period / this.stride
    for (const n of waiting) {
      const vel = clamp(n.v * (0.6 + strength * 0.6), 0.05, 1)
      this.piano.play({
        midi: n.p, vel, dur: n.d * secPerPulse,
        release: this.piece.release,
        pan: n.p < 60 ? -0.22 : 0.18,
      })
      this.lastFired.push({ p: n.p, vel, t: now, kind: 'note' })
      this.lastOf[side] = n
    }
  }

  // ------------------------------------------------------------------ update

  update(dt: number, now: number, ex: Expression) {
    this.strikeFlash = Math.max(0, this.strikeFlash - dt * 4.5)
    this.ornamentFlash = Math.max(0, this.ornamentFlash - dt * 6)

    // How much of each hand is in the performance. A hand you are holding
    // still rests; a hand that has left the frame stops playing altogether.
    // A staff only rests once you have shown us the hand that plays it. Play
    // one-handed all session and you still get the whole piece; put a second
    // hand up once and from then on taking it away means something.
    if (ex.present.L && ex.present.R) this.everBoth = true
    for (const s of SIDES) {
      const floor = !ex.twoHanded || !this.everBoth ? 1 : ex.present[s] ? GHOST : 0
      this.engage[s] += (floor - this.engage[s]) * lerpRate(dt, 1.3)
    }

    // Hands high, dampers up. This is continuous and it is always live, which
    // is what makes the instrument answer between the notes.
    this.pedal = ex.height
    this.piano.setPedal(ex.height)
    const meanX = ex.present.L && ex.present.R
      ? (ex.x.L + ex.x.R) / 2
      : ex.present.L ? ex.x.L : ex.present.R ? ex.x.R : 0.5
    this.piano.stir(ex.travel, meanX, ex.dyn)

    if (!this.started) return

    // where the music *should* be if you keep going at this pace
    let frac = (now - this.lastStrikeAt) / this.period
    if (frac > 0.88) frac = 0.88 + 0.12 * (1 - Math.exp(-(frac - 0.88) * 1.1))
    this.phase = Math.min(1, frac)
    const target = this.beatOrigin + frac * this.stride

    // Damped chase for everything *between* strikes. Tighter than it was:
    // the follower is now only smoothing prediction error, not absorbing the
    // strike itself, so it no longer needs to hide a lag.
    const maxRate = (6 * this.stride) / this.period
    const pull = (target - this.pos) * Math.min(1, dt * 22)
    this.advance(this.pos + Math.min(pull, maxRate * dt))

    // Everything the playhead just passed, spread over a window sized to how
    // much there is. Notes written on the same beat stay together; distinct
    // beats always get distinct instants, however many got skipped — a fixed
    // spacing with a fixed cap used to pile a whole stroke of sixteenths onto
    // the same millisecond at WAVE 4.
    this.tally.dynLo = Math.min(this.tally.dynLo, ex.dyn)
    this.tally.dynHi = Math.max(this.tally.dynHi, ex.dyn)
    if (this.intervals.length >= 3) {
      this.tally.steadySum += this.unsteadiness
      this.tally.steadyN += 1
    }

    const head = this.playhead
    const due: NoteEv[] = []
    if (this.finished) {
      // the last chord is written past wherever the playhead stopped; play it
      while (this.idx < this.notes.length) due.push(this.notes[this.idx++])
    }
    if (this.pendingWrap > 0) {
      while (this.idx < this.notes.length) due.push(this.notes[this.idx++])
      this.idx = 0
      this.loops += this.pendingWrap
      this.pendingWrap = 0
      this.held = { L: [], R: [] }
    }
    while (this.idx < this.notes.length && this.notes[this.idx].b <= head + 1e-6) {
      due.push(this.notes[this.idx++])
    }
    if (!due.length) return

    let slots = 0
    let atB = -1
    const slotOf = due.map((n) => {
      if (atB >= 0 && n.b !== atB) slots++
      atB = n.b
      return slots
    })
    const step = slots > 0 ? Math.min(FLOURISH_MAX, slots * FLOURISH) / slots : 0
    for (let i = 0; i < due.length; i++) this.fire(due[i], now, ex, slotOf[i] * step)
  }

  private fire(n: NoteEv, now: number, ex: Expression, delay: number) {
    const side = staffOf(n)
    const eng = this.engage[side]

    // A hand that has left the instrument does not play. It is not a bug that
    // the bass goes quiet when you drop your left hand — it is the point.
    if (eng < 0.06) {
      this.held[side] = [n]
      return
    }

    const secPerPulse = this.period / this.stride

    // Metric accent: notes landing on a beat carry the weight of your stroke,
    // notes between beats are passing detail. Downbeats get a touch more.
    const onBeat = 1 - Math.min(1, Math.abs(n.b - Math.round(n.b)) * 4)
    const bar = n.b % this.piece.pulsesPerBar < 1e-6 ? 1.07 : 1
    const accent = (0.86 + onBeat * 0.2) * bar

    const hit = 0.55 + this.hit[side] * 0.6 * (0.4 + onBeat * 0.6)
    const level = 0.4 + ex.dyn * 0.9
    const lift = 0.9 + ex.height * 0.2               // hands high = brighter
    const isBass = n.p < 60
    const scatter = 1 + (Math.random() - 0.5) * ex.wild * 0.55

    const vel = clamp(n.v * accent * hit * level * lift * (0.35 + eng * 0.75) * scatter, 0.05, 1)

    // Wider hands, wider instrument.
    const width = 0.6 + ex.spread * 0.7
    const hand = ex.present[side] ? (ex.x[side] - 0.5) * 0.5 : 0
    this.piano.play({
      midi: n.p,
      vel,
      dur: n.d * secPerPulse,
      release: this.piece.release * (0.75 + ex.dyn * 0.5),
      pan: ((isBass ? -0.22 : 0.18) * width) + hand,
      at: delay,
    })
    this.lastOf[side] = n
    this.held[side] = []
    this.tally.notes += 1
    this.lastFired.push({ p: n.p, vel, t: now, kind: 'note' })
  }

  /**
   * Come back after the tab was hidden. No video arrives while you are away,
   * so the follower would wake to a several-second gap and lurch; this puts
   * the beat under the playhead where it already is. It deliberately keeps
   * your take, your tempo and your place — losing those to an alt-tab was
   * punishing something that isn't a mistake.
   */
  reanchor(now: number) {
    if (!this.started) return
    this.lastStrikeAt = now
    this.beatOrigin = this.pos
    this.phase = 0
  }

  reset() {
    this.idx = 0
    this.pos = 0
    this.beatOrigin = 0
    this.lastStrikeAt = -1
    this.strikeCount = 0
    this.started = false
    this.loops = 0
    this.intervals = []
    this.period = (60 / this.piece.pulseBpm) * this.stride
    this.engage = { L: 1, R: 1 }
    this.held = { L: [], R: [] }
    this.lastOf = {}
    this.pendingWrap = 0
    this.everBoth = false
    this.hit = { L: 0.6, R: 0.6 }
    this.strikeFlash = 0
    this.ornamentFlash = 0
    this.phase = 0
    this.pedal = 0
    this.finished = false
    this.tally = { strokes: 0, notes: 0, dynLo: 1, dynHi: 0, steadySum: 0, steadyN: 0 }
  }

  /** How it went. Only meaningful once `finished`. */
  get report(): Report {
    const t = this.tally
    const steadiness = clamp(1 - (t.steadyN ? t.steadySum / t.steadyN : 1), 0, 1)
    const range = clamp(t.dynHi - t.dynLo, 0, 1)
    const score = steadiness * 0.62 + range * 0.38

    const [grade, line] =
      score > 0.82 ? ['MAESTRO', 'the cat has never heard better'] :
      score > 0.66 ? ['TASTEFUL', 'the cat approves, quietly'] :
      score > 0.48 ? ['SPIRITED', 'the cat enjoyed that a great deal'] :
      score > 0.3 ? ['RUBATO', 'the cat is calling it interpretation'] :
      ['CHAOS', 'the cat would like to try that one again']

    return {
      steadiness, range, notes: t.notes, strokes: t.strokes,
      bpm: this.bpm, grade, line,
    }
  }

  /** Round again, from the top, keeping nothing but the tempo you found. */
  encore() {
    const period = this.period
    this.reset()
    this.period = period
    this.finished = false
  }

  /** Notes played since the last call. Drained rather than cleared per frame
   *  because ornaments and chords fire from the camera callback, which runs
   *  between render frames — clearing on update() used to swallow them. */
  drain(): FiredNote[] {
    const out = this.lastFired
    this.lastFired = []
    return out
  }

  /** Notes coming up, for the falling-note display. */
  upcoming(window: number): NoteEv[] {
    const head = this.playhead
    const out: NoteEv[] = []
    for (let i = Math.max(0, this.idx - 6); i < this.notes.length; i++) {
      const n = this.notes[i]
      if (n.b > head + window) break
      if (n.b > head - 0.4) out.push(n)
    }
    // wrap the display around the loop point so it never goes blank
    const over = head + window - this.piece.loopAt
    if (over > 0) {
      for (const n of this.notes) {
        if (n.b > over) break
        out.push({ ...n, b: n.b + this.piece.loopAt })
      }
    }
    return out
  }

  /** Where the next beat is, 0..1 of the way there. For the landing target. */
  get toNextBeat() {
    if (!this.started) return 0
    return clamp(1 - this.phase, 0, 1)
  }
}
