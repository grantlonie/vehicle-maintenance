import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './IconButton'

export type DialogPlacement = 'center' | 'top'
export type DialogSize = 'full' | 'lg' | 'md' | 'sm'

interface DialogBackdropOptions {
  /** Dismiss when the backdrop is clicked. Default true. */
  clickaway?: boolean
}

interface DialogProps {
  backdrop?: DialogBackdropOptions
  children: ReactNode
  footer?: ReactNode
  /** When true with `open`, defer mounting body content until first open. */
  lazyMount?: boolean
  onClose: () => void
  /** Controlled visibility. Default true when the component is mounted. */
  open?: boolean
  /** Vertical placement. Default `top`. */
  placement?: DialogPlacement
  size?: DialogSize
  title: string
}

/** Fraction of viewport height used as the top anchor for `placement="top"`. */
const TOP_OFFSET = '10vh'

const SIZE_CLASS: Record<DialogSize, string> = {
  full: 'max-w-[min(100%,72rem)]',
  lg: 'max-w-2xl',
  md: 'max-w-lg',
  sm: 'max-w-sm',
}

export function Dialog({
  backdrop,
  children,
  footer,
  lazyMount = false,
  onClose,
  open = true,
  placement = 'top',
  size = 'md',
  title,
}: DialogProps) {
  const clickaway = backdrop?.clickaway ?? true
  const [hasOpened, setHasOpened] = useState(open)

  useEffect(() => {
    if (open) setHasOpened(true)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, open])

  useEffect(() => {
    if (!open) return
    const { overflow, paddingRight } = document.body.style
    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarGap > 0) {
      document.body.style.paddingRight = `${scrollbarGap}px`
    }
    return () => {
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
    }
  }, [open])

  if (!open) return null

  const mountBody = !lazyMount || hasOpened || open
  const shellClass =
    placement === 'top' ? 'items-start justify-center' : 'items-center justify-center'

  const panelMaxHeight =
    placement === 'top'
      ? 'max-h-[calc(100vh-10vh-1.5rem)]'
      : 'max-h-[min(90vh,calc(100vh-2rem))]'

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex bg-ink/40 px-4 pb-4 ${shellClass}`}
      style={placement === 'top' ? { paddingTop: TOP_OFFSET } : undefined}
    >
      <button
        aria-label="Close dialog backdrop"
        className="absolute inset-0 cursor-default"
        onClick={clickaway ? onClose : undefined}
        type="button"
      />
      <div
        className={`relative z-10 flex w-full flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-lg ${SIZE_CLASS[size]} ${panelMaxHeight}`}
        role="dialog"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <IconButton
            aria-label="Close"
            icon={<CloseIcon />}
            onClick={onClose}
            size="sm"
            tooltip={{ content: 'Close' }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {mountBody ? children : null}
        </div>
        {footer && mountBody ? (
          <div className="shrink-0 border-t border-line px-4 py-3">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

function CloseIcon() {
  return (
    <svg
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}
