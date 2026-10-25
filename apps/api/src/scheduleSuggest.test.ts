import { describe, expect, test } from 'bun:test'
import { KM_PER_MILE } from '@vehicles/shared'
import {
  buildUserMessage,
  MAX_SCHEDULE_SUGGESTIONS,
  normalizeScheduleSuggestions,
} from './scheduleSuggest'

describe('normalizeScheduleSuggestions', () => {
  test('converts miles to km and keeps month intervals', () => {
    const drafts = normalizeScheduleSuggestions({
      items: [
        {
          distanceUnit: 'mi',
          intervalDistance: 10000,
          intervalMonths: 12,
          name: 'Change engine oil and filter',
          source: 'Normal schedule, 10,000 mi / 12 months',
        },
      ],
    })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.key).toBe('suggested-1')
    expect(drafts[0]!.schedule).toEqual({
      activePeriod: 'year_round',
      frequencyMode: 'interval',
      intervalKm: 10000 * KM_PER_MILE,
      intervalMonths: 12,
      name: 'Change engine oil and filter',
      notes: 'Normal schedule, 10,000 mi / 12 months',
      seasons: null,
    })
  })

  test('builds once-per-season items without intervals', () => {
    const [draft] = normalizeScheduleSuggestions({
      items: [
        {
          intervalDistance: 5000,
          name: 'Swap to winter tires',
          oncePerSeason: true,
          seasonal: true,
          seasons: ['Fall', 'bogus'],
        },
      ],
    })
    expect(draft!.schedule).toMatchObject({
      activePeriod: 'seasonal',
      frequencyMode: 'once_per_season',
      intervalKm: null,
      intervalMonths: null,
      seasons: ['fall'],
    })
  })

  test('drops items without a name or interval, dedupes names, and caps the list', () => {
    const items = [
      { intervalMonths: 6, name: 'Rotate tires' },
      { intervalMonths: 6, name: 'rotate  tires' },
      { name: 'Inspect everything' },
      { intervalMonths: 12 },
      ...Array.from({ length: 60 }, (_, i) => ({ intervalMonths: 12, name: `Item ${i}` })),
    ]
    const drafts = normalizeScheduleSuggestions({ items })
    expect(drafts).toHaveLength(MAX_SCHEDULE_SUGGESTIONS)
    expect(normalizeScheduleSuggestions({ items }, 10)).toHaveLength(10)
    expect(drafts.filter(d => d.schedule.name.toLowerCase().includes('rotate'))).toHaveLength(1)
    expect(drafts.some(d => d.schedule.name === 'Inspect everything')).toBe(false)
  })

  test('returns empty for malformed payloads', () => {
    expect(normalizeScheduleSuggestions(null)).toEqual([])
    expect(normalizeScheduleSuggestions({ items: 'nope' })).toEqual([])
  })
})

describe('buildUserMessage', () => {
  const base = { make: 'Winnebago', model: 'View 24D', vinDecode: null, year: 2021 }

  test('asks motorhomes for chassis and house systems', () => {
    const message = buildUserMessage({ ...base, vehicleType: 'motorhome' })
    expect(message).toContain('Chassis and engine')
    expect(message).toContain('House systems')
    expect(message).toContain(`Item limit: ${MAX_SCHEDULE_SUGGESTIONS}`)
  })

  test('tells towables to skip engine items', () => {
    const message = buildUserMessage({
      ...base,
      make: 'Grand Design',
      model: 'Imagine 2500RL',
      vehicleType: 'towable',
    })
    expect(message).toContain('NO engine')
    expect(message).toContain('wheel bearing')
  })

  test('keeps cars on the engine schedule', () => {
    const message = buildUserMessage({ ...base, make: 'Honda', model: 'Civic', vehicleType: 'car' })
    expect(message).toContain('car, truck, or SUV')
    expect(message).not.toContain('House systems')
  })
})
