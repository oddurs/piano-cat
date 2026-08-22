'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Press_Start_2P } from 'next/font/google'
import { PIECES, type Piece } from '@/lib/pieces'
import { Piano } from '@/lib/audio'
import { Camera, GW, GH } from '@/lib/camera'
import { Perception } from '@/lib/perception'
import { Probe, Recorder } from '@/lib/capture'
import { restingHand, type PlayFrame, type Side } from '@/lib/signal'
import { Conductor, type Expression } from '@/lib/conductor'
import { Renderer, setFont, W, H, type CatMood } from '@/lib/render'
import { drawMenu, drawLoading, drawCalibrate, menuRowAt } from '@/lib/menu'

const pixel = Press_Start_2P({ weight: '400', subsets: ['latin'], variable: '--pixel' })

type Screen = 'menu' | 'loading' | 'calibrate' | 'play'
/** long enough to reach up and down once, short enough not to be a chore */
const CALIBRATION = 3.4

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
  const calUntilRef = useRef(0)
  const takeRef = useRef(1)
  const autoRef = useRef(false)
  const sawFirstRef = useRef(false)
  const keySideRef = useRef<Side>('R')
  const autoAccRef = useRef(0)
  const debugRef = useRef(false)

  const setScreen = (s: Screen) => { screenRef.current = s; setScreenState(s) }
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

  // integer-scale the canvas so no pixel is ever a fraction
  useEffect(() => {
    const fit = () => {
      const c = canvasRef.current
      if (!c) return
      const s = Math.max(1, Math.floor(Math.min((window.innerWidth - 90) / W, (window.innerHeight - 190) / H)))
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
    if (!con || screenRef.current !== 'play') return
    con.strike(now, strength, side)
    sawFirstRef.current = true
  }, [])

  const begin = useCallback(async (p: Piece) => {
    if (screenRef.current !== 'menu') return
    setPiece(p)
    pieceRef.current = p
    doneRef.current = 0
    statusRef.current = 'warming up the piano...'
    setScreen('loading')

    const piano = pianoRef.current ?? new Piano()
    pianoRef.current = piano
    await piano.init((v) => { doneRef.current = v * 0.55 })
    piano.resume()

    statusRef.current = 'asking for the camera...'
    const cam = camRef.current ?? new Camera()
    camRef.current = cam
    let fresh = false
    if (!cam.stream) {
      try {
        await cam.start()
        warn(null)
        fresh = true
      } catch (e) {
        warn((e as Error)?.name === 'NotAllowedError'
          ? 'CAMERA DECLINED - USE SPACE' : 'NO CAMERA - USE SPACE')
      }
    }

    if (cam.stream) {
      statusRef.current = 'teaching the cat to see hands...'
      await cam.loadHands((v) => { doneRef.current = 0.55 + v * 0.45 })
      if (cam.modelNote) warn(cam.modelNote)
    }
    doneRef.current = 1

    const per = perRef.current
    per.sensitivity = sens
    per.reset()

    if (fresh) {
      cam.onSample = (s) => {
        const f = per.ingest(s, cam.pixels, cam.mask)
        frameRef.current = f
        recRef.current.push({ ...s })
        if (screenRef.current !== 'play' || autoRef.current) return
        for (const st of f.strokes) {
          const now = performance.now() / 1000
          probeRef.current.add(now - s.capturedAt)   // shutter to sound
          takeStrike(now, st.strength, st.side)
        }
      }
      cam.onLost = () => { warn('CAMERA LOST - USE SPACE') }
    }

    const con = new Conductor(p, piano)
    conRef.current = con
    setStride(con.stride)
    takeRef.current = 1; setTake(1)
    sawFirstRef.current = false
    autoAccRef.current = 0
    probeRef.current.clear()

    if (cam.stream && cam.mode === 'hands') {
      per.beginCalibration()
      calUntilRef.current = performance.now() / 1000 + CALIBRATION
      setScreen('calibrate')
    } else {
      setScreen('play')
    }
  }, [sens, takeStrike])

  const quit = useCallback(() => {
    pianoRef.current?.allOff(0.3)
    pianoRef.current?.setPedal(0)
    setAuto(false)
    setScreen('menu')
  }, [])

  const restart = useCallback(() => {
    pianoRef.current?.allOff(0.2)
    conRef.current?.reset()
    sawFirstRef.current = false
    takeRef.current = 1
    setTake(1)
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
        drawMenu(ren.px, { pieces: PIECES, sel: selRef.current, t, camWarn: warnRef.current?.text ?? null })
      } else if (scr === 'loading') {
        drawLoading(ren.px, { t, status: statusRef.current, done: doneRef.current })
      } else if (scr === 'calibrate') {
        const f = frameRef.current
        const hands = (['L', 'R'] as Side[]).filter((s) => f.hands[s].present).map((s) => f.hands[s])
        drawCalibrate(ren.px, {
          t,
          left: Math.max(0, (calUntilRef.current - now) / CALIBRATION),
          hands,
          accent: pieceRef.current.accent,
        })
        if (now >= calUntilRef.current) {
          perRef.current.endCalibration()
          setScreen('play')
        }
      } else {
        const con = conRef.current!
        const f = frameRef.current

        if (autoRef.current) {
          autoAccRef.current += dt
          while (autoAccRef.current >= con.period) {
            autoAccRef.current -= con.period
            keySideRef.current = keySideRef.current === 'L' ? 'R' : 'L'
            con.strike(now, 0.62, keySideRef.current)
            sawFirstRef.current = true
          }
        }

        const tracked = f.tracked && !autoRef.current
        const ex: Expression = {
          dyn: autoRef.current ? 0.55 : f.dyn,
          wild: Math.min(1, f.wild * 0.6 + con.unsteadiness * 0.45),
          // No hands to read? The pedal follows how hard you are playing, so
          // the instrument still breathes on the keyboard-only path.
          height: autoRef.current ? 0.5 : tracked ? f.height : 0.42 + f.dyn * 0.34,
          spread: f.spread,
          travel: autoRef.current ? 0.2 : f.travel,
          present: { L: tracked && f.hands.L.present, R: tracked && f.hands.R.present },
          x: { L: f.hands.L.x, R: f.hands.R.x },
          twoHanded: tracked,
        }
        con.update(dt, now, ex)
        for (const n of con.drain()) ren.noteFired(n.p, n.vel, con.piece.accent, n.kind === 'ornament')
        if (con.loops + 1 !== takeRef.current) { takeRef.current = con.loops + 1; setTake(con.loops + 1) }

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
          vibe,
          hint,
          debug: debugRef.current
            ? {
              fps: cam?.fps ?? 0,
              p50: probeRef.current.p50,
              p95: probeRef.current.p95,
              mode: cam?.stream ? cam.mode.toUpperCase() : 'NO CAM',
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
        if (k === 'arrowdown' || k === 'arrowright') { e.preventDefault(); selRef.current = (selRef.current + 1) % PIECES.length }
        else if (k === 'arrowup' || k === 'arrowleft') { e.preventDefault(); selRef.current = (selRef.current + PIECES.length - 1) % PIECES.length }
        else if (k === 'enter' || k === ' ') { e.preventDefault(); begin(PIECES[selRef.current]) }
        return
      }
      if (screenRef.current === 'calibrate' && (k === 'escape' || k === 'enter' || k === ' ')) {
        e.preventDefault()
        calUntilRef.current = 0
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
  }, [begin, quit, restart, takeStrike])

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
    const i = menuRowAt(x, y, PIECES.length)
    if (i >= 0) selRef.current = i
  }
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (screenRef.current === 'menu') {
      const { x, y } = canvasPoint(e)
      const i = menuRowAt(x, y, PIECES.length)
      begin(PIECES[i >= 0 ? i : selRef.current])
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
          {screen === 'play' ? (
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
            <span className="tag">
              {screen === 'loading' ? 'LOADING A REAL GRAND PIANO AND A PAIR OF EYES'
                : screen === 'calibrate' ? 'REACH UP HIGH, THEN DOWN LOW'
                  : 'PICK A MASTERPIECE — IT NEEDS YOUR CAMERA'}
            </span>
          )}
        </div>

        <div className="grille" aria-hidden />
      </div>

      <p className="note">
        {screen === 'play' && piece
          ? `${piece.composer} — ${piece.title}. Drop a hand to play a beat — each hand plays its own staff, and both together make a chord. Rest a hand and that staff falls back; take it out of frame and it stops. Lift both hands and the dampers come off, so everything rings. Extra taps between the beats come out as ornaments: nothing you do is ever silent. SPACE / Z / X = keystroke, A = auto, R = restart, D = meters, ESC = back.`
          : 'Your hands are the hammers and the pedal. Every stroke plays the next beat, so the music follows your pace — speed up, drag your heels, stop dead. The cat has opinions.'}
      </p>
    </main>
  )
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
