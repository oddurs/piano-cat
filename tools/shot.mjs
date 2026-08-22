// Renders the canvas screens headlessly to PNG contact sheets so the pixel art
// can be reviewed without a browser.  npm run shot  ->  .shots/*.png
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out = path.join(root, '.shots')
const build = path.join(out, 'cjs')
mkdirSync(out, { recursive: true })

execSync(`npx tsc lib/*.ts --ignoreConfig --outDir ${build} --module commonjs --target es2020 --skipLibCheck --types node`,
  { cwd: root, stdio: 'inherit' })

const font = path.join(out, 'PressStart2P.ttf')
if (!existsSync(font)) {
  const res = await fetch('https://github.com/google/fonts/raw/main/ofl/pressstart2p/PressStart2P-Regular.ttf')
  writeFileSync(font, Buffer.from(await res.arrayBuffer()))
}
GlobalFonts.registerFromPath(font, 'Press Start 2P')

const { require: req } = await import('node:module').then((m) => ({ require: m.createRequire(import.meta.url) }))
const { PIECES } = req(path.join(build, 'pieces.js'))
const { Conductor } = req(path.join(build, 'conductor.js'))
const R = req(path.join(build, 'render.js'))
const M = req(path.join(build, 'menu.js'))
const { Px, setFont } = req(path.join(build, 'px.js'))
setFont('"Press Start 2P", monospace')
const { W, H } = R
const S = 2

function fakeCam(t, dyn) {
  const GW = 64, GH = 36
  const px = new Uint8Array(GW * GH), mask = new Uint8Array(GW * GH)
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x
    const dx = (x - 32) / 20, dy = (y - 26) / 16
    px[i] = Math.max(0, Math.min(255, (dx * dx + dy * dy < 1 ? 150 : 60) + Math.sin(x * .4 + y * .3) * 14))
    const hy = 16 + Math.cos(t * 3) * 5
    for (const hx of [32 + Math.sin(t * 3) * 16, 32 - Math.sin(t * 3) * 16])
      if ((x - hx) ** 2 + (y - hy) ** 2 < 12 * dyn + 3) mask[i] = 255
  }
  return { pixels: px, motionMask: mask }
}

function play(idx, seconds, dyn, mood, vibe, hint) {
  const piece = PIECES[idx]
  const con = new Conductor(piece, { play: () => {} })
  const cv = createCanvas(W, H)
  const ren = new R.Renderer(cv)
  const ex = { dyn, wild: .15, bass: .5, treble: .5, height: .5 }
  const DT = 1 / 60, per = 60 / piece.pulseBpm
  let T = 0, si = 0
  while (T < seconds) {
    if (mood !== 'sleep') while (si * per <= T) { con.strike(T, .7, si % 2 ? 1 : -1); si++ }
    con.update(DT, T, ex)
    const frame = { energy: .05 * dyn, left: .02 * dyn, right: .035 * dyn, height: .55, down: .6,
      onset: false, strength: .6, dyn, wild: .15, ...fakeCam(T, dyn) }
    for (const n of con.lastFired) ren.noteFired(n.p, n.vel, piece.accent)
    ren.draw(con, frame, DT, mood, { auto: false, vibe, hint })
    T += DT
  }
  return cv
}

function screen(fn) {
  const cv = createCanvas(W, H)
  const c = cv.getContext('2d')
  c.imageSmoothingEnabled = false
  c.textBaseline = 'top'
  fn(new Px(c))
  return cv
}

function sheet(name, cvs) {
  const cols = 2, rows = Math.ceil(cvs.length / cols)
  const o = createCanvas(W * S * cols + 12, H * S * rows + 12)
  const oc = o.getContext('2d')
  oc.imageSmoothingEnabled = false
  oc.fillStyle = '#000'
  oc.fillRect(0, 0, o.width, o.height)
  cvs.forEach((c, i) => oc.drawImage(c, (i % cols) * (W * S + 12), Math.floor(i / cols) * (H * S + 12), W * S, H * S))
  writeFileSync(path.join(out, `${name}.png`), o.toBuffer('image/png'))
  console.log('wrote', path.relative(root, path.join(out, `${name}.png`)))
}

sheet('play', [
  play(0, 6.2, .55, 'happy', 'TASTEFUL', ''),
  play(1, 9.5, .92, 'wild', 'CHAOS', ''),
  play(2, 22, .28, 'calm', 'MAESTRO', ''),
  play(3, 3.0, .04, 'sleep', 'ZZZ', 'the cat is waiting'),
])
sheet('menu', [
  screen((px) => M.drawMenu(px, { pieces: PIECES, sel: 0, t: 1.2, camWarn: null })),
  screen((px) => M.drawMenu(px, { pieces: PIECES, sel: 2, t: 3.4, camWarn: null })),
  screen((px) => M.drawLoading(px, { t: 2.1, status: 'warming up the piano...', done: .45 })),
  screen((px) => M.drawMenu(px, { pieces: PIECES, sel: 3, t: 5.0, camWarn: 'NO CAMERA - USE SPACE' })),
])
