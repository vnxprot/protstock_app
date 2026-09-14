// Text inputs match :focus-visible even after a mouse click in Chromium.
// Track navigation modality so pointer users get quiet surfaces, keyboard users a focus ring.
export function initializeInputModality() {
  document.addEventListener('pointerdown', () => { document.documentElement.dataset.inputMode = 'pointer' })
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab' || event.key.startsWith('Arrow')) document.documentElement.dataset.inputMode = 'keyboard'
  })
}
