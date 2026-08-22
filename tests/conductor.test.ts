import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Conductor, type Expression } from '../lib/conductor'
import { PIECES } from '../lib/pieces'
import { fakePiano } from './helpers'

const bach = PIECES[0]

const ex = (over: Partial<Expression> = {}): Expression => ({
  dyn: 0.5, wild: 0, height: 0.4, spread: 0.5, travel: 0,
  present: { L: true, R: true }, x: { L: 0.3, R: 0.7 }, twoHanded: false,
  ...over,
})

function rig(piece = bach) {
  const piano = fakePiano()
  const con = new Conductor(piece, piano as any)
  return { piano, con }
}

test('a stroke too soon is an ornament, and an ornament makes a sound', () => {
  const { piano, con } = rig()
  assert.equal(con.strike(0, 0.7, 'R'), 'start')
  con.update(1 / 60, 0, ex())
  const before = piano.played.length

  // half a beat early: the old code returned false here and played nothing
  assert.equal(con.strike(0.05, 0.7, 'R'), 'ornament')
  assert.ok(piano.played.length > before, 'an ornament must be audible')
  assert.ok(piano.thuds.length > 0, 'and it should feel mechanical')
})

test('nothing you do is ever silent', () => {
  const { piano, con } = rig()
  let t = 0
  const gaps = [0.9, 0.05, 0.42, 0.9, 0.06, 0.3, 0.9, 0.9, 0.04, 0.5]
  con.strike(t, 0.7, 'R')
  con.update(1 / 60, t, ex())
  for (const g of gaps) {
    t += g
    const before = piano.played.length
    con.strike(t, 0.7, t % 2 < 1 ? 'R' : 'L')
    con.update(1 / 60, t, ex())
    assert.ok(piano.played.length > before, `stroke after ${g}s produced no sound`)
  }
})

test('the beat lands on the gesture, not after the follower catches up', () => {
  const { piano, con } = rig()
  con.strike(0, 0.7, 'R')
  con.update(1 / 60, 0, ex())
  const period = con.period

  const before = piano.played.length
  con.strike(period, 0.7, 'L')
  // the playhead has already moved, before any update() has run
  assert.ok(con.pos >= 1, `playhead should be on beat 1 immediately, was ${con.pos}`)
  con.update(1 / 60, period, ex())
  assert.ok(piano.played.length > before, 'beat 1 should sound in the same frame')
})

test('a clump of skipped notes comes out as a flourish, not a fistful', () => {
  const { piano, con } = rig()
  con.strike(0, 0.7, 'R')
  con.update(1 / 60, 0, ex())
  piano.played.length = 0
  // strike well ahead of the beat: several sixteenths are skipped past
  con.strike(con.period * 0.75, 0.9, 'L')
  con.update(1 / 60, con.period * 0.75, ex())
  const spread = new Set(piano.played.map((p) => p.at))
  assert.ok(piano.played.length >= 2, 'notes were skipped, they should still play')
  assert.ok(spread.size > 1, 'and they should be spread in time, not simultaneous')
})

test('two hands within a moment of each other are a chord, not two beats', () => {
  const { con } = rig()
  con.strike(0, 0.7, 'R')
  con.update(1 / 60, 0, ex())
  const beat = con.pos
  assert.equal(con.strike(0.04, 0.7, 'L'), 'chord')
  assert.equal(con.pos, beat, 'a chord must not advance the music')
})

test('a hand that leaves the instrument stops playing its staff', () => {
  const { piano, con } = rig()
  const gone = ex({ present: { L: false, R: true }, twoHanded: true })
  let t = 0
  for (let i = 0; i < 8; i++) {
    con.strike(t, 0.7, 'R')
    for (let k = 0; k < 30; k++) { t += 1 / 60; con.update(1 / 60, t, gone) }
  }
  assert.ok(con.engage.L < 0.06, `left hand should have fallen silent, engage=${con.engage.L}`)

  // measure only once the left hand has genuinely gone, not while it fades
  const mark = piano.played.length
  for (let i = 0; i < 4; i++) {
    con.strike(t, 0.7, 'R')
    for (let k = 0; k < 30; k++) { t += 1 / 60; con.update(1 / 60, t, gone) }
  }
  // pitches this piece only ever gives to the left hand — register alone is a
  // bad proxy, the two hands overlap in the middle of the keyboard
  const right = new Set(bach.notes.filter((n) => n.h === 1).map((n) => n.p))
  const leftOnly = new Set(bach.notes.filter((n) => n.h === -1 && !right.has(n.p)).map((n) => n.p))
  const late = piano.played.slice(mark)
  assert.ok(leftOnly.size > 0, 'the piece should have some left-hand-only pitches')
  assert.equal(late.filter((p) => leftOnly.has(p.midi)).length, 0, 'no bass should sound with no left hand')
  assert.ok(late.length > 0, 'the melody should carry on')
})

test('both staves play when there are no hands to hold back', () => {
  const { piano, con } = rig()
  let t = 0
  for (let i = 0; i < 6; i++) {
    con.strike(t, 0.7, i % 2 ? 'L' : 'R')
    for (let k = 0; k < 30; k++) { t += 1 / 60; con.update(1 / 60, t, ex()) }
  }
  assert.ok(piano.played.some((p) => p.midi < 60), 'keyboard play must still get a bass line')
  assert.ok(piano.played.some((p) => p.midi >= 60), 'and a melody')
})

test('the take loops without dropping notes', () => {
  const { piano, con } = rig(PIECES[3])
  let t = 0
  while (con.loops < 2 && t < 200) {
    con.strike(t, 0.7, 'R')
    const p = con.period
    for (let k = 0; k < 30; k++) { t += p / 30; con.update(p / 30, t, ex()) }
  }
  assert.equal(con.loops, 2)
  assert.ok(piano.played.length > PIECES[3].notes.length * 1.8, 'both takes should be complete')
})
