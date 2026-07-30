import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type TooltipPosition = 'bottom' | 'left' | 'right' | 'top'

export interface TooltipProps {
  children: ReactNode
  content: ReactNode
  delayMs?: number
  position?: TooltipPosition
}

interface TipCoords {
  left: number
  top: number
}

const OFFSET = 8

export function Tooltip({ children, content, delayMs = 400, position = 'top' }: TooltipProps) {
  const tipId = useId()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<TipCoords | null>(null)

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function show() {
    clearTimer()
    timerRef.current = window.setTimeout(() => setOpen(true), delayMs)
  }

  function hide() {
    clearTimer()
    setOpen(false)
  }

  useEffect(() => () => clearTimer(), [])

  useEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }

    function updatePosition() {
      const trigger = triggerRef.current
      const tip = tipRef.current
      if (!trigger || !tip) return
      const rect = trigger.getBoundingClientRect()
      const tipRect = tip.getBoundingClientRect()
      setCoords(placeTooltip(rect, tipRect, position))
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, position])

  return (
    <>
      <span
        aria-describedby={open ? tipId : undefined}
        className="inline-flex"
        onBlur={hide}
        onFocus={show}
        onPointerEnter={show}
        onPointerLeave={hide}
        ref={triggerRef}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[70] max-w-xs rounded-md bg-ink px-2 py-1 text-xs text-white shadow-md"
              id={tipId}
              ref={tipRef}
              role="tooltip"
              style={{
                left: coords?.left ?? -9999,
                top: coords?.top ?? -9999,
                visibility: coords ? 'visible' : 'hidden',
              }}
            >
              {content}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

function placeTooltip(
  trigger: DOMRect,
  tip: DOMRect,
  position: TooltipPosition
): TipCoords {
  const centerX = trigger.left + trigger.width / 2
  const centerY = trigger.top + trigger.height / 2

  if (position === 'bottom') {
    return {
      left: clamp(centerX - tip.width / 2, 8, window.innerWidth - tip.width - 8),
      top: trigger.bottom + OFFSET,
    }
  }
  if (position === 'left') {
    return {
      left: trigger.left - tip.width - OFFSET,
      top: clamp(centerY - tip.height / 2, 8, window.innerHeight - tip.height - 8),
    }
  }
  if (position === 'right') {
    return {
      left: trigger.right + OFFSET,
      top: clamp(centerY - tip.height / 2, 8, window.innerHeight - tip.height - 8),
    }
  }
  return {
    left: clamp(centerX - tip.width / 2, 8, window.innerWidth - tip.width - 8),
    top: trigger.top - tip.height - OFFSET,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
