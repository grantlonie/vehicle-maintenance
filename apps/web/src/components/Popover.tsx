import type { ReactNode, RefObject } from 'react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export type PopoverPosition = 'bottom' | 'left' | 'right' | 'top'

interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  /** When true, defer mounting content until first open. */
  lazyMount?: boolean
  onClose: () => void
  open: boolean
  /** Placement relative to the anchor. Default `bottom`. */
  position?: PopoverPosition
  widthClassName?: string
}

interface Coords {
  left: number
  top: number
  transform?: string
}

const OFFSET = 8

export function Popover({
  anchorRef,
  children,
  lazyMount = false,
  onClose,
  open,
  position = 'bottom',
  widthClassName = 'w-64',
}: PopoverProps) {
  const [coords, setCoords] = useState<Coords | null>(null)
  const [hasOpened, setHasOpened] = useState(open)

  useEffect(() => {
    if (open) setHasOpened(true)
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }

    function updatePosition() {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const popoverWidth = widthPx(widthClassName) ?? 256
      setCoords(placePopover(rect, popoverWidth, position))
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, open, position, widthClassName])

  useEffect(() => {
    if (!open) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node
      const anchor = anchorRef.current
      const popover = document.getElementById('app-popover-root')
      if (anchor?.contains(target) || popover?.contains(target)) return
      onClose()
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('touchstart', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('touchstart', onPointerDown)
    }
  }, [anchorRef, onClose, open])

  if (!open || !coords) return null

  const mountContent = !lazyMount || hasOpened || open

  return createPortal(
    <div
      className={`fixed z-[60] rounded-lg border border-line bg-panel p-3 shadow-lg ${widthClassName}`}
      id="app-popover-root"
      style={{
        left: coords.left,
        top: coords.top,
        transform: coords.transform,
      }}
    >
      {mountContent ? children : null}
    </div>,
    document.body
  )
}

function placePopover(
  rect: DOMRect,
  popoverWidth: number,
  position: PopoverPosition
): Coords {
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - popoverWidth - 8)

  if (position === 'top') {
    return {
      left,
      top: rect.top - OFFSET,
      transform: 'translateY(-100%)',
    }
  }
  if (position === 'left') {
    return {
      left: Math.max(8, rect.left - OFFSET),
      top: rect.top,
      transform: 'translateX(-100%)',
    }
  }
  if (position === 'right') {
    return {
      left: Math.min(rect.right + OFFSET, window.innerWidth - popoverWidth - 8),
      top: rect.top,
    }
  }
  return { left, top: rect.bottom + OFFSET }
}

function widthPx(widthClassName: string): number | null {
  const match = /^w-(\d+)$/.exec(widthClassName.trim())
  if (!match) return null
  return Number(match[1]) * 4
}
