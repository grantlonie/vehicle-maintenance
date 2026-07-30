import type { ReactNode } from 'react'
import type { ButtonProps } from './Button'
import { Button } from './Button'
import type { TooltipProps } from './Tooltip'
import { Tooltip } from './Tooltip'

export interface IconButtonProps
  extends Omit<ButtonProps, 'children' | 'leftIcon' | 'rightIcon'> {
  'aria-label': string
  icon: ReactNode
  tooltip?: Omit<TooltipProps, 'children'>
}

const ICON_SIZE_CLASS = {
  lg: '!h-11 !w-11 !px-0',
  md: '!h-9 !w-9 !px-0',
  sm: '!h-8 !w-8 !px-0',
} as const

export function IconButton({
  className = '',
  icon,
  size = 'md',
  tooltip,
  variant = 'text',
  ...rest
}: IconButtonProps) {
  const button = (
    <Button
      className={`${ICON_SIZE_CLASS[size]} ${className}`.trim()}
      size={size}
      variant={variant}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex items-center justify-center">
        {icon}
      </span>
    </Button>
  )

  if (!tooltip) return button

  return <Tooltip {...tooltip}>{button}</Tooltip>
}
