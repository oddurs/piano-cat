// Webcam -> a 64x36 luma grid. Frame differencing gives motion energy; bursts
// in that energy are strikes, the running level is the dynamic, and where the
// motion sits in frame decides bass/treble weighting.
// No ML model, no download, runs on anything with a camera.

export const GW = 64
export const GH = 36

export type Frame = {
  energy: number         // 0..1 smooth measure of how much is moving
  left: number           // motion in the left of frame (your bass hand)
  right: number          // motion in the right
  height: number         // 0 (low) .. 1 (high) centroid of motion
  down: number           // 0..1 how downward the motion is right now
  onset: boolean         // a strike happened this frame
  strength: number       // 0..1 how hard, if onset
  dyn: number            // 0..1 smoothed dynamic level
  wild: number           // 0..1 how frantic/uneven you are being
  pixels: Uint8Array
  motionMask: Uint8Array
}

const lerpRate = (dt: number, tau: number) => 1 - Math.exp(-dt / tau)

export class MotionReader {
  video = document.createElement('video')
  private cv = document.createElement('canvas')
  private cx!: CanvasRenderingContext2D
  private prev = new Uint8Array(GW * GH)
  private cur = new Uint8Array(GW * GH)
  mask = new Uint8Array(GW * GH)
  private hasPrev = false
  stream: MediaStream | null = null

  private lastVideoTime = -1
  private last: Frame

  // signal state
  private slow = 0            // moving average of energy
  private fluxMax = 0.004
  private env = 0
  private dynSmooth = 0
  private wildSmooth = 0
  private prevFlux = 0
  private armed = true
  private lastOnset = -1
  private cy = GH / 2
  private dySmooth = 0
  private heightSmooth = 0.5

  /** 0.4 (twitchy) .. 2.5 (needs big gestures) */
  sensitivity = 1

  constructor() {
    this.last = {
      energy: 0, left: 0, right: 0, height: 0.5, down: 0.5, onset: false,
      strength: 0, dyn: 0, wild: 0, pixels: this.cur, motionMask: this.mask,
    }
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } },
      audio: false,
    })
    this.video.srcObject = this.stream
    this.video.playsInline = true
    this.video.muted = true
    await this.video.play()
    this.cv.width = GW
    this.cv.height = GH
    this.cx = this.cv.getContext('2d', { willReadFrequently: true })!
    this.cx.imageSmoothingEnabled = true
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }

  read(now: number, dt: number): Frame {
    if (!this.stream || this.video.readyState < 2) return this.hold()

    // The camera runs at ~30fps but we're called at 60. Diffing a frame
    // against itself produced a zero every other tick, which made the whole
    // signal strobe — so only recompute when there is genuinely a new frame.
    if (this.video.currentTime === this.lastVideoTime) return this.hold()
    this.lastVideoTime = this.video.currentTime

    // mirrored, so waving your right hand moves the right side of the picture
    this.cx.save()
    this.cx.setTransform(-1, 0, 0, 1, GW, 0)
    this.cx.drawImage(this.video, 0, 0, GW, GH)
    this.cx.restore()
    const d = this.cx.getImageData(0, 0, GW, GH).data

    // Weighted rather than binary: a smooth measure of "how much is moving"
    // beats a pixel count, both for onsets and for reading your dynamics.
    let acc = 0, accL = 0, accR = 0, accY = 0, moved = 0
    const CAP = 72
    for (let i = 0, p = 0; i < GW * GH; i++, p += 4) {
      const l = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8
      this.cur[i] = l
      const diff = this.hasPrev ? Math.abs(l - this.prev[i]) : 0
      if (diff > 11) {
        const w = Math.min(diff, CAP)
        acc += w
        moved++
        const x = i % GW
        if (x < GW * 0.44) accL += w
        else if (x > GW * 0.56) accR += w
        accY += ((i / GW) | 0) * w
        this.mask[i] = 255
      } else {
        this.mask[i] = this.mask[i] > 40 ? (this.mask[i] * 0.7) | 0 : 0
      }
    }
    this.prev.set(this.cur)
    this.hasPrev = true

    const norm = GW * GH * CAP
    const energy = acc / norm
    const left = accL / norm
    const right = accR / norm

    // vertical centroid, and how fast it is falling (piano strokes go down)
    if (acc > 0) {
      const c = accY / acc
      const dyRaw = (c - this.cy) / Math.max(dt, 1 / 60) / GH
      this.cy = c
      this.dySmooth += (dyRaw - this.dySmooth) * lerpRate(dt, 0.07)
      this.heightSmooth += ((1 - c / GH) - this.heightSmooth) * lerpRate(dt, 0.25)
    }
    const down = Math.max(0, Math.min(1, 0.5 + this.dySmooth * 0.6))

    // --- dynamics: fast to swell, slow to subside
    this.env += (energy - this.env) * lerpRate(dt, energy > this.env ? 0.09 : 0.5)
    const target = Math.min(1, Math.pow(this.env / (0.075 * this.sensitivity), 0.7))
    this.dynSmooth += (target - this.dynSmooth) * lerpRate(dt, 0.16)

    // --- onsets: rising edges in the energy above its own moving average
    this.slow += (energy - this.slow) * lerpRate(dt, 0.3)
    const flux = Math.max(0, energy - this.slow)
    this.fluxMax = Math.max(flux, this.fluxMax * Math.exp(-dt / 1.6))
    const thr = Math.max(0.0022, this.fluxMax * 0.33) * this.sensitivity

    let onset = false
    let strength = 0
    const since = now - this.lastOnset
    if (!this.armed && (flux < thr * 0.45 || since > 0.55)) this.armed = true
    if (this.armed && flux > thr && flux >= this.prevFlux && since > 0.14) {
      onset = true
      this.armed = false
      this.lastOnset = now
      strength = Math.min(1, Math.pow(flux / Math.max(thr * 2.4, 1e-6), 0.7))
      strength *= 0.72 + down * 0.45     // a real keystroke travels downward
      strength = Math.max(0.12, Math.min(1, strength))
    }
    this.prevFlux = flux

    // --- wildness: how uneven the energy is, weighted by how loud you are
    const jitter = Math.min(1, flux / Math.max(thr * 3, 1e-6))
    this.wildSmooth += (jitter * this.dynSmooth - this.wildSmooth) * lerpRate(dt, 1.6)

    this.last = {
      energy, left, right, height: this.heightSmooth, down, onset, strength,
      dyn: this.dynSmooth, wild: this.wildSmooth,
      pixels: this.cur, motionMask: this.mask,
    }
    return this.last
  }

  /** re-serve the last analysis, minus the one-shot onset */
  private hold(): Frame {
    if (!this.last.onset) return this.last
    this.last = { ...this.last, onset: false, strength: 0 }
    return this.last
  }
}
