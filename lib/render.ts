import { GW, GH, type Frame } from './motion'
import { dynMark, type Conductor } from './conductor'
import { Px } from './px'
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

export class Renderer {
  px: Px
  cx: CanvasRenderingContext2D
  private keyLight = new Map<number, number>()
  private parts: Particle[] = []
  private blink = 0
  private nextBlink = 2
  private dt = 1 / 60
  t = 0

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W
    canvas.height = H
    this.cx = canvas.getContext('2d')!
    this.cx.imageSmoothingEnabled = false
    this.cx.textBaseline = 'top'
    this.px = new Px(this.cx)
  }

  noteFired(midi: number, vel: number, accent: string) {
    this.keyLight.set(midi, Math.max(this.keyLight.get(midi) ?? 0, 0.35 + vel * 0.65))
    const k = keyRect(midi)
    const n = vel > 0.7 ? 3 : vel > 0.4 ? 2 : 1
    for (let i = 0; i < n; i++) {
      this.parts.push({
        x: k.x + k.w / 2 + (Math.random() - 0.5) * 6,
        y: KEY_TOP - 2,
        vx: (Math.random() - 0.5) * 8,
        vy: -16 - vel * 30 - Math.random() * 10,
        life: 1,
        c: vel > 0.75 ? '#fff8c4' : accent,
        s: vel > 0.66 ? 2 : 1,
      })
    }
  }

  // ------------------------------------------------------------------ frame

  draw(con: Conductor, frame: Frame, dt: number, mood: CatMood, opts: { auto: boolean; vibe: string; hint: string }) {
    this.t += dt
    this.dt = dt
    const px = this.px
    const p = con.piece

    this.cx.fillStyle = '#0b0910'
    this.cx.fillRect(0, 0, W, H)
    this.drawCamera(frame, p.accent2, p.accent)
    this.cx.fillStyle = 'rgba(11,9,16,0.6)'
    this.cx.fillRect(0, HEAD_H, W, FALL_TOP - HEAD_H)

    this.drawBeatGrid(con)
    this.drawFallingNotes(con)
    this.drawHint(opts.hint)

    this.blink -= dt
    if (this.blink < -0.12) { this.blink = 0; this.nextBlink = 2 + Math.random() * 4 }
    this.nextBlink -= dt
    if (this.nextBlink <= 0) this.blink = 0.12

    const cat: CatState = {
      cx: W / 2, headTop: 42, phase: con.started ? con.phase : 0, pos: con.pos,
      dyn: frame.dyn, mood, t: this.t, blinkOpen: this.blink <= 0, strike: con.strikeFlash,
    }
    drawCatBody(px, cat)
    drawCandelabra(px, 24, FALL_TOP + 2, this.t)
    drawMetronome(px, W - 26, FALL_TOP + 2, con.pos, con.started)
    drawPianoTop(px, FALL_TOP, FALL_H, W)
    this.drawKeyboard(con, dt)
    drawCatPaws(px, cat, KEY_TOP, con.lastHand, con.strikeFlash)
    this.drawSlip(con)
    this.drawParticles(dt)
    this.drawHud(con, frame, opts)
  }

  private drawCamera(f: Frame, dark: string, accent: string) {
    const cx = this.cx
    const px = f.pixels, mk = f.motionMask
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x
        cx.globalAlpha = 0.10 + (px[i] >> 6) * 0.10       // 4 luma steps
        cx.fillStyle = dark
        cx.fillRect(x * 5, y * 5, 5, 5)
        if (mk[i] > 60) {
          cx.globalAlpha = (mk[i] / 255) * 0.55
          cx.fillStyle = accent
          cx.fillRect(x * 5, y * 5, 5, 5)
        }
      }
    }
    cx.globalAlpha = 1
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
      px.a(0.2 + near * 0.72)
      px.r(k.x, top, Math.max(2, k.w - 1), y - top, con.piece.accent)
      px.a(0.35 + near * 0.6).r(k.x, Math.max(HEAD_H, y - 1), Math.max(2, k.w - 1), 1, '#ffffff')
      px.reset
    }
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
    for (const [m, v] of this.keyLight) {
      const nv = v - dt * 2.2
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

  private drawHud(con: Conductor, f: Frame, o: { auto: boolean; vibe: string; hint: string }) {
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

    px.textS(dynMark(f.dyn), 4, FOOT_TOP + 6, px.mix('#6f6a86', p.accent, f.dyn), '#000000')

    // segmented VU meter — chunky blocks read better than a smooth bar
    const mx = 44, seg = 10, sw = 6
    for (let i = 0; i < seg; i++) {
      const on = f.dyn > (i + 0.5) / seg
      const hot = i >= seg - 2
      px.r(mx + i * (sw + 1), FOOT_TOP + 6, sw, 7,
        on ? (hot ? '#ff6a5a' : p.accent) : '#241d33')
    }
    px.a(0.9).r(mx + Math.min(1, f.energy * 7) * (seg * (sw + 1)), FOOT_TOP + 4, 1, 11, '#ffffff')
    px.reset

    // which hand you're leaning on
    const bx = mx + seg * (sw + 1) + 12
    const tot = f.left + f.right + 1e-5
    px.text('L', bx - 9, FOOT_TOP + 6, f.left > f.right ? p.accent : '#4c4763')
    px.r(bx, FOOT_TOP + 8, 28, 3, '#241d33')
    px.r(bx + (f.right / tot) * 24, FOOT_TOP + 6, 4, 7, '#ffffff')
    px.text('R', bx + 31, FOOT_TOP + 6, f.right > f.left ? p.accent : '#4c4763')

    const badge = o.auto ? 'AUTO' : o.vibe
    const bw = px.textW(badge) + 8
    px.panel(W - 4 - bw, FOOT_TOP + 4, bw, 11, o.auto ? '#241d33' : p.accent2, px.mix(p.accent2, '#ffffff', .4), '#0d0a14')
    px.text(badge, W - bw, FOOT_TOP + 6, o.auto ? '#6f6a86' : '#ffffff')

    px.r(0, H - 2, W, 2, '#241d33')
    px.r(0, H - 2, W * con.progress, 2, p.accent)

  }
}
