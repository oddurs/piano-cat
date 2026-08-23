// The camera end of things: one video element, one 64x36 luma grid for the
// backdrop, and a hand model when the machine can carry one.
//
// Everything is driven by requestVideoFrameCallback rather than the render
// loop. The old code polled video.currentTime from rAF and skipped the frames
// where it hadn't changed — which meant every observation was up to a whole
// render frame stale on top of the camera's own latency. Now we look exactly
// when there is something new to look at.
//
// This all runs on the main thread, and it stays there deliberately. Moving
// the model into a worker was planned, then measured and dropped: with the
// hand model running and a piece playing, frame intervals came out at 8ms
// median and 17ms at their worst with *no* long tasks at all, inference cost
// 6.4ms, and shutter-to-schedule was 8.2ms median and 9.3ms at p95. There is
// no contention to relieve. A worker would buy nothing measurable and would
// cost a Chromium-only capture path plus a fallback to keep working, in the
// most fragile part of the app. Measure again before revisiting; the numbers
// are what should decide it, not the fact that workers sound faster.

import { BASE } from './base'
import type { Observation, Sample } from './perception'

export const GW = 64
export const GH = 36

export type CameraMode = 'hands' | 'pixels'

/** landmark indices we care about */
const WRIST = 0
const PALM = [0, 5, 9, 13, 17]
const TIPS = [8, 12, 16]
const THUMB_TIP = 4
const PINKY_TIP = 20
const MIDDLE_MCP = 9

export class Camera {
  video = document.createElement('video')
  stream: MediaStream | null = null
  mode: CameraMode = 'pixels'
  /** set when the hand model was asked for but could not be used */
  modelNote: string | null = null
  fps = 0

  pixels = new Uint8Array(GW * GH)
  mask = new Uint8Array(GW * GH)

  onSample: ((s: Sample) => void) | null = null
  onLost: (() => void) | null = null

  private cv = document.createElement('canvas')
  private cx!: CanvasRenderingContext2D
  private prev = new Uint8Array(GW * GH)
  private hasPrev = false
  private landmarker: any = null
  private lastStamp = -1
  private stop_ = false
  private cost = 14
  private frames = 0
  private fpsAt = 0

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 60 } },
      audio: false,
    })
    for (const track of this.stream.getVideoTracks()) {
      track.addEventListener('ended', () => this.lose())
    }
    this.video.srcObject = this.stream
    this.video.playsInline = true
    this.video.muted = true
    await this.video.play()

    this.cv.width = GW
    this.cv.height = GH
    this.cx = this.cv.getContext('2d', { willReadFrequently: true })!
    this.stop_ = false
    this.pump()
  }

  /** Load the hand model. Safe to fail — we simply stay in pixels mode. */
  async loadHands(onProgress?: (v: number) => void) {
    if (this.landmarker) { onProgress?.(1); return }
    try {
      const vision = await import('@mediapipe/tasks-vision')
      onProgress?.(0.15)
      const files = await vision.FilesetResolver.forVisionTasks(`${BASE}/mediapipe/wasm`)
      onProgress?.(0.4)
      this.landmarker = await vision.HandLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: `${BASE}/mediapipe/models/hand_landmarker.task`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      })
      onProgress?.(1)
      this.mode = 'hands'
      this.modelNote = null
    } catch (e) {
      this.landmarker = null
      this.mode = 'pixels'
      this.modelNote = 'HAND MODEL UNAVAILABLE - USING MOTION'
    }
  }

  stop() {
    this.stop_ = true
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.landmarker?.close?.()
    this.landmarker = null
  }

  private lose() {
    // Stop the pump too, or a later start() leaves two of them running over
    // the same video element.
    this.stop_ = true
    this.stream = null
    this.onLost?.()
  }

  // ------------------------------------------------------------------ pump

  private pump() {
    const anyVideo = this.video as any
    const step = (_now?: number, meta?: any) => {
      if (this.stop_) return
      const t = performance.now() / 1000
      // presentationTime is when the frame was actually captured; the gap
      // between it and now is latency we did not cause and cannot remove,
      // but we can at least report it honestly.
      const capturedAt = meta?.presentationTime != null ? meta.presentationTime / 1000 : t
      if (this.video.readyState >= 2) this.observe(t, capturedAt)
      if (anyVideo.requestVideoFrameCallback) anyVideo.requestVideoFrameCallback(step)
      else requestAnimationFrame(() => step())
    }
    if (anyVideo.requestVideoFrameCallback) anyVideo.requestVideoFrameCallback(step)
    else requestAnimationFrame(() => step())
  }

  private observe(t: number, capturedAt: number) {
    const energy = this.grid()

    let hands: Observation[] = []
    if (this.landmarker) {
      const stamp = Math.max(this.lastStamp + 1, Math.round(t * 1000))
      this.lastStamp = stamp
      const t0 = performance.now()
      try {
        const res = this.landmarker.detectForVideo(this.video, stamp)
        hands = (res?.landmarks ?? []).map(readHand).filter(Boolean) as Observation[]
      } catch {
        // a transient GPU hiccup should not take the instrument down
      }
      // If the model cannot keep up there is no point in it being late *and*
      // wrong — drop to the pixel path and say so.
      this.cost += (performance.now() - t0 - this.cost) * 0.06
      if (this.cost > 46) {
        this.landmarker.close?.()
        this.landmarker = null
        this.mode = 'pixels'
        this.modelNote = 'TOO SLOW FOR HAND TRACKING - USING MOTION'
      }
    }

    this.frames++
    if (t - this.fpsAt > 0.5) {
      this.fps = this.frames / (t - this.fpsAt)
      this.frames = 0
      this.fpsAt = t
    }

    this.onSample?.({ t, capturedAt, hands, energy })
  }

  /** Downsample to the little luma grid, and diff it for the backdrop glow. */
  private grid(): number {
    this.cx.save()
    this.cx.setTransform(-1, 0, 0, 1, GW, 0)   // mirrored: you move, your side moves
    this.cx.drawImage(this.video, 0, 0, GW, GH)
    this.cx.restore()
    const d = this.cx.getImageData(0, 0, GW, GH).data

    let acc = 0
    const CAP = 72
    for (let i = 0, p = 0; i < GW * GH; i++, p += 4) {
      const l = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8
      this.pixels[i] = l
      const diff = this.hasPrev ? Math.abs(l - this.prev[i]) : 0
      if (diff > 11) {
        acc += Math.min(diff, CAP)
        this.mask[i] = 255
      } else {
        this.mask[i] = this.mask[i] > 40 ? (this.mask[i] * 0.7) | 0 : 0
      }
    }
    this.prev.set(this.pixels)
    this.hasPrev = true
    return acc / (GW * GH * CAP)
  }
}

type LM = { x: number; y: number; z: number }

function readHand(lm: LM[]): Observation | null {
  if (!lm || lm.length < 21) return null
  let px = 0, py = 0
  for (const i of PALM) { px += lm[i].x; py += lm[i].y }
  px /= PALM.length; py /= PALM.length

  let sy = 0
  let pz = 0
  for (const i of TIPS) sy += lm[i].y
  sy /= TIPS.length
  for (const i of PALM) pz += lm[i].z ?? 0
  pz /= PALM.length

  const palm = Math.hypot(lm[MIDDLE_MCP].x - lm[WRIST].x, lm[MIDDLE_MCP].y - lm[WRIST].y) || 1e-3
  const span = Math.hypot(lm[THUMB_TIP].x - lm[PINKY_TIP].x, lm[THUMB_TIP].y - lm[PINKY_TIP].y) / palm

  return {
    x: 1 - px,                                     // mirrored to match the backdrop
    y: py,
    sy,
    z: pz,
    spread: Math.max(0, Math.min(1, (span - 0.7) / 1.1)),
    conf: 1,
  }
}
