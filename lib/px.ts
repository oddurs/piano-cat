// Chunky drawing primitives. Everything snaps to whole pixels — the canvas is
// 320x180 and gets nearest-neighbour scaled, so a half pixel is a smear.

let FONT = '"Press Start 2P", ui-monospace, monospace'
export const setFont = (f: string) => { FONT = f }

/**
 * Somebody who has asked their machine for less movement gets less of it.
 * Not none: the instrument moving is the instrument working, and a piano that
 * holds still is broken rather than considerate. What goes is the decoration
 * — drifting notes, bouncing titles, flickering candles, sparks — none of
 * which is telling anybody anything.
 */
let CALM = false
export const setCalm = (v: boolean) => { CALM = v }
export const calm = () => CALM

export class Px {
  constructor(public cx: CanvasRenderingContext2D) {}

  a(v: number) { this.cx.globalAlpha = v; return this }
  get reset() { this.cx.globalAlpha = 1; return this }

  r(x: number, y: number, w: number, h: number, c: string) {
    this.cx.fillStyle = c
    this.cx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
  }

  /** filled rect with the corners nibbled off — reads as a pixel-art blob */
  blob(x: number, y: number, w: number, h: number, c: string, corner = 3) {
    for (let i = 0; i < h; i++) {
      const inset = Math.max(0, corner - Math.min(i, h - 1 - i))
      this.r(x + inset, y + i, w - inset * 2, 1, c)
    }
  }

  /** blob with a 1px outline in `edge` */
  blobOut(x: number, y: number, w: number, h: number, c: string, edge: string, corner = 3) {
    this.blob(x - 1, y - 1, w + 2, h + 2, edge, corner)
    this.blob(x, y, w, h, c, corner)
  }

  tri(cx: number, y: number, base: number, height: number, c: string) {
    for (let i = 0; i < height; i++) {
      const w = Math.max(1, Math.round((base * (i + 1)) / height))
      this.r(cx - w / 2, y + height - 1 - i, w, 1, c)
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string, thick = 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps
      this.r(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thick, thick, c)
    }
  }

  /** 50% checkerboard fill — the classic way to get a half-tone in pixel art */
  dither(x: number, y: number, w: number, h: number, c: string, step = 2) {
    this.cx.fillStyle = c
    for (let j = 0; j < h; j++) {
      for (let i = (j % step === 0 ? 0 : 1); i < w; i += step) {
        this.cx.fillRect(Math.round(x + i), Math.round(y + j), 1, 1)
      }
    }
  }

  /** beveled panel: light top-left, dark bottom-right */
  panel(x: number, y: number, w: number, h: number, fill: string, hi: string, lo: string) {
    this.r(x, y, w, h, fill)
    this.r(x, y, w, 1, hi); this.r(x, y, 1, h, hi)
    this.r(x, y + h - 1, w, 1, lo); this.r(x + w - 1, y, 1, h, lo)
  }

  text(s: string, x: number, y: number, c: string, size = 8) {
    this.cx.font = `${size}px ${FONT}`
    this.cx.fillStyle = c
    this.cx.fillText(s, Math.round(x), Math.round(y))
  }
  textW(s: string, size = 8) {
    this.cx.font = `${size}px ${FONT}`
    return this.cx.measureText(s).width
  }
  textR(s: string, x: number, y: number, c: string, size = 8) {
    this.text(s, x - this.textW(s, size), y, c, size)
  }
  textC(s: string, cx: number, y: number, c: string, size = 8) {
    this.text(s, cx - this.textW(s, size) / 2, y, c, size)
  }
  /** text with a hard pixel drop shadow */
  textS(s: string, x: number, y: number, c: string, shadow: string, size = 8, off = 1) {
    this.text(s, x + off, y + off, shadow, size)
    this.text(s, x, y, c, size)
  }
  textCS(s: string, cx: number, y: number, c: string, shadow: string, size = 8, off = 1) {
    this.textS(s, cx - this.textW(s, size) / 2, y, c, shadow, size, off)
  }

  mix(a: string, b: string, t: number) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
    const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t)
    const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t)
    const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t)
    return `rgb(${r},${g},${bl})`
  }
}
