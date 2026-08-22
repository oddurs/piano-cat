// A small sampler over the Salamander Grand Piano (CC-BY, Alexander Holm).
// Velocity drives both level and brightness, the way hammer speed does on a
// real piano — that's most of what makes forte/piano read as forte/piano.

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

type Voice = { gain: GainNode; src: AudioBufferSourceNode; stopAt: number }

export type Strike = {
  midi: number
  vel: number        // 0..1, hammer speed
  dur: number        // seconds until release begins
  release: number    // seconds of release ramp
  pan: number        // -1..1
}

export class Piano {
  ctx!: AudioContext
  private samples: { midi: number; buf: AudioBuffer }[] = []
  private voices = new Map<number, Voice>()
  private master!: GainNode
  private dry!: GainNode
  private wet!: GainNode
  ready = false

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

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume() }

  play(s: Strike) {
    if (!this.ready) return
    const now = this.ctx.currentTime
    const vel = Math.max(0.03, Math.min(1, s.vel))

    // pick the nearest sampled note and pitch-shift the rest of the way
    let best = this.samples[0]
    for (const smp of this.samples) {
      if (Math.abs(smp.midi - s.midi) < Math.abs(best.midi - s.midi)) best = smp
    }

    this.stopVoice(s.midi, 0.03)

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
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.006)

    const pan = this.ctx.createStereoPanner()
    pan.pan.value = Math.max(-1, Math.min(1, s.pan))

    src.connect(tone); tone.connect(gain); gain.connect(pan)
    pan.connect(this.dry); pan.connect(this.wet)
    src.start(now)

    // Let it ring for its written length, then damp. Generous, because the
    // tempo can slacken under us at any moment.
    const hold = Math.max(0.18, s.dur * 1.35)
    const rel = Math.max(0.08, s.release)
    gain.gain.setValueAtTime(Math.max(0.0002, peak * 0.55), now + hold)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + hold + rel)
    const stopAt = now + hold + rel + 0.05
    src.stop(stopAt)

    this.voices.set(s.midi, { gain, src, stopAt })
    src.onended = () => { if (this.voices.get(s.midi)?.src === src) this.voices.delete(s.midi) }
  }

  private stopVoice(midi: number, fade: number) {
    const v = this.voices.get(midi)
    if (!v) return
    const now = this.ctx.currentTime
    try {
      v.gain.gain.cancelScheduledValues(now)
      v.gain.gain.setValueAtTime(Math.max(0.0002, v.gain.gain.value), now)
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + fade)
      v.src.stop(now + fade + 0.02)
    } catch { /* already stopped */ }
    this.voices.delete(midi)
  }

  allOff(fade = 0.25) {
    for (const midi of [...this.voices.keys()]) this.stopVoice(midi, fade)
  }
}
