// Supervise `next dev` so a crash does not leave you staring at a dead port.
//
// The toy is fiddled with for long stretches — camera permissions, a phone
// pointed at the screen, a hand waving at the lens — and a Turbopack panic in
// the middle of that used to end the session silently. So: restart on an exit
// nobody asked for, back off if it is failing on startup rather than mid-run,
// and give up loudly instead of hammering a port forever.
//
// `npm run dev:raw` is the escape hatch to a plain, unsupervised `next dev`.

import { spawn, execFileSync } from 'node:child_process'

const PORT = process.env.PORT || '9393'
const URL_ = `http://localhost:${PORT}/`

// A child that ran this long was serving, not crash-looping on startup.
const HEALTHY_MS = 60_000
const MAX_FAST_FAILURES = 5
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

const dim = (s) => `\x1b[2m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** pids listening on PORT, newest last. Empty when the port is free. */
function listeners() {
  try {
    const out = execFileSync('lsof', ['-tiTCP:' + PORT, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.split('\n').filter(Boolean).map(Number)
  } catch {
    return [] // lsof exits non-zero when nothing matches
  }
}

const commandOf = (pid) => {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/**
 * Reclaim the port, but only from one of our own strays. Killing whatever
 * happens to hold 9393 would eventually kill something that matters, so an
 * unrecognised listener is reported and we step aside. Note that Next
 * renames the listening process to `next-server (v16.3.2)` — matching on
 * `next dev` alone never fires, which is exactly the bug this comment is
 * here to stop someone reintroducing.
 */
async function reclaimPort() {
  for (const pid of listeners()) {
    const cmd = commandOf(pid)
    if (!/^next-server\b|\bnext\b.*\bdev\b/.test(cmd)) {
      console.error(red(`port ${PORT} is held by pid ${pid}:`))
      console.error(`  ${cmd || '(unknown process)'}`)
      console.error(`Stop it, or pick another port:  PORT=${Number(PORT) + 1} npm run dev`)
      process.exit(1)
    }
    console.log(dim(`→ reclaiming port ${PORT} from a stray next dev (pid ${pid})`))
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already gone between lsof and here
    }
  }
  // Give the old listener a moment to let go before we bind.
  for (let i = 0; i < 20 && listeners().length; i++) await sleep(100)
  for (const pid of listeners()) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* gone */
    }
  }
}

/** One-shot readiness probe: a live process that cannot serve is still down. */
async function probe() {
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    if (stopping || !child) return
    try {
      const res = await fetch(URL_, { signal: AbortSignal.timeout(2_000) })
      if (res.ok) return console.log(dim(`→ serving ${URL_}`))
    } catch {
      // not up yet
    }
  }
  console.warn(dim(`→ ${URL_} did not answer within 30s (the process is still up)`))
}

let child = null
let stopping = false
let fastFailures = 0

async function run() {
  await reclaimPort()

  const startedAt = Date.now()
  child = spawn('npx', ['next', 'dev', '-p', PORT], {
    stdio: 'inherit',
    env: process.env,
  })
  probe()

  const [code, signal] = await new Promise((resolve) =>
    child.once('exit', (c, s) => resolve([c, s])),
  )
  child = null
  if (stopping) return

  const how = signal ? `signal ${signal}` : `code ${code}`
  const lived = Date.now() - startedAt

  if (lived >= HEALTHY_MS) {
    fastFailures = 0 // it was serving fine; this is a fresh problem, not a loop
  } else if (++fastFailures >= MAX_FAST_FAILURES) {
    console.error(red(`next dev exited (${how}) ${fastFailures} times without staying up.`))
    console.error('Giving up — this is a code or config error, not a flake.')
    process.exit(1)
  }

  const wait = BACKOFF_MS[Math.min(fastFailures, BACKOFF_MS.length - 1)]
  console.warn(dim(`→ next dev exited (${how}); restarting in ${wait / 1000}s`))
  await sleep(wait)
  return run()
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true
    if (child) child.kill(sig)
    // The child inherits the terminal; let it print its own goodbye first.
    setTimeout(() => process.exit(0), 300)
  })
}

await run()
