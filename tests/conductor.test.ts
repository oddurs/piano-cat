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
  const both = ex({ present: { L: true, R: true }, twoHanded: true })
  const gone = ex({ present: { L: false, R: true }, twoHanded: true })
  let t = 0
  // play with both hands first — a staff only rests once we have seen the
  // hand that plays it, so there is something to take away
  for (let i = 0; i < 2; i++) {
    con.strike(t, 0.7, i % 2 ? 'L' : 'R')
    for (let k = 0; k < 30; k++) { t += 1 / 60; con.update(1 / 60, t, both) }
  }
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

test('playing one-handed all along still gets you the whole piece', () => {
  // The bass staff is gated on the left hand. Somebody who only ever waves one
  // hand has not put a hand down — they have never picked one up — and taking
  // half the music away from them is a punishment for a thing they did not do.
  const { piano, con } = rig()
  const oneHand = ex({ present: { L: false, R: true }, twoHanded: true })
  let t = 0
  for (let i = 0; i < 10; i++) {
    con.strike(t, 0.7, 'R')
    for (let k = 0; k < 30; k++) { t += 1 / 60; con.update(1 / 60, t, oneHand) }
  }
  const right = new Set(bach.notes.filter((n) => n.h === 1).map((n) => n.p))
  const leftOnly = new Set(bach.notes.filter((n) => n.h === -1 && !right.has(n.p)).map((n) => n.p))
  assert.ok(con.engage.L > 0.9, `left staff should stay engaged, was ${con.engage.L}`)
  assert.ok(
    piano.played.some((p) => leftOnly.has(p.midi)),
    'the bass line should still be playing',
  )
})

test('the loop seam does not swallow the end of the take', () => {
  // idx used to reset at the wrap, so notes between the last one played and
  // the loop point were never heard — a hole at the top of every repeat.
  const { piano, con } = rig(PIECES[3])
  con.loop = true
  const last = Math.max(...PIECES[3].notes.map((n) => n.b))
  const tail = PIECES[3].notes.filter((n) => n.b === last)
  let t = 0
  while (con.loops < 1 && t < 120) {
    con.strike(t, 0.7, 'R')
    const p = con.period
    for (let k = 0; k < 30; k++) { t += p / 30; con.update(p / 30, t, ex()) }
  }
  assert.equal(con.loops, 1)
  for (const n of tail) {
    assert.ok(
      piano.played.some((p) => p.midi === n.p),
      `the final chord note ${n.p} was skipped at the loop seam`,
    )
  }
})

test('coming back from a hidden tab keeps your take and your tempo', () => {
  const { con } = rig()
  let t = 0
  for (let i = 0; i < 6; i++) {
    con.strike(t, 0.7, i % 2 ? 'L' : 'R')
    t += con.period
    con.update(1 / 60, t, ex())
  }
  const was = { pos: con.pos, loops: con.loops, bpm: con.bpm }
  con.reanchor(t + 40)            // forty seconds in another tab
  con.update(1 / 60, t + 40, ex())
  assert.equal(con.loops, was.loops, 'the take number survives')
  assert.ok(con.pos >= was.pos, 'the playhead does not rewind')
  assert.ok(Math.abs(con.bpm - was.bpm) < 1e-6, 'the tempo survives')
  assert.ok(con.pos - was.pos < 1, 'and it does not lurch forward on return')
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
  con.loop = true
  let t = 0
  while (con.loops < 2 && t < 200) {
    con.strike(t, 0.7, 'R')
    const p = con.period
    for (let k = 0; k < 30; k++) { t += p / 30; con.update(p / 30, t, ex()) }
  }
  assert.equal(con.loops, 2)
  assert.ok(piano.played.length > PIECES[3].notes.length * 1.8, 'both takes should be complete')
})

test('the cat winces when you land nowhere near the beat', () => {
  const { con } = rig()
  con.strike(0, 0.6, 'R')
  con.update(1 / 60, 0, ex())
  con.strike(con.period, 0.6, 'L')
  con.update(1 / 60, con.period, ex())
  assert.notEqual(con.reaction?.kind, 'stumble', 'a beat on time is not a stumble')

  // Half a beat early: late enough to be a beat rather than an ornament,
  // wrong enough that it is plainly not where the pulse was.
  const early = con.period * 1.5
  con.strike(early, 0.6, 'R')
  con.update(1 / 60, early, ex())
  assert.equal(con.reaction?.kind, 'stumble')
})

test('both hands at once always gets a look', () => {
  const { con } = rig()
  con.strike(0, 0.6, 'R')
  con.update(1 / 60, 0, ex())
  con.strike(0.04, 0.6, 'L')
  assert.equal(con.reaction?.kind, 'startled')
})

test('finishing makes it bow, and nothing takes that away', () => {
  const { con } = rig(PIECES[3])
  let t = 0
  while (!con.finished && t < 120) {
    con.strike(t, 0.95, 'R')                  // loud enough to startle, normally
    const p = con.period
    for (let k = 0; k < 30; k++) { t += p / 30; con.update(p / 30, t, ex()) }
  }
  assert.ok(con.finished)
  assert.equal(con.reaction?.kind, 'bow')
  con.strike(t + 1, 1, 'L')
  con.update(1 / 60, t + 1, ex())
  assert.equal(con.reaction?.kind, 'bow', 'a bow outranks everything')
})

test('a reaction holds its place and then ages out', () => {
  const { con } = rig()
  con.strike(0, 0.95, 'R')                    // startled
  con.update(1 / 60, 0, ex())
  assert.equal(con.reaction?.kind, 'startled')
  const age0 = con.reaction!.age
  for (let k = 0; k < 30; k++) con.update(1 / 60, k / 60, ex())
  assert.ok(con.reaction!.age > age0, 'reactions age on their own clock')
})
