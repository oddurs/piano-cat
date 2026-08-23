// Drive the real app in headless Chrome and report what screen it reached.
//
//   npm run drive            play a piece through to its verdict
//
// This exists because the alternative — eyeballing a deck string and calling
// anything that isn't the verdict "still playing" — cannot tell the menu from
// the loading screen from a dead dev server, and will happily report a
// regression that is really a process that exited half an hour ago. It names
// the screen, and it refuses to run at all if nothing is listening.

const APP = process.env.APP ?? 'http://localhost:9393/'
const PORT = process.env.CDP_PORT ?? 9222
const PIECE = Number(process.env.PIECE ?? 10)         // default: Chopsticks, the shortest

const up = await fetch(APP, { method: 'GET' }).then((r) => r.ok, () => false)
if (!up) {
  console.error(`nothing is serving ${APP} — start it with \`npm run dev\` first`)
  process.exit(2)
}

const targets = await fetch(`http://localhost:${PORT}/json`).then((r) => r.json(), () => null)
if (!targets) {
  console.error(`no browser on :${PORT}. Launch one with:
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \\
    --remote-debugging-port=${PORT} --user-data-dir=/tmp/piano-cat-drive \\
    --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \\
    --autoplay-policy=no-user-gesture-required --enable-unsafe-swiftshader`)
  process.exit(2)
}

const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const waiting = new Map()
const errs = []
const call = (method, params = {}) => new Promise((res) => {
  const n = ++id
  waiting.set(n, res)
  ws.send(JSON.stringify({ id: n, method, params }))
})
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) }
  else if (m.method === 'Runtime.exceptionThrown') {
    errs.push(m.params.exceptionDetails?.exception?.description ?? '?')
  }
})

await call('Runtime.enable')
await call('Page.enable')
const ev = async (x) => (await call('Runtime.evaluate', { expression: x, returnByValue: true }))
  .result?.result?.value
const key = async (k, code, vk) => {
  for (const type of ['keyDown', 'keyUp']) {
    await call('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk })
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Which screen is on, by name. Not "is it the verdict, else assume fine". */
const screen = async () => {
  const d = await ev("document.querySelector('.deck')?.textContent ?? ''")
  if (d === '') return 'NOT LOADED'
  if (d.includes('ENCORE')) return 'VERDICT'
  if (d.includes('RESTART')) return 'PLAY'
  if (d.includes('LOADING')) return 'LOADING'
  if (d.includes('PICK')) return 'MENU'
  return `UNKNOWN(${d.slice(0, 30)})`
}

await call('Page.navigate', { url: APP })
await wait(2500)
if (await screen() !== 'MENU') {
  console.error('did not reach the menu:', await screen())
  process.exit(1)
}

for (let i = 0; i < PIECE; i++) await key('ArrowDown', 'ArrowDown', 40)
await key('Enter', 'Enter', 13)

let started = false
for (let i = 0; i < 90; i++) {
  if (await screen() === 'PLAY') { started = true; break }
  await wait(250)
}
if (!started) {
  console.error('the piece never started; stuck on', await screen())
  process.exit(1)
}
console.log('playing')

let reached = null
for (let s = 0; s < 26 && !reached; s++) {
  for (let i = 0; i < 3; i++) { await key(' ', 'Space', 32); await wait(320) }
  if (await screen() === 'VERDICT') reached = s + 1
}

console.log(reached ? `verdict after ~${reached}s of playing` : `no verdict; ended on ${await screen()}`)
console.log(`exceptions: ${errs.length}${errs.length ? ' ' + errs[0] : ''}`)
ws.close()
process.exit(reached && !errs.length ? 0 : 1)
