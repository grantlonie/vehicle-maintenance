import type { ReactNode, RefObject } from 'react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  onClose: () => void
  open: boolean
  widthClassName?: string
}

interface Position {
  left: number
  top: number
}

export function Popover({
  anchorRef,
  children,
  onClose,
  open,
  widthClassName = 'w-64',
}: PopoverProps) {
  const [position, setPosition] = useState<Position | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    function updatePosition() {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const popoverWidth = 256
      const left = Math.min(
        Math.max(8, rect.left),
        window.innerWidth - popoverWidth - 8
      )
      setPosition({
        left,
        top: rect.bottom + 8,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, open])

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

  if (!open || !position) return null

  return createPortal(
    <div
      className={`fixed z-[60] rounded-lg border border-line bg-panel p-3 shadow-lg ${widthClassName}`}
      id="app-popover-root"
      style={{ left: position.left, top: position.top }}
    >
      {children}
    </div>,
    document.body
  )
}
