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

/** a pair of hands going through the motions, for the tracked screens */
function fakeHands(t, dyn, tracked, height) {
  const at = (side, phase) => ({
    side, present: tracked, conf: 1,
    x: (side === 'L' ? 0.31 : 0.69) + Math.sin(t * 1.7 + phase) * 0.06,
    y: 1 - height + Math.sin(t * 3 + phase) * 0.06,
    vy: 0, speed: dyn * 2, spread: 0.4 + dyn * 0.4, lastStroke: 0,
  })
  return { L: at('L', 0), R: at('R', 1.6) }
}

/** an instrument that makes no noise, so the renderer can be driven headlessly */
const mute = { play() {}, thud() {}, stir() {}, setPedal() {}, setResonance() {} }

function play(idx, seconds, o) {
  const { dyn, mood, vibe, hint = '', tracked = false, height = 0.5, debug = null,
    countIn = null, over = false, react = null, reveals = [] } = o
  const piece = PIECES[idx]
  const con = new Conductor(piece, mute)
  const cv = createCanvas(W, H)
  const ren = new R.Renderer(cv)
  const DT = 1 / 60, per = 60 / piece.pulseBpm
  let T = 0, si = 0
  let frame
  while (T < seconds) {
    if (mood !== 'sleep') while (si * per <= T) { con.strike(T, .7, si % 2 ? 'R' : 'L'); si++ }
    const hands = fakeHands(T, dyn, tracked, height)
    const ex = {
      dyn, wild: .15, height, spread: .5, travel: dyn * .6,
      present: { L: hands.L.present, R: hands.R.present },
      x: { L: hands.L.x, R: hands.R.x },
      twoHanded: tracked,
    }
    con.update(DT, T, ex)
    frame = {
      t: T, hands, strokes: [], tracked,
      energy: .05 * dyn, dyn, wild: .15, height, spread: .5, travel: dyn * .6,
      ...fakeCam(T, dyn),
    }
    // force a face for the review sheet — these are transient by nature and
    // would otherwise never be sampled
    if (react) con.reaction = { kind: react, age: 0.25 }
    if (reveals.length && T > seconds - 0.6) for (const r of reveals) ren.reveal(r)
    for (const n of con.drain()) ren.noteFired(n.p, n.vel, piece.accent, n.kind === 'ornament')
    ren.draw(con, frame, DT, mood, { auto: false, vibe, hint, debug, countIn, over })
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

// Panel times are chosen, not arbitrary: the last frame rendered is the one
// you see, so art behind a time gate is only in the sheet if the gate happens
// to be open at that t. Two were closed at every time originally sampled here
// — the cat's happy note (sin(t*3) > 0.2) and, on the loading screen, its open
// eyes (sin(t*2.2) > -0.9, shut for only ~10% of the cycle and we landed in it
// every time). Neither had ever appeared in a review sheet.
//
// The check that finds these is cheap and needs no tooling: grep every Math.sin
// in a file with conditional art and ask of each one whether it can hide art
// entirely or only move it. Offsets and alphas are fine; comparisons are not.
// Do it whenever you add time-gated art, and pick a t here that turns it on.
sheet('play', [
  play(0, 6.4, { dyn: .55, mood: 'happy', vibe: 'TASTEFUL', tracked: true, height: .35 }),
  play(1, 9.5, { dyn: .92, mood: 'wild', vibe: 'CHAOS', tracked: true, height: .85 }),
  play(2, 22, { dyn: .28, mood: 'calm', vibe: 'MAESTRO' }),
  play(3, 3.0, { dyn: .04, mood: 'sleep', vibe: 'ZZZ', hint: 'the cat is waiting' }),
])
sheet('tracking', [
  // hands low: dampers down, both staves engaged
  play(0, 5.0, { dyn: .5, mood: 'calm', vibe: 'TASTEFUL', tracked: true, height: .1 }),
  // hands high: dampers lifted, the pedal meter open
  play(0, 5.0, { dyn: .5, mood: 'happy', vibe: 'TASTEFUL', tracked: true, height: .95 }),
  // the debug meters, which are easy to let drift over the playfield
  play(2, 6.4, {
    dyn: .6, mood: 'happy', vibe: 'MAESTRO', tracked: true, height: .6,
    debug: { fps: 58, p50: 21, p95: 34, mode: 'HANDS', out: 12 },
  }),
  // no hands seen at all: the fallback look, with the prompt showing
  play(1, 4.0, { dyn: .35, mood: 'calm', vibe: 'SPIRITED', hint: 'SHOW ME YOUR HANDS' }),
])
const REPORTS = {
  good: { steadiness: .88, range: .71, notes: 412, strokes: 80, bpm: 61, grade: 'MAESTRO', line: 'the cat has never heard better' },
  bad: { steadiness: .19, range: .12, notes: 388, strokes: 96, bpm: 143, grade: 'CHAOS', line: 'the cat would like to try that one again' },
}
sheet('arc', [
  play(0, 6.4, { dyn: .3, mood: 'calm', vibe: 'TASTEFUL', tracked: true, height: .4, countIn: 3 }),
  play(3, 6.4, { dyn: .5, mood: 'happy', vibe: 'MAESTRO', tracked: true, height: .7, over: true }),
  screen((px) => M.drawVerdict(px, { t: 1.1, piece: PIECES[0], report: REPORTS.good, take: 1 })),
  screen((px) => M.drawVerdict(px, { t: 2.3, piece: PIECES[1], report: REPORTS.bad, take: 4 })),
])
// the teaching banners, which appear for two seconds and are otherwise
// impossible to look at
sheet('teach', [
  play(0, 6.4, { dyn: .5, mood: 'happy', vibe: 'TASTEFUL', tracked: true, height: .9,
    reveals: ['DAMPERS UP - IT ALL RINGS'] }),
  play(1, 6.4, { dyn: .6, mood: 'calm', vibe: 'SPIRITED', tracked: true, height: .4,
    reveals: ['ORNAMENT', 'BOTH HANDS = CHORD'] }),
  play(2, 6.4, { dyn: .4, mood: 'calm', vibe: 'MAESTRO', tracked: true, height: .5,
    reveals: ['HANDS READY - WAVE TO TAKE OVER'] }),
  play(3, 6.4, { dyn: .5, mood: 'happy', vibe: 'TASTEFUL', tracked: true, height: .6,
    reveals: ['YOU HAVE IT'] }),
])
sheet('faces', [
  play(0, 6.4, { dyn: .5, mood: 'calm', vibe: 'TASTEFUL', tracked: true, height: .6, react: 'stumble' }),
  play(0, 6.4, { dyn: .5, mood: 'calm', vibe: 'MAESTRO', tracked: true, height: .6, react: 'nailed' }),
  play(1, 6.4, { dyn: .8, mood: 'calm', vibe: 'SPIRITED', tracked: true, height: .3, react: 'startled' }),
  play(3, 6.4, { dyn: .3, mood: 'calm', vibe: 'MAESTRO', tracked: true, height: .9, react: 'bow', over: true }),
])
sheet('menu', [
  screen((px) => M.drawMenu(px, { pieces: PIECES, sel: 0, t: 1.2, camWarn: null })),
  screen((px) => M.drawMenu(px, { pieces: PIECES, sel: 2, t: 3.4, camWarn: null })),
  // scrolled to the bottom of the list, which only exists once there are more
  // pieces than rows
  screen((px) => M.drawMenu(px, { pieces: PIECES, sel: PIECES.length - 1, t: 4.2, camWarn: null })),
  // t chosen so the cat's eyes are open — the normal state, and the one that
  // had never once been rendered into a sheet
  screen((px) => M.drawLoading(px, { t: 2.4, status: 'warming up the piano...', done: .45 })),
  screen((px) => M.drawMenu(px, { pieces: PIECES, sel: 3, t: 5.0, camWarn: 'NO CAMERA - USE SPACE' })),
])
