/** Stop iOS Safari pinch-zoom. Viewport + `touch-action` cover other mobile browsers. */
export function preventAppZoom() {
  function onGesture(event: Event) {
    event.preventDefault()
  }

  function onTouchMove(event: TouchEvent) {
    if (event.touches.length > 1) event.preventDefault()
  }

  document.addEventListener('gesturestart', onGesture)
  document.addEventListener('gesturechange', onGesture)
  document.addEventListener('gestureend', onGesture)
  document.addEventListener('touchmove', onTouchMove, { passive: false })
}
