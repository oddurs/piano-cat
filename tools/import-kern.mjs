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

/** dynamic marks, as a fraction of full hammer speed */
const DYN = {
  ppp: 0.16, pp: 0.26, p: 0.36, mp: 0.46, mf: 0.58,
  f: 0.7, ff: 0.82, fff: 0.92, sf: 0.85, sfz: 0.88, fp: 0.72, rf: 0.8, rfz: 0.82,
}

/**
 * Humdrum spines are a living list, not columns.
 *
 * A staff splits into voices with `*^` and rejoins with `*v`, which piano
 * music does constantly — a melody and an accompaniment sharing one hand.
 * Reading the file as a fixed table of columns works until the first split
 * and is quietly wrong forever after: notes land on the wrong staff and
 * against the wrong clock. Five of the six scores imported here do it, and
 * the Moonlight Sonata does it sixteen times.
 *
 * So the spine list is rebuilt on every interpretation line, and each spine
 * carries its own staff, its own elapsed time and its own unfinished ties.
 */
export function parseKern(text) {
  const meta = {}
  let spines = []
  const notes = []
  let meter = null
  let bpm = null
  let bars = 0
  let dynamic = DYN.mf
  // tracked as we go: spines are dropped at the end of the file, so asking
  // the survivors how far they got gets you nothing at all
  let end = 0

  const spine = (kind, staff) => ({ kind, staff, t: 0, ties: new Map() })

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const ref = /^!!!([A-Z]+\d*):\s*(.+)$/.exec(line)
    if (ref) { meta[ref[1]] ??= ref[2].replace(/<[^>]+>/g, '').trim(); continue }
    if (!line || line.startsWith('!')) continue
    const cols = line.split('\t')

    if (line.startsWith('**')) {
      spines = cols.map((c) => spine(c.replace(/^\*\*/, ''), 'R'))
      continue
    }

    if (line.startsWith('*')) {
      const next = []
      for (let i = 0; i < cols.length && i < spines.length; i++) {
        const c = cols[i]
        const sp = spines[i]
        if (c === '*-') continue                       // this spine ends here
        if (c === '*^') {                              // one voice becomes two
          next.push(sp, { ...sp, ties: new Map() })
          continue
        }
        if (c === '*v') {                              // several become one
          if (next.length === 0 || cols[i - 1] !== '*v') next.push(sp)
          continue
        }
        const st = /^\*staff(\d)/.exec(c)
        if (st) sp.staff = st[1] === '1' ? 'R' : 'L'
        const mm = /^\*M(\d+)\/(\d+)$/.exec(c)
        if (mm) meter ??= { top: +mm[1], bottom: +mm[2] }
        const t = /^\*MM(\d+)/.exec(c)
        if (t) bpm ??= +t[1]
        next.push(sp)
      }
      spines = next
      continue
    }

    if (cols[0]?.startsWith('=')) { bars++; continue }

    // dynamics first: they colour whatever sounds on this line
    cols.forEach((tok, i) => {
      const sp = spines[i]
      if (!sp || sp.kind !== 'dynam' || tok === '.' || !tok) return
      for (const key of Object.keys(DYN).sort((a, b) => b.length - a.length)) {
        if (tok.includes(key)) { dynamic = DYN[key]; break }
      }
    })

    cols.forEach((tok, i) => {
      const sp = spines[i]
      if (!sp || sp.kind !== 'kern' || tok === '.' || tok === '') return
      for (const sub of tok.split(' ')) {
        if (!sub || /r/.test(sub)) continue
        const grace = /[qQ]/.test(sub)
        const p = pitchOf(sub)
        const d = durOf(sub)
        if (p == null) continue

        const held = sp.ties.get(p)
        if (held && /[_\]]/.test(sub)) {
          held.d += d ?? 0
          if (sub.includes(']')) sp.ties.delete(p)
          continue
        }
        // articulation the score actually notated, rather than a guess
        const staccato = sub.includes("'")
        const accent = /[\^>]/.test(sub)
        const tenuto = sub.includes('~')
        const note = {
          p,
          b: +sp.t.toFixed(6),
          d: grace ? 0.12 : Math.max(0.05, (d ?? 0.25) * (staccato ? 0.45 : tenuto ? 1 : 0.92)),
          v: +Math.max(0.12, Math.min(1, dynamic * (accent ? 1.28 : 1))).toFixed(3),
          h: sp.staff,
        }
        notes.push(note)
        if (sub.includes('[')) sp.ties.set(p, note)
      }
      const lead = tok.split(' ')[0]
      if (!/[qQ]/.test(lead)) sp.t += durOf(lead) ?? 0
      if (sp.t > end) end = sp.t
    })
  }

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
