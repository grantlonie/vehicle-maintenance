import { describe, expect, test } from 'bun:test'
import {
  defaultTrackOdometer,
  logInputSchema,
  trackedLogOdometer,
  vehicleCreateSchema,
  vehicleUpdateSchema,
} from './schemas'

const log = {
  kind: 'service' as const,
  odometer: 24512,
  odometerUnit: 'mi' as const,
  performedBy: 'self' as const,
  performedOn: '2026-07-30',
}

describe('defaultTrackOdometer', () => {
  test('is on for cars and motorhomes, off for trailers', () => {
    expect(defaultTrackOdometer('car')).toBe(true)
    expect(defaultTrackOdometer('motorhome')).toBe(true)
    expect(defaultTrackOdometer('towable')).toBe(false)
    expect(defaultTrackOdometer(undefined)).toBe(true)
  })
})

describe('trackedLogOdometer', () => {
  test('returns the reading when tracking is on', () => {
    expect(trackedLogOdometer(true, 12000)).toBe(12000)
    expect(trackedLogOdometer(true, 0)).toBe(0)
  })

  test('returns null when tracking is off or the reading is missing', () => {
    expect(trackedLogOdometer(false, 12000)).toBeNull()
    expect(trackedLogOdometer(false, null)).toBeNull()
    expect(trackedLogOdometer(true, undefined)).toBeNull()
  })
})

describe('logInputSchema', () => {
  test('accepts a log without an odometer', () => {
    const result = logInputSchema.safeParse({ ...log, odometer: null, odometerUnit: undefined })
    expect(result.success).toBe(true)
  })

  test('requires a unit when an odometer is set', () => {
    const result = logInputSchema.safeParse({ ...log, odometerUnit: undefined })
    expect(result.success).toBe(false)
  })
})

describe('vehicle schemas', () => {
  test('defaults a missing create odometer to 0', () => {
    const result = vehicleCreateSchema.safeParse({
      make: 'Forest River',
      model: 'R-Pod',
      name: 'Trailer',
      odometerUnit: 'mi',
      vehicleType: 'towable',
      year: 2018,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.odometer).toBe(0)
  })

  test('accepts trackOdometer on create and update', () => {
    expect(
      vehicleCreateSchema.safeParse({
        make: 'Forest River',
        model: 'R-Pod',
        name: 'Trailer',
        odometer: 0,
        odometerUnit: 'mi',
        trackOdometer: false,
        vehicleType: 'towable',
        year: 2018,
      }).success
    ).toBe(true)
    expect(vehicleUpdateSchema.safeParse({ trackOdometer: true }).success).toBe(true)
  })
})
