export const GLASS_STORAGE_KEY = 'vs-glass-effects'
export const GLASS_EVENT = 'vs-glass-effects-change'

// Defaults to ON unless the user explicitly switched it off.
export function readGlassPref() {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(GLASS_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeGlassPref(enabled) {
  try {
    window.localStorage.setItem(GLASS_STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {}
  window.dispatchEvent(new CustomEvent(GLASS_EVENT, { detail: enabled }))
}
