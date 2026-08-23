// The handful of things somebody sets once and should not have to set again.
//
// Deliberately small: what you were listening to, how hard you have to move,
// how much music a movement covers, how loud it is. Not your takes — those
// have their own store — and nothing that would be strange to find remembered.

export type Prefs = {
  piece: string
  sens: number
  wave: number
  volume: number
  /** whether the camera has been allowed here before, so we stop asking */
  camera: boolean
}

const KEY = 'piano-cat.prefs'
const DEFAULTS: Prefs = { piece: '', sens: 1, wave: 1, volume: 0.85, camera: false }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw)
    return {
      piece: typeof p.piece === 'string' ? p.piece : '',
      sens: Number.isFinite(p.sens) ? clamp(p.sens, 0.4, 2.5) : DEFAULTS.sens,
      wave: Number.isFinite(p.wave) ? clamp(Math.round(p.wave), 1, 4) : DEFAULTS.wave,
      volume: Number.isFinite(p.volume) ? clamp(p.volume, 0, 1) : DEFAULTS.volume,
      camera: p.camera === true,
    }
  } catch {
    return { ...DEFAULTS }          // a private window, or somebody's cleaner
  }
}

export function savePrefs(p: Partial<Prefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...p }))
  } catch { /* nothing here is worth an exception */ }
}
