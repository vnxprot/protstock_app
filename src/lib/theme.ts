import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const eventName = 'protstock:theme-change'

declare global {
  interface Window {
    // The synchronous head bootstrap also owns restore/visibility/system-theme events.
    protStockTheme: { read: () => Theme; apply: (theme: Theme) => void; set: (theme: Theme) => void }
  }
}

export function initializeTheme() { window.protStockTheme.apply(window.protStockTheme.read()) }
export function setTheme(theme: Theme) { window.protStockTheme.set(theme) }

function subscribe(listener: () => void) {
  window.addEventListener(eventName, listener)
  return () => window.removeEventListener(eventName, listener)
}

const snapshot = (): Theme => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
export function useTheme() { return useSyncExternalStore(subscribe, snapshot) }
