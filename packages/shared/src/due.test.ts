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
      activePeriod: 'seasonal',
      currentOdometerKm: 10000,
      frequencyMode: 'interval',
      intervalKm: null,
      intervalMonths: 1,
      lastService: null,
      seasons: ['winter'],
      today: new Date(Date.UTC(2026, 6, 15)),
    })
    expect(result.status).toBe('inactive')
  })

  test('odometer interval overdue', () => {
    const result = evaluateScheduleDue({
      ...baseline,
      activePeriod: 'year_round',
      currentOdometerKm: 21000,
      frequencyMode: 'interval',
      intervalKm: 10000,
      intervalMonths: null,
      lastService: { odometerKm: 10000, performedOn: '2025-01-01' },
      seasons: null,
      today: new Date(Date.UTC(2026, 0, 1)),
    })
    expect(result.status).toBe('overdue')
    expect(result.dueOdometerKm).toBe(20000)
  })

  test('odometer soon within 1000 km', () => {
    const result = evaluateScheduleDue({
      ...baseline,
      activePeriod: 'year_round',
      currentOdometerKm: 20000 - SOON_KM + 1,
      frequencyMode: 'interval',
      intervalKm: 10000,
      intervalMonths: null,
      lastService: { odometerKm: 10000, performedOn: '2025-01-01' },
      seasons: null,
      today: new Date(Date.UTC(2026, 0, 1)),
    })
    expect(result.status).toBe('soon')
  })

  test('date soon when due within current month', () => {
    const result = evaluateScheduleDue({
      ...baseline,
      activePeriod: 'year_round',
      currentOdometerKm: 5000,
      frequencyMode: 'interval',
      intervalKm: null,
      intervalMonths: 1,
      lastService: { odometerKm: 4800, performedOn: '2026-06-20' },
      seasons: null,
      today: new Date(Date.UTC(2026, 6, 10)),
    })
    expect(result.status).toBe('soon')
    expect(result.dueDate).toBe('2026-07-20')
  })

  test('once per season overdue until completed', () => {
    const result = evaluateScheduleDue({
      ...baseline,
      activePeriod: 'seasonal',
      currentOdometerKm: 1000,
      frequencyMode: 'once_per_season',
      intervalKm: null,
      intervalMonths: null,
      lastService: { odometerKm: 500, performedOn: '2025-04-01' },
      seasons: ['spring'],
      today: new Date(Date.UTC(2026, 3, 10)),
    })
    expect(result.status).toBe('overdue')
    expect(result.seasonWindowStart).toBe('2026-03-01')
  })

  test('winter window start crosses year boundary', () => {
    const start = seasonWindowStart(new Date(Date.UTC(2026, 0, 15)), ['winter'])
    expect(start?.toISOString().slice(0, 10)).toBe('2025-12-01')
  })

  test('once per season with spring and fall', () => {
    const spring = evaluateScheduleDue({
      ...baseline,
      activePeriod: 'seasonal',
      currentOdometerKm: 1000,
      frequencyMode: 'once_per_season',
      intervalKm: null,
      intervalMonths: null,
      lastService: { odometerKm: 500, performedOn: '2025-10-01' },
      seasons: ['spring', 'fall'],
      today: new Date(Date.UTC(2026, 3, 10)),
    })
    expect(spring.status).toBe('overdue')
    expect(spring.seasonWindowStart).toBe('2026-03-01')

    const fallDone = evaluateScheduleDue({
      ...baseline,
      activePeriod: 'seasonal',
      currentOdometerKm: 1000,
      frequencyMode: 'once_per_season',
      intervalKm: null,
      intervalMonths: null,
      lastService: { odometerKm: 500, performedOn: '2026-09-15' },
      seasons: ['spring', 'fall'],
      today: new Date(Date.UTC(2026, 9, 10)),
    })
    expect(fallDone.status).toBe('ok')
    expect(fallDone.seasonWindowStart).toBe('2026-09-01')
  })

  test('monthly winter spray due in season', () => {
    const result = evaluateScheduleDue({
      ...baseline,
      activePeriod: 'seasonal',
      currentOdometerKm: 5000,
      frequencyMode: 'interval',
      intervalKm: null,
      intervalMonths: 1,
      lastService: { odometerKm: 4800, performedOn: '2025-12-01' },
      seasons: ['winter'],
      today: new Date(Date.UTC(2026, 0, 15)),
    })
    expect(result.status).toBe('overdue')
    expect(result.dueDate).toBe('2026-01-01')
  })

  test('uses vehicle year baseline when never serviced', () => {
    const result = evaluateScheduleDue({
      ...baseline,
      activePeriod: 'year_round',
      currentOdometerKm: 14013,
      frequencyMode: 'interval',
      intervalKm: 100000,
      intervalMonths: 72,
      lastService: null,
      seasons: null,
      today: new Date(Date.UTC(2026, 6, 23)),
    })
    expect(result.status).toBe('ok')
    expect(result.dueDate).toBe('2031-01-01')
    expect(result.dueOdometerKm).toBe(100000)
  })
})
