// Render the app's own artwork into the icons and link previews.
//
//   npm run icons
//
// Drawing a separate favicon by hand would mean two cats that drift apart.
// These come out of lib/cat.ts and lib/render.ts, so the face in the browser
// tab is the face on the screen, and it stays that way on its own.

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const build = path.join(root, '.shots/cjs')
mkdirSync(build, { recursive: true })
execSync(
  `npx tsc lib/*.ts --ignoreConfig --outDir ${build} --module commonjs ` +
  `--target es2020 --skipLibCheck --types node`,
  { cwd: root, stdio: 'inherit' },
)

const font = path.join(root, '.shots/PressStart2P.ttf')
if (!existsSync(font)) {
  const res = await fetch('https://github.com/google/fonts/raw/main/ofl/pressstart2p/PressStart2P-Regular.ttf')
  writeFileSync(font, Buffer.from(await res.arrayBuffer()))
}
GlobalFonts.registerFromPath(font, 'Press Start 2P')

const req = createRequire(import.meta.url)
const { PIECES } = req(path.join(build, 'pieces.js'))
const { Conductor } = req(path.join(build, 'conductor.js'))
const R = req(path.join(build, 'render.js'))
const { Px, setFont } = req(path.join(build, 'px.js'))
const { drawCatBody } = req(path.join(build, 'cat.js'))
setFont('"Press Start 2P", monospace')
const { W, H } = R

const mute = { play() {}, thud() {}, stir() {}, setPedal() {}, setResonance() {} }
const EX = {
  dyn: 0.55, wild: 0.1, height: 0.62, spread: 0.5, travel: 0.3,
  present: { L: true, R: true }, x: { L: 0.31, R: 0.69 }, twoHanded: true,
}

/** the play screen, a few seconds in, with the cat pleased with itself */
function scene(pieceIndex, seconds) {
  const piece = PIECES[pieceIndex]
  const con = new Conductor(piece, mute)
  con.loop = true
  const cv = createCanvas(W, H)
  const ren = new R.Renderer(cv)
  const DT = 1 / 60
  let t = 0
  let si = 0
  const per = con.period
  const hands = {
    L: { side: 'L', present: true, conf: 1, x: 0.31, y: 0.42, vy: 0, speed: 1, spread: 0.5, lastStroke: 0 },
    R: { side: 'R', present: true, conf: 1, x: 0.69, y: 0.4, vy: 0, speed: 1, spread: 0.5, lastStroke: 0 },
  }
  const px = new Uint8Array(64 * 36)
  const mk = new Uint8Array(64 * 36)
  for (let i = 0; i < px.length; i++) px[i] = 40 + ((i * 37) % 60)
  while (t < seconds) {
    while (si * per <= t) { con.strike(t, 0.7, si % 2 ? 'R' : 'L'); si++ }
    con.update(DT, t, EX)
    con.reaction = { kind: 'nailed', age: 0.3 }
    for (const n of con.drain()) ren.noteFired(n.p, n.vel, piece.accent, n.kind === 'ornament')
    ren.draw(con, {
      t, hands, strokes: [], tracked: true, energy: 0.05,
      dyn: 0.55, wild: 0.1, height: 0.62, spread: 0.5, travel: 0.3,
      pixels: px, motionMask: mk,
    }, DT, 'happy', { auto: false, vibe: 'MAESTRO', hint: '' })
    t += DT
  }
  return cv
}

const blit = (dst, src, sx, sy, sw, sh, dx, dy, dw, dh) => {
  const c = dst.getContext('2d')
  c.imageSmoothingEnabled = false
  c.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh)
}

// ------------------------------------------------------------------ icons

const play = scene(0, 6.4)

/**
 * Just the head, drawn on its own. Cropping it out of the play screen caught
 * whatever happened to be falling past at the time and clipped the ears, and
 * an icon is the one picture that has to survive being sixteen pixels wide.
 */
function icon(size) {
  const scene = createCanvas(W, H)
  const sc = scene.getContext('2d')
  sc.imageSmoothingEnabled = false
  sc.textBaseline = 'top'
  sc.fillStyle = '#241a44'
  sc.fillRect(0, 0, W, H)
  drawCatBody(new Px(sc), {
    cx: W / 2, headTop: 46, phase: 0.25, pos: 1, dyn: 0.4, mood: 'happy',
    t: 6.4, blinkOpen: true, strike: 0.4,
    react: { kind: 'nailed', age: 0.3 }, pedal: 0.6,
  })

  const cv = createCanvas(size, size)
  const c = cv.getContext('2d')
  c.imageSmoothingEnabled = false
  c.fillStyle = '#241a44'
  c.fillRect(0, 0, size, size)
  // head plus ears, with a little air around it
  blit(cv, scene, W / 2 - 29, 27, 58, 58, 0, 0, size, size)
  return cv
}

mkdirSync(path.join(root, 'app'), { recursive: true })
writeFileSync(path.join(root, 'app/icon.png'), icon(512).toBuffer('image/png'))
writeFileSync(path.join(root, 'app/apple-icon.png'), icon(180).toBuffer('image/png'))

// --------------------------------------------------------- link preview

function preview(w, h) {
  const cv = createCanvas(w, h)
  const c = cv.getContext('2d')
  c.imageSmoothingEnabled = false
  const g = c.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#241a44'); g.addColorStop(0.55, '#0b0812'); g.addColorStop(1, '#07060c')
  c.fillStyle = g
  c.fillRect(0, 0, w, h)

  // the screen itself, scaled to whole pixels so nothing smears
  const scale = Math.floor(Math.min((w - 120) / W, (h - 210) / H))
  const sw = W * scale
  const sh = H * scale
  const ox = Math.round((w - sw) / 2)
  const oy = 130
  c.fillStyle = '#4a3c78'
  c.fillRect(ox - 8, oy - 8, sw + 16, sh + 16)
  c.fillStyle = '#0a0812'
  c.fillRect(ox - 4, oy - 4, sw + 8, sh + 8)
  blit(cv, play, 0, 0, W, H, ox, oy, sw, sh)

  c.font = `64px "Press Start 2P", monospace`
  c.textAlign = 'center'
  c.fillStyle = '#7a3d00'
  c.fillText('PIANO CAT', w / 2 + 5, 88)
  c.fillStyle = '#ffd76a'
  c.fillText('PIANO CAT', w / 2, 83)
  c.font = `20px "Press Start 2P", monospace`
  c.fillStyle = '#a49dc4'
  c.fillText('mime a masterpiece at your webcam', w / 2, oy + sh + 48)
  return cv
}

writeFileSync(path.join(root, 'app/opengraph-image.png'), preview(1200, 630).toBuffer('image/png'))
writeFileSync(path.join(root, 'app/twitter-image.png'), preview(1200, 600).toBuffer('image/png'))

console.log('wrote app/icon.png, app/apple-icon.png, app/opengraph-image.png, app/twitter-image.png')
