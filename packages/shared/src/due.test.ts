import { describe, expect, test } from 'bun:test'
import { evaluateScheduleDue, seasonWindowStart, SOON_KM } from './due'
import { convertCadCentsToUsdCents, fromKm, toKm } from './units'

const baseline = {
  baselineDate: '2025-01-01',
  baselineOdometerKm: 0,
}

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
      ...baseline,
      activeMonths: null,
      activePeriod: 'season',
      currentOdometerKm: 10000,
      frequencyMode: 'interval',
      intervalKm: null,
      intervalMonths: 1,
      lastService: null,
      season: 'winter',
      today: new Date(Date.UTC(2026, 6, 15)),
    })
    expect(result.status).toBe('inactive')
  })

  test('odometer interval overdue', () => {
    const result = evaluateScheduleDue({
      ...baseline,
      activeMonths: null,
      activePeriod: 'year_round',
      currentOdometerKm: 21000,
      frequencyMode: 'interval',
      intervalKm: 10000,
      intervalMonths: null,
      lastService: { odometerKm: 10000, performedOn: '2025-01-01' },
      season: null,
      today: new Date(Date.UTC(2026, 0, 1)),
    })
    expect(result.status).toBe('overdue')
    expect(result.dueOdometerKm).toBe(20000)
  })

  test('odometer soon within 1000 km', () => {
    const result = evaluateScheduleDue({
      ...baseline,
      activeMonths: null,
      activePeriod: 'year_round',
      currentOdometerKm: 20000 - SOON_KM + 1,
      frequencyMode: 'interval',
      intervalKm: 10000,
      intervalMonths: null,
      lastService: { odometerKm: 10000, performedOn: '2025-01-01' },
      season: null,
      today: new Date(Date.UTC(2026, 0, 1)),
    })
    expect(result.status).toBe('soon')
  })

  test('date soon when due within current month', () => {
    const result = evaluateScheduleDue({
      ...baseline,
      activeMonths: null,
      activePeriod: 'year_round',
      currentOdometerKm: 5000,
      frequencyMode: 'interval',
      intervalKm: null,
      intervalMonths: 1,
      lastService: { odometerKm: 4800, performedOn: '2026-06-20' },
      season: null,
      today: new Date(Date.UTC(2026, 6, 10)),
    })
    expect(result.status).toBe('soon')
    expect(result.dueDate).toBe('2026-07-20')
  })

  test('once per season overdue until completed', () => {
    const result = evaluateScheduleDue({
      ...baseline,
      activeMonths: null,
      activePeriod: 'season',
      currentOdometerKm: 1000,
      frequencyMode: 'once_per_season',
      intervalKm: null,
      intervalMonths: null,
      lastService: { odometerKm: 500, performedOn: '2025-04-01' },
      season: 'spring',
      today: new Date(Date.UTC(2026, 3, 10)),
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
      ...baseline,
      activeMonths: null,
      activePeriod: 'season',
      currentOdometerKm: 5000,
      frequencyMode: 'interval',
      intervalKm: null,
      intervalMonths: 1,
      lastService: { odometerKm: 4800, performedOn: '2025-12-01' },
      season: 'winter',
      today: new Date(Date.UTC(2026, 0, 15)),
    })
    expect(result.status).toBe('overdue')
    expect(result.dueDate).toBe('2026-01-01')
  })

  test('uses vehicle year baseline when never serviced', () => {
    const result = evaluateScheduleDue({
      ...baseline,
      activeMonths: null,
      activePeriod: 'year_round',
      currentOdometerKm: 14013,
      frequencyMode: 'interval',
      intervalKm: 100000,
      intervalMonths: 72,
      lastService: null,
      season: null,
      today: new Date(Date.UTC(2026, 6, 23)),
    })
    expect(result.status).toBe('ok')
    expect(result.dueDate).toBe('2031-01-01')
    expect(result.dueOdometerKm).toBe(100000)
  })
})
