// Provision the hand tracker into public/ at build time.
//
// These files have to be served from our own origin: the page turns on
// somebody's camera, and pulling the model that reads it from a third-party
// CDN at runtime is not a thing we should ask them to accept. But 30 MB of
// vendored binaries has no business in git either. So: fetch on build, ignore
// in git, ship in the artifact.
//
// The wasm comes out of node_modules (@mediapipe/tasks-vision is already a
// dependency, so nothing is downloaded). Only the model is fetched, and it is
// checked against a known hash before anything is allowed to use it.

import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'mediapipe')

const MODEL = {
  url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
  path: join(out, 'models', 'hand_landmarker.task'),
}

// The SIMD build and the fallback for browsers without it. The `_module`
// build is only chosen when FilesetResolver is asked for the module variant,
// which we never do — leaving it out saves 11 MB in the deployed artifact.
const WASM = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const exists = (p) => stat(p).then(() => true, () => false)

async function wasm() {
  const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
  if (!(await exists(from))) {
    throw new Error('@mediapipe/tasks-vision is not installed — run npm install first')
  }
  await mkdir(join(out, 'wasm'), { recursive: true })
  let copied = 0
  for (const name of WASM) {
    const dst = join(out, 'wasm', name)
    if (await exists(dst)) continue
    await copyFile(join(from, name), dst)
    copied++
  }
  return copied
}

async function model() {
  if (await exists(MODEL.path)) {
    if (sha256(await readFile(MODEL.path)) === MODEL.sha256) return false
    console.warn('mediapipe: model hash mismatch, refetching')
  }
  await mkdir(dirname(MODEL.path), { recursive: true })
  const buf = await download()
  const got = sha256(buf)
  if (got !== MODEL.sha256) {
    throw new Error(`mediapipe: model hash is ${got}, expected ${MODEL.sha256}`)
  }
  await writeFile(MODEL.path, buf)
  return true
}

/**
 * This is the only thing the build fetches from the network, so a blip here
 * fails `npm run dev` and every CI run. Retry the transient half of that —
 * timeouts, resets, 5xx, 429 — and fail fast on the half that will not fix
 * itself, like a 404 from the model being moved.
 */
async function download() {
  const RETRIES = 4
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(MODEL.url, { signal: AbortSignal.timeout(60_000) })
      if (res.ok) return Buffer.from(await res.arrayBuffer())
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt > RETRIES) {
        throw new Error(`mediapipe: model fetch failed (${res.status})`)
      }
      console.warn(`mediapipe: fetch got ${res.status}, retrying`)
    } catch (err) {
      // A hash mismatch is not a network problem — never retry past it.
      if (attempt > RETRIES || err.message.startsWith('mediapipe:')) throw err
      console.warn(`mediapipe: fetch failed (${err.message}), retrying`)
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
  }
}

const copied = await wasm()
const fetched = await model()
console.log(
  copied || fetched
    ? `mediapipe: ${copied} wasm file(s) copied, model ${fetched ? 'downloaded' : 'already present'}`
    : 'mediapipe: already provisioned',
)
