// Turn a Standard MIDI File into piece data.
//
//   node tools/import-midi.mjs <name> <url> [--bpm N] [--pulse D] [--from BAR] [--to BAR]
//
// The companion to import-kern.mjs, for sources that publish MIDI rather than
// Humdrum — Mutopia among them. Track names carry the staff, so which hand
// plays a note comes from the source here too rather than from its pitch.

import { writeScore } from './score-out.mjs'

function reader(buf) {
  let p = 0
  return {
    get at() { return p },
    set at(v) { p = v },
    u8: () => buf[p++],
    u16: () => { const v = buf.readUInt16BE(p); p += 2; return v },
    u32: () => { const v = buf.readUInt32BE(p); p += 4; return v },
    str: (n) => { const v = buf.toString('ascii', p, p + n); p += n; return v },
    varint: () => { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f) } while (b & 0x80); return v },
    skip: (n) => { p += n },
    get done() { return p >= buf.length },
  }
}

export function parseMidi(buf) {
  const r = reader(buf)
  if (r.str(4) !== 'MThd') throw new Error('not a MIDI file')
  r.u32()
  r.u16()                                   // format
  const ntrks = r.u16()
  const division = r.u16()
  if (division & 0x8000) throw new Error('SMPTE timing is not supported')

  const notes = []
  let meter = null
  let bpm = null
  let end = 0

  for (let t = 0; t < ntrks; t++) {
    if (r.str(4) !== 'MTrk') break
    const len = r.u32()
    const stop = r.at + len
    let tick = 0
    let status = 0
    let name = ''
    const open = new Map()

    while (r.at < stop) {
      tick += r.varint()
      let b = r.u8()
      if (b < 0x80) { r.at -= 1; b = status } else status = b
      const kind = b & 0xf0

      if (b === 0xff) {
        const type = r.u8()
        const n = r.varint()
        if (type === 0x03) name = r.str(n)
        else if (type === 0x51) { const us = (buf[r.at] << 16) | (buf[r.at + 1] << 8) | buf[r.at + 2]; bpm ??= Math.round(6e7 / us); r.skip(n) }
        else if (type === 0x58) { meter ??= { top: buf[r.at], bottom: 2 ** buf[r.at + 1] }; r.skip(n) }
        else r.skip(n)
        continue
      }
      if (b === 0xf0 || b === 0xf7) { r.skip(r.varint()); continue }

      if (kind === 0x90 || kind === 0x80) {
        const pitch = r.u8()
        const vel = r.u8()
        if (kind === 0x90 && vel > 0) open.set(pitch, { tick, vel })
        else {
          const on = open.get(pitch)
          if (on) {
            open.delete(pitch)
            notes.push({
              p: pitch,
              b: on.tick / division,
              d: Math.max(0.08, (tick - on.tick) / division),
              v: +Math.max(0.25, Math.min(1, on.vel / 110)).toFixed(2),
              track: t,
              name,
            })
          }
        }
      } else if (kind === 0xc0 || kind === 0xd0) r.u8()
      else if (kind >= 0x80 && kind <= 0xe0) { r.u8(); r.u8() }
      else break
    }
    end = Math.max(end, tick / division)
    r.at = stop
    // track names are only known once the track has been read, so stamp them now
    for (const n of notes) if (n.track === t) n.name = name
  }

  // Which staff a note belongs to, in descending order of how much the
  // source is actually telling us. Named tracks are the source saying it
  // outright. Two note-bearing tracks is the source saying it by structure —
  // one staff each — and which is which follows from their registers, not
  // from a threshold applied note by note. Splitting every note at middle C
  // is the last resort, and it is wrong every time a hand crosses over.
  const named = new Set(notes.map((n) => n.name).filter(Boolean))
  const lower = [...named].filter((s) => /low|left|bass/i.test(s))
  const upper = [...named].filter((s) => /up|right|treb/i.test(s))
  let how = 'middle C'
  if (lower.length && upper.length) {
    how = 'track names'
    for (const n of notes) n.h = lower.includes(n.name) ? 'L' : upper.includes(n.name) ? 'R' : n.p < 60 ? 'L' : 'R'
  } else {
    const tracks = [...new Set(notes.map((n) => n.track))]
    if (tracks.length === 2) {
      const meanOf = (t) => {
        const xs = notes.filter((n) => n.track === t)
        return xs.reduce((a, n) => a + n.p, 0) / xs.length
      }
      const [a, b] = tracks
      const lowTrack = meanOf(a) <= meanOf(b) ? a : b
      how = 'one track per staff'
      for (const n of notes) n.h = n.track === lowTrack ? 'L' : 'R'
    } else {
      for (const n of notes) n.h = n.p < 60 ? 'L' : 'R'
    }
  }
  return { notes, meter: meter ?? { top: 4, bottom: 4 }, bpm, quarters: end, how }
}

const [name, url, ...rest] = process.argv.slice(2)
if (!name || !url) { console.error('usage: node tools/import-midi.mjs <name> <url> [--bpm N] [--pulse D] [--from BAR] [--to BAR]'); process.exit(2) }
const arg = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? Number(rest[i + 1]) : d }

const res = await fetch(url)
if (!res.ok) { console.error(`could not fetch ${url}: ${res.status}`); process.exit(1) }
const score = parseMidi(Buffer.from(await res.arrayBuffer()))
console.log(`${name}: hands taken from ${score.how}`)
if (score.how === 'middle C') {
  console.warn(`  ${name}: that is a guess, and it is wrong wherever the hands cross`)
}

writeScore({
  name, url,
  cmd: `node tools/import-midi.mjs ${name} ${url}${rest.length ? ' ' + rest.join(' ') : ''}`,
  notes: score.notes, meter: score.meter, bpm: score.bpm, quarters: score.quarters,
  from: arg('from', 0), to: arg('to', Infinity), bpmOverride: arg('bpm', undefined),
  pulseDenominator: arg('pulse', undefined),
})
