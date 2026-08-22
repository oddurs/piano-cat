'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Press_Start_2P } from 'next/font/google'
import { PIECES, type Piece } from '@/lib/pieces'
import { Piano } from '@/lib/audio'
import { MotionReader, type Frame } from '@/lib/motion'
import { Conductor, type Expression } from '@/lib/conductor'
import { Renderer, setFont, W, H, type CatMood } from '@/lib/render'
import { drawMenu, drawLoading, menuRowAt } from '@/lib/menu'

const pixel = Press_Start_2P({ weight: '400', subsets: ['latin'], variable: '--pixel' })

type Screen = 'menu' | 'loading' | 'play'
const IDLE_SILENCE = 0.045

export default function Page() {
  const [screen, setScreenState] = useState<Screen>('menu')
  const [piece, setPiece] = useState<Piece | null>(null)
  const [auto, setAuto] = useState(false)
  const [sens, setSens] = useState(1)
  const [stride, setStride] = useState(1)
  const [take, setTake] = useState(1)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pianoRef = useRef<Piano | null>(null)
  const motionRef = useRef<MotionReader | null>(null)
  const conRef = useRef<Conductor | null>(null)
  const renRef = useRef<Renderer | null>(null)

  const screenRef = useRef<Screen>('menu')
  const selRef = useRef(0)
  const statusRef = useRef('')
  const doneRef = useRef(0)
  const camWarnRef = useRef<string | null>(null)
  const takeRef = useRef(1)
  const autoRef = useRef(false)
  const sawFirstRef = useRef(false)
  const handRef = useRef<-1 | 1>(-1)
  const autoAccRef = useRef(0)

  const setScreen = (s: Screen) => { screenRef.current = s; setScreenState(s) }
  useEffect(() => { autoRef.current = auto }, [auto])
  useEffect(() => { if (motionRef.current) motionRef.current.sensitivity = sens }, [sens])
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

  const begin = useCallback(async (p: Piece) => {
    if (screenRef.current !== 'menu') return
    setPiece(p)
    doneRef.current = 0
    statusRef.current = 'warming up the piano...'
    setScreen('loading')

    const piano = pianoRef.current ?? new Piano()
    pianoRef.current = piano
    await piano.init((v) => { doneRef.current = v })
    piano.resume()

    statusRef.current = 'asking for the camera...'
    const motion = motionRef.current ?? new MotionReader()
    motionRef.current = motion
    motion.sensitivity = sens
    if (!motion.stream) {
      try { await motion.start(); camWarnRef.current = null }
      catch (e) {
        camWarnRef.current = (e as Error)?.name === 'NotAllowedError'
          ? 'CAMERA DECLINED - USE SPACE' : 'NO CAMERA - USE SPACE'
      }
    }

    const con = new Conductor(p, piano)
    conRef.current = con
    setStride(con.stride)
    takeRef.current = 1; setTake(1)
    sawFirstRef.current = false
    autoAccRef.current = 0
    setScreen('play')
  }, [sens])

  const quit = useCallback(() => {
    pianoRef.current?.allOff(0.3)
    setAuto(false)
    setScreen('menu')
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

      if (screenRef.current === 'menu') {
        drawMenu(ren.px, { pieces: PIECES, sel: selRef.current, t, camWarn: camWarnRef.current })
      } else if (screenRef.current === 'loading') {
        drawLoading(ren.px, { t, status: statusRef.current, done: doneRef.current })
      } else {
        const con = conRef.current!
        const motion = motionRef.current!
        const f: Frame = motion.stream ? motion.read(now, dt) : idleFrame(motion)

        if (autoRef.current) {
          autoAccRef.current += dt
          while (autoAccRef.current >= con.period) {
            autoAccRef.current -= con.period
            handRef.current = handRef.current === -1 ? 1 : -1
            if (con.strike(now, 0.62, handRef.current)) sawFirstRef.current = true
          }
        } else if (f.onset) {
          handRef.current = f.left > f.right ? -1 : 1
          if (con.strike(now, f.strength, handRef.current)) sawFirstRef.current = true
        }

        const tot = f.left + f.right + 1e-5
        const ex: Expression = {
          dyn: autoRef.current ? 0.55 : f.dyn,
          wild: Math.min(1, f.wild * 0.6 + con.unsteadiness * 0.45),
          bass: f.left / tot,
          treble: f.right / tot,
          height: autoRef.current ? 0.5 : f.height,
        }
        con.update(dt, now, ex)
        for (const n of con.lastFired) ren.noteFired(n.p, n.vel, con.piece.accent)
        if (con.loops + 1 !== takeRef.current) { takeRef.current = con.loops + 1; setTake(con.loops + 1) }

        const quiet = f.energy < IDLE_SILENCE && !autoRef.current
        const idle = (sawFirstRef.current && con.idleFor > 2.4) || (!sawFirstRef.current && quiet)
        const u = con.unsteadiness
        let mood: CatMood = 'calm'
        if (idle) mood = 'sleep'
        else if (ex.dyn > 0.78 || u > 0.65) mood = 'wild'
        else if (u < 0.22 && ex.dyn > 0.12) mood = 'happy'

        let vibe = 'CHAOS'
        if (idle) vibe = 'ZZZ'
        else if (u < 0.12) vibe = 'MAESTRO'
        else if (u < 0.25) vibe = 'TASTEFUL'
        else if (u < 0.45) vibe = 'SPIRITED'
        else if (u < 0.68) vibe = 'RUBATO?'

        let hint = ''
        if (!sawFirstRef.current) hint = autoRef.current ? '' : 'WAVE YOUR HANDS'
        else if (idle) hint = 'the cat is waiting'

        ren.draw(con, f, dt, mood, { auto: autoRef.current, vibe, hint })
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
      if (screenRef.current !== 'play') return
      const con = conRef.current!
      if (k === ' ') {
        e.preventDefault()
        handRef.current = handRef.current === -1 ? 1 : -1
        if (con.strike(performance.now() / 1000, 0.55 + Math.random() * 0.3, handRef.current)) sawFirstRef.current = true
      } else if (k === 'r') {
        pianoRef.current?.allOff(0.2); con.reset(); sawFirstRef.current = false; takeRef.current = 1; setTake(1)
      } else if (k === 'a') setAuto((v) => !v)
      else if (k === 'escape') quit()
      else if (k === '[') setSens((s) => Math.max(0.4, +(s - 0.1).toFixed(2)))
      else if (k === ']') setSens((s) => Math.min(2.5, +(s + 0.1).toFixed(2)))
      else if (k === '-') setStride((v) => Math.max(1, v - 1))
      else if (k === '=' || k === '+') setStride((v) => Math.min(4, v + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [begin, quit])

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
      handRef.current = handRef.current === -1 ? 1 : -1
      if (conRef.current!.strike(performance.now() / 1000, 0.7, handRef.current)) sawFirstRef.current = true
    }
  }

  useEffect(() => () => { motionRef.current?.stop() }, [])

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
              <button className="btn" onClick={() => { pianoRef.current?.allOff(0.2); conRef.current?.reset(); sawFirstRef.current = false; takeRef.current = 1; setTake(1) }}>RESTART</button>
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
              {screen === 'loading' ? 'LOADING A REAL GRAND PIANO (2 MB)' : 'PICK A MASTERPIECE — IT NEEDS YOUR CAMERA'}
            </span>
          )}
        </div>

        <div className="grille" aria-hidden />
      </div>

      <p className="note">
        {screen === 'play' && piece
          ? `${piece.composer} — ${piece.title}. Big gestures play forte, small ones piano. Lean left for the bass, right for the tune, hands high for a brighter tone. It loops forever. SPACE = keystroke, A = auto, R = restart, ESC = back.`
          : 'Every stroke of your hands plays the next beat, so the music follows your pace — speed up, drag your heels, stop dead. The cat has opinions.'}
      </p>
    </main>
  )
}

const BLANK = new Uint8Array(64 * 36)
function idleFrame(m: MotionReader): Frame {
  return {
    energy: 0, left: 0, right: 0, height: 0.5, down: 0.5,
    onset: false, strength: 0, dyn: 0.5, wild: 0,
    pixels: BLANK, motionMask: m.mask,
  }
}
