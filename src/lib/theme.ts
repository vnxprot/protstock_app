import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const storageKey = 'protstock-theme'
const eventName = 'protstock:theme-change'

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(storageKey)
    return value === 'light' || value === 'dark' ? value : null
  } catch { return null }
}

function preferredTheme(): Theme {
  return savedTheme() ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f7f5' : '#07110e')
  window.dispatchEvent(new Event(eventName))
}

export function initializeTheme() { applyTheme(preferredTheme()) }

export function setTheme(theme: Theme) {
  try { localStorage.setItem(storageKey, theme) } catch { /* Session-only preference when storage is unavailable. */ }
  applyTheme(theme)
}

function subscribe(listener: () => void) {
  const media = matchMedia('(prefers-color-scheme: light)')
  const syncStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) applyTheme(preferredTheme())
  }
  const syncSystem = () => { if (!savedTheme()) applyTheme(preferredTheme()) }
  window.addEventListener(eventName, listener)
  window.addEventListener('storage', syncStorage)
  media.addEventListener('change', syncSystem)
  return () => {
    window.removeEventListener(eventName, listener)
    window.removeEventListener('storage', syncStorage)
    media.removeEventListener('change', syncSystem)
  }
}

const snapshot = (): Theme => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
export function useTheme() { return useSyncExternalStore(subscribe, snapshot) }
