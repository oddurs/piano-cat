import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Conductor, type Expression } from '../lib/conductor'
import { PIECES, type Piece } from '../lib/pieces'
import type { Side } from '../lib/signal'
import { SHORTEST, fakePiano, piece, strokesToFinish } from './helpers'

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

/** Seconds per stroke of a hand — not per pulse. The two are the same only
 *  when a piece advances one beat per wave, which is no longer all of them. */
const strokePeriod = (piece: Piece) =>
  (60 / piece.pulseBpm) * (piece.loopAt / piece.gestures.length) * piece.stride

const steady = (n: number, p: number, t0 = 0): Hit[] =>
  Array.from({ length: n }, (_, i) => ({ t: t0 + i * p, side: (i % 2 ? 'R' : 'L') as Side }))

let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

// ------------------------------------------------------------ every piece

for (const piece of PIECES) {
  const p0 = strokePeriod(piece)
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
    const cap = ((6 * piece.stride) / strokePeriod(piece)) * DT * 1.05
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

const bach = piece('bach-prelude')
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
    const strokes = strokesToFinish(piece)
    const r = run(piece, steady(strokes, strokePeriod(piece)), { loop: false })
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
    const strokes = strokesToFinish(piece)
    const r = run(piece, steady(strokes, strokePeriod(piece)), { loop: false })
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
  const r = run(bach, steady(strokesToFinish(bach), p0), { loop: false })
  const before = r.piano.played.length
  assert.equal(r.con.strike(999, 0.8, 'R'), 'over')
  r.con.update(DT, 999, EX)
  assert.equal(r.piano.played.length, before, 'a finished piece must stay finished')
})

test('an encore starts over but keeps the tempo you found', () => {
  const r = run(bach, steady(strokesToFinish(bach), p0 * 0.75), { loop: false })
  const tempo = r.con.bpm
  assert.ok(r.con.finished)
  r.con.encore()
  assert.equal(r.con.finished, false)
  assert.equal(r.con.pos, 0, 'an encore starts from the top')
  assert.ok(Math.abs(r.con.bpm - tempo) < 1e-6, 'and at the pace you were already playing')
})

test('the verdict reflects how it was actually played', () => {
  const steadyRun = run(bach, steady(strokesToFinish(bach), p0), { loop: false })
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

// -------------------------------------------------------- frame independence

/** Play an identical performance while pretending to be a given display. */
function atFrameRate(piece: Piece, fps: number) {
  const piano = fakePiano()
  const con = new Conductor(piece, piano as unknown as never)
  const dt = 1 / fps
  const per = strokePeriod(piece)
  const hits = steady(strokesToFinish(piece), per)
  let t = 0
  let i = 0
  while (!con.finished && t < hits[hits.length - 1].t + 4) {
    t += dt
    // strikes land at their own moment, not the frame's — the point is to
    // isolate what the follower does with the time between them
    while (i < hits.length && hits[i].t <= t) { con.strike(hits[i].t, 0.6, hits[i].side); i++ }
    con.update(dt, t, EX)
  }
  return { notes: piano.played.map((p) => p.midi), finished: con.finished }
}

test('the instrument does not play differently on a different display', () => {
  for (const piece of PIECES) {
    const slow = atFrameRate(piece, 30)
    const normal = atFrameRate(piece, 60)
    const fast = atFrameRate(piece, 144)
    assert.ok(slow.finished && normal.finished && fast.finished, `${piece.id} did not finish at every rate`)
    assert.deepEqual(normal.notes, slow.notes, `${piece.id}: 30Hz played a different piece to 60Hz`)
    assert.deepEqual(normal.notes, fast.notes, `${piece.id}: 144Hz played a different piece to 60Hz`)
  }
})

test('a stall does not make the follower bolt to catch up', () => {
  const piano = fakePiano()
  const con = new Conductor(bach, piano as unknown as never)
  con.strike(0, 0.6, 'R')
  con.update(1 / 60, 0, EX)
  con.strike(p0, 0.6, 'L')
  con.update(1 / 60, p0, EX)
  const before = con.pos
  con.update(9, p0 + 9, EX)          // nine seconds in a hidden tab
  assert.ok(con.pos - before < 2, `the playhead jumped ${(con.pos - before).toFixed(2)} pulses on resume`)
})

// ------------------------------------------------------- onset precision

/** The moments the instrument was actually asked to make a sound. */
function onsets(piece: Piece, fps: number) {
  const piano = fakePiano()
  const con = new Conductor(piece, piano as unknown as never)
  const dt = 1 / fps
  const per = strokePeriod(piece)
  const hits = steady(strokesToFinish(piece), per)
  let t = 0
  let i = 0
  while (!con.finished && t < hits[hits.length - 1].t + 4) {
    t += dt
    while (i < hits.length && hits[i].t <= t) {
      // a stroke reads the instrument's clock at the moment it happens, not
      // at the next frame — that is the whole point of it sounding at once
      piano.clock.now = hits[i].t
      con.strike(hits[i].t, 0.6, hits[i].side)
      i++
    }
    piano.clock.now = t
    con.update(dt, t, EX)
  }
  return [...new Set(piano.played.map((p) => +p.when.toFixed(5)))].sort((a, b) => a - b)
}

test('a written run comes out evenly, whatever the frame rate', () => {
  // Bach's right hand is a continuous stream of sixteenths. Played at the
  // tempo it asks for, the gaps between them should all be the same — and
  // that has to be true of a machine dropping to twenty frames a second too,
  // because the alternative is an instrument that stutters when something
  // else on the laptop gets busy.
  const nominal = (60 / bach.pulseBpm) * 0.25
  for (const fps of [20, 30, 60, 144]) {
    const xs = onsets(bach, fps)
    const gaps: number[] = []
    // from the second stroke on: the first has no grid to be even against,
    // because the grid is what the strokes are for
    for (let i = 5; i < xs.length; i++) {
      const g = xs[i] - xs[i - 1]
      if (g > nominal * 0.4 && g < nominal * 1.6) gaps.push(g)
    }
    assert.ok(gaps.length > 60, `${fps}fps: only ${gaps.length} usable gaps`)
    // Even means even with each other. The absolute rate is set by how fast
    // the player is waving and by how much music a gesture covers, and this
    // test is not about either of those — it is about whether a written run
    // comes out level or lumpy.
    const median = [...gaps].sort((a, b) => a - b)[gaps.length >> 1]
    const worst = Math.max(...gaps.map((g) => Math.abs(g - median)))
    assert.ok(
      worst < 0.004,
      `${fps}fps: a sixteenth landed ${(worst * 1000).toFixed(1)}ms off its neighbours`,
    )
  }
})

test('onset timing does not depend on when a frame happened to run', () => {
  // The same music, sampled by two very different displays. If scheduling
  // still leaned on frame boundaries these would drift apart.
  const a = onsets(piece('entertainer'), 30)
  const b = onsets(piece('entertainer'), 144)
  const n = Math.min(a.length, b.length)
  assert.ok(n > 40, `only ${n} onsets to compare`)
  for (let i = 5; i < n; i++) {
    const ga = a[i] - a[i - 1]
    const gb = b[i] - b[i - 1]
    assert.ok(Math.abs(ga - gb) < 0.005, `gap ${i} differed by ${((ga - gb) * 1000).toFixed(1)}ms`)
  }
})

test('one fumbled stroke does not drag the whole performance with it', () => {
  // Somebody playing steadily who puts a single stroke half a beat late has
  // not changed their mind about the tempo. They have fumbled one stroke.
  const run = (badAt: number | null) => {
    const piano = fakePiano()
    const con = new Conductor(bach, piano as unknown as never)
    con.loop = true
    let t = 0
    const times: number[] = []
    for (let k = 0; k < 40; k++) {
      times.push(t)
      t += k === 19 && badAt ? p0 * badAt : p0
    }
    let now = 0, i = 0
    let before = 0, after = 0
    while (now < times[times.length - 1] + 2) {
      now += DT
      while (i < times.length && times[i] <= now) {
        piano.clock.now = now
        con.strike(times[i], 0.6, i % 2 ? 'R' : 'L')
        i++
        if (i === 20) before = con.bpm
        if (i === 22) after = con.bpm
      }
      piano.clock.now = now
      con.update(DT, now, EX)
    }
    return Math.abs(after / before - 1)
  }
  assert.ok(run(null) < 0.01, 'a clean run should not move at all')
  assert.ok(run(1.5) < 0.02, `one late stroke moved the tempo by ${(run(1.5) * 100).toFixed(1)}%`)
  assert.ok(run(0.45) < 0.02, `one early stroke moved the tempo by ${(run(0.45) * 100).toFixed(1)}%`)
})

test('but a sustained change of pace is still followed', () => {
  // The distinction that matters: one stroke out of line is a fumble, every
  // stroke moving the same way is you meaning it.
  let t = 0, per = p0
  const hits: Hit[] = [{ t, side: 'L' }]
  for (let i = 0; i < 24; i++) { per *= 0.96; t += per; hits.push({ t, side: i % 2 ? 'L' : 'R' }) }
  assert.ok(run(bach, hits, { loop: true }).bpm > bach.pulseBpm * 1.6, 'accelerando')

  t = 0; per = p0
  const slow: Hit[] = [{ t, side: 'L' }]
  for (let i = 0; i < 24; i++) { per *= 1.05; t += per; slow.push({ t, side: i % 2 ? 'L' : 'R' }) }
  assert.ok(run(bach, slow, { loop: true }).bpm < bach.pulseBpm * 0.6, 'ritardando')
})
