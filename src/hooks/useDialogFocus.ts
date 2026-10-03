import { useEffect, type RefObject } from 'react'

let activeLocks = 0
let scrollPosition = 0
let originalStyles: { bodyPosition: string; bodyTop: string; bodyWidth: string; bodyOverflow: string; htmlOverflow: string } | null = null

function updateModalViewport() {
  const viewport = window.visualViewport
  document.documentElement.style.setProperty('--modal-viewport-top', `${viewport?.offsetTop ?? 0}px`)
  document.documentElement.style.setProperty('--modal-viewport-height', `${viewport?.height ?? window.innerHeight}px`)
}

function lockBackground() {
  if (activeLocks++ > 0) return
  scrollPosition = window.scrollY
  originalStyles = {
    bodyPosition: document.body.style.position, bodyTop: document.body.style.top,
    bodyWidth: document.body.style.width, bodyOverflow: document.body.style.overflow,
    htmlOverflow: document.documentElement.style.overflow,
  }
  document.body.style.position = 'fixed'
  document.body.style.top = `-${scrollPosition}px`
  document.body.style.width = '100%'
  document.body.style.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
  updateModalViewport()
  window.visualViewport?.addEventListener('resize', updateModalViewport)
  window.visualViewport?.addEventListener('scroll', updateModalViewport)
  window.addEventListener('resize', updateModalViewport)
}

function unlockBackground() {
  if (--activeLocks > 0 || !originalStyles) return
  document.body.style.position = originalStyles.bodyPosition
  document.body.style.top = originalStyles.bodyTop
  document.body.style.width = originalStyles.bodyWidth
  document.body.style.overflow = originalStyles.bodyOverflow
  document.documentElement.style.overflow = originalStyles.htmlOverflow
  originalStyles = null
  window.visualViewport?.removeEventListener('resize', updateModalViewport)
  window.visualViewport?.removeEventListener('scroll', updateModalViewport)
  window.removeEventListener('resize', updateModalViewport)
  document.documentElement.style.removeProperty('--modal-viewport-top')
  document.documentElement.style.removeProperty('--modal-viewport-height')
  window.scrollTo(0, scrollPosition)
}

export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    if (!node) return
    lockBackground()
    const selectors = 'button:not([disabled]),input:not([disabled]):not([aria-hidden="true"]),select:not([disabled]):not([aria-hidden="true"]),textarea:not([disabled]),a[href],[tabindex="0"]'
    const elements = () => [...node.querySelectorAll<HTMLElement>(selectors)].filter(item => item.getClientRects().length > 0)
    const first = elements()[0]
    ;(first ?? node).focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
      if (dialogs.at(-1) !== node) return
      if (event.key === 'Escape' && (event.target as HTMLElement)?.closest('[role="combobox"][aria-expanded="true"]')) return
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const all = elements(); const current = document.activeElement
      if (!all.length) { event.preventDefault(); node.focus(); return }
      if (event.shiftKey && (current === all[0] || !node.contains(current))) { event.preventDefault(); all.at(-1)?.focus() }
      else if (!event.shiftKey && (current === all.at(-1) || !node.contains(current))) { event.preventDefault(); all[0].focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); unlockBackground(); previous?.focus() }
  }, [open, ref, onClose])
}
