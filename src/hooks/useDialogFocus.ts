import { useEffect, type RefObject } from 'react'

export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    if (!node) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
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
    return () => { document.removeEventListener('keydown', keyboard); document.body.style.overflow = previousOverflow; previous?.focus() }
  }, [open, ref, onClose])
}
