import type { DisplayUnit, DueStatus } from '@vehicles/shared'
import { SEASON_ORDER } from '@vehicles/shared'
import { distanceLabel } from './format'
import type { DueItem, Schedule } from './types'

export const STATUS_RANK: Record<DueStatus, number> = {
  inactive: 4,
  never: 2,
  ok: 3,
  overdue: 0,
  soon: 1,
}

export function rankSchedules(
  schedules: Schedule[],
  dueBySchedule: Map<string, DueItem>
): Schedule[] {
  return [...schedules].sort((a, b) => {
    const aStatus = dueBySchedule.get(a.id)?.status ?? 'ok'
    const bStatus = dueBySchedule.get(b.id)?.status ?? 'ok'
    const rank = STATUS_RANK[aStatus] - STATUS_RANK[bStatus]
    if (rank !== 0) return rank
    return a.name.localeCompare(b.name)
  })
}

export function describeSchedule(schedule: Schedule, unit: DisplayUnit): string {
  const bits: string[] = []

  if (schedule.frequencyMode === 'once_per_season' && schedule.seasons?.length) {
    bits.push(
      `every ${SEASON_ORDER.filter(season => schedule.seasons!.includes(season)).join(', ')}`
    )
  } else if (schedule.activePeriod === 'seasonal' && schedule.seasons?.length) {
    bits.push(SEASON_ORDER.filter(season => schedule.seasons!.includes(season)).join(', '))
  }

  if (schedule.intervalMonths) {
    if (schedule.intervalMonths >= 12 && schedule.intervalMonths % 12 === 0) {
      const years = schedule.intervalMonths / 12
      bits.push(`every ${years} ${years === 1 ? 'yr' : 'yrs'}`)
    } else {
      bits.push(`every ${schedule.intervalMonths} mo`)
    }
  }
  if (schedule.intervalKm) {
    bits.push(`every ${distanceLabel(schedule.intervalKm, unit)}`)
  }
  return bits.join(' · ')
}
