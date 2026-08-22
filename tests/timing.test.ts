import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Conductor, type Expression } from '../lib/conductor'
import { PIECES, type Piece } from '../lib/pieces'
import type { Side } from '../lib/signal'
import { fakePiano } from './helpers'

// Ported from tools/sim.mjs. Same synthetic strike patterns, same properties,
// re-expressed for a follower that now moves the playhead on the gesture
// itself: a strike is *allowed* to jump, so the invariants are stated on what
// the ear actually notices — how many notes land at the same instant, and how
// far the playhead drifts between strikes.

const DT = 1 / 60

const EX: Expression = {
  dyn: 0.55, wild: 0, height: 0.5, spread: 0.5, travel: 0,
  present: { L: true, R: true }, x: { L: 0.3, R: 0.7 }, twoHanded: false,
}

/** the most notes the score itself asks for at a single instant */
function maxChord(piece: Piece) {
  const at = new Map<number, number>()
  for (const n of piece.notes) at.set(n.b, (at.get(n.b) ?? 0) + 1)
  return Math.max(...at.values())
}

type Hit = { t: number; side: Side }

function run(piece: Piece, strikes: Hit[], opts: { strideAt?: [number, number][]; loop?: boolean } = {}) {
  const piano = fakePiano()
  const con = new Conductor(piece, piano as any)
  // These properties describe the follower in continuous motion, so they are
  // stated against a piece that keeps going. The ones that must hold whatever
  // mode you are in are asserted separately, below, in both.
  con.loop = opts.loop !== false
  let T = 0
  let si = 0
  let maxTogether = 0     // notes sharing one scheduled instant
  let maxJump = 0         // biggest playhead move on any frame
  let maxDrift = 0        // biggest playhead move on a frame with no strike
  let backwards = 0
  let prev = 0
  const end = strikes[strikes.length - 1].t + 2

  while (T < end) {
    let struck = false
    while (si < strikes.length && strikes[si].t <= T) {
      con.strike(T, 0.6, strikes[si].side)
      si++
      struck = true
    }
    if (opts.strideAt) {
      for (const [t, s] of opts.strideAt) if (Math.abs(T - t) < DT / 2) con.setStride(s)
    }

    const mark = piano.played.length
    con.update(DT, T, EX)
    const batch = piano.played.slice(mark)
    const bySlot = new Map<number, number>()
    for (const n of batch) bySlot.set(n.at, (bySlot.get(n.at) ?? 0) + 1)
    for (const c of bySlot.values()) maxTogether = Math.max(maxTogether, c)

    const moved = con.pos - prev
    maxJump = Math.max(maxJump, moved)
    if (!struck) maxDrift = Math.max(maxDrift, moved)
    if (moved < -1e-9) backwards++
    prev = con.pos
    T += DT
  }
  return { con, piano, maxTogether, maxJump, maxDrift, backwards, bpm: con.bpm }
}

const steady = (n: number, p: number, t0 = 0): Hit[] =>
  Array.from({ length: n }, (_, i) => ({ t: t0 + i * p, side: (i % 2 ? 'R' : 'L') as Side }))

let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

// ------------------------------------------------------------ every piece

for (const piece of PIECES) {
  const p0 = 60 / piece.pulseBpm
  const chord = maxChord(piece)

  test(`${piece.id}: notes never land in a clump`, () => {
    const r = run(piece, steady(24, p0))
    assert.ok(
      r.maxTogether <= chord,
      `${r.maxTogether} notes at one instant, the score's biggest chord is ${chord}`,
    )
  })

  test(`${piece.id}: the playhead drifts smoothly between strikes`, () => {
    const r = run(piece, steady(24, p0))
    // between strikes only the damped chase moves the playhead, and it is
    // rate-capped. A strike itself is allowed to jump — that is the point.
    const cap = ((6 * piece.stride) / ((60 / piece.pulseBpm) * piece.stride)) * DT * 1.05
    assert.ok(r.maxDrift <= cap, `drifted ${r.maxDrift.toFixed(4)}, cap is ${cap.toFixed(4)} pulses/frame`)
    assert.ok(
      r.maxJump <= piece.stride + cap,
      `a strike moved ${r.maxJump.toFixed(3)} pulses, more than one stroke of music`,
    )
  })

  test(`${piece.id}: the playhead never rewinds, looping or not`, () => {
    // Not a fact about looping — a fact about music. It holds in both modes.
    assert.equal(run(piece, steady(24, p0), { loop: true }).backwards, 0)
    assert.equal(run(piece, steady(24, p0), { loop: false }).backwards, 0)
  })

  test(`${piece.id}: holds the tempo it was given`, () => {
    const r = run(piece, steady(24, p0))
    assert.ok(
      Math.abs(r.bpm - piece.pulseBpm) < piece.pulseBpm * 0.05,
      `${r.bpm.toFixed(1)} vs ${piece.pulseBpm} BPM`,
    )
  })

  test(`${piece.id}: the loop point is bar-aligned and after the last note`, () => {
    assert.equal(piece.loopAt % piece.pulsesPerBar, 0, `${piece.loopAt} pulses / ${piece.pulsesPerBar} per bar`)
    const last = Math.max(...piece.notes.map((n) => n.b))
    assert.ok(last < piece.loopAt, `last note at ${last}, loops at ${piece.loopAt}`)
  })
}

// ------------------------------------------------------------------- bach

const bach = PIECES[0]
const p0 = 60 / bach.pulseBpm

test('a camera double-triggering the same hand does not run the tempo away', () => {
  const doubled: Hit[] = []
  for (const h of steady(20, p0)) doubled.push(h, { t: h.t + 0.06, side: h.side })
  const dbl = run(bach, doubled)
  const clean = run(bach, steady(20, p0))
  assert.ok(
    Math.abs(dbl.bpm - clean.bpm) < clean.bpm * 0.1,
    `${dbl.bpm.toFixed(1)} vs clean ${clean.bpm.toFixed(1)} BPM`,
  )
})

test('a double-trigger read as the other hand does not run the tempo away either', () => {
  const doubled: Hit[] = []
  for (const h of steady(20, p0)) doubled.push(h, { t: h.t + 0.06, side: h.side === 'L' ? 'R' : 'L' })
  const dbl = run(bach, doubled)
  const clean = run(bach, steady(20, p0))
  assert.ok(
    Math.abs(dbl.bpm - clean.bpm) < clean.bpm * 0.1,
    `${dbl.bpm.toFixed(1)} vs clean ${clean.bpm.toFixed(1)} BPM`,
  )
})

test('a deliberate accelerando is followed', () => {
  let t = 0, per = p0
  const hits: Hit[] = [{ t, side: 'L' }]
  for (let i = 0; i < 24; i++) { per *= 0.96; t += per; hits.push({ t, side: i % 2 ? 'L' : 'R' }) }
  assert.ok(run(bach, hits).bpm > bach.pulseBpm * 1.6)
})

test('a deliberate ritardando is followed', () => {
  let t = 0, per = p0
  const hits: Hit[] = [{ t, side: 'L' }]
  for (let i = 0; i < 24; i++) { per *= 1.05; t += per; hits.push({ t, side: i % 2 ? 'L' : 'R' }) }
  assert.ok(run(bach, hits).bpm < bach.pulseBpm * 0.6)
})

test('human sloppiness stays smooth and keeps the average tempo', () => {
  let t = 0
  const hits: Hit[] = [{ t, side: 'L' }]
  for (let i = 0; i < 24; i++) { t += p0 * (0.82 + rnd() * 0.36); hits.push({ t, side: i % 2 ? 'L' : 'R' }) }
  const r = run(bach, hits)
  assert.ok(r.maxTogether <= maxChord(bach), `${r.maxTogether} notes at one instant`)
  assert.equal(r.backwards, 0)
  assert.ok(Math.abs(r.bpm - bach.pulseBpm) < bach.pulseBpm * 0.15, `${r.bpm.toFixed(1)} BPM`)
})

test('stopping dead holds, and picking it up again continues', () => {
  const r = run(bach, [...steady(8, p0), ...steady(8, p0, 8 * p0 + 2.5)])
  assert.equal(r.backwards, 0)
  assert.ok(r.piano.played.length > 0)
})

test('changing beats-per-wave mid-play does not lurch', () => {
  const r = run(bach, steady(40, p0), { strideAt: [[6, 2], [12, 4]] })
  // the follower may not bolt just because the gearing changed; a strike is
  // still allowed to land its own stroke of music
  assert.ok(r.maxDrift < 0.25, `drifted ${r.maxDrift.toFixed(3)} pulses in one frame`)
  assert.equal(r.backwards, 0)
})

test('a big early strike is a flourish at any beats-per-wave, never a clump', () => {
  for (const stride of [1, 2, 4]) {
    const piano = fakePiano()
    const con = new Conductor(bach, piano as any)
    con.setStride(stride)
    con.strike(0, 0.7, 'R')
    con.update(DT, 0, EX)
    piano.played.length = 0

    const early = con.period * 0.25
    con.strike(early, 0.7, 'L')
    con.update(DT, early, EX)

    const bySlot = new Map<number, number>()
    for (const n of piano.played) bySlot.set(n.at, (bySlot.get(n.at) ?? 0) + 1)
    const worst = Math.max(0, ...bySlot.values())
    assert.ok(
      worst <= maxChord(bach),
      `WAVE ${stride}: ${worst} notes at one instant out of ${piano.played.length}`,
    )
    assert.ok(
      Math.max(0, ...piano.played.map((n) => n.at)) <= 0.16,
      `WAVE ${stride}: the flourish spilled past a single gesture`,
    )
  }
})


// ------------------------------------------------------------- the ending

test('a performance ends at the last bar instead of wrapping', () => {
  for (const piece of PIECES) {
    const p = 60 / piece.pulseBpm
    const r = run(piece, steady(piece.loopAt + 4, p), { loop: false })
    assert.ok(r.con.finished, `${piece.id} never finished`)
    assert.ok(
      r.con.pos <= piece.loopAt + 1e-9,
      `${piece.id} ran past its own ending: ${r.con.pos} > ${piece.loopAt}`,
    )
    assert.equal(r.con.loops, 0, `${piece.id} should not have looped`)
  }
})

test('the piece plays its final chord before it stops', () => {
  for (const piece of PIECES) {
    const p = 60 / piece.pulseBpm
    const r = run(piece, steady(piece.loopAt + 4, p), { loop: false })
    const last = Math.max(...piece.notes.map((n) => n.b))
    for (const n of piece.notes.filter((n) => n.b === last)) {
      assert.ok(
        r.piano.played.some((x) => x.midi === n.p),
        `${piece.id}: final note ${n.p} never sounded`,
      )
    }
  }
})

test('once it is over, waving does nothing', () => {
  const r = run(bach, steady(bach.loopAt + 4, p0), { loop: false })
  const before = r.piano.played.length
  assert.equal(r.con.strike(999, 0.8, 'R'), 'over')
  r.con.update(DT, 999, EX)
  assert.equal(r.piano.played.length, before, 'a finished piece must stay finished')
})

test('an encore starts over but keeps the tempo you found', () => {
  const r = run(bach, steady(bach.loopAt + 4, p0 * 0.75), { loop: false })
  const tempo = r.con.bpm
  assert.ok(r.con.finished)
  r.con.encore()
  assert.equal(r.con.finished, false)
  assert.equal(r.con.pos, 0, 'an encore starts from the top')
  assert.ok(Math.abs(r.con.bpm - tempo) < 1e-6, 'and at the pace you were already playing')
})

test('the verdict reflects how it was actually played', () => {
  const steadyRun = run(bach, steady(bach.loopAt + 4, p0), { loop: false })
  let t = 0
  const sloppy: Hit[] = [{ t, side: 'L' }]
  for (let i = 0; i < bach.loopAt + 4; i++) {
    t += p0 * (0.6 + rnd() * 0.8)
    sloppy.push({ t, side: i % 2 ? 'L' : 'R' })
  }
  const sloppyRun = run(bach, sloppy, { loop: false })

  assert.ok(
    steadyRun.con.report.steadiness > sloppyRun.con.report.steadiness,
    `metronomic ${steadyRun.con.report.steadiness.toFixed(2)} should beat ` +
    `shambolic ${sloppyRun.con.report.steadiness.toFixed(2)}`,
  )
  assert.ok(steadyRun.con.report.notes > 0)
  assert.ok(steadyRun.con.report.strokes > 0)
  assert.ok(steadyRun.con.report.grade.length > 0)
})
