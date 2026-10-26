import type { DisplayUnit } from '@vehicles/shared'
import { distanceLabel, formatDate, statusClass, statusLabel } from '../lib/format'
import { describeSchedule } from '../lib/schedules'
import type { DueItem, Schedule } from '../lib/types'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { PencilIcon, PlusIcon, TrashIcon } from './icons'

interface SchedulePreviewDialogProps {
  due?: DueItem
  onClose: () => void
  onDelete: () => void
  onEdit: () => void
  onLog: () => void
  schedule: Schedule
  unit: DisplayUnit
}

export function SchedulePreviewDialog({
  due,
  onClose,
  onDelete,
  onEdit,
  onLog,
  schedule,
  unit,
}: SchedulePreviewDialogProps) {
  return (
    <Dialog
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button leftIcon={<PencilIcon />} onClick={onEdit} variant="outlined">
              Edit
            </Button>
            <Button color="error" leftIcon={<TrashIcon />} onClick={onDelete} variant="text">
              Delete
            </Button>
          </div>
          <Button leftIcon={<PlusIcon />} onClick={onLog}>
            Log
          </Button>
        </div>
      }
      onClose={onClose}
      title={schedule.name}
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">{describeSchedule(schedule, unit)}</p>
        {due ? (
          <p className={`font-mono text-xs uppercase ${statusClass(due.status)}`}>
            {statusLabel(due.status)}
            {due.dueDate ? ` · ${formatDate(due.dueDate)}` : ''}
            {due.dueOdometerKm != null ? ` · ${distanceLabel(due.dueOdometerKm, unit)}` : ''}
          </p>
        ) : null}
        {schedule.notes ? (
          <p className="whitespace-pre-wrap text-sm text-ink">{schedule.notes}</p>
        ) : null}
      </div>
    </Dialog>
  )
}
