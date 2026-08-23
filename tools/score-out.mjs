// Shared by both importers: check a parsed score, then write it out.
//
// A parse that reads plausibly and is wrong in the middle is worse than one
// that fails loudly, and both of the mistakes actually made while building
// this — a filename that was not the sonata anybody would assume, and a
// meter read from the wrong movement — would have gone straight through
// unnoticed. So nothing is written until it has been checked against what the
// source itself says it is.

import { mkdirSync, writeFileSync } from 'node:fs'

export function writeScore({ name, url, cmd, notes, meter, bpm, quarters, meta = {}, from = 0, to = Infinity, bpmOverride, pulseDenominator }) {
  // A pulse is the beat the meter names, not a quarter note. Everything
  // arrives measured in quarters, so 3/8 counted in quarters gives one and a
  // half beats to the bar, which is not a thing anybody can wave to. Counted
  // in eighths it gives three, which is what the music is doing.
  // --pulse overrides the meter's own beat where the notation and the way
  // anyone would actually conduct the piece disagree: alla breve Moonlight is
  // written in half notes and nobody waves once every two and a half seconds.
  const den = pulseDenominator ?? meter.bottom
  const unit = 4 / den
  const perBar = Math.round(meter.top * (den / meter.bottom))
  const lo = from * perBar * unit
  const hi = to * perBar * unit
  const kept = notes
    .filter((n) => n.b >= lo && n.b < hi)
    .map((n) => ({
      ...n,
      b: +((n.b - lo) / unit).toFixed(4),
      d: +Math.max(0.08, n.d / unit).toFixed(4),
    }))
    .sort((a, b) => a.b - b.b || a.p - b.p)

  const problems = []
  const L = kept.filter((n) => n.h === 'L')
  const R = kept.filter((n) => n.h === 'R')
  const mean = (xs) => xs.reduce((a, n) => a + n.p, 0) / Math.max(1, xs.length)
  if (kept.length < 20) problems.push(`only ${kept.length} notes came out`)
  if (!L.length || !R.length) problems.push('one of the two staves is empty')
  else if (mean(L) >= mean(R)) {
    problems.push(`left hand averages ${mean(L).toFixed(1)}, right ${mean(R).toFixed(1)} — the staves are the wrong way round`)
  }
  const outside = kept.filter((n) => n.p < 21 || n.p > 108)
  if (outside.length) problems.push(`${outside.length} notes outside a piano's 88 keys`)
  if (kept.some((n) => !(n.d > 0))) problems.push('some notes have no length')
  if (kept.some((n) => !Number.isFinite(n.b) || n.b < 0)) problems.push('some notes start nowhere')
  if (problems.length) {
    console.error(`${name}: refusing to write —`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }

  // round the loop out to a whole bar: the follower counts bars, and a take
  // that repeats from three beats into one is not the piece
  const span = (Math.min(hi, quarters) - lo) / unit
  const loopAt = Math.ceil(span / perBar) * perBar
  // the marked tempo is in quarters; the pulse may not be
  const tempo = Math.round((bpmOverride ?? bpm ?? 96) / unit)
  const title = [meta.OTL, meta.OMV && `movement ${meta.OMV}`, meta.OMD, meta.SCT1 ?? meta.SCT]
    .filter(Boolean).join(', ')

  const out = `// GENERATED — do not edit by hand. Regenerate with:
//   ${cmd}
//
// ${title || name}
// ${meta.COM ?? 'composer not stated in the source'}
//
// Read from: ${url}
// The music is public domain. The digital edition it was read from is the
// work of its editors, credited in lib/scores/SOURCES.md.
//
// ${kept.length} notes, ${loopAt} quarter-note pulses over ${(loopAt / perBar).toFixed(0)} bars,
// ${meter.top}/${meter.bottom}${bpm ? `, marked MM ${bpm}` : ''}.

import type { NoteEv } from '../pieces'

export const pulsesPerBar = ${perBar}
export const loopAt = ${loopAt}
export const suggestedBpm = ${tempo}

export const notes: NoteEv[] = [
${kept.map((n) => `  { p: ${n.p}, b: ${n.b}, d: ${n.d}, v: ${n.v ?? (n.h === 'L' ? 0.56 : 0.74)}, h: ${n.h === 'L' ? -1 : 1} },`).join('\n')}
]
`
  mkdirSync('lib/scores', { recursive: true })
  writeFileSync(`lib/scores/${name}.ts`, out)
  console.log(
    `${name}: ${title || '(untitled)'}\n  ${kept.length} notes, ${loopAt} pulses over ` +
    `${(loopAt / perBar).toFixed(0)} bars, ${meter.top}/${meter.bottom}, ` +
    `hands ${mean(L).toFixed(0)}/${mean(R).toFixed(0)}, ~${(loopAt / tempo).toFixed(1)} min at ${tempo}`,
  )
}
