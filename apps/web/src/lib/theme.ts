import { useEffect, useState } from 'react'

export type ThemePreference = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'vehicles.theme'
export const THEME_PREFERENCES: ThemePreference[] = ['light', 'system', 'dark']

const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: '#121a16',
  light: '#1a2e24',
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch {}
  return 'system'
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark = prefersDark()
): ResolvedTheme {
  if (preference === 'dark') return 'dark'
  if (preference === 'light') return 'light'
  return systemDark ? 'dark' : 'light'
}

export function applyTheme(preference: ThemePreference = readThemePreference()) {
  const resolved = resolveTheme(preference)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved])
}

export function setThemePreference(preference: ThemePreference) {
  localStorage.setItem(THEME_STORAGE_KEY, preference)
  applyTheme(preference)
}

export function initTheme() {
  applyTheme(readThemePreference())
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  function sync() {
    applyTheme(readThemePreference())
  }
  media.addEventListener('change', sync)
  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY) sync()
  })
}

export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference)

  useEffect(() => {
    function sync() {
      setPreference(readThemePreference())
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', sync)
    window.addEventListener('storage', sync)
    return () => {
      media.removeEventListener('change', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  function update(next: ThemePreference) {
    setThemePreference(next)
    setPreference(next)
  }

  return [preference, update]
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
