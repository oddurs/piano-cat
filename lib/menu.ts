import type { Px } from './px'
import type { Piece } from './pieces'
import { drawCatBody, drawCandelabra, type CatState } from './cat'

export const MW = 320
export const MH = 180

const ROW_TOP = 52
const ROW_H = 17
const KEYS_TOP = 158

/** which piece row is under a canvas-space point, or -1 */
export function menuRowAt(x: number, y: number, count: number) {
  if (x < 16 || x > MW - 16) return -1
  const i = Math.floor((y - ROW_TOP) / ROW_H)
  return i >= 0 && i < count ? i : -1
}

const NOTES = Array.from({ length: 16 }, (_, i) => ({
  x: (i * 97) % MW, sp: 6 + (i % 5) * 3, ph: (i * 37) % 100 / 100, sz: i % 3 === 0 ? 2 : 1,
}))

function drawBackdrop(px: Px, t: number, accent: string) {
  px.r(0, 0, MW, MH, '#0b0910')
  for (let y = 0; y < MH; y += 2) {
    px.a(0.05 + 0.10 * (1 - y / MH)).r(0, y, MW, 1, '#3a2a6a')
  }
  px.reset
  for (const n of NOTES) {
    const p = (t * n.sp / 100 + n.ph) % 1
    const y = MH - p * MH
    const x = n.x + Math.sin(p * 6 + n.ph * 9) * 8
    px.a(0.10 + (1 - p) * 0.35)
    px.r(x, y, n.sz, n.sz * 3, accent)
    px.r(x, y + n.sz * 3 - 1, n.sz * 2, n.sz, accent)
    px.reset
  }
}

/** 12x12 emblem per piece — a candle, a flower, a moon, a dancing shoe */
function drawIcon(px: Px, id: string, x: number, y: number, c: string, t: number) {
  if (id === 'bach-prelude') {
    px.r(x + 3, y + 4, 5, 7, '#f2ead2'); px.r(x + 2, y + 10, 7, 2, '#8a6a22')
    px.r(x + 5, y + 1 + (Math.sin(t * 8) > 0 ? 0 : 1), 1, 3, '#ffd764')
    px.r(x + 5, y, 1, 1, '#fff3b0')
  } else if (id === 'fur-elise') {
    for (const [dx, dy] of [[5, 1], [8, 4], [5, 7], [2, 4]]) px.r(x + dx, y + dy, 3, 3, c)
    px.r(x + 5, y + 4, 3, 3, '#ffd764'); px.r(x + 6, y + 7, 1, 5, '#5ea15a')
  } else if (id === 'moonlight') {
    px.blob(x + 2, y + 1, 9, 10, c, 3); px.blob(x + 5, y, 8, 10, '#0b0910', 3)
    px.r(x + 1, y + 2, 1, 1, '#fff'); px.r(x + 3, y + 9, 1, 1, '#fff')
  } else {
    const b = Math.sin(t * 5) > 0 ? 0 : 1
    px.r(x + 3, y + 1 + b, 2, 6, c); px.r(x + 8, y + b, 2, 6, c)
    px.r(x + 3, y + b, 7, 2, c)
    px.r(x + 1, y + 7 + b, 5, 3, c); px.r(x + 6, y + 6 + b, 5, 3, c)
  }
}

export function drawMenu(px: Px, o: {
  pieces: Piece[]; sel: number; t: number; camWarn: string | null
}) {
  const p = o.pieces[o.sel]
  drawBackdrop(px, o.t, p.accent)

  // --- title
  const bounce = Math.round(Math.sin(o.t * 2) * 2)
  px.textCS('PIANO CAT', MW / 2, 10 + bounce, '#ffd76a', '#7a3d00', 16, 2)
  px.a(0.85).textC('mime a masterpiece at your webcam', MW / 2, 32, '#a49dc4')
  px.reset

  // --- piece rows
  o.pieces.forEach((piece, i) => {
    const y = ROW_TOP + i * ROW_H
    const on = i === o.sel
    if (on) {
      px.panel(16, y, MW - 32, ROW_H - 2, '#1d1636', px.mix(piece.accent2, '#ffffff', .35), '#0d0a18')
      const wob = Math.round(Math.sin(o.t * 6) * 1)
      px.r(10 + wob, y + 5, 4, 4, piece.accent)      // paw cursor
      px.r(8 + wob, y + 3, 2, 2, piece.accent)
      px.r(12 + wob, y + 2, 2, 2, piece.accent)
    }
    drawIcon(px, piece.id, 22, y + 2, on ? piece.accent : '#5d5878', o.t)
    px.text(piece.title.toUpperCase(), 40, y + 5, on ? '#ffffff' : '#8a83aa')
    px.textR(piece.short.toUpperCase(), MW - 22, y + 5, on ? piece.accent : '#4c4763')
  })

  // --- blurb for the highlighted piece
  const words = p.blurb.split(' ')
  const lines: string[] = ['']
  for (const w of words) {
    const test = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w
    if (px.textW(test) > MW - 40) lines.push(w); else lines[lines.length - 1] = test
  }
  lines.slice(0, 2).forEach((l, i) => px.a(0.9).textC(l, MW / 2, 124 + i * 10, p.accent))
  px.reset

  const hint = o.camWarn ?? '\u25b2\u25bc PICK   ENTER TO PLAY'
  px.a(0.7 + Math.sin(o.t * 4) * 0.3).textC(hint, MW / 2, 146, o.camWarn ? '#ff8f7a' : '#cfc7ee')
  px.reset

  // --- a strip of keys along the bottom with two paws on them
  drawMiniKeys(px, o.t, p.accent)
  const cx = MW - 38
  for (const side of [-1, 1] as const) {
    const lx = cx + side * 15 - 6
    const lift = side < 0 ? (Math.sin(o.t * 3) > 0.5 ? 2 : 0) : (Math.sin(o.t * 3 + 2) > 0.5 ? 2 : 0)
    px.blob(lx - 1, KEYS_TOP - 13, 14, 13 - lift, '#1b1009', 4)
    px.blob(lx, KEYS_TOP - 12, 12, 11 - lift, '#f3ae63', 3)
    px.blob(lx - 2, KEYS_TOP - 2 - lift, 16, 9, '#1b1009', 3)
    px.blob(lx - 1, KEYS_TOP - 1 - lift, 14, 7, '#f8e6c4', 2)
    for (const tx of [2, 6, 10]) px.r(lx - 1 + tx, KEYS_TOP + 2 - lift, 1, 4, '#ac5f27')
  }
}

function drawMiniKeys(px: Px, t: number, accent: string) {
  const n = 18, w = MW / n
  px.r(0, KEYS_TOP - 2, MW, 2, '#0d0805')
  for (let i = 0; i < n; i++) {
    const lit = Math.sin(t * 2 + i * 0.7) > 0.93
    px.r(i * w, KEYS_TOP, w - 1, MH - KEYS_TOP - 4, lit ? accent : '#efeae0')
    px.r(i * w, MH - 4, w - 1, 4, '#b3ada2')
  }
  for (let i = 0; i < n - 1; i++) {
    if ([2, 6].includes(i % 7)) continue          // no black key after E or B
    px.r((i + 1) * w - 2.5, KEYS_TOP, 5, 13, '#211c26')
  }
}

export function drawLoading(px: Px, o: { t: number; status: string; done: number }) {
  drawBackdrop(px, o.t, '#ffd76a')
  px.textCS('PIANO CAT', MW / 2, 20, '#ffd76a', '#7a3d00', 16, 2)

  const cat: CatState = {
    cx: MW / 2, headTop: 58, phase: (o.t * 0.9) % 1, pos: o.t * 1.2,
    dyn: 0.25, mood: 'calm', t: o.t, blinkOpen: Math.sin(o.t * 2.2) > -0.9, strike: 0,
  }
  drawCatBody(px, cat)
  drawCandelabra(px, 44, 150, o.t)
  drawCandelabra(px, MW - 44, 150, o.t + 1.3)

  // progress as keys lighting up left to right
  const n = 20, w = (MW - 60) / n
  for (let i = 0; i < n; i++) {
    const on = o.done * n > i
    px.r(30 + i * w, 148, w - 1, 10, on ? '#ffd76a' : '#2b2440')
    px.r(30 + i * w, 156, w - 1, 2, on ? '#a8802f' : '#1b1730')
  }
  px.a(0.75 + Math.sin(o.t * 5) * 0.25).textC(o.status, MW / 2, 166, '#cfc7ee')
  px.reset
}

/**
 * Calibration. Every room is lit differently and every person sits at a
 * different distance, so instead of shipping one set of thresholds and a
 * sensitivity slider to apologise for them, we watch you reach up and down
 * once and take the measurement.
 */
export function drawCalibrate(px: Px, o: {
  t: number; left: number; hands: { x: number; y: number }[]; accent: string
}) {
  drawBackdrop(px, o.t, o.accent)
  px.textCS('TUNING THE ROOM', MW / 2, 16, '#ffd76a', '#7a3d00', 8, 1)

  const bx = 40, by = 40, bw = MW - 80, bh = 92
  px.panel(bx, by, bw, bh, '#12101d', '#3a3352', '#08070e')
  px.a(0.6).dither(bx + 1, by + 1, bw - 2, bh - 2, '#1d1a2e', 3)
  px.reset

  for (const h of o.hands) {
    const x = bx + h.x * bw
    const y = by + h.y * bh
    px.a(0.35).r(x - 1, by, 2, bh, o.accent)
    px.reset
    px.blobOut(x - 5, y - 4, 10, 8, o.accent, '#ffffff', 2)
  }
  if (!o.hands.length) px.a(0.8).textC('SHOW ME YOUR HANDS', MW / 2, by + bh / 2 - 4, '#8a86a0')
  px.reset

  px.textC('REACH UP HIGH, THEN DOWN LOW', MW / 2, by + bh + 10, '#cfc7ee')
  const n = 20, w = (MW - 60) / n
  for (let i = 0; i < n; i++) {
    px.r(30 + i * w, by + bh + 24, w - 1, 6, (1 - o.left) * n > i ? o.accent : '#2b2440')
  }
}
