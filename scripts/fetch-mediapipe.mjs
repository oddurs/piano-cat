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
  const res = await fetch(MODEL.url)
  if (!res.ok) throw new Error(`mediapipe: model fetch failed (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256(buf)
  if (got !== MODEL.sha256) {
    throw new Error(`mediapipe: model hash is ${got}, expected ${MODEL.sha256}`)
  }
  await writeFile(MODEL.path, buf)
  return true
}

const copied = await wasm()
const fetched = await model()
console.log(
  copied || fetched
    ? `mediapipe: ${copied} wasm file(s) copied, model ${fetched ? 'downloaded' : 'already present'}`
    : 'mediapipe: already provisioned',
)
