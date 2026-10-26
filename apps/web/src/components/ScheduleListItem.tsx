import type { DisplayUnit } from '@vehicles/shared'
import { distanceLabel, formatDate, statusClass, statusLabel } from '../lib/format'
import { describeSchedule } from '../lib/schedules'
import type { DueItem, Schedule } from '../lib/types'
import { IconButton } from './IconButton'
import { PencilIcon, PlusIcon } from './icons'

interface ScheduleListItemProps {
  clampNotes?: boolean
  due?: DueItem
  onEdit: () => void
  onLog: () => void
  schedule: Schedule
  unit: DisplayUnit
}

export function ScheduleListItem({
  clampNotes = false,
  due,
  onEdit,
  onLog,
  schedule,
  unit,
}: ScheduleListItemProps) {
  const overdue = due?.status === 'overdue'

  return (
    <li className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{schedule.name}</p>
        <p className="text-sm text-ink-muted">{describeSchedule(schedule, unit)}</p>
        {schedule.notes ? (
          <p className={`mt-1 text-sm text-ink-muted ${clampNotes ? 'line-clamp-2' : ''}`}>
            {schedule.notes}
          </p>
        ) : null}
        {due ? (
          <p className={`mt-1 font-mono text-xs uppercase ${statusClass(due.status)}`}>
            {statusLabel(due.status)}
            {due.dueDate ? ` · ${formatDate(due.dueDate)}` : ''}
            {due.dueOdometerKm != null ? ` · ${distanceLabel(due.dueOdometerKm, unit)}` : ''}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 self-stretch">
        <IconButton
          aria-label="Edit schedule"
          icon={<PencilIcon />}
          onClick={onEdit}
          size="sm"
          tooltip={{ content: 'Edit schedule' }}
        />
        {overdue ? (
          <IconButton
            aria-label="Log service"
            className="mt-auto"
            icon={<PlusIcon />}
            onClick={onLog}
            tooltip={{ content: 'Log service' }}
            variant="filled"
          />
        ) : null}
      </div>
    </li>
  )
}
