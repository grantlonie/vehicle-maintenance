import { describe, expect, test } from 'bun:test'
import { importLogSchema, vehicleIntakeSchema } from './intake'

const log = {
  costEnteredCents: null,
  costEnteredCurrency: null,
  documentIndex: 0,
  kind: 'service' as const,
  notes: 'Oil change',
  odometer: 24512,
  odometerUnit: 'mi' as const,
  performedBy: 'shop' as const,
  performedOn: '2021-06-14',
  scheduleKey: 'suggested-1',
  shopName: 'Valvoline',
}

describe('intake schemas', () => {
  test('accepts a full intake payload', () => {
    const result = vehicleIntakeSchema.safeParse({
      copyFromVehicleId: null,
      logs: [log],
      schedules: [
        {
          key: 'suggested-1',
          schedule: {
            activePeriod: 'year_round',
            frequencyMode: 'interval',
            intervalKm: 16093.44,
            intervalMonths: 12,
            name: 'Change engine oil and filter',
          },
        },
      ],
      vehicle: {
        make: 'Toyota',
        model: 'RAV4',
        name: 'RAV4',
        odometer: 40000,
        odometerUnit: 'mi',
        year: 2021,
      },
    })
    expect(result.success).toBe(true)
  })

  test('rejects repairs linked to a schedule', () => {
    expect(importLogSchema.safeParse({ ...log, kind: 'repair' }).success).toBe(false)
  })

  test('rejects schedule drafts without an interval', () => {
    const result = vehicleIntakeSchema.safeParse({
      copyFromVehicleId: null,
      logs: [],
      schedules: [
        {
          key: 'a',
          schedule: { activePeriod: 'year_round', frequencyMode: 'interval', name: 'Nothing' },
        },
      ],
      vehicle: { make: 'a', model: 'b', name: 'c', odometer: 0, odometerUnit: 'km', year: 2020 },
    })
    expect(result.success).toBe(false)
  })
})
