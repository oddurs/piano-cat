'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Press_Start_2P } from 'next/font/google'
import { PIECES, type Piece } from '@/lib/pieces'
import { Piano } from '@/lib/audio'
import { Camera, GW, GH } from '@/lib/camera'
import { Perception } from '@/lib/perception'
import { Probe, Recorder } from '@/lib/capture'
import {
  TakePlayer, TakeRecorder, decodeTake, encodeTake, loadTake, saveTake, type Take,
} from '@/lib/take'
import { restingHand, type PlayFrame, type Side } from '@/lib/signal'
import { Conductor, type Expression } from '@/lib/conductor'
import { Renderer, setFont, W, H, type CatMood } from '@/lib/render'
import { drawMenu, drawLoading, drawVerdict, menuRowAt } from '@/lib/menu'

const pixel = Press_Start_2P({ weight: '400', subsets: ['latin'], variable: '--pixel' })

type Screen = 'menu' | 'loading' | 'play' | 'verdict'
/** the piece is yours after this many counted beats, or on your first stroke */
type CountIn = { left: number; at: number } | null
/** let the last chord ring before anyone claps over it */
const RING_OUT = 4
/** long enough that a trailing stroke cannot skip your own verdict */
const VERDICT_GRACE = 2

export default function Page() {
  const [screen, setScreenState] = useState<Screen>('menu')
  const [piece, setPiece] = useState<Piece | null>(null)
  const pieceRef = useRef<Piece>(PIECES[0])
  const [auto, setAuto] = useState(false)
  const [sens, setSens] = useState(1)
  const [stride, setStride] = useState(1)
  const [take, setTake] = useState(1)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pianoRef = useRef<Piano | null>(null)
  const camRef = useRef<Camera | null>(null)
  const perRef = useRef<Perception>(new Perception())
  const conRef = useRef<Conductor | null>(null)
  const renRef = useRef<Renderer | null>(null)
  const recRef = useRef<Recorder>(new Recorder(30))
  const probeRef = useRef<Probe>(new Probe())
  const frameRef = useRef<PlayFrame>(idleFrame())

  const screenRef = useRef<Screen>('menu')
  const selRef = useRef(0)
  const statusRef = useRef('')
  const doneRef = useRef(0)
  // A warning is news, not a permanent fixture. On the play screen it expires,
  // because a stale 'CAMERA DECLINED' used to sit in the hint panel for the
  // rest of the session hiding every hint that would actually have helped. On
  // the menu it persists, because that is where you can act on it.
  const warnRef = useRef<{ text: string; until: number } | null>(null)
  const takeRef = useRef(1)
  const autoRef = useRef(false)
  const sawFirstRef = useRef(false)
  const keySideRef = useRef<Side>('R')
  const autoAccRef = useRef(0)
  const debugRef = useRef(false)
  const takeRecRef = useRef<TakeRecorder>(new TakeRecorder())
  const lastTakeRef = useRef<Take | null>(null)
  const replayRef = useRef<TakePlayer | null>(null)
  const sharedRef = useRef<Take | null>(null)
  const [shared, setShared] = useState(false)
  const [copied, setCopied] = useState(false)
  const countRef = useRef<CountIn>(null)
  /** things we have already shown you once; nobody needs telling twice */
  const seenRef = useRef<Set<string>>(new Set())
  const previewRef = useRef<{ con: Conductor; acc: number; side: Side } | null>(null)
  /** how much of this performance had two hands far enough apart to be two people */
  const duetRef = useRef({ frames: 0, both: 0 })
  const [listening, setListening] = useState(false)
  const overAtRef = useRef(0)
  const clappedRef = useRef(false)
  const verdictAtRef = useRef(0)

  const setScreen = (s: Screen) => { screenRef.current = s; setScreenState(s) }
  /** Say a thing once, at the moment it is true. Nobody reads the caption. */
  const teach = (key: string, text: string) => {
    if (seenRef.current.has(key)) return
    seenRef.current.add(key)
    renRef.current?.reveal(text)
  }
  const warn = (text: string | null, secs = 9) => {
    warnRef.current = text ? { text, until: performance.now() / 1000 + secs } : null
  }
  const liveWarn = (now: number) => {
    const w = warnRef.current
    return w && now <= w.until ? w.text : null
  }
  useEffect(() => { autoRef.current = auto }, [auto])
  useEffect(() => { perRef.current.sensitivity = sens }, [sens])
  useEffect(() => { conRef.current?.setStride(stride) }, [stride])
  useEffect(() => { setFont(`${pixel.style.fontFamily}, ui-monospace, monospace`) }, [])

  // Somebody sent you a performance. It is a few hundred numbers in the link.
  // Also listened for on hashchange, because pasting a link into a tab that
  // already has the page open is a same-document navigation — nothing reloads,
  // and without this the link would appear to do nothing at all.
  useEffect(() => {
    const read = () => {
      const m = /[#&]t=([A-Za-z0-9_-]+)/.exec(window.location.hash)
      const t = m ? decodeTake(m[1]) : null
      if (t && PIECES.some((p) => p.id === t.piece) && screenRef.current === 'menu') {
        sharedRef.current = t
        setShared(true)
      }
    }
    read()
    lastTakeRef.current ??= loadTake()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])

  // integer-scale the canvas so no pixel is ever a fraction
  useEffect(() => {
    const fit = () => {
      const c = canvasRef.current
      if (!c) return
      // Whole-number scaling keeps every pixel square, and on a desktop there
      // is always room for it. On a phone the honest integer answer was 1,
      // which put a 320-wide canvas on a 390-wide screen — so below that we
      // take a fractional scale instead. The canvas is nearest-neighboured by
      // CSS either way; uneven pixels beat a postage stamp.
      const narrow = window.innerWidth < 760
      const raw = Math.min(
        (window.innerWidth - (narrow ? 16 : 90)) / W,
        (window.innerHeight - (narrow ? 230 : 190)) / H,
      )
      const s = raw >= 2 ? Math.floor(raw) : Math.max(1, +raw.toFixed(3))
      c.style.width = `${W * s}px`
      c.style.height = `${H * s}px`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // ------------------------------------------------------------- one strike
  // Strikes are handled the instant the camera hands us a frame, not on the
  // next render tick. That is up to a whole frame of latency saved, and this
  // is the one place in the app where a frame is worth saving.
  const takeStrike = useCallback((now: number, strength: number, side: Side) => {
    const con = conRef.current
    if (!con || screenRef.current !== 'play' || con.finished) return
    // Coming in early is not a mistake, it is you taking the piece over.
    countRef.current = null
    if (autoRef.current) {
      autoRef.current = false
      setAuto(false)
      renRef.current?.reveal('YOU HAVE IT')
    }
    const kind = con.strike(now, strength, side)
    if (kind === 'ornament') teach('ornament', 'ORNAMENT')
    if (kind === 'chord') teach('chord', 'BOTH HANDS = CHORD')
    if (!replayRef.current) takeRecRef.current.stroke(now, side, strength)
    sawFirstRef.current = true
  }, [])

  const stopPreview = useCallback(() => {
    if (!previewRef.current) return
    previewRef.current = null
    setListening(false)
    pianoRef.current?.allOff(0.3)
    pianoRef.current?.setPedal(0)
  }, [])

  /**
   * Hear a piece before committing to it. Four titles and a joke told you
   * nothing about what you were signing up for, or how fast to wave.
   */
  const listen = useCallback(async () => {
    if (previewRef.current) { stopPreview(); return }
    const piano = pianoRef.current ?? new Piano()
    pianoRef.current = piano
    if (!piano.ready) {
      statusRef.current = 'fetching the piano...'
      setListening(true)
      await piano.init((v) => { doneRef.current = v })
    }
    piano.resume()
    exposeForProbe({ piano })
    if (screenRef.current !== 'menu') { setListening(false); return }
    const p = PIECES[selRef.current]
    const con = new Conductor(p, piano)
    con.loop = true
    previewRef.current = { con, acc: 0, side: 'R' }
    setListening(true)
  }, [stopPreview])

  /** Get the camera and the hand model going without anybody waiting on it. */
  const openEyes = useCallback(async () => {
    const cam = camRef.current ?? new Camera()
    camRef.current = cam
    const per = perRef.current
    per.sensitivity = sens

    if (!cam.stream) {
      try {
        await cam.start()
        warn(null)
        cam.onLost = () => { warn('CAMERA LOST - USE SPACE') }
        cam.onSample = (s) => {
          const f = per.ingest(s, cam.pixels, cam.mask)
          frameRef.current = f
          recRef.current.push({ ...s })
          if (screenRef.current !== 'play' || replayRef.current) return
          for (const st of f.strokes) {
            const at = performance.now() / 1000
            probeRef.current.add(at - s.capturedAt)   // shutter to sound
            takeStrike(at, st.strength, st.side)
          }
        }
      } catch (e) {
        warn((e as Error)?.name === 'NotAllowedError'
          ? 'CAMERA DECLINED - USE SPACE' : 'NO CAMERA - USE SPACE')
        return
      }
    }

    exposeForProbe({ cam, probe: probeRef.current })
    await cam.loadHands()
    if (cam.modelNote) warn(cam.modelNote)
    else if (screenRef.current === 'play') renRef.current?.reveal('HANDS READY - WAVE TO TAKE OVER')
  }, [sens, takeStrike])

  const begin = useCallback(async (p: Piece, watchThis?: Take) => {
    if (screenRef.current !== 'menu') return
    setPiece(p)
    pieceRef.current = p
    doneRef.current = 0
    statusRef.current = 'warming up the piano...'
    setScreen('loading')

    // The piano is two megabytes and it is the only thing standing between a
    // click and a sound. Everything else — the camera, nineteen megabytes of
    // hand model — happens behind a piece that is already playing.
    const piano = pianoRef.current ?? new Piano()
    pianoRef.current = piano
    await piano.init((v) => { doneRef.current = v })
    piano.resume()
    exposeForProbe({ piano })

    const now = performance.now() / 1000
    const con = new Conductor(p, piano)
    conRef.current = con
    exposeForProbe({ con })
    setStride(con.wave)      // gestures per wave, not the span of one
    takeRef.current = 1; setTake(1)
    sawFirstRef.current = false
    autoAccRef.current = 0
    clappedRef.current = false
    overAtRef.current = 0
    seenRef.current.clear()
    duetRef.current = { frames: 0, both: 0 }
    countRef.current = null
    replayRef.current = null
    probeRef.current.clear()

    if (watchThis) {
      sharedRef.current = null
      setShared(false)
      replayRef.current = new TakePlayer(watchThis)
      autoRef.current = false
      setAuto(false)
      setScreen('play')
      return
    }

    // The cat starts without you so that something is playing while the rest
    // loads. Your first stroke takes it off them.
    takeRecRef.current.start(p.id, now)
    autoRef.current = true
    setAuto(true)
    setScreen('play')
    void openEyes()
  }, [openEyes])

  const quit = useCallback(() => {
    pianoRef.current?.allOff(0.3)
    pianoRef.current?.setPedal(0)
    setAuto(false)
    setScreen('menu')
  }, [])

  const restart = useCallback(() => {
    const con = conRef.current
    pianoRef.current?.allOff(0.2)
    con?.reset()
    sawFirstRef.current = false
    clappedRef.current = false
    overAtRef.current = 0
    countRef.current = con ? { left: con.piece.pulsesPerBar, at: performance.now() / 1000 + 0.5 } : null
    takeRef.current = 1
    setTake(1)
  }, [])

  const watch = useCallback((t: Take) => {
    const piece = PIECES.find((x) => x.id === t.piece)
    const piano = pianoRef.current
    if (!piece || !piano?.ready) return
    piano.allOff(0.2)
    setPiece(piece)
    pieceRef.current = piece
    const con = new Conductor(piece, piano)
    conRef.current = con
    replayRef.current = new TakePlayer(t)
    sawFirstRef.current = false
    clappedRef.current = false
    overAtRef.current = 0
    countRef.current = null
    setScreen('play')
  }, [])

  const share = useCallback(() => {
    const t = lastTakeRef.current
    if (!t) return
    const url = `${window.location.origin}${window.location.pathname}#t=${encodeTake(t)}`
    navigator.clipboard?.writeText(url).catch(() => {})
    window.history.replaceState(null, '', `#t=${encodeTake(t)}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2200)
  }, [])

  /** Round again, at the pace you already found. */
  const encore = useCallback(() => {
    const con = conRef.current
    if (!con) return
    pianoRef.current?.allOff(0.25)
    con.encore()
    sawFirstRef.current = false
    clappedRef.current = false
    overAtRef.current = 0
    countRef.current = { left: con.piece.pulsesPerBar, at: performance.now() / 1000 + 0.5 }
    takeRef.current += 1
    setTake((v) => v + 1)
    setScreen('play')
  }, [])

  // ------------------------------------------------------- one loop, all screens
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ren = new Renderer(canvas)
    renRef.current = ren
    let last = performance.now() / 1000
    let t = 0
    let raf = 0
    let running = true

    const tick = () => {
      if (!running) return
      const now = performance.now() / 1000
      const dt = Math.min(0.05, now - last)
      last = now
      t += dt

      const scr = screenRef.current
      if (scr === 'menu') {
        // the cat playing to itself while you decide
        const pv = previewRef.current
        if (pv) {
          pv.acc += dt
          while (pv.acc >= pv.con.period) {
            pv.acc -= pv.con.period
            pv.side = pv.side === 'L' ? 'R' : 'L'
            pv.con.strike(now, 0.6, pv.side)
          }
          pv.con.update(dt, now, PREVIEW_EX)
          pv.con.drain()
        }
        drawMenu(ren.px, {
          pieces: PIECES, sel: selRef.current, t,
          camWarn: sharedRef.current
            ? 'SOMEONE SENT YOU A TAKE - ENTER TO WATCH'
            : previewRef.current
              ? 'LISTENING   P STOP   ENTER TO PLAY IT'
              : warnRef.current?.text ?? null,
        })
      } else if (scr === 'loading') {
        drawLoading(ren.px, { t, status: statusRef.current, done: doneRef.current })
            } else if (scr === 'verdict') {
        const con = conRef.current!
        const d = duetRef.current
        drawVerdict(ren.px, {
          t, piece: con.piece, report: con.report, take: takeRef.current,
          duet: d.frames > 0 && d.both / d.frames > 0.4,
        })
      } else {
        const con = conRef.current!
        const f = frameRef.current

        // --- count-in: somebody has to give you the tempo before asking you
        // to keep it. Any stroke of your own cancels it.
        const count = countRef.current
        if (count && !autoRef.current) {
          if (now >= count.at) {
            pianoRef.current?.tick(count.left === con.piece.pulsesPerBar)
            count.left -= 1
            count.at = now + con.period
            if (count.left <= 0) countRef.current = null
          }
        } else if (count) {
          countRef.current = null
        }

        // --- a recorded performance, played back through the same follower
        const rp = replayRef.current
        let shape: { dyn: number; height: number; spread: number } | undefined
        if (rp) {
          countRef.current = null
          const step = rp.advance(dt)
          shape = step.shape
          for (const st of step.strokes) {
            con.strike(now, st.strength, st.side)
            sawFirstRef.current = true
          }
        }

        if (autoRef.current) {
          autoAccRef.current += dt
          while (autoAccRef.current >= con.period) {
            autoAccRef.current -= con.period
            keySideRef.current = keySideRef.current === 'L' ? 'R' : 'L'
            con.strike(now, 0.62, keySideRef.current)
            sawFirstRef.current = true
          }
        }

        const tracked = f.tracked && !autoRef.current && !rp
        const ex: Expression = {
          dyn: shape ? shape.dyn : autoRef.current ? 0.55 : f.dyn,
          wild: Math.min(1, f.wild * 0.6 + con.unsteadiness * 0.45),
          // No hands to read? The pedal follows how hard you are playing, so
          // the instrument still breathes on the keyboard-only path.
          height: shape ? shape.height : autoRef.current ? 0.5 : tracked ? f.height : 0.42 + f.dyn * 0.34,
          spread: shape ? shape.spread : f.spread,
          travel: autoRef.current ? 0.2 : f.travel,
          present: { L: tracked && f.hands.L.present, R: tracked && f.hands.R.present },
          x: { L: f.hands.L.x, R: f.hands.R.x },
          twoHanded: tracked,
        }
        if (!replayRef.current) takeRecRef.current.sample(now, ex.dyn, ex.height, ex.spread)
        con.update(dt, now, ex)
        // Two hands this far apart are not one person's. The app noticing is
        // most of the joke, and the mechanics already supported it.
        const duet = tracked && f.hands.L.present && f.hands.R.present
          && f.hands.R.x - f.hands.L.x > 0.5
        duetRef.current.frames += 1
        if (duet) { duetRef.current.both += 1; teach('duet', 'A DUET - ONE HAND EACH') }
        if (con.pedal > 0.62) teach('pedal', 'DAMPERS UP - IT ALL RINGS')
        if (tracked && (con.engage.L < 0.1 || con.engage.R < 0.1)) teach('rest', 'THAT HAND IS RESTING')
        for (const n of con.drain()) ren.noteFired(n.p, n.vel, con.piece.accent, n.kind === 'ornament')

        // --- the ending. Let the last chord ring on its own before the room
        // does anything, then hand over to the verdict.
        if (con.finished) {
          if (!overAtRef.current) {
            overAtRef.current = now
            // A replay is somebody else's performance; it does not overwrite yours.
            if (!replayRef.current) {
              const t = takeRecRef.current.finish(now, con.report)
              if (t) { lastTakeRef.current = t; saveTake(t) }
            }
          }
          const since = now - overAtRef.current
          if (since > 0.35 && !clappedRef.current) {
            clappedRef.current = true
            pianoRef.current?.finale(con.piece.resonance)
          }
          if (since > RING_OUT && screenRef.current !== 'verdict') {
            verdictAtRef.current = now
            setScreen('verdict')
          }
        }

        const asleep = (sawFirstRef.current && con.idleFor > 2.4) || (!sawFirstRef.current && f.dyn < 0.06)
        const u = con.unsteadiness
        let mood: CatMood = 'calm'
        if (asleep) mood = 'sleep'
        else if (ex.dyn > 0.78 || u > 0.65) mood = 'wild'
        else if (u < 0.22 && ex.dyn > 0.12) mood = 'happy'

        let vibe = 'CHAOS'
        if (asleep) vibe = 'ZZZ'
        else if (u < 0.12) vibe = 'MAESTRO'
        else if (u < 0.25) vibe = 'TASTEFUL'
        else if (u < 0.45) vibe = 'SPIRITED'
        else if (u < 0.68) vibe = 'RUBATO?'

        let hint = ''
        const cam = camRef.current
        if (!autoRef.current) {
          const w = liveWarn(now)
          if (w) hint = w
          else if (cam?.mode === 'hands' && !f.tracked) hint = 'SHOW ME YOUR HANDS'
          else if (!sawFirstRef.current) hint = 'PLAY A KEY IN THE AIR'
          else if (asleep) hint = 'the cat is waiting'
        }

        ren.draw(con, f, dt, mood, {
          auto: autoRef.current,
          vibe: rp ? 'REPLAY' : duet ? 'DUET' : vibe,
          hint: con.finished ? '' : hint,
          countIn: countRef.current?.left ?? null,
          over: con.finished,
          debug: debugRef.current
            ? {
              fps: cam?.fps ?? 0,
              p50: probeRef.current.p50,
              p95: probeRef.current.p95,
              mode: cam?.stream ? cam.mode.toUpperCase() : 'NO CAM',
              out: (pianoRef.current?.latency ?? 0) * 1000,
            }
            : null,
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(raf) }
  }, [])

  // ------------------------------------------------------------------- input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const k = e.key.toLowerCase()
      if (screenRef.current === 'menu') {
        if (k === 'arrowdown' || k === 'arrowright') {
          e.preventDefault(); sharedRef.current = null; setShared(false); stopPreview()
          selRef.current = (selRef.current + 1) % PIECES.length
        } else if (k === 'arrowup' || k === 'arrowleft') {
          e.preventDefault(); sharedRef.current = null; setShared(false); stopPreview()
          selRef.current = (selRef.current + PIECES.length - 1) % PIECES.length
        } else if (k === 'p') {
          e.preventDefault(); void listen()
        } else if (k === 'enter' || k === ' ') {
          e.preventDefault()
          stopPreview()
          const t = sharedRef.current
          // A link to a take is a link to that take, not to the menu.
          begin(t ? PIECES.find((x) => x.id === t.piece)! : PIECES[selRef.current], t ?? undefined)
        }
        return
      }
      if (screenRef.current === 'verdict') {
        // Somebody who is still tapping when the piece ends would encore
        // straight past their own verdict without ever seeing it.
        if (performance.now() / 1000 - verdictAtRef.current < VERDICT_GRACE) return
        // Deliberately not SPACE. Space is the key you have been hammering for
        // the last two minutes, and binding it here means the last twitch of
        // your performance dismisses the verdict on that performance.
        if (k === 'enter') { e.preventDefault(); encore() }
        else if (k === 'w' && lastTakeRef.current) watch(lastTakeRef.current)
        else if (k === 's') share()
        else if (k === 'escape') quit()
        return
      }
      if (screenRef.current !== 'play') return
      if (k === ' ') {
        e.preventDefault()
        keySideRef.current = keySideRef.current === 'L' ? 'R' : 'L'
        takeStrike(performance.now() / 1000, 0.55 + Math.random() * 0.3, keySideRef.current)
      } else if (k === 'z' || k === 'x') {
        // one key per hand, so the keyboard can play chords too
        e.preventDefault()
        takeStrike(performance.now() / 1000, 0.6 + Math.random() * 0.3, k === 'z' ? 'L' : 'R')
      } else if (k === 'r') restart()
      else if (k === 'a') setAuto((v) => !v)
      else if (k === 'escape') quit()
      else if (k === 'd') debugRef.current = !debugRef.current
      else if (k === 'c' && debugRef.current) recRef.current.download()
      else if (k === '[') setSens((s) => Math.max(0.4, +(s - 0.1).toFixed(2)))
      else if (k === ']') setSens((s) => Math.min(2.5, +(s + 0.1).toFixed(2)))
      else if (k === '-') setStride((v) => Math.max(1, v - 1))
      else if (k === '=' || k === '+') setStride((v) => Math.min(4, v + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [begin, quit, restart, encore, takeStrike, watch, share, listen, stopPreview])

  // A backgrounded tab gets no video frames, so the follower would wake up to
  // a several-second gap and lurch. Put the instrument down instead.
  useEffect(() => {
    const onVis = () => {
      const piano = pianoRef.current
      if (!piano?.ready) return
      if (document.hidden) {
        piano.silenceForHiddenTab()
      } else {
        piano.resume()
        // Put the beat back under the playhead rather than starting over —
        // alt-tabbing is not a mistake and should not cost you your take.
        conRef.current?.reanchor(performance.now() / 1000)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const canvasPoint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (screenRef.current !== 'menu') return
    const { x, y } = canvasPoint(e)
    const i = menuRowAt(x, y, PIECES.length, selRef.current)
    if (i >= 0 && i !== selRef.current) { selRef.current = i; stopPreview() }
  }
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (screenRef.current === 'menu') {
      const { x, y } = canvasPoint(e)
      const i = menuRowAt(x, y, PIECES.length, selRef.current)
      stopPreview()
      begin(PIECES[i >= 0 ? i : selRef.current])
    } else if (screenRef.current === 'verdict') {
      if (performance.now() / 1000 - verdictAtRef.current >= VERDICT_GRACE) encore()
    } else if (screenRef.current === 'play') {
      const { x } = canvasPoint(e)
      takeStrike(performance.now() / 1000, 0.7, x < W / 2 ? 'L' : 'R')
    }
  }

  useEffect(() => () => { camRef.current?.stop() }, [])

  // --------------------------------------------------------------------- ui
  return (
    <main className={`${pixel.variable} room`}>
      <div className="console">
        <div className="brand">
          <span className={`led ${screen === 'play' ? 'on' : ''}`} />
          <span>PIANO CAT</span>
          <span className="model">MODEL C&#8209;4</span>
        </div>

        <div className="screen">
          <canvas
            ref={canvasRef}
            className={`stage ${screen === 'menu' ? 'pick' : ''}`}
            onMouseMove={onMove}
            onClick={onClick}
          />
          <div className="scan" />
        </div>

        <div className="deck">
          {screen === 'verdict' ? (
            <>
              <button className="btn" onClick={quit}>&#9664; PIECES</button>
              <button className="btn on" onClick={encore}>ENCORE &#9654;</button>
              <button className="btn" onClick={() => lastTakeRef.current && watch(lastTakeRef.current)}>WATCH</button>
              <button className="btn" onClick={share}>{copied ? 'LINK COPIED' : 'SHARE'}</button>
              <span className="tag">A TAKE IS A FEW HUNDRED NUMBERS &mdash; NO VIDEO LEAVES THIS PAGE</span>
            </>
          ) : screen === 'play' ? (
            <>
              <button className="btn" onClick={quit}>&#9664; PIECES</button>
              <button className="btn" onClick={restart}>RESTART</button>
              <button className={`btn ${auto ? 'on' : ''}`} aria-pressed={auto} onClick={() => setAuto((v) => !v)}>AUTO</button>
              <span className="knob">
                <b>WAVE</b>
                <button className="mini" onClick={() => setStride((v) => Math.max(1, v - 1))}>&minus;</button>
                <i>{stride}</i>
                <button className="mini" onClick={() => setStride((v) => Math.min(4, v + 1))}>+</button>
                <b>BEAT{stride > 1 ? 'S' : ''}</b>
              </span>
              <span className="knob">
                <b>SENS</b>
                <input type="range" min={0.4} max={2.5} step={0.05} value={sens}
                  onChange={(e) => setSens(parseFloat(e.target.value))} />
                <i>{sens.toFixed(2)}</i>
              </span>
              <span className="knob"><b>TAKE</b><i>{take}</i></span>
            </>
          ) : (
            <>
              {screen === 'menu' && (
                <button className={`btn ${listening ? 'on' : ''}`} onClick={() => void listen()}>
                  {listening ? 'STOP' : 'LISTEN'}
                </button>
              )}
              <span className="tag">
                {screen === 'loading' ? 'LOADING A REAL GRAND PIANO' : 'PICK A MASTERPIECE'}
              </span>
            </>
          )}
        </div>

        <div className="grille" aria-hidden />
      </div>

      <p className="note">
        {screen === 'play' && piece
          ? `${piece.composer} — ${piece.title}. Drop a hand to play a beat — each hand plays its own staff, and both together make a chord. Rest a hand and that staff falls back; take it out of frame and it stops. Lift both hands and the dampers come off, so everything rings. Extra taps between the beats come out as ornaments: nothing you do is ever silent. It ends on its last chord — play it all the way through. SPACE / Z / X = keystroke, A = auto, R = restart, D = meters, ESC = back.`
          : shared
            ? 'Somebody sent you a performance. Press ENTER to watch it play back — a take is a few hundred numbers describing what their hands did, and nothing else.'
            : 'Your hands are the hammers and the pedal. Every stroke plays the next beat, so the music follows your pace — speed up, drag your heels, stop dead. Play a piece to its final chord and the cat will tell you what it thought. The scores are complete, and come from published digital editions credited in lib/scores/SOURCES.md.'}
      </p>
    </main>
  )
}

/**
 * Hand the instrument to tools/audio-probe.mjs, and only ever to that. A
 * claim about how a fortissimo differs from a pianissimo should be measured
 * rather than asserted, and measuring it means reaching the real graph — but
 * a permanent handle on the audio engine is not something a page should carry
 * around, so it appears only when explicitly asked for by query string.
 */
function exposeForProbe(bits: { piano?: Piano; probe?: Probe; cam?: Camera; con?: Conductor }) {
  if (typeof window === 'undefined') return
  if (!new URLSearchParams(window.location.search).has('probe')) return
  const w = window as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(bits)) if (v) w[`__${k}`] = v
}

/** what the cat sounds like playing to itself: even, unhurried, no pedal */
const PREVIEW_EX: Expression = {
  dyn: 0.5, wild: 0.05, height: 0.35, spread: 0.5, travel: 0,
  present: { L: false, R: false }, x: { L: 0.3, R: 0.7 }, twoHanded: false,
}

const BLANK = new Uint8Array(GW * GH)
function idleFrame(): PlayFrame {
  return {
    t: 0,
    hands: { L: restingHand('L'), R: restingHand('R') },
    strokes: [],
    tracked: false,
    energy: 0, dyn: 0, wild: 0, height: 0.5, spread: 0.5, travel: 0,
    pixels: BLANK, motionMask: BLANK,
  }
}
