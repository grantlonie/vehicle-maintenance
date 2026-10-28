/** Block pinch, double-tap, ctrl-wheel, and keyboard zoom so the PWA stays at 1×. */
export function preventAppZoom() {
  function onWheel(event: WheelEvent) {
    if (event.ctrlKey) event.preventDefault()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey)) return
    if (
      event.key === '+' ||
      event.key === '-' ||
      event.key === '=' ||
      event.key === '_' ||
      event.key === '0'
    ) {
      event.preventDefault()
    }
  }

  function onGesture(event: Event) {
    event.preventDefault()
  }

  function onTouchMove(event: TouchEvent) {
    if (event.touches.length > 1) event.preventDefault()
  }

  document.addEventListener('wheel', onWheel, { passive: false })
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('gesturestart', onGesture)
  document.addEventListener('gesturechange', onGesture)
  document.addEventListener('gestureend', onGesture)
  document.addEventListener('touchmove', onTouchMove, { passive: false })
}
