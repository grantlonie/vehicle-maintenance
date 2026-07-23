import type { DueStatus } from '@vehicles/shared'
import { fromKm } from '@vehicles/shared'
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

export function describeSchedule(schedule: Schedule): string {
  const bits = [schedule.activePeriod.replace('_', ' ')]
  if (schedule.season) bits.push(schedule.season)
  if (schedule.frequencyMode === 'once_per_season') bits.push('once per season')
  if (schedule.intervalMonths) bits.push(`every ${schedule.intervalMonths} mo`)
  if (schedule.intervalKm) {
    bits.push(`every ${Math.round(fromKm(schedule.intervalKm, 'km'))} km`)
  }
  return bits.join(' · ')
}
