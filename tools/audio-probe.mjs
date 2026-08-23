// Measure what a velocity actually does to the sound.
//
//   npm run probe
//
// There is one recording per pitch, so every difference between a fortissimo
// and a pianissimo is modelled rather than played back. That is a claim, and
// claims about sound are worth checking with a number instead of a paragraph.
// This renders single notes through the real audio graph in a real browser and
// reports what came out.

const APP = process.env.APP ?? 'http://localhost:9393/'
const PORT = process.env.CDP_PORT ?? 9222

if (!await fetch(APP).then((r) => r.ok, () => false)) {
  console.error(`nothing is serving ${APP} — start it with \`npm run dev\``)
  process.exit(2)
}
const targets = await fetch(`http://localhost:${PORT}/json`).then((r) => r.json(), () => null)
if (!targets) { console.error(`no browser on :${PORT} — see tools/drive.mjs for the launch line`); process.exit(2) }

const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const waiting = new Map()
const call = (method, params = {}) => new Promise((res) => {
  const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params }))
})
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) }
})
await call('Runtime.enable'); await call('Page.enable')
const ev = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result?.result?.value
}
const key = async (k, code, vk) => {
  for (const type of ['keyDown', 'keyUp']) {
    await call('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk })
  }
}

await call('Page.navigate', { url: `${APP}?probe=1` })
await new Promise((r) => setTimeout(r, 2500))
await key('p', 'KeyP', 80)                    // LISTEN: loads the piano
for (let i = 0; i < 60 && !(await ev('!!window.__piano?.ready')); i++) {
  await new Promise((r) => setTimeout(r, 500))
}
if (!await ev('!!window.__piano?.ready')) { console.error('the piano never loaded'); process.exit(1) }
await key('p', 'KeyP', 80)                    // and stop it again

const rows = await ev(`(async () => {
  const p = window.__piano
  const rate = p.ctx.sampleRate
  // A magnitude-weighted centroid on a piano note is pinned by the
  // fundamental and barely moves however the hammer is behaving. What the
  // hammer actually decides is how much lives *above* the fundamental, so
  // that is what gets measured: energy over 1.5kHz as a share of the whole.
  const spectrum = (buf) => {
    const N = 4096, off = Math.floor(rate * 0.01)
    const bins = []
    for (let b = 0; b < 56; b++) {
      const f = 80 * Math.pow(2, b / 8)
      if (f > rate / 2) break
      const w = 2 * Math.PI * f / rate
      const c = 2 * Math.cos(w)
      let s1 = 0, s2 = 0
      for (let i = 0; i < N; i++) { const s0 = (buf[off + i] || 0) + c * s1 - s2; s2 = s1; s1 = s0 }
      bins.push({ f, mag: Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - c * s1 * s2)) })
    }
    const all = bins.reduce((a, x) => a + x.mag, 0) || 1e-9
    const high = bins.filter((x) => x.f > 1500).reduce((a, x) => a + x.mag, 0)
    const centroid = bins.reduce((a, x) => a + x.f * x.mag, 0) / all
    return { hf: high / all, centroid }
  }
  const out = []
  for (const vel of [0.12, 0.35, 0.6, 0.85, 1]) {
    const buf = await p.render(60, vel)
    let peak = 0, rms = 0
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; rms += buf[i] * buf[i] }
    out.push({ vel, peak, rms: Math.sqrt(rms / buf.length), ...spectrum(buf) })
  }
  return out
})()`)

console.log('vel    peak     rms      >1.5kHz   centroid')
for (const r of rows) {
  console.log(
    `${r.vel.toFixed(2)}   ${r.peak.toFixed(4)}   ${r.rms.toFixed(4)}   ` +
    `${(r.hf * 100).toFixed(1)}%      ${r.centroid.toFixed(0)}Hz`,
  )
}
const lo = rows[0], hi = rows[rows.length - 1]
const louder = hi.rms / Math.max(1e-9, lo.rms)
const brighter = hi.hf / Math.max(1e-9, lo.hf)
console.log(`\nff is ${louder.toFixed(1)}x louder, and ${brighter.toFixed(1)}x as much of it is above 1.5kHz`)
const ok = brighter > 3 && louder > 4
console.log(ok ? 'PASS — velocity changes colour, not just level' : 'FAIL — velocity is mostly a volume knob')
ws.close()
process.exit(ok ? 0 : 1)
