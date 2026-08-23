import { GW, GH } from './camera'
import { dynMark, type Conductor } from './conductor'
import { clamp, type PlayFrame, type Side } from './signal'
import { calm, Px } from './px'
import { drawCatBody, drawCatPaws, drawCandelabra, drawMetronome, drawPianoTop, type CatMood, type CatState } from './cat'

export { setFont } from './px'
export type { CatMood } from './cat'

export const W = 320
export const H = 180
const HEAD_H = 15
const FALL_TOP = 104, FALL_H = 14
const KEY_TOP = 118, KEY_H = 32
const SLIP_TOP = 150, SLIP_H = 8
const FOOT_TOP = 158

const LOW = 24, HIGH = 84          // C1 .. C6
const WHITES = 36
const WK = W / WHITES
const BW = 5

const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)
function whitesBelow(midi: number) {
  let c = 0
  for (let n = LOW; n < midi; n++) if (!isBlack(n)) c++
  return c
}
export function keyRect(midi: number) {
  const i = whitesBelow(midi)
  return isBlack(midi)
    ? { x: i * WK - BW / 2, w: BW, black: true }
    : { x: i * WK, w: WK, black: false }
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number }

export type Chrome = {
  auto: boolean
  vibe: string
  hint: string
  /** how loud the instrument is actually being asked to play. Not the same
   *  as what the camera sees: when the cat is playing to itself, or a take is
   *  being replayed, the camera may be seeing nothing at all while the piece
   *  is in full flow. The meters should show the music. */
  level?: number
  /** beats left in the count-in, or null once the piece is yours */
  countIn?: number | null
  /** the last chord is ringing and the performance is over */
  over?: boolean
  debug?: { fps: number; p50: number; p95: number; mode: string; out: number } | null
}

export class Renderer {
  px: Px
  cx: CanvasRenderingContext2D
  private keyLight = new Map<number, number>()
  private parts: Particle[] = []
  private blink = 0
  private nextBlink = 2
  private ghost: Record<Side, number> = { L: 0, R: 0 }
  private reveals: { text: string; life: number }[] = []
  private buckets: number[][] = Array.from({ length: 8 }, () => [])
  private pal: string[] = []
  private palKey = ''
  t = 0

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W
    canvas.height = H
    this.cx = canvas.getContext('2d')!
    this.cx.imageSmoothingEnabled = false
    this.cx.textBaseline = 'top'
    this.px = new Px(this.cx)
  }

  /**
   * Say a thing once, where it is happening, at the moment it becomes true.
   * The pedal, the ornaments, the two staves and the chord were all real
   * before this and all invisible, because they were explained in a paragraph
   * of body copy under the console that nobody has ever read.
   */
  reveal(text: string) {
    if (this.reveals.some((r) => r.text === text)) return
    this.reveals.push({ text, life: 2.6 })
    if (this.reveals.length > 3) this.reveals.shift()
  }

  private drawReveals(dt: number, accent: string) {
    const px = this.px
    for (let i = this.reveals.length - 1; i >= 0; i--) {
      const r = this.reveals[i]
      r.life -= dt
      if (r.life <= 0) { this.reveals.splice(i, 1); continue }
      const fade = Math.min(1, r.life / 0.5) * Math.min(1, (2.6 - r.life) / 0.2)
      const w = px.textW(r.text) + 12
      const y = 88 - i * 14
      px.a(fade * 0.92)
      px.panel(W / 2 - w / 2, y, w, 12, '#151123', px.mix(accent, '#ffffff', .4), '#08060f')
      px.text(r.text, W / 2 - w / 2 + 6, y + 3, accent)
      px.reset
    }
  }

  noteFired(midi: number, vel: number, accent: string, ornament = false) {
    this.keyLight.set(midi, Math.max(this.keyLight.get(midi) ?? 0, (ornament ? 0.2 : 0.35) + vel * 0.65))
    if (calm()) return                      // the key still lights; the sparks go
    const k = keyRect(midi)
    const n = ornament ? 1 : vel > 0.7 ? 3 : vel > 0.4 ? 2 : 1
    for (let i = 0; i < n; i++) {
      this.parts.push({
        x: k.x + k.w / 2 + (Math.random() - 0.5) * 6,
        y: KEY_TOP - 2,
        vx: (Math.random() - 0.5) * 8,
        vy: -16 - vel * 30 - Math.random() * 10,
        life: ornament ? 0.5 : 1,
        c: ornament ? '#ffffff' : vel > 0.75 ? '#fff8c4' : accent,
        s: vel > 0.66 && !ornament ? 2 : 1,
      })
    }
  }

  // ------------------------------------------------------------------ frame

  draw(con: Conductor, frame: PlayFrame, dt: number, mood: CatMood, opts: Chrome) {
    this.t += dt
    const px = this.px
    const p = con.piece

    this.cx.fillStyle = '#0b0910'
    this.cx.fillRect(0, 0, W, H)
    this.drawCamera(frame, p.accent2, p.accent)
    this.cx.fillStyle = 'rgba(11,9,16,0.6)'
    this.cx.fillRect(0, HEAD_H, W, FALL_TOP - HEAD_H)

    this.drawBeatGrid(con)
    this.drawFallingNotes(con)
    this.drawHands(con, frame)
    this.drawHint(opts.hint)

    this.blink -= dt
    if (this.blink < -0.12) { this.blink = 0; this.nextBlink = 2 + Math.random() * 4 }
    this.nextBlink -= dt
    if (this.nextBlink <= 0) this.blink = 0.12

    const react = con.reaction
    const cat: CatState = {
      cx: W / 2, headTop: 42, phase: con.started ? con.phase : 0, pos: con.pos,
      dyn: frame.dyn, mood, t: this.t, blinkOpen: this.blink <= 0, strike: con.strikeFlash,
      react,
      pedal: con.pedal,
    }
    drawCatBody(px, cat)
    drawCandelabra(px, 24, FALL_TOP + 2, this.t)
    drawMetronome(px, W - 26, FALL_TOP + 2, con.pos, con.started)
    drawPianoTop(px, FALL_TOP, FALL_H, W)
    this.drawDampers(con)
    this.drawKeyboard(con, dt)
    this.drawLanding(con, frame)
    this.drawPaws(con, frame)
    drawCatPaws(px, cat, KEY_TOP, con.lastHand, con.strikeFlash)
    this.drawSlip(con)
    this.drawParticles(dt)
    this.drawReveals(dt, con.piece.accent)
    this.drawHud(con, frame, opts)
    if (opts.countIn != null) this.drawCountIn(opts.countIn, con)
    if (opts.over) this.drawFine(con)
    if (opts.debug) this.drawDebug(opts.debug, frame, con)
  }

  /** Somebody has to set the tempo before you can be asked to keep it. */
  private drawCountIn(left: number, con: Conductor) {
    const px = this.px
    const n = String(Math.max(1, left))
    const pulse = 1 - ((this.t * 2) % 1)
    px.a(0.6).r(0, HEAD_H, W, FALL_TOP - HEAD_H, '#08060f')
    px.reset
    // A card, clear of the cat's head — a bare numeral over the fur was
    // unreadable at the size anyone actually sees this.
    const w = 74, x = W / 2 - w / 2, y = 22
    px.panel(x, y, w, 34, '#151123', px.mix(con.piece.accent2, '#ffffff', .35), '#08060f')
    px.textCS(n, W / 2, y + 4, '#ffffff', con.piece.accent2, 16, 2)
    px.a(0.55 + pulse * 0.45).textC('JOIN IN', W / 2, y + 23, con.piece.accent)
    px.reset
  }

  /** The double bar. Everything stops except the room. */
  private drawFine(con: Conductor) {
    const px = this.px
    const w = px.textW('FINE') + 22
    px.a(0.85).r(W / 2 - w / 2, 26, w, 17, '#0f0c1a')
    px.reset
    px.panel(W / 2 - w / 2, 26, w, 17, '#151123', px.mix(con.piece.accent2, '#ffffff', .35), '#08060f')
    px.textCS('FINE', W / 2, 31, '#ffffff', con.piece.accent2)
  }

  /**
   * The camera backdrop, in nine fill calls instead of four and a half
   * thousand. Every pixel of the grid lands in one of four luma steps or one
   * of four motion steps, so the colours are bucketed and each bucket is
   * filled in one pass — the per-pixel globalAlpha and fillStyle writes were
   * the single most expensive thing in the frame, and they were competing for
   * budget with the hand model.
   */
  private drawCamera(f: PlayFrame, dark: string, accent: string) {
    if (f.pixels.length < GW * GH) return
    const cx = this.cx
    const px = f.pixels, mk = f.motionMask
    const pal = this.palette(dark, accent)
    for (const b of this.buckets) b.length = 0

    for (let i = 0; i < GW * GH; i++) {
      const lit = mk[i] > 60
      const k = lit ? 4 + Math.min(3, (mk[i] - 60) >> 6) : px[i] >> 6
      this.buckets[k].push(i)
    }
    for (let k = 0; k < 8; k++) {
      const b = this.buckets[k]
      if (!b.length) continue
      cx.fillStyle = pal[k]
      for (const i of b) cx.fillRect((i % GW) * 5, ((i / GW) | 0) * 5, 5, 5)
    }
  }

  /** The eight colours the backdrop can be, computed once per palette. */
  private palette(dark: string, accent: string) {
    const key = dark + accent
    if (this.palKey === key) return this.pal
    const over = (hex: string, a: number) => {
      const v = parseInt(hex.slice(1), 16)
      return `rgb(${Math.round(((v >> 16) & 255) * a)},${Math.round(((v >> 8) & 255) * a)},${Math.round((v & 255) * a)})`
    }
    this.pal = [
      over(dark, 0.10), over(dark, 0.20), over(dark, 0.30), over(dark, 0.40),
      over(accent, 0.16), over(accent, 0.29), over(accent, 0.42), over(accent, 0.55),
    ]
    this.palKey = key
    return this.pal
  }

  private get look() { return 4 }
  private yFor(beatsAhead: number) {
    return KEY_TOP - (beatsAhead / this.look) * (KEY_TOP - HEAD_H - 2)
  }

  /** Faint rules where the beats are, so you can see when to wave. */
  private drawBeatGrid(con: Conductor) {
    const px = this.px
    const head = con.playhead
    const bar = con.piece.pulsesPerBar
    for (let b = Math.ceil(head); b < head + this.look; b++) {
      const y = this.yFor(b - head)
      if (y > FALL_TOP) continue
      const down = ((b % bar) + bar) % bar === 0
      px.a(down ? 0.24 : 0.13)
      if (down) px.r(0, y, W, 1, '#ffffff')
      else px.dither(0, y, W, 1, con.piece.accent2, 2)
      px.reset
    }
  }

  private drawFallingNotes(con: Conductor) {
    const px = this.px
    const head = con.playhead
    for (const n of con.upcoming(this.look)) {
      if (n.p < LOW || n.p > HIGH) continue
      const rel = n.b - head
      const y = this.yFor(rel)
      if (y > KEY_TOP) continue
      const k = keyRect(n.p)
      const h = Math.max(2, (n.d / this.look) * (KEY_TOP - HEAD_H - 2) * 0.85)
      const near = 1 - Math.min(1, Math.max(0, rel / this.look))
      const top = Math.max(HEAD_H, y - h)
      // A note whose hand has left the instrument is drawn as an outline: it
      // is coming, but nobody is going to play it.
      const side: Side = n.h === -1 ? 'L' : n.h === 1 ? 'R' : n.p < 60 ? 'L' : 'R'
      const eng = con.engage[side]
      px.a((0.2 + near * 0.72) * (0.25 + eng * 0.75))
      px.r(k.x, top, Math.max(2, k.w - 1), y - top, con.piece.accent)
      px.a((0.35 + near * 0.6) * (0.3 + eng * 0.7)).r(k.x, Math.max(HEAD_H, y - 1), Math.max(2, k.w - 1), 1, '#ffffff')
      px.reset
    }
  }

  /** Your hands, where the camera says they are. Without this you are playing
   *  an instrument you cannot see, which is most of what felt broken. */
  private drawHands(con: Conductor, f: PlayFrame) {
    if (!f.tracked) return
    const px = this.px
    for (const side of ['L', 'R'] as Side[]) {
      const h = f.hands[side]
      this.ghost[side] += ((h.present ? 1 : 0) - this.ghost[side]) * 0.16
      if (this.ghost[side] < 0.02) continue
      // The camera backdrop covers the whole canvas, so a hand has to be drawn
      // where the backdrop actually put it or the ghost floats off your body.
      // Only the vertical is clamped, and only enough to keep it out of the
      // header and off the keys.
      const x = Math.round(h.x * W)
      const y = clamp(Math.round(h.y * H), HEAD_H + 5, KEY_TOP - 12)
      const a = this.ghost[side] * (0.25 + con.engage[side] * 0.55)
      const c = con.piece.accent
      // a soft column down to the keys: this is the key you are over
      px.a(a * 0.28).r(x - 1, y + 3, 2, KEY_TOP - y - 3, c)
      // a paw, not a lollipop — a pad with three toes above it
      px.a(a).blobOut(x - 5, y - 1, 10, 6, con.piece.accent2, c, 2)
      for (const dx of [-4, -1, 2]) px.a(a).r(x + dx, y - 4, 3, 3, c)
      px.a(a * 0.55).r(x - 3, y + 1, 6, 2, c)
      px.reset
    }
  }

  /** Paw shadows on the keys themselves, under each hand. */
  private drawPaws(con: Conductor, f: PlayFrame) {
    if (!f.tracked) return
    const px = this.px
    for (const side of ['L', 'R'] as Side[]) {
      const h = f.hands[side]
      if (!h.present) continue
      const x = Math.round(h.x * W)
      const w = 6 + Math.round(f.spread * 10)
      px.a(0.16 + con.engage[side] * 0.3)
      px.r(x - w / 2, KEY_TOP, w, KEY_H - 5, '#ffffff')
      px.reset
    }
  }

  /** Dampers lifting off the strings as you raise your hands. */
  private drawDampers(con: Conductor) {
    const px = this.px
    const lift = Math.round(con.pedal * 4)
    for (let x = 8; x < W - 8; x += 6) {
      px.a(0.5 + con.pedal * 0.4)
      px.r(x, FALL_TOP + 7 - lift, 3, 4, con.pedal > 0.55 ? con.piece.accent : '#6a5f52')
      px.reset
    }
  }

  /** The converging bracket that tells you when the next beat lands. */
  private drawLanding(con: Conductor, f: PlayFrame) {
    if (!con.started) return
    const px = this.px
    const cxp = f.tracked && (f.hands.L.present || f.hands.R.present)
      ? ((f.hands.L.present ? f.hands.L.x : f.hands.R.x) + (f.hands.R.present ? f.hands.R.x : f.hands.L.x)) / 2 * W
      : W / 2
    const half = 4 + con.toNextBeat * 46
    const y = KEY_TOP - 4
    const hot = con.strikeFlash > 0.55
    // On a strike the bracket reports how close you were: white and closed up
    // when you were on it, wide and dim when you were not.
    const good = con.accuracy > 0.72
    px.a(hot ? 0.95 : 0.35 + (1 - con.toNextBeat) * 0.4)
    const c = hot ? (good ? '#ffffff' : con.piece.accent2) : con.piece.accent
    px.r(cxp - half - 4, y, 4, 2, c)
    px.r(cxp + half, y, 4, 2, c)
    if (hot && good) {
      px.a(con.strikeFlash * 0.9)
      px.r(cxp - 7, y - 3, 14, 1, '#ffffff')
    }
    px.reset
  }

  private drawKeyboard(con: Conductor, dt: number) {
    const px = this.px
    px.r(0, KEY_TOP - 2, W, 2, '#0d0805')
    for (let m = LOW; m <= HIGH; m++) {
      if (isBlack(m)) continue
      const k = keyRect(m)
      const lit = this.keyLight.get(m) ?? 0
      const face = lit > 0 ? px.mix('#efeae0', con.piece.accent, lit) : '#efeae0'
      const d = lit > 0.05 ? 1 : 0                      // the key dips when struck
      px.r(k.x, KEY_TOP, k.w - 1, 1, '#0d0805')
      px.r(k.x, KEY_TOP + d, k.w - 1, KEY_H - 5 - d, face)
      px.r(k.x, KEY_TOP + d, 1, KEY_H - 5 - d, lit > 0 ? face : '#ffffff')
      px.r(k.x, KEY_TOP + KEY_H - 5, k.w - 1, 5, lit > 0 ? px.mix('#b3ada2', con.piece.accent, lit * 0.6) : '#b3ada2')
    }
    for (let m = LOW; m <= HIGH; m++) {
      if (!isBlack(m)) continue
      const k = keyRect(m)
      const lit = this.keyLight.get(m) ?? 0
      const h = Math.round(KEY_H * 0.62)
      const d = lit > 0.05 ? 1 : 0
      px.r(k.x, KEY_TOP + d, k.w, h - d, lit > 0 ? px.mix('#211c26', con.piece.accent, lit) : '#211c26')
      px.r(k.x, KEY_TOP + d, k.w, 1, '#443c50')
      px.r(k.x, KEY_TOP + h - 1, k.w, 1, '#0d0a10')
    }
    // Pedalled notes hang on to their light the way they hang on to their sound.
    const fade = dt * (con.pedal > 0.58 ? 0.7 : 2.2)
    for (const [m, v] of this.keyLight) {
      const nv = v - fade
      if (nv <= 0) this.keyLight.delete(m); else this.keyLight.set(m, nv)
    }
  }

  private drawSlip(con: Conductor) {
    const px = this.px
    px.r(0, SLIP_TOP, W, SLIP_H, '#3d2617')
    px.r(0, SLIP_TOP, W, 1, '#6b4526')
    px.dither(0, SLIP_TOP + 2, W, SLIP_H - 3, '#2b1a10', 4)
    // a little brass plate with the composer on it
    const name = con.piece.composer.toUpperCase()
    const w = px.textW(name, 8) + 8
    px.panel(W / 2 - w / 2, SLIP_TOP + 1, w, 7, '#8a6a22', '#d8b455', '#5a4212')
    px.text(name, W / 2 - w / 2 + 4, SLIP_TOP + 1, '#241710')
  }

  private drawParticles(dt: number) {
    const px = this.px
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 26 * dt
      p.life -= dt * 1.5
      if (p.life <= 0) { this.parts.splice(i, 1); continue }
      px.a(Math.min(1, p.life)).r(p.x, p.y, p.s, p.s, p.c)
      px.reset
    }
  }

  private drawHint(hint: string) {
    if (!hint) return
    const px = this.px
    const w = px.textW(hint) + 14
    const y = 24 + Math.round(Math.sin(this.t * 3) * 2)
    px.panel(W / 2 - w / 2, y, w, 15, '#120e1a', '#4a3d72', '#000000')
    px.textC(hint, W / 2, y + 4, '#e8e4f5')
  }

  // -------------------------------------------------------------------- hud

  private drawHud(con: Conductor, f: PlayFrame, o: Chrome) {
    const px = this.px
    const p = con.piece

    px.r(0, 0, W, HEAD_H, '#120e1a')
    px.r(0, HEAD_H - 1, W, 1, '#2b2440')
    px.textS(p.title.toUpperCase(), 4, 4, p.accent, '#000000')

    const pipX = W - 124
    for (let i = 0; i < p.pulsesPerBar; i++) {
      const on = con.started && con.beatInBar === i
      px.r(pipX + i * 8 - (on ? 1 : 0), 5 - (on ? 1 : 0), on ? 6 : 4, on ? 6 : 4, on ? '#ffffff' : '#3a3352')
    }
    px.textR(`${Math.round(con.bpm)} BPM`, W - 4, 4, '#8a86a0')
    if (con.loops > 0) {
      const s = `TAKE ${con.loops + 1}`
      px.panel(4, HEAD_H + 3, px.textW(s) + 7, 11, '#221a3a', '#4a3d72', '#120e20')
      px.text(s, 8, HEAD_H + 5, '#b6a8e8')
    }

    px.r(0, FOOT_TOP, W, H - FOOT_TOP, '#120e1a')
    px.r(0, FOOT_TOP, W, 1, '#2b2440')

    const level = o.level ?? f.dyn
    px.textS(dynMark(level), 4, FOOT_TOP + 6, px.mix('#6f6a86', p.accent, level), '#000000')

    // segmented VU meter — chunky blocks read better than a smooth bar
    const mx = 44, seg = 10, sw = 6
    for (let i = 0; i < seg; i++) {
      const on = level > (i + 0.5) / seg
      const hot = i >= seg - 2
      px.r(mx + i * (sw + 1), FOOT_TOP + 6, sw, 7,
        on ? (hot ? '#ff6a5a' : p.accent) : '#241d33')
    }
    px.a(0.9).r(mx + Math.min(1, f.travel) * (seg * (sw + 1)), FOOT_TOP + 4, 1, 11, '#ffffff')
    px.reset

    // how much of each hand is actually in the performance
    const bx = mx + seg * (sw + 1) + 12
    for (const [i, side] of (['L', 'R'] as Side[]).entries()) {
      const e = con.engage[side]
      const on = f.hands[side].present || !f.tracked
      px.text(side, bx + i * 20, FOOT_TOP + 4, on ? px.mix('#4c4763', p.accent, e) : '#4c4763')
      px.r(bx + i * 20, FOOT_TOP + 14, 14, 2, '#241d33')
      px.r(bx + i * 20, FOOT_TOP + 14, Math.round(14 * e), 2, on ? p.accent : '#4c4763')
    }

    // damper pedal, held by your hands
    const px0 = bx + 44
    px.text('PED', px0, FOOT_TOP + 4, con.pedal > 0.58 ? p.accent : '#4c4763')
    px.r(px0, FOOT_TOP + 14, 26, 2, '#241d33')
    px.r(px0, FOOT_TOP + 14, Math.round(26 * con.pedal), 2, con.pedal > 0.58 ? '#ffffff' : p.accent)

    const badge = o.auto ? 'AUTO' : o.vibe
    const bw = px.textW(badge) + 8
    px.panel(W - 4 - bw, FOOT_TOP + 4, bw, 11, o.auto ? '#241d33' : p.accent2, px.mix(p.accent2, '#ffffff', .4), '#0d0a14')
    px.text(badge, W - bw, FOOT_TOP + 6, o.auto ? '#6f6a86' : '#ffffff')

    px.r(0, H - 2, W, 2, '#241d33')
  }

  /** Held on `D`. The numbers that decide whether this feels like an
   *  instrument: camera rate, and how long your gesture took to become sound. */
  private drawDebug(d: NonNullable<Chrome['debug']>, f: PlayFrame, con: Conductor) {
    const px = this.px
    const lines = [
      `${d.mode[0]} ${d.fps.toFixed(0)}FPS`,
      `${d.p50.toFixed(0)}/${d.p95.toFixed(0)}MS`,
      // what the browser adds after we hand the note over. Not ours to fix,
      // but reporting shutter-to-schedule as shutter-to-sound was flattering.
      `OUT ${d.out.toFixed(0)}MS`,
      `DYN ${(f.dyn).toFixed(1)}`,
      `L${con.engage.L.toFixed(1)}R${con.engage.R.toFixed(1)}`,
    ]
    const w = Math.max(...lines.map((l) => px.textW(l, 8))) + 6
    px.a(0.82).r(W - w - 3, HEAD_H + 3, w, lines.length * 9 + 3, '#050409')
    px.reset
    lines.forEach((l, i) => px.text(l, W - w, HEAD_H + 5 + i * 9, i === 1 && d.p95 > 90 ? '#ff6a5a' : '#7de0c0'))
  }
}
