import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

// index.html sets the attribute from the same key before the first paint
const STORAGE_KEY = 'axispilot-theme'
const LIGHT = '(prefers-color-scheme: light)'

const listeners = new Set<() => void>()
const current = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
  listeners.forEach((l) => l())
}

function saved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // the system setting is followed until the user picks a theme
  const media = window.matchMedia(LIGHT)
  const onSystem = (e: MediaQueryListEvent) => {
    if (!saved()) apply(e.matches ? 'light' : 'dark')
  }
  media.addEventListener('change', onSystem)
  return () => {
    listeners.delete(listener)
    media.removeEventListener('change', onSystem)
  }
}

/** The screen's theme and the switch to the other one, which is remembered. */
export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, current)
  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // private window or blocked storage: the choice just isn't remembered
    }
    apply(next)
  }
  return [theme, toggle]
}
