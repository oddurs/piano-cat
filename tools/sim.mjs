/**
 * Regression tests for the beat follower.
 *
 * There is no browser here, so the timing core is exercised headlessly: we
 * feed it synthetic strike patterns (steady, accelerating, sloppy, stopped,
 * double-triggered) and assert the properties that make it feel smooth —
 * no note clumping, no runaway tempo, monotonic playhead, clean looping.
 */
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const build = path.join(root, '.shots/cjs')
mkdirSync(build, { recursive: true })
execSync(`npx tsc lib/pieces.ts lib/conductor.ts --ignoreConfig --outDir ${build} --module commonjs --target es2020 --skipLibCheck --types node`,
  { cwd: root, stdio: 'inherit' })

const require = createRequire(import.meta.url)
const { PIECES } = require(path.join(build, 'pieces.js'))
const { Conductor } = require(path.join(build, 'conductor.js'))

const DT = 1 / 60
const EX = { dyn: 0.55, wild: 0, bass: 0.5, treble: 0.5, height: 0.5 }

/** the most notes the score itself asks for at a single instant */
function maxChord(piece) {
  const at = new Map()
  for (const n of piece.notes) at.set(n.b, (at.get(n.b) ?? 0) + 1)
  return Math.max(...at.values())
}

function run(piece, strikes, { strideAt } = {}) {
  const fired = []
  let T = 0
  const con = new Conductor(piece, { play: () => fired.push(T) })
  let si = 0, maxClump = 0, maxJump = 0, prev = 0, backwards = 0
  const end = strikes[strikes.length - 1] + 2
  while (T < end) {
    while (si < strikes.length && strikes[si] <= T) { con.strike(T, 0.6, si % 2 ? 1 : -1); si++ }
    if (strideAt) for (const [t, s] of strideAt) if (Math.abs(T - t) < DT / 2) con.setStride(s)
    con.update(DT, T, EX)
    maxClump = Math.max(maxClump, con.lastFired.length)
    maxJump = Math.max(maxJump, con.pos - prev)
    if (con.pos < prev - 1e-9) backwards++
    prev = con.pos
    T += DT
  }
  return { con, fired, maxClump, maxJump, backwards, bpm: con.bpm }
}

const steady = (n, p, t0 = 0) => Array.from({ length: n }, (_, i) => t0 + i * p)
let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); return ok }

for (const piece of PIECES) {
  const p0 = 60 / piece.pulseBpm
  const r = run(piece, steady(24, p0))
  const cap = (4 * piece.stride) / ((60 / piece.pulseBpm) * piece.stride) * DT * 1.05
  check(`${piece.id}: no note clumping`, r.maxClump <= maxChord(piece),
    `${r.maxClump} in one frame, score's biggest chord is ${maxChord(piece)}`)
  check(`${piece.id}: playhead respects the rate cap`, r.maxJump <= cap,
    `${r.maxJump.toFixed(4)} <= ${cap.toFixed(4)} pulses/frame`)
  check(`${piece.id}: playhead never rewinds`, r.backwards === 0, `${r.backwards} reversals`)
  check(`${piece.id}: holds the given tempo`, Math.abs(r.bpm - piece.pulseBpm) < piece.pulseBpm * 0.05,
    `${r.bpm.toFixed(1)} vs ${piece.pulseBpm} BPM`)
  check(`${piece.id}: loop point is bar-aligned`, piece.loopAt % piece.pulsesPerBar === 0,
    `${piece.loopAt} pulses / ${piece.pulsesPerBar} per bar`)
  const last = Math.max(...piece.notes.map((n) => n.b))
  check(`${piece.id}: every note is inside the loop`, last < piece.loopAt, `last note at ${last}, loops at ${piece.loopAt}`)
}

const bach = PIECES[0]
const p0 = 60 / bach.pulseBpm

// a spurious second trigger 60ms after every stroke must not compound into speed
const doubled = []
steady(20, p0).forEach((t) => { doubled.push(t, t + 0.06) })
const dbl = run(bach, doubled)
const base = run(bach, steady(20, p0))
check('double-triggers do not run the tempo away',
  Math.abs(dbl.bpm - base.bpm) < base.bpm * 0.1,
  `${dbl.bpm.toFixed(1)} vs clean ${base.bpm.toFixed(1)} BPM`)

// deliberate tempo changes still get through
let t = 0, per = p0
const accel = [t]
for (let i = 0; i < 24; i++) { per *= 0.96; t += per; accel.push(t) }
const up = run(bach, accel)
check('accelerando is followed', up.bpm > bach.pulseBpm * 1.6, `reached ${up.bpm.toFixed(0)} BPM`)

t = 0; per = p0
const rit = [t]
for (let i = 0; i < 24; i++) { per *= 1.05; t += per; rit.push(t) }
const down = run(bach, rit)
check('ritardando is followed', down.bpm < bach.pulseBpm * 0.6, `slowed to ${down.bpm.toFixed(0)} BPM`)

// a human is never metronomic
t = 0
const jit = [t]
for (let i = 0; i < 24; i++) { t += p0 * (0.82 + rnd() * 0.36); jit.push(t) }
const sloppy = run(bach, jit)
check('sloppy timing stays smooth', sloppy.maxClump <= maxChord(bach) && sloppy.backwards === 0,
  `max ${sloppy.maxClump} notes/frame, ${sloppy.backwards} reversals`)
check('sloppy timing keeps the average tempo', Math.abs(sloppy.bpm - bach.pulseBpm) < bach.pulseBpm * 0.15,
  `${sloppy.bpm.toFixed(1)} vs ${bach.pulseBpm} BPM`)

// stop dead, then pick it up again
const stop = run(bach, [...steady(8, p0), ...steady(8, p0, 8 * p0 + 2.5)])
check('stopping holds, resuming continues', stop.backwards === 0 && stop.fired.length > 0,
  `${stop.fired.length} notes, ${stop.backwards} reversals`)

// looping
const minuet = PIECES[3]
const loop = run(minuet, steady(80, 60 / minuet.pulseBpm))
check('the piece loops', loop.con.loops >= 2, `${loop.con.loops} loops`)
check('looping does not rewind the playhead', loop.backwards === 0, `${loop.backwards} reversals`)

// changing beats-per-wave mid-play must not lurch
const sw = run(bach, steady(40, p0), { strideAt: [[6, 2], [12, 4]] })
check('changing beats-per-wave does not lurch', sw.maxJump < 0.25, `biggest jump ${sw.maxJump.toFixed(3)} pulses`)

const pad = Math.max(...checks.map((c) => c.name.length))
let failed = 0
for (const c of checks) {
  if (!c.ok) failed++
  console.log(`${c.ok ? ' ok ' : 'FAIL'}  ${c.name.padEnd(pad)}  ${c.detail}`)
}
console.log(`\n${checks.length - failed}/${checks.length} passed`)
process.exit(failed ? 1 : 0)
