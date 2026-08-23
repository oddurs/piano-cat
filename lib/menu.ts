import { calm, type Px } from './px'
import type { Piece } from './pieces'
import type { Report } from './conductor'
import { drawCatBody, drawCandelabra, type CatState } from './cat'

export const MW = 320
export const MH = 180

// The list scrolls. Laying the menu out for however many pieces there happen
// to be works right up until there are more of them than fit, and then it
// silently draws the last few over the instructions — which is what happened
// at seven. A window that follows the selection does not care how long the
// list gets.
const ROW_TOP = 38
const ROW_H = 14
const VISIBLE = 7
const KEYS_TOP = 164

/** first row on screen, given where the selection is and how many there are */
export function windowTop(sel: number, count: number) {
  if (count <= VISIBLE) return 0
  return Math.max(0, Math.min(count - VISIBLE, sel - (VISIBLE >> 1)))
}

/** greedy word wrap to a pixel width — the pixel font has no ellipsis and
 *  nothing here is short enough to trust */
function wrap(px: Px, text: string, width: number): string[] {
  const lines: string[] = ['']
  for (const w of text.split(' ')) {
    const last = lines[lines.length - 1]
    const test = last ? `${last} ${w}` : w
    if (px.textW(test) > width) lines.push(w)
    else lines[lines.length - 1] = test
  }
  return lines
}

/** which piece row is under a canvas-space point, or -1 */
export function menuRowAt(x: number, y: number, count: number, sel = 0) {
  if (x < 16 || x > MW - 16) return -1
  const i = Math.floor((y - ROW_TOP) / ROW_H) + windowTop(sel, count)
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
  if (calm()) return
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
  } else if (id === 'pathetique') {
    px.blob(x + 1, y + 3, 10, 7, c, 3)             // a sighing slur
    px.r(x + 2, y + 8, 2, 2, '#f8e6c4'); px.r(x + 8, y + 8, 2, 2, '#f8e6c4')
  } else if (id === 'sonata-facile') {
    px.r(x + 1, y + 9, 10, 2, c)                   // a neat little staircase
    px.r(x + 3, y + 6, 8, 2, c); px.r(x + 5, y + 3, 6, 2, c); px.r(x + 7, y + 1, 4, 2, c)
  } else if (id === 'alla-turca') {
    px.r(x + 1, y + 4, 10, 5, c)                   // a drum
    px.r(x + 1, y + 3, 10, 1, '#f8e6c4'); px.r(x + 1, y + 9, 10, 1, '#f8e6c4')
    px.r(x + 5, y + 1, 2, 2, c)
  } else if (id === 'mapleleaf') {
    px.tri(x + 6, y + 2, 9, 7, c)                  // a leaf
    px.tri(x + 6, y + 5, 11, 5, c)
    px.r(x + 5, y + 9, 2, 3, '#8a6a22')
  } else if (id === 'chopsticks') {
    const b = Math.sin(t * 9) > 0 ? 0 : 1          // two hands chopping
    px.r(x + 1, y + 2 + b, 4, 7, c); px.r(x + 7, y + 4 - b, 4, 7, c)
    px.r(x + 1, y + 9 + b, 4, 2, '#f8e6c4'); px.r(x + 7, y + 11 - b, 4, 2, '#f8e6c4')
  } else if (id === 'entertainer') {
    px.r(x + 2, y + 8, 8, 3, c)                    // a straw boater
    px.r(x + 3, y + 3, 6, 5, c)
    px.r(x + 3, y + 6, 6, 1, '#f8e6c4')
  } else if (id === 'mountain-king') {
    for (let i = 0; i < 5; i++) px.r(x + 1 + i, y + 11 - i * 2, 1, i * 2 + 1, c)
    px.r(x + 6, y + 1, 5, 11, c)                   // a rising crag
    px.r(x + 7, y + 1, 3, 2, '#ffffff')
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
  const bounce = calm() ? 0 : Math.round(Math.sin(o.t * 2) * 2)
  px.textCS('PIANO CAT', MW / 2, 4 + bounce, '#ffd76a', '#7a3d00', 16, 2)
  px.a(0.85).textC('mime a masterpiece at your webcam', MW / 2, 26, '#a49dc4')
  px.reset

  // --- piece rows
  const top = windowTop(o.sel, o.pieces.length)
  o.pieces.slice(top, top + VISIBLE).forEach((piece, row) => {
    const i = top + row
    const y = ROW_TOP + row * ROW_H
    const on = i === o.sel
    if (on) {
      px.panel(16, y, MW - 32, ROW_H - 2, '#1d1636', px.mix(piece.accent2, '#ffffff', .35), '#0d0a18')
      const wob = Math.round(Math.sin(o.t * 6) * 1)
      px.r(10 + wob, y + 4, 4, 4, piece.accent)      // paw cursor
      px.r(8 + wob, y + 2, 2, 2, piece.accent)
      px.r(12 + wob, y + 1, 2, 2, piece.accent)
    }
    drawIcon(px, piece.id, 22, y, on ? piece.accent : '#5d5878', o.t)
    px.text(piece.title.toUpperCase(), 40, y + 3, on ? '#ffffff' : '#8a83aa')
    px.textR(piece.short.toUpperCase(), MW - 22, y + 3, on ? piece.accent : '#4c4763')
  })

  // there is more list above and below; say so rather than just cutting it
  // off. Down the right-hand edge, where nothing else lives — under the list
  // is where the blurb goes, and a marker there is a marker nobody can see.
  const last = top + VISIBLE
  px.a(0.8)
  if (top > 0) px.text('\u25b2', MW - 12, ROW_TOP + 2, '#6d6890')
  if (last < o.pieces.length) px.text('\u25bc', MW - 12, ROW_TOP + (VISIBLE - 1) * ROW_H + 3, '#6d6890')
  px.reset

  // --- blurb for the highlighted piece
  const lines = wrap(px, p.blurb, MW - 40)
  lines.slice(0, 2).forEach((l, i) => px.a(0.9).textC(l, MW / 2, 136 + i * 9, p.accent))
  px.reset

  const hint = o.camWarn ?? '\u25b2\u25bc PICK   P LISTEN   ENTER PLAY'
  px.a(0.7 + Math.sin(o.t * 4) * 0.3).textC(hint, MW / 2, 154, o.camWarn ? '#ff8f7a' : '#cfc7ee')
  px.reset

  // Keys along the bottom. The two paws that used to sit on them were drawn
  // when this menu had four rows; with seven they sit on top of the hint line,
  // and a decoration that covers the instructions is not a decoration.
  drawMiniKeys(px, o.t, p.accent)
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
 * The verdict. A performance that just stops has not ended, it has been
 * abandoned — this is the part that makes finishing mean something, and the
 * part that makes you want to go again.
 */
export function drawVerdict(px: Px, o: {
  t: number; piece: Piece; report: Report; take: number; duet?: boolean
}) {
  const { report: r, piece: p } = o
  drawBackdrop(px, o.t, p.accent)

  px.a(0.9).r(24, 18, MW - 48, MH - 46, '#0f0c1a')
  px.reset
  px.panel(24, 18, MW - 48, MH - 46, '#151123', px.mix(p.accent2, '#ffffff', .3), '#08060f')

  px.textCS(r.grade, MW / 2, 26, '#ffffff', p.accent2, 16, 2)
  // the cat is not concise and the card is 272px wide
  const said = wrap(px, r.line, MW - 72)
  said.slice(0, 2).forEach((l, i) => px.a(0.85).textC(l, MW / 2, 48 + i * 10, p.accent))
  px.reset
  const top = said.length > 1 ? 74 : 68

  const bar = (label: string, v: number, y: number) => {
    px.text(label, 40, y, '#8a83aa')
    const w = 132
    px.r(112, y + 1, w, 6, '#241d33')
    px.r(112, y + 1, Math.round(w * v), 6, p.accent)
    px.textR(`${Math.round(v * 100)}`, MW - 40, y, '#cfc7ee')
  }
  bar('STEADY', r.steadiness, top)
  bar('DYNAMICS', r.range, top + 14)

  const facts = [
    `${r.notes} NOTES`,
    `${r.strokes} STROKES`,
    `${Math.round(r.bpm)} BPM`,
    o.duet ? 'AS A DUET' : `TAKE ${o.take}`,
  ]
  facts.forEach((f, i) => {
    const x = 40 + (i % 2) * 118
    px.a(0.75).text(f, x, top + 34 + Math.floor(i / 2) * 11, '#8a83aa')
  })
  px.reset

  px.a(0.7 + Math.sin(o.t * 4) * 0.3)
    .textC('ENTER = ENCORE      ESC = PIECES', MW / 2, MH - 20, '#cfc7ee')
  px.reset
}
