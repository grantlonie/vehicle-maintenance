import { describe, expect, test } from 'bun:test'
import { evaluateScheduleDue, seasonWindowStart } from './due'
import { convertCadCentsToUsdCents, fromKm, toKm } from './units'

describe('units', () => {
  test('converts miles to km', () => {
    expect(toKm(10, 'mi')).toBeCloseTo(16.09344)
    expect(fromKm(16.09344, 'mi')).toBeCloseTo(10)
  })

  test('converts CAD cents to USD cents', () => {
    expect(convertCadCentsToUsdCents(10000, 0.73)).toBe(7300)
  })
})

describe('due engine', () => {
  test('marks schedule inactive outside season', () => {
    const result = evaluateScheduleDue({
      activeMonths: null,
      activePeriod: 'season',
      currentOdometerKm: 10000,
      frequencyMode: 'interval',
      intervalKm: null,
      intervalMonths: 1,
      lastService: null,
      season: 'winter',
      today: new Date(Date.UTC(2026, 6, 15)),
      warnDays: 7,
      warnKm: null,
    })
    expect(result.status).toBe('inactive')
  })

  test('odometer interval overdue', () => {
    const result = evaluateScheduleDue({
      activeMonths: null,
      activePeriod: 'year_round',
      currentOdometerKm: 21000,
      frequencyMode: 'interval',
      intervalKm: 10000,
      intervalMonths: null,
      lastService: { odometerKm: 10000, performedOn: '2025-01-01' },
      season: null,
      today: new Date(Date.UTC(2026, 0, 1)),
      warnDays: null,
      warnKm: 500,
    })
    expect(result.status).toBe('overdue')
    expect(result.dueOdometerKm).toBe(20000)
  })

  test('once per season overdue until completed', () => {
    const result = evaluateScheduleDue({
      activeMonths: null,
      activePeriod: 'season',
      currentOdometerKm: 1000,
      frequencyMode: 'once_per_season',
      intervalKm: null,
      intervalMonths: null,
      lastService: { odometerKm: 500, performedOn: '2025-04-01' },
      season: 'spring',
      today: new Date(Date.UTC(2026, 3, 10)),
      warnDays: null,
      warnKm: null,
    })
    expect(result.status).toBe('overdue')
    expect(result.seasonWindowStart).toBe('2026-03-01')
  })

  test('winter window start crosses year boundary', () => {
    const start = seasonWindowStart(new Date(Date.UTC(2026, 0, 15)), [12, 1, 2])
    expect(start?.toISOString().slice(0, 10)).toBe('2025-12-01')
  })

  test('monthly winter spray due in season', () => {
    const result = evaluateScheduleDue({
      activeMonths: null,
      activePeriod: 'season',
      currentOdometerKm: 5000,
      frequencyMode: 'interval',
      intervalKm: null,
      intervalMonths: 1,
      lastService: { odometerKm: 4800, performedOn: '2025-12-01' },
      season: 'winter',
      today: new Date(Date.UTC(2026, 0, 15)),
      warnDays: 7,
      warnKm: null,
    })
    expect(result.status).toBe('overdue')
    expect(result.dueDate).toBe('2026-01-01')
  })
})
