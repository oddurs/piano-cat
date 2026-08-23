import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { TakePlayer, TakeRecorder, decodeTake, encodeTake, type Take } from '../lib/take'
import { Conductor, type Report } from '../lib/conductor'
import { PIECES } from '../lib/pieces'
import type { Side } from '../lib/signal'
import { fakePiano, strokesToFinish } from './helpers'

const report: Report = {
  steadiness: 0.81, range: 0.44, notes: 312, strokes: 80, bpm: 61,
  grade: 'TASTEFUL', line: 'the cat approves, quietly',
}

function record() {
  const r = new TakeRecorder()
  r.start('bach-prelude', 100)
  for (let i = 0; i < 40; i++) {
    r.stroke(100 + i * 0.5, i % 2 ? 'R' : 'L', 0.4 + (i % 5) * 0.1)
    for (let k = 0; k < 30; k++) {
      const t = 100 + i * 0.5 + k / 60
      r.sample(t, 0.3 + (i % 4) * 0.15, 0.5 + Math.sin(i) * 0.3, 0.5)
    }
  }
  return r.finish(120, report)!
}

test('a take survives the trip through a URL', () => {
  const t = record()
  const back = decodeTake(encodeTake(t))
  assert.ok(back, 'it should decode at all')
  assert.equal(back!.piece, t.piece)
  assert.equal(back!.strokes.length, t.strokes.length)
  assert.equal(back!.report.grade, t.report.grade)
  assert.equal(back!.report.line, t.report.line)
  for (const [i, s] of back!.strokes.entries()) {
    assert.equal(s.side, t.strokes[i].side)
    assert.ok(Math.abs(s.t - t.strokes[i].t) < 0.01, 'timing survives to a hundredth')
    assert.ok(Math.abs(s.strength - t.strokes[i].strength) < 0.01)
  }
})

test('a take is small enough to be a link', () => {
  const encoded = encodeTake(record())
  assert.ok(encoded.length < 8000, `${encoded.length} chars is too long for a URL`)
  assert.ok(/^[A-Za-z0-9_-]+$/.test(encoded), 'must be URL-safe with no padding')
})

test('a take carries no imagery, only what you did', () => {
  const t = record()
  const keys = new Set(Object.keys(t))
  assert.deepEqual([...keys].sort(), ['piece', 'report', 'seconds', 'shape', 'strokes'])
  for (const s of t.strokes) {
    assert.deepEqual(Object.keys(s).sort(), ['side', 'strength', 't'])
  }
  for (const s of t.shape) {
    assert.deepEqual(Object.keys(s).sort(), ['dyn', 'height', 'spread', 't'])
  }
  const wire = JSON.stringify(t)
  for (const forbidden of ['pixel', 'mask', 'image', 'frame', 'landmark', 'x', 'y']) {
    assert.ok(!Object.keys(t.shape[0] ?? {}).includes(forbidden), `shape must not carry ${forbidden}`)
  }
  assert.ok(wire.length > 0)
})

test('replaying gives back the strokes that were played, in order', () => {
  const t = record()
  const p = new TakePlayer(t)
  const out: { t: number; side: string }[] = []
  for (let i = 0; i < 60 * 25; i++) {
    for (const s of p.advance(1 / 60).strokes) out.push({ t: s.t, side: s.side })
  }
  assert.equal(out.length, t.strokes.length)
  assert.deepEqual(out.map((s) => s.side), t.strokes.map((s) => s.side))
  for (let i = 1; i < out.length; i++) assert.ok(out[i].t >= out[i - 1].t, 'in order')
  assert.ok(p.done)
})

test('a corrupt link is refused rather than half-read', () => {
  assert.equal(decodeTake('not-a-take'), null)
  assert.equal(decodeTake(''), null)
  assert.equal(decodeTake(encodeTake(record()).slice(0, 40)), null)
})

test('a take starts when the player did, not when the piece was chosen', () => {
  const r = new TakeRecorder()
  r.start('bach-prelude', 0)
  // four seconds of count-in and hesitation, sampled but never struck
  for (let k = 0; k < 60 * 4; k++) r.sample(k / 60, 0.2, 0.5, 0.5)
  for (let i = 0; i < 12; i++) {
    r.stroke(4 + i * 0.5, i % 2 ? 'R' : 'L', 0.6)
    r.sample(4 + i * 0.5, 0.6, 0.5, 0.5)
  }
  const t = r.finish(11, report)!
  assert.equal(t.strokes[0].t, 0, 'the first stroke is the start of the performance')
  assert.ok(t.shape.every((s) => s.t >= 0), 'nothing from before it survives')
  assert.ok(Math.abs(t.seconds - 7) < 0.05, `length should exclude the lead-in, got ${t.seconds}`)
})

test('a replay drives the piece all the way to its ending', () => {
  // The claim worth testing is not "the replay emits strokes" but "a replayed
  // performance finishes the piece the way the original did". A wall-clock
  // poll in a browser answers that badly; this answers it exactly.
  const piece = PIECES[3]                      // the shortest one
  const per = 60 / piece.pulseBpm
  const strokes = Array.from({ length: strokesToFinish(piece) + 4 }, (_, i) => ({
    t: +(i * per).toFixed(3),
    side: (i % 2 ? 'R' : 'L') as Side,
    strength: 0.7,
  }))
  const take: Take = {
    piece: piece.id,
    seconds: strokes.length * per,
    strokes,
    shape: strokes.map((s) => ({ t: s.t, dyn: 0.5, height: 0.5, spread: 0.5 })),
    report,
  }

  const player = new TakePlayer(take)
  const piano = fakePiano()
  const con = new Conductor(piece, piano as unknown as never)
  const ex = {
    dyn: 0.5, wild: 0, height: 0.5, spread: 0.5, travel: 0,
    present: { L: true, R: true }, x: { L: 0.3, R: 0.7 }, twoHanded: false,
  }
  let t = 0
  const limit = take.seconds + 10
  while (!con.finished && t < limit) {
    const step = player.advance(1 / 60)
    t += 1 / 60
    for (const s of step.strokes) con.strike(t, s.strength, s.side)
    con.update(1 / 60, t, ex)
  }
  assert.ok(con.finished, `the replay never reached the end (stopped at ${t.toFixed(1)}s of ${limit.toFixed(1)}s)`)
  assert.ok(t < take.seconds + 1, 'and it got there in about the time the original took')
  assert.ok(piano.played.length > piece.notes.length * 0.8, 'having played the piece')
})
