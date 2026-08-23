// A small sampler over the Salamander Grand Piano (CC-BY, Alexander Holm).
// Velocity drives both level and brightness, the way hammer speed does on a
// real piano — that's most of what makes forte/piano read as forte/piano.
//
// On top of the sampler there are three things a real piano has and a note
// player does not: a damper pedal you hold continuously, strings that answer
// when you move near them, and mechanical noise. They are the difference
// between an instrument that responds to *events* and one that responds to
// *you*.

import { BASE } from './base'

const SAMPLE_NAMES = [
  'A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3',
  'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5',
  'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8',
]

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
function midiOf(name: string): number {
  const s = /^([A-G])([#sb]?)(-?\d)$/.exec(name)!
  let v = STEP[s[1]]
  if (s[2] === '#' || s[2] === 's') v += 1
  if (s[2] === 'b') v -= 1
  return v + (parseInt(s[3], 10) + 1) * 12
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

type Voice = {
  gain: GainNode
  src: AudioBufferSourceNode
  midi: number
  born: number
  peak: number
  dampAt: number     // when this voice is scheduled to start letting go
  stopAt: number
  pedalled: boolean
}

export type Strike = {
  midi: number
  vel: number        // 0..1, hammer speed
  dur: number        // seconds until release begins
  release: number    // seconds of release ramp
  pan: number        // -1..1
  at?: number        // seconds from now — lets a flourish be spread out
}

/** More than this and we are wasting CPU on notes nobody can pick out. */
const MAX_VOICES = 28
/** How long a pedalled note is allowed to ring before it fades on its own. */
const PEDAL_TAIL = 7

export class Piano {
  ctx!: AudioContext
  ready = false
  pedal = 0

  private samples: { midi: number; buf: AudioBuffer }[] = []
  private voices: Voice[] = []
  private master!: GainNode
  private dry!: GainNode
  private wet!: GainNode
  private noise!: AudioBuffer
  private bed: Bed | null = null
  private pedalDown = false

  async init(onProgress?: (v: number) => void) {
    if (this.ready) return
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.85
    this.master.connect(this.ctx.destination)

    this.dry = this.ctx.createGain()
    this.dry.gain.value = 1
    this.dry.connect(this.master)

    const verb = this.ctx.createConvolver()
    verb.buffer = this.makeIR(2.2, 2.6)
    this.wet = this.ctx.createGain()
    this.wet.gain.value = 0.24
    this.wet.connect(verb)
    verb.connect(this.master)

    this.noise = this.makeNoise(2)
    this.bed = new Bed(this.ctx, this.noise, this.dry, this.wet)

    let done = 0
    const loaded = await Promise.all(
      SAMPLE_NAMES.map(async (n) => {
        const res = await fetch(`${BASE}/piano/${n}.mp3`)
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer())
        onProgress?.(++done / SAMPLE_NAMES.length)
        return { midi: midiOf(n), buf }
      })
    )
    this.samples = loaded.sort((a, b) => a.midi - b.midi)
    this.ready = true
  }

  /** Noise burst with an exponential tail — a cheap but convincing room. */
  private makeIR(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate
    const len = Math.floor(rate * seconds)
    const ir = this.ctx.createBuffer(2, len, rate)
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c)
      for (let i = 0; i < len; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
      }
    }
    return ir
  }

  private makeNoise(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate
    const buf = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1
    return buf
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume() }

  /**
   * What the browser adds between us scheduling a sample and a speaker moving.
   * We cannot remove it, but the number belongs on the meters next to the one
   * we can do something about — reporting shutter-to-schedule as though it
   * were shutter-to-sound was flattering and wrong.
   */
  get latency() {
    if (!this.ctx) return 0
    const base = this.ctx.baseLatency ?? 0
    const out = (this.ctx as unknown as { outputLatency?: number }).outputLatency ?? 0
    return base + out
  }
  async silenceForHiddenTab() { this.allOff(0.15); this.bed?.mute(); await this.ctx?.suspend?.().catch?.(() => {}) }

  /** Which notes the strings should ring in sympathy with. */
  setResonance(midis: number[]) { this.bed?.tune(midis.map(hz)) }

  // ------------------------------------------------------------------ pedal

  /**
   * The damper pedal, held continuously by how high your hands are. Raise
   * them and everything you have played keeps ringing and the room opens up;
   * drop them and the whole instrument damps at once. It is the single most
   * expressive continuous control a pianist has, and it costs you nothing but
   * lifting your hands.
   */
  setPedal(v: number) {
    if (!this.ready) return
    v = Math.max(0, Math.min(1, v))
    this.pedal = v
    const now = this.ctx.currentTime
    this.wet.gain.setTargetAtTime(0.14 + v * 0.34, now, 0.12)

    // Hysteresis, or a hand hovering on the boundary flutters the dampers.
    if (!this.pedalDown && v > 0.58) { this.pedalDown = true; this.sustainAll() }
    else if (this.pedalDown && v < 0.42) { this.pedalDown = false; this.dampAll(0.24); this.thud(0.35, 0) }
  }

  /** Let go of the dampers: everything currently sounding keeps ringing. */
  private sustainAll() {
    const now = this.ctx.currentTime
    for (const v of this.voices) {
      if (v.pedalled || now > v.stopAt) continue
      v.pedalled = true
      try {
        v.gain.gain.cancelScheduledValues(now)
        const at = Math.max(0.0002, currentGain(v.gain, now, v))
        v.gain.gain.setValueAtTime(at, now)
        v.gain.gain.exponentialRampToValueAtTime(0.0002, now + PEDAL_TAIL)
        v.stopAt = now + PEDAL_TAIL + 0.05
        v.src.stop(v.stopAt)
      } catch { /* already on its way out */ }
    }
  }

  /** Dampers back down: the sound stops the way it does on a real piano. */
  private dampAll(fade: number) {
    const now = this.ctx.currentTime
    for (const v of this.voices) {
      if (now > v.stopAt) continue
      try {
        v.gain.gain.cancelScheduledValues(now)
        v.gain.gain.setValueAtTime(Math.max(0.0002, currentGain(v.gain, now, v)), now)
        v.gain.gain.exponentialRampToValueAtTime(0.0002, now + fade)
        v.stopAt = now + fade + 0.03
        v.src.stop(v.stopAt)
      } catch { /* already stopped */ }
    }
  }

  // ------------------------------------------------------------------ notes

  play(s: Strike) {
    if (!this.ready) return
    const now = this.ctx.currentTime
    const at = now + Math.max(0, s.at ?? 0)
    const vel = Math.max(0.03, Math.min(1, s.vel))

    // pick the nearest sampled note and pitch-shift the rest of the way
    let best = this.samples[0]
    for (const smp of this.samples) {
      if (Math.abs(smp.midi - s.midi) < Math.abs(best.midi - s.midi)) best = smp
    }

    this.stopVoice(s.midi, 0.03)
    this.evict()

    const src = this.ctx.createBufferSource()
    src.buffer = best.buf
    src.playbackRate.value = Math.pow(2, (s.midi - best.midi) / 12)

    // Hammer brightness: pianissimo is felt and dark, fortissimo is edged.
    const tone = this.ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 480 + Math.pow(vel, 1.5) * 11000
    tone.Q.value = 0.4

    const gain = this.ctx.createGain()
    const peak = Math.pow(vel, 1.6) * 0.9
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.006)

    const pan = this.ctx.createStereoPanner()
    pan.pan.value = Math.max(-1, Math.min(1, s.pan))

    src.connect(tone); tone.connect(gain); gain.connect(pan)
    pan.connect(this.dry); pan.connect(this.wet)
    src.start(at)

    // Let it ring for its written length, then damp — unless the pedal is
    // down, in which case it rings until it dies or you drop your hands.
    const held = this.pedalDown
    const hold = held ? PEDAL_TAIL : Math.max(0.18, s.dur * 1.35)
    const rel = held ? PEDAL_TAIL : Math.max(0.08, s.release)
    if (held) {
      gain.gain.exponentialRampToValueAtTime(0.0002, at + PEDAL_TAIL)
    } else {
      gain.gain.setValueAtTime(Math.max(0.0002, peak * 0.55), at + hold)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + hold + rel)
    }
    const stopAt = held ? at + PEDAL_TAIL + 0.05 : at + hold + rel + 0.05
    src.stop(stopAt)

    const v: Voice = {
      gain, src, midi: s.midi, born: at, peak,
      dampAt: at + hold, stopAt, pedalled: held,
    }
    this.voices.push(v)
    src.onended = () => {
      const i = this.voices.indexOf(v)
      if (i >= 0) this.voices.splice(i, 1)
    }
  }

  /**
   * Mechanical noise — a key coming back up, a damper landing, a knuckle on
   * the fallboard. Pitchless and quiet, but it is most of why a piano sounds
   * like a machine somebody is touching.
   */
  thud(strength: number, pan: number) {
    if (!this.ready) return
    const now = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    src.playbackRate.value = 0.6 + Math.random() * 0.5

    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 220 + strength * 380
    lp.Q.value = 1.6

    const g = this.ctx.createGain()
    const peak = 0.006 + strength * 0.03
    g.gain.setValueAtTime(peak, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)

    const p = this.ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan))

    src.connect(lp); lp.connect(g); g.connect(p); p.connect(this.dry)
    src.start(now)
    src.stop(now + 0.12)
  }

  /**
   * The strings answering your hands. Not a drone — the level follows how
   * fast you are actually moving and dies away in a moment when you stop, so
   * moving through what used to be silence now sounds like moving through an
   * instrument.
   */
  stir(travel: number, x: number, dyn: number) {
    this.bed?.set(travel, x, dyn, this.pedal)
  }

  /**
   * A room getting to its feet. A wash of filtered noise for the crowd, with
   * discrete claps scattered over it so it reads as people rather than static.
   * The piece has to be able to end before this is worth having, and the
   * ending is worth very little without it.
   */
  applaud(seconds = 3.4) {
    if (!this.ready) return
    const now = this.ctx.currentTime

    const wash = this.ctx.createBufferSource()
    wash.buffer = this.noise
    wash.loop = true
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1800
    bp.Q.value = 0.8
    const wg = this.ctx.createGain()
    wg.gain.setValueAtTime(0.0002, now)
    wg.gain.exponentialRampToValueAtTime(0.09, now + 0.35)
    wg.gain.setValueAtTime(0.09, now + seconds * 0.4)
    wg.gain.exponentialRampToValueAtTime(0.0002, now + seconds)
    wash.connect(bp); bp.connect(wg); wg.connect(this.master)
    wash.start(now)
    wash.stop(now + seconds + 0.1)

    for (let i = 0; i < 26; i++) {
      // clustered early, thinning out — nobody claps in time
      const at = now + Math.pow(Math.random(), 0.55) * seconds * 0.9
      const c = this.ctx.createBufferSource()
      c.buffer = this.noise
      c.playbackRate.value = 0.8 + Math.random() * 0.6
      const hp = this.ctx.createBiquadFilter()
      hp.type = 'bandpass'
      hp.frequency.value = 1200 + Math.random() * 2200
      hp.Q.value = 1.2
      const g = this.ctx.createGain()
      const peak = 0.02 + Math.random() * 0.03
      g.gain.setValueAtTime(peak, at)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07)
      const pan = this.ctx.createStereoPanner()
      pan.pan.value = (Math.random() - 0.5) * 1.4
      c.connect(hp); hp.connect(g); g.connect(pan); pan.connect(this.master)
      c.start(at)
      c.stop(at + 0.1)
    }
  }

  /** A wood-block tick for the count-in. Someone has to set the tempo first. */
  tick(accent: boolean) {
    if (!this.ready) return
    const now = this.ctx.currentTime
    const o = this.ctx.createOscillator()
    o.type = 'square'
    o.frequency.value = accent ? 1150 : 780
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(accent ? 0.09 : 0.055, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)
    o.connect(g); g.connect(this.master)
    o.start(now)
    o.stop(now + 0.06)
  }

  private evict() {
    while (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.reduce((a, b) => (a.born <= b.born ? a : b))
      this.hush(oldest, 0.05)
    }
  }

  private stopVoice(midi: number, fade: number) {
    for (const v of [...this.voices]) if (v.midi === midi) this.hush(v, fade)
  }

  private hush(v: Voice, fade: number) {
    const now = this.ctx.currentTime
    try {
      v.gain.gain.cancelScheduledValues(now)
      v.gain.gain.setValueAtTime(Math.max(0.0002, currentGain(v.gain, now, v)), now)
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + fade)
      v.src.stop(now + fade + 0.02)
    } catch { /* already stopped */ }
    const i = this.voices.indexOf(v)
    if (i >= 0) this.voices.splice(i, 1)
  }

  allOff(fade = 0.25) {
    for (const v of [...this.voices]) this.hush(v, fade)
    this.pedalDown = false
    this.bed?.mute()
  }
}

/** AudioParam.value is not readable mid-ramp in every browser; approximate. */
function currentGain(g: GainNode, now: number, v: Voice) {
  const live = g.gain.value
  if (live > 0.0003) return live
  return now < v.dampAt ? v.peak : v.peak * 0.4
}

// -------------------------------------------------------------------- bed

/**
 * Two narrow bandpasses over looping noise, tuned to notes from the piece.
 * Sweeping your hands across the frame sweeps the resonance across the
 * strings; how fast you move sets how much of it you hear.
 */
class Bed {
  private gain: GainNode
  private a: BiquadFilterNode
  private b: BiquadFilterNode
  private freqs: number[] = [261.6, 392, 523.3]

  constructor(private ctx: AudioContext, noise: AudioBuffer, dry: GainNode, wet: GainNode) {
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true

    this.a = ctx.createBiquadFilter(); this.a.type = 'bandpass'; this.a.Q.value = 14
    this.b = ctx.createBiquadFilter(); this.b.type = 'bandpass'; this.b.Q.value = 9
    this.a.frequency.value = 392
    this.b.frequency.value = 784

    this.gain = ctx.createGain()
    this.gain.gain.value = 0

    src.connect(this.a); src.connect(this.b)
    this.a.connect(this.gain); this.b.connect(this.gain)
    this.gain.connect(dry)
    this.gain.connect(wet)
    src.start()
  }

  tune(freqs: number[]) { if (freqs.length) this.freqs = [...freqs].sort((x, y) => x - y) }

  set(travel: number, x: number, dyn: number, pedal: number) {
    const now = this.ctx.currentTime
    // hands across the frame -> up the strings, snapped to notes of the piece
    const want = 140 * Math.pow(2, Math.max(0, Math.min(1, x)) * 4.2)
    let f = this.freqs[0]
    for (const c of this.freqs) if (Math.abs(c - want) < Math.abs(f - want)) f = c
    this.a.frequency.setTargetAtTime(f, now, 0.09)
    this.b.frequency.setTargetAtTime(f * 2, now, 0.09)

    const level = travel * (0.02 + dyn * 0.05) * (0.4 + pedal * 0.6)
    this.gain.gain.setTargetAtTime(level, now, level > 0.001 ? 0.05 : 0.3)
  }

  mute() { this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08) }
}
