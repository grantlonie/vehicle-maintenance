import type { ReactNode } from 'react'
import { Button, type ButtonColor } from './Button'
import { Dialog } from './Dialog'

export interface AlertDialogProps {
  cancelLabel?: string
  children?: ReactNode
  confirmColor?: ButtonColor
  confirmLabel?: string
  onClose: () => void
  onConfirm: () => void
  open: boolean
  pending?: boolean
  title: string
}

export function AlertDialog({
  cancelLabel = 'Cancel',
  children,
  confirmColor = 'error',
  confirmLabel = 'Delete',
  onClose,
  onConfirm,
  open,
  pending = false,
  title,
}: AlertDialogProps) {
  return (
    <Dialog
      backdrop={{ clickaway: !pending }}
      footer={
        <div className="flex justify-end gap-2">
          <Button disabled={pending} onClick={onClose} variant="text">
            {cancelLabel}
          </Button>
          <Button color={confirmColor} loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
      onClose={pending ? () => undefined : onClose}
      open={open}
      placement="center"
      role="alertdialog"
      size="sm"
      title={title}
    >
      {children ?? null}
    </Dialog>
  )
}
