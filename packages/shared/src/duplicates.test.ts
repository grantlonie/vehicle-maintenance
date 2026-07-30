import { describe, expect, test } from 'bun:test'
import { findPossibleDuplicateLogs, isPossibleDuplicateLog } from './duplicates'

describe('isPossibleDuplicateLog', () => {
  test('matches same date, kind, and near odometer', () => {
    expect(
      isPossibleDuplicateLog(
        { kind: 'repair', odometerKm: 14136, performedOn: '2026-07-30' },
        { kind: 'repair', odometerKm: 14136, performedOn: '2026-07-30' }
      )
    ).toBe(true)
    expect(
      isPossibleDuplicateLog(
        { kind: 'repair', odometerKm: 14136, performedOn: '2026-07-30' },
        { kind: 'repair', odometerKm: 14138, performedOn: '2026-07-30' }
      )
    ).toBe(true)
  })

  test('ignores different kind on the same day', () => {
    expect(
      isPossibleDuplicateLog(
        { kind: 'repair', odometerKm: 14136, performedOn: '2026-07-30' },
        { kind: 'service', odometerKm: 14138, performedOn: '2026-07-30' }
      )
    ).toBe(false)
  })

  test('ignores different date', () => {
    expect(
      isPossibleDuplicateLog(
        { kind: 'service', odometerKm: 14013, performedOn: '2026-07-24' },
        { kind: 'service', odometerKm: 14013, performedOn: '2026-07-23' }
      )
    ).toBe(false)
  })

  test('ignores odometer outside tolerance', () => {
    expect(
      isPossibleDuplicateLog(
        { kind: 'service', odometerKm: 14000, performedOn: '2026-07-30' },
        { kind: 'service', odometerKm: 14010, performedOn: '2026-07-30' }
      )
    ).toBe(false)
  })
})

describe('findPossibleDuplicateLogs', () => {
  test('returns matching rows', () => {
    const matches = findPossibleDuplicateLogs(
      { kind: 'repair', odometerKm: 14136, performedOn: '2026-07-30' },
      [
        { id: 'a', kind: 'repair', odometerKm: 14136, performedOn: '2026-07-30' },
        { id: 'b', kind: 'service', odometerKm: 14138, performedOn: '2026-07-30' },
        { id: 'c', kind: 'repair', odometerKm: 15000, performedOn: '2026-07-30' },
      ]
    )
    expect(matches.map(row => row.id)).toEqual(['a'])
  })
})
