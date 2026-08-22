import type { Px } from './px'

export type CatMood = 'sleep' | 'calm' | 'happy' | 'wild'

const FUR = '#e0873a', FUR_D = '#ac5f27', FUR_L = '#f3ae63'
const CREAM = '#f8e6c4', INK = '#241710', PINK = '#f0899f'
const EDGE = '#1b1009'

export type CatState = {
  cx: number          // horizontal centre
  headTop: number     // y of the top of the head
  phase: number       // 0..1 through the current beat
  pos: number         // musical position, for slow drifting motion
  dyn: number         // 0..1 loudness
  mood: CatMood
  t: number           // wall clock, for blinks and flames
  blinkOpen: boolean
  strike: number      // 0..1, decaying flash from the last stroke
}

/** Head, body and tail. Draw before the piano — the cat sits behind it. */
export function drawCatBody(px: Px, s: CatState) {
  const { cx, mood, dyn } = s
  const asleep = mood === 'sleep'
  const bob = asleep ? Math.sin(s.t * 1.6) * 1 : Math.cos(s.phase * Math.PI * 2) * (1 + dyn * 2.2)
  const y = s.headTop + Math.round(bob * 0.5)
  const bodyTop = y + 34
  const puff = Math.round(dyn * 3)

  // tail — one lazy swish every two beats, wider the harder you play
  const sw = Math.sin(s.pos * Math.PI * 0.5)
  for (let i = 0; i < 11; i++) {
    const k = i / 10
    const tx = cx + 16 + i * 2.5
    const ty = bodyTop + 32 - i * 2.4 + Math.sin(s.pos * Math.PI * 0.5 - i * 0.4) * (i * 0.55) * (1 + dyn)
    const w = 6 - k * 2
    px.r(tx - 1, ty - 1, w + 2, w + 2, EDGE)
    px.r(tx, ty, w, w, i > 7 ? FUR_L : i % 3 === 0 ? FUR_D : FUR)
  }
  void sw

  // haunches
  px.blobOut(cx - 23 - puff, bodyTop, 46 + puff * 2, 38, FUR, EDGE, 6)
  px.blob(cx - 13, bodyTop + 10, 26, 28, CREAM, 5)
  for (const sx of [-1, 1]) {
    px.r(cx + sx * 19 - (sx < 0 ? 0 : 7), bodyTop + 6, 7, 2, FUR_D)
    px.r(cx + sx * 19 - (sx < 0 ? 0 : 6), bodyTop + 12, 6, 2, FUR_D)
  }

  // ears — they perk on every stroke
  const hx = cx - 21
  const ey = y - Math.round(s.strike * 2)
  px.tri(hx + 8, ey - 9, 15, 12, EDGE)
  px.tri(hx + 34, ey - 9, 15, 12, EDGE)
  px.tri(hx + 8, ey - 8, 13, 11, FUR)
  px.tri(hx + 34, ey - 8, 13, 11, FUR)
  px.tri(hx + 8, ey - 4, 6, 6, PINK)
  px.tri(hx + 34, ey - 4, 6, 6, PINK)
  if (mood === 'wild') {                       // fur standing on end
    for (const dx of [4, 14, 28, 38]) px.r(hx + dx, y - 5, 1, 4, FUR_L)
  }

  // head
  px.blobOut(hx, y, 42, 34, FUR, EDGE, 6)
  px.r(hx + 5, y + 3, 9, 2, FUR_D)
  px.r(hx + 28, y + 3, 9, 2, FUR_D)
  px.r(hx + 8, y + 7, 6, 2, FUR_D)
  px.r(hx + 28, y + 7, 6, 2, FUR_D)
  px.blob(hx + 11, y + 19, 20, 13, CREAM, 4)

  // eyes
  const shut = asleep || !s.blinkOpen
  for (const ex of [hx + 10, hx + 26]) {
    if (shut) {
      px.r(ex, y + 14, 7, 1, INK)
      px.r(ex + 1, y + 13, 5, 1, INK)
    } else if (mood === 'wild') {
      px.r(ex - 1, y + 9, 8, 10, '#fff')
      px.r(ex, y + 8, 6, 1, EDGE)
      px.r(ex + 2, y + 12 + Math.sin(s.t * 21) * 1.6, 3, 4, INK)
    } else if (mood === 'happy') {
      px.r(ex - 1, y + 15, 3, 2, INK); px.r(ex + 1, y + 13, 3, 2, INK)
      px.r(ex + 3, y + 13, 3, 2, INK); px.r(ex + 5, y + 15, 3, 2, INK)
    } else {
      px.r(ex, y + 10, 6, 9, INK)
      px.r(ex + 1, y + 11, 2, 3, '#fff')
      px.r(ex + 4, y + 16, 1, 1, '#fff')
    }
  }

  // nose, mouth, whiskers
  px.tri(hx + 21, y + 20, 5, 3, PINK)
  if (mood === 'wild') {
    px.blob(hx + 17, y + 24, 9, 6, '#7a1f2e', 2)
    px.r(hx + 19, y + 26, 5, 3, PINK)
  } else if (mood === 'happy') {
    px.r(hx + 17, y + 24, 2, 1, INK); px.r(hx + 24, y + 24, 2, 1, INK)
    px.r(hx + 19, y + 25, 5, 1, INK)
  } else {
    px.r(hx + 19, y + 24, 5, 1, INK)
  }
  px.a(0.9)
  for (const sd of [-1, 1]) {
    const wx = sd < 0 ? hx - 7 : hx + 34
    px.r(wx, y + 20, 8, 1, CREAM)
    px.r(wx + (sd < 0 ? 1 : 0), y + 24, 7, 1, CREAM)
  }
  px.reset

  // bow tie, at the neck where the head meets the body
  const bty = bodyTop - 2
  px.tri(cx - 6, bty, 9, 7, '#8e1b30')
  px.tri(cx + 6, bty, 9, 7, '#8e1b30')
  px.tri(cx - 6, bty + 1, 7, 5, '#d0304a')
  px.tri(cx + 6, bty + 1, 7, 5, '#d0304a')
  px.r(cx - 2, bty + 2, 5, 4, '#f05a72')

  // garnish
  if (asleep) {
    for (const [i, z] of ['z', 'Z', 'z'].entries()) {
      const a = (s.t * 0.55 + i * 0.33) % 1
      px.a(1 - a).text(z, cx + 20 + a * 10, y - 2 - a * 20, '#cfd3ff')
    }
    px.reset
  }
  if (mood === 'wild') {
    px.r(hx + 41, y + 4, 3, 5, '#8fd6ff')
    px.r(hx + 42, y + 9, 1, 2, '#8fd6ff')
    px.r(hx - 3, y + 2, 3, 5, '#8fd6ff')
  }
  if (mood === 'happy' && Math.sin(s.t * 3) > 0.2) {
    px.r(cx + 22, y + 2, 2, 7, '#fff8c4')
    px.r(cx + 22, y + 8, 4, 3, '#fff8c4')
  }
}

/** Forelegs and paws. Draw after the keys — they rest on top of them. */
export function drawCatPaws(px: Px, s: CatState, keyTop: number, hand: -1 | 1, strike: number) {
  const asleep = s.mood === 'sleep'
  const hover = asleep ? 0 : (1 - Math.cos(s.phase * Math.PI * 2)) * 1.1
  for (const side of [-1, 1] as const) {
    const dip = hand === side ? strike : 0
    const lx = s.cx + side * 15 - 6
    const lift = asleep ? 0 : hover + (1 - dip) * 2.5
    const top = keyTop - 12
    px.blob(lx - 1, top - 1, 14, 14 - lift, EDGE, 4)
    px.blob(lx, top, 12, 12 - lift, FUR_L, 3)
    const py = keyTop - 1 - lift
    px.blob(lx - 2, py - 1, 16, 9, EDGE, 3)
    px.blob(lx - 1, py, 14, 7, CREAM, 2)
    for (const tx of [2, 6, 10]) px.r(lx - 1 + tx, py + 3, 1, 4, FUR_D)
  }
}

// ------------------------------------------------------------------- props

export function drawCandelabra(px: Px, x: number, base: number, t: number) {
  px.r(x - 6, base - 3, 13, 4, '#7a5a1c')
  px.r(x - 4, base - 2, 9, 2, '#c79a34')
  px.r(x - 1, base - 14, 3, 12, '#c79a34')
  px.r(x - 8, base - 14, 17, 2, '#c79a34')
  for (const dx of [-7, 0, 7]) {
    px.r(x + dx - 1, base - 22, 3, 8, '#f2ead2')       // candle
    px.r(x + dx - 1, base - 23, 3, 1, '#cdc4a8')
    const f = Math.sin(t * 9 + dx) * 0.5 + Math.sin(t * 17 + dx * 2) * 0.5
    px.r(x + dx, base - 25 + (f > 0.4 ? 0 : 1), 1, 3, '#ffd764')
    px.r(x + dx, base - 26, 1, 1, '#fff3b0')
    px.a(0.25).r(x + dx - 2, base - 27, 5, 6, '#ffcf5a')
    px.reset
  }
}

export function drawMetronome(px: Px, x: number, base: number, pos: number, on: boolean) {
  const ang = on ? Math.sin(pos * Math.PI) * 0.42 : 0
  const h = 22
  for (let i = 0; i < h; i++) {                         // tapered wooden case
    const w = Math.round(17 - (i / h) * 10)
    px.r(x - w / 2 - 1, base - h + i, w + 2, 1, '#2a1a0f')
    px.r(x - w / 2, base - h + i, w, 1, '#a86c34')
    px.r(x - w / 2, base - h + i, 1, 1, '#c99050')
    px.r(x + w / 2 - 1, base - h + i, 1, 1, '#7a4a24')
  }
  px.r(x - 2, base - h + 4, 5, h - 8, '#2a1a0f')        // the slot
  for (let i = 2; i < h - 9; i += 3) px.r(x + 3, base - h + 5 + i, 2, 1, '#e8d7a8')
  px.r(x - 9, base - 3, 19, 4, '#2a1a0f')
  px.r(x - 8, base - 3, 17, 1, '#c99050')
  // the rod runs well clear of the case, or you can't see it swing
  const L = 30
  const tipX = x + Math.sin(ang) * L
  const tipY = base - 4 - Math.cos(ang) * L
  px.line(x, base - 4, tipX, tipY, '#0f0a06', 2)
  px.line(x, base - 4, tipX, tipY, '#e8e0cc')
  px.r(tipX - 2, tipY - 2, 5, 5, '#2a1a0f')
  px.r(tipX - 1, tipY - 1, 3, 3, '#d0304a')
}

/** the piano itself: fallboard band, then the slip below the keys */
export function drawPianoTop(px: Px, y: number, h: number, w: number) {
  px.r(0, y, w, h, '#2b1a10')
  px.r(0, y, w, 2, '#6b4526')
  px.r(0, y + 2, w, 1, '#4a2e18')
  px.dither(0, y + 3, w, h - 5, '#3d2617', 4)
  px.r(0, y + h - 2, w, 2, '#170d07')
}
