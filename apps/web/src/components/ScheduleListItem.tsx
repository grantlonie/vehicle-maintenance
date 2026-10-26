import type { DisplayUnit } from '@vehicles/shared'
import { distanceLabel, formatDate, statusClass, statusLabel } from '../lib/format'
import { describeSchedule } from '../lib/schedules'
import type { DueItem, Schedule } from '../lib/types'

interface ScheduleListItemProps {
  due?: DueItem
  onOpen: () => void
  schedule: Schedule
  unit: DisplayUnit
}

export function ScheduleListItem({ due, onOpen, schedule, unit }: ScheduleListItemProps) {
  return (
    <li className="first:pt-0 last:pb-0">
      <button
        className="-mx-4 w-[calc(100%+2rem)] cursor-pointer px-4 py-3 text-left hover:bg-bg-deep"
        onClick={onOpen}
        type="button"
      >
        <p className="font-medium">{schedule.name}</p>
        <p className="text-sm text-ink-muted">{describeSchedule(schedule, unit)}</p>
        {due ? (
          <p className={`mt-1 font-mono text-xs uppercase ${statusClass(due.status)}`}>
            {statusLabel(due.status)}
            {due.dueDate ? ` · ${formatDate(due.dueDate)}` : ''}
            {due.dueOdometerKm != null ? ` · ${distanceLabel(due.dueOdometerKm, unit)}` : ''}
          </p>
        ) : null}
      </button>
    </li>
  )
}
