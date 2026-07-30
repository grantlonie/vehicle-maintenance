import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonColor = 'error' | 'primary' | 'warning'
export type ButtonSize = 'lg' | 'md' | 'sm'
export type ButtonVariant = 'filled' | 'outlined' | 'text'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  color?: ButtonColor
  leftIcon?: ReactNode
  loading?: boolean
  rightIcon?: ReactNode
  size?: ButtonSize
  variant?: ButtonVariant
}

interface ButtonClassNameOptions {
  className?: string
  color?: ButtonColor
  disabled?: boolean
  loading?: boolean
  size?: ButtonSize
  variant?: ButtonVariant
}

/** Fixed width for Done ↔ Save so the label swap does not shift layout. */
export const DONE_SAVE_WIDTH = 'w-20'

const SIZE_CLASS: Record<ButtonSize, string> = {
  lg: 'h-11 px-5 text-base',
  md: 'h-9 px-4 text-sm',
  sm: 'h-8 px-3 text-xs',
}

export function Button({
  children,
  className = '',
  color = 'primary',
  disabled = false,
  leftIcon,
  loading = false,
  rightIcon,
  size = 'md',
  type = 'button',
  variant = 'filled',
  ...rest
}: ButtonProps) {
  const inactive = disabled || loading

  return (
    <button
      className={buttonClassName({
        className,
        color,
        disabled: inactive,
        loading,
        size,
        variant,
      })}
      disabled={inactive}
      type={type}
      {...rest}
    >
      {loading ? <Spinner /> : leftIcon}
      {children}
      {!loading ? rightIcon : null}
    </button>
  )
}

export function buttonClassName({
  className = '',
  color = 'primary',
  disabled = false,
  loading = false,
  size = 'md',
  variant = 'filled',
}: ButtonClassNameOptions = {}): string {
  const interactive = !disabled && !loading
  const cursor = interactive ? 'cursor-pointer' : 'cursor-default'
  return [
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
    'box-border disabled:pointer-events-none disabled:opacity-60',
    SIZE_CLASS[size],
    cursor,
    toneClass(variant, color, interactive),
    className,
  ]
    .filter(Boolean)
    .join(' ')
}

function toneClass(variant: ButtonVariant, color: ButtonColor, interactive: boolean): string {
  if (variant === 'filled') {
    const border = 'border border-transparent'
    if (color === 'error') {
      return `${border} bg-overdue text-white ${interactive ? 'hover:bg-overdue/90' : ''}`
    }
    if (color === 'warning') {
      return `${border} bg-soon text-white ${interactive ? 'hover:bg-soon/90' : ''}`
    }
    return `${border} bg-accent text-white ${interactive ? 'hover:bg-accent-dark' : ''}`
  }

  if (variant === 'outlined') {
    if (color === 'error') {
      return `border border-overdue text-overdue ${interactive ? 'hover:bg-overdue/10' : ''}`
    }
    if (color === 'warning') {
      return `border border-soon text-soon ${interactive ? 'hover:bg-soon/10' : ''}`
    }
    return `border border-line bg-panel text-ink ${interactive ? 'hover:bg-bg-deep' : ''}`
  }

  const border = 'border border-transparent'
  if (color === 'error') {
    return `${border} text-overdue ${interactive ? 'hover:bg-overdue/10' : ''}`
  }
  if (color === 'warning') {
    return `${border} text-soon ${interactive ? 'hover:bg-soon/10' : ''}`
  }
  return `${border} text-ink ${interactive ? 'hover:bg-bg-deep' : ''}`
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-75"
        d="M4 12a8 8 0 018-8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="3"
      />
    </svg>
  )
}
