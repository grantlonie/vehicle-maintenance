import {
  evaluateScheduleDue,
  type ActivePeriod,
  type DueStatus,
  type FrequencyMode,
  type Season,
} from '@vehicles/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from './db/client'
import { serviceLogs, serviceSchedules, vehicles } from './db/schema'
import { parseActiveMonths } from './util'

export interface DueItem {
  dueDate: string | null
  dueOdometerKm: number | null
  scheduleId: string
  scheduleName: string
  seasonWindowStart: string | null
  status: DueStatus
  vehicleId: string
  vehicleName: string
}

export async function getDueSummary(vehicleId?: string): Promise<DueItem[]> {
  const scheduleRows = vehicleId
    ? await db
        .select()
        .from(serviceSchedules)
        .innerJoin(vehicles, eq(serviceSchedules.vehicleId, vehicles.id))
        .where(and(eq(serviceSchedules.vehicleId, vehicleId), isNull(vehicles.archivedAt)))
    : await db
        .select()
        .from(serviceSchedules)
        .innerJoin(vehicles, eq(serviceSchedules.vehicleId, vehicles.id))
        .where(isNull(vehicles.archivedAt))

  const today = new Date()
  const items: DueItem[] = []

  for (const row of scheduleRows) {
    const schedule = row.service_schedules
    const vehicle = row.vehicles

    const logs = await db
      .select()
      .from(serviceLogs)
      .where(
        and(
          eq(serviceLogs.scheduleId, schedule.id),
          eq(serviceLogs.kind, 'service'),
          eq(serviceLogs.vehicleId, vehicle.id)
        )
      )
      .orderBy(desc(serviceLogs.performedOn), desc(serviceLogs.createdAt))
      .limit(1)

    const last = logs[0] ?? null
    const result = evaluateScheduleDue({
      activeMonths: parseActiveMonths(schedule.activeMonthsJson),
      activePeriod: schedule.activePeriod as ActivePeriod,
      baselineDate: `${vehicle.year}-01-01`,
      baselineOdometerKm: 0,
      currentOdometerKm: vehicle.currentOdometerKm,
      frequencyMode: schedule.frequencyMode as FrequencyMode,
      intervalKm: schedule.intervalKm,
      intervalMonths: schedule.intervalMonths,
      lastService: last
        ? { odometerKm: last.odometerKm, performedOn: last.performedOn }
        : null,
      season: (schedule.season as Season | null) ?? null,
      today,
    })

    items.push({
      dueDate: result.dueDate,
      dueOdometerKm: result.dueOdometerKm,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      seasonWindowStart: result.seasonWindowStart,
      status: result.status,
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
    })
  }

  return items
}
