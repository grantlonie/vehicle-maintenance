/**
 * One-shot import of spreadsheet schedules + service log into local API.
 * Run: bun scripts/importSpreadsheet.ts
 */
import type { Season } from '@vehicles/shared'

const BASE = process.env.API_BASE || 'http://127.0.0.1:3002'
const TOKEN = process.env.APP_TOKEN || 'this-long-token-is-required'

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${TOKEN}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${await res.text()}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

interface ScheduleSpec {
  activePeriod: 'year_round' | 'seasonal'
  frequencyMode: 'interval' | 'once_per_season'
  intervalKm?: number | null
  intervalMonths?: number | null
  lastDone?: string | null
  lastOdometerKm?: number | null
  name: string
  notes?: string | null
  seasons?: Season[] | null
}

const SPRING_FALL: Season[] = ['spring', 'fall']

const schedules: ScheduleSpec[] = [
  {
    activePeriod: 'seasonal',
    frequencyMode: 'once_per_season',
    lastDone: '2026-05-07',
    lastOdometerKm: 8835,
    name: 'Rotate tires (cross back to front)',
    notes: 'Mapped from Spring & Fall; once per spring and once per fall window',
    seasons: SPRING_FALL,
  },
  {
    activePeriod: 'seasonal',
    frequencyMode: 'once_per_season',
    name: 'Clean & condition leather seats',
    seasons: SPRING_FALL,
  },
  {
    activePeriod: 'seasonal',
    frequencyMode: 'once_per_season',
    lastDone: '2026-07-23',
    lastOdometerKm: 14013,
    name: 'Full wash including undercarriage + ceramic spray wax',
    seasons: SPRING_FALL,
  },
  {
    activePeriod: 'seasonal',
    frequencyMode: 'once_per_season',
    name: 'Inspect/service brake calipers & sliders (salt corrosion check)',
    seasons: ['spring'],
  },
  {
    activePeriod: 'seasonal',
    frequencyMode: 'once_per_season',
    lastDone: '2025-03-01',
    lastOdometerKm: 0,
    name: 'Inspect wipers, fluids, cabin filter; hybrid battery air filter & intake',
    seasons: ['fall'],
  },
  {
    activePeriod: 'year_round',
    frequencyMode: 'interval',
    intervalKm: 16000,
    intervalMonths: 12,
    lastDone: '2025-03-01',
    lastOdometerKm: 0,
    name: 'Change oil',
    notes: 'Sheet: Fall + 10k mi (16k km); modeled as yearly or 16k km whichever first',
  },
  {
    activePeriod: 'seasonal',
    frequencyMode: 'interval',
    intervalMonths: 1,
    name: 'Wash & rinse including undercarriage (salt removal)',
    seasons: ['winter'],
  },
  {
    activePeriod: 'year_round',
    frequencyMode: 'interval',
    intervalMonths: 24,
    lastDone: '2025-03-01',
    lastOdometerKm: 0,
    name: 'Inspect brake lines/pads, check steering linkage',
  },
  {
    activePeriod: 'year_round',
    frequencyMode: 'interval',
    intervalKm: 32000,
    intervalMonths: 24,
    lastDone: '2025-03-01',
    lastOdometerKm: 0,
    name: 'Replace cabin air filter',
  },
  {
    activePeriod: 'year_round',
    frequencyMode: 'interval',
    intervalKm: 50000,
    intervalMonths: 36,
    lastDone: '2025-03-01',
    lastOdometerKm: 0,
    name: 'Replace engine air filter',
  },
  {
    activePeriod: 'year_round',
    frequencyMode: 'interval',
    intervalKm: 100000,
    intervalMonths: 72,
    lastDone: '2025-03-01',
    lastOdometerKm: 0,
    name: 'Inspect drive belts',
  },
  {
    activePeriod: 'year_round',
    frequencyMode: 'interval',
    intervalKm: 160000,
    intervalMonths: 120,
    lastDone: '2025-03-01',
    lastOdometerKm: 0,
    name: 'Replace spark plugs + coolant (engine and inverter)',
  },
  {
    activePeriod: 'year_round',
    frequencyMode: 'interval',
    intervalKm: 48000,
    intervalMonths: 36,
    name: 'Flush brake fluid',
  },
  {
    activePeriod: 'year_round',
    frequencyMode: 'interval',
    intervalKm: 100000,
    name: 'Replace transmission/transaxle fluid (eCVT)',
  },
]

interface LogSpec {
  kind: 'service' | 'repair'
  nameHint?: string
  notes?: string | null
  odometerKm: number
  performedOn: string
  scheduleName?: string
}

const logs: LogSpec[] = [
  {
    kind: 'service',
    notes: 'Winter tire install (odometer not recorded on sheet)',
    odometerKm: 0,
    performedOn: '2025-10-01',
    scheduleName: 'Rotate tires (cross back to front)',
  },
  {
    kind: 'service',
    notes: 'tires are rotated and placed on wall. top left corresponds driver side front',
    odometerKm: 8835,
    performedOn: '2026-05-07',
    scheduleName: 'Rotate tires (cross back to front)',
  },
  {
    kind: 'service',
    notes: 'Removed all tar and bugs and spotless with wax',
    odometerKm: 14013,
    performedOn: '2026-07-23',
    scheduleName: 'Full wash including undercarriage + ceramic spray wax',
  },
  {
    kind: 'service',
    notes: 'Spot-clean bugs, sap & tar (as-needed; no recurring schedule)',
    odometerKm: 14013,
    performedOn: '2026-07-23',
  },
]

async function main() {
  const existing = await api<{ vehicles: Array<{ id: string; name: string }> }>('/api/vehicles')
  for (const v of existing.vehicles) {
    await api(`/api/vehicles/${v.id}/archive`, { method: 'POST' })
    console.log('Archived previous vehicle', v.name)
  }

  const vehicle = await api<{ id: string }>('/api/vehicles', {
    body: JSON.stringify({
      displayUnit: 'km',
      make: 'Toyota',
      model: 'Sienna',
      name: 'Family Van',
      odometer: 14013,
      odometerUnit: 'km',
      vin: '5TDGRKEC3SS236919',
      year: 2025,
    }),
    method: 'POST',
  })
  console.log('Created vehicle', vehicle.id)

  const scheduleIds = new Map<string, string>()

  for (const spec of schedules) {
    const created = await api<{ id: string }>(`/api/vehicles/${vehicle.id}/schedules`, {
      body: JSON.stringify({
        activePeriod: spec.activePeriod,
        frequencyMode: spec.frequencyMode,
        intervalKm: spec.intervalKm ?? null,
        intervalMonths: spec.intervalMonths ?? null,
        name: spec.name,
        notes: spec.notes ?? null,
        seasons: spec.seasons ?? null,
      }),
      method: 'POST',
    })
    scheduleIds.set(spec.name, created.id)
    console.log('Schedule', spec.name)

    if (spec.lastDone) {
      // Skip if a dedicated log sheet entry will cover the same schedule+date
      const coveredByLog = logs.some(
        l => l.scheduleName === spec.name && l.performedOn === spec.lastDone
      )
      if (!coveredByLog) {
        await api(`/api/vehicles/${vehicle.id}/logs`, {
          body: JSON.stringify({
            kind: 'service',
            notes: 'Imported last-done from reminders sheet',
            odometer: spec.lastOdometerKm ?? 0,
            odometerUnit: 'km',
            performedBy: 'self',
            performedOn: spec.lastDone,
            scheduleId: created.id,
          }),
          method: 'POST',
        })
      }
    }
  }

  for (const log of logs) {
    const scheduleId = log.scheduleName ? scheduleIds.get(log.scheduleName) ?? null : null
    await api(`/api/vehicles/${vehicle.id}/logs`, {
      body: JSON.stringify({
        kind: log.kind,
        notes: log.notes ?? null,
        odometer: log.odometerKm,
        odometerUnit: 'km',
        performedBy: 'self',
        performedOn: log.performedOn,
        scheduleId,
      }),
      method: 'POST',
    })
    console.log('Log', log.performedOn, log.scheduleName || log.notes)
  }

  // Ensure current odometer is latest from sheet
  await api(`/api/vehicles/${vehicle.id}/odometer`, {
    body: JSON.stringify({ odometer: 14013, odometerUnit: 'km', recordedOn: '2026-07-23' }),
    method: 'POST',
  })

  const due = await api<{ items: Array<{ scheduleName: string; status: string }> }>(
    `/api/due?vehicleId=${vehicle.id}`
  )
  console.log('\nDue summary:')
  for (const item of due.items) {
    console.log(`  ${item.status.padEnd(10)} ${item.scheduleName}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
