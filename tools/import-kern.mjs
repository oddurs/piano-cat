// Turn a scholarly Humdrum **kern edition into piece data.
//
//   node tools/import-kern.mjs <name> <url> [--bpm N] [--pulse D] [--from BAR] [--to BAR]
//
// The pieces here used to be hand-typed from memory, which is fine for the
// first eight bars of something everybody knows and hopeless for the other
// eighty. These encodings are made from named printed editions, they carry
// their own provenance, and — the part that matters most for this app — they
// keep the two staves in separate spines, so which hand plays a note is in
// the source rather than guessed from its pitch.
//
// The output is written to lib/scores/, committed, and never fetched at
// runtime. What is generated is note data: pitches and durations of music
// that has been public domain for a century. The encoding it was read from is
// credited in the header of every generated file.

const STEP = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

/** `ccc` -> C6, `c` -> C4, `C` -> C3, `CCC` -> C1, plus accidentals. */
function pitchOf(token) {
  const m = /([a-gA-G]+)/.exec(token)
  if (!m) return null
  const letters = m[1]
  const lower = letters[0] === letters[0].toLowerCase()
  const n = letters.length
  const octave = lower ? 4 + (n - 1) : 3 - (n - 1)
  let midi = (octave + 1) * 12 + STEP[letters[0].toLowerCase()]
  for (const ch of token) {
    if (ch === '#') midi += 1
    else if (ch === '-') midi -= 1
  }
  return midi
}

/** kern durations are reciprocal, so a triplet eighth is simply `12`. */
function durOf(token) {
  const m = /(\d+)(\.*)/.exec(token)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (n === 0) return 8                              // breve
  let q = 4 / n
  for (let i = 0; i < m[2].length; i++) q *= 1.5
  return q
}

export function parseKern(text) {
  const lines = text.split('\n')
  const meta = {}
  let spines = []          // one entry per **kern spine, in file order
  let hands = []           // 'L' | 'R' per kern spine
  const time = []          // quarters elapsed, per kern spine
  const open = []          // tied notes waiting to be closed, per spine
  const notes = []
  let meter = null
  let bpm = null
  let bars = 0

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    // reference records carry the work's own identity: take it from the
    // source rather than from a filename, because a filename is a guess and
    // sonata16 turned out not to be the sonata anybody would assume
    const ref = /^!!!([A-Z]+\d*):\s*(.+)$/.exec(line)
    if (ref) { meta[ref[1]] ??= ref[2].replace(/<[^>]+>/g, '').trim(); continue }
    if (!line || line.startsWith('!')) continue
    const cols = line.split('\t')

    if (line.startsWith('**')) {
      spines = cols.map((c) => c === '**kern')
      hands = cols.map(() => 'R')
      cols.forEach((_, i) => { time[i] = 0; open[i] = new Map() })
      continue
    }
    if (line.startsWith('*')) {
      cols.forEach((c, i) => {
        // staff1 is the upper staff, which is the right hand
        const st = /^\*staff(\d)/.exec(c)
        if (st) hands[i] = st[1] === '1' ? 'R' : 'L'
        const mm = /^\*M(\d+)\/(\d+)$/.exec(c)
        if (mm) meter ??= { top: +mm[1], bottom: +mm[2] }
        const t = /^\*MM(\d+)/.exec(c)
        if (t) bpm ??= +t[1]
      })
      continue
    }
    if (cols[0]?.startsWith('=')) { bars++; continue }

    cols.forEach((tok, i) => {
      if (!spines[i] || tok === '.' || tok === '') return
      for (const sub of tok.split(' ')) {
        if (!sub || sub.includes('r')) continue          // rest
        const grace = /[qQ]/.test(sub)
        const p = pitchOf(sub)
        const d = durOf(sub)
        if (p == null) continue

        const tied = open[i].get(p)
        if (tied && (sub.includes('_') || sub.includes(']'))) {
          tied.d += d ?? 0                                // hold it longer
          if (sub.includes(']')) open[i].delete(p)
          continue
        }
        const note = { p, b: +time[i].toFixed(6), d: grace ? 0.12 : (d ?? 0.25), h: hands[i] }
        notes.push(note)
        if (sub.includes('[')) open[i].set(p, note)
      }
      // grace notes take no time; everything else advances this spine alone
      const lead = tok.split(' ')[0]
      if (!/[qQ]/.test(lead)) time[i] += durOf(lead) ?? 0
    })
  }

  const end = Math.max(...time.filter((x) => Number.isFinite(x)), 0)
  return { notes, meter: meter ?? { top: 4, bottom: 4 }, bpm, bars, quarters: end, meta }
}

// ------------------------------------------------------------------- output

import { writeScore } from './score-out.mjs'

const [name, url, ...rest] = process.argv.slice(2)
if (!name || !url) {
  console.error('usage: node tools/import-kern.mjs <name> <url> [--bpm N] [--pulse D] [--from BAR] [--to BAR]')
  process.exit(2)
}
const arg = (k, d) => {
  const i = rest.indexOf(`--${k}`)
  return i >= 0 ? Number(rest[i + 1]) : d
}

const res = await fetch(url)
if (!res.ok) { console.error(`could not fetch ${url}: ${res.status}`); process.exit(1) }
const score = parseKern(await res.text())
console.log(`${name}: hands taken from the score's own staff spines`)

writeScore({
  name, url,
  cmd: `node tools/import-kern.mjs ${name} ${url}${rest.length ? ' ' + rest.join(' ') : ''}`,
  notes: score.notes, meter: score.meter, bpm: score.bpm,
  quarters: score.quarters, meta: score.meta,
  from: arg('from', 0), to: arg('to', Infinity), bpmOverride: arg('bpm', undefined),
  pulseDenominator: arg('pulse', undefined),
})
