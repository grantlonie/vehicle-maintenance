import { describe, expect, test } from 'bun:test'
import { UNRECORDED_SHOP_NAME } from '@vehicles/shared'
import {
  chunkText,
  normalizeHistoryEvents,
  toBillOfSale,
  type HistoryImportContext,
} from './historyImport'

const context: HistoryImportContext = {
  defaultUnit: 'mi',
  schedules: [
    { key: 'suggested-1', name: 'Change engine oil and filter' },
    { key: 'suggested-2', name: 'Rotate tires' },
  ],
  today: '2026-10-25',
}

const carfaxFixture = [
  {
    costEnteredCents: null,
    kind: 'service',
    notes: 'Oil and filter changed',
    odometer: '24,512',
    odometerUnit: 'mi',
    performedBy: 'shop',
    performedOn: '06/14/2021',
    scheduleKey: 'suggested-1',
    shopName: 'Valvoline Instant Oil Change',
    status: 'performed',
  },
  {
    kind: 'service',
    notes: 'Tires rotated',
    odometer: 24512,
    odometerUnit: 'mi',
    performedBy: 'shop',
    performedOn: '2021-06-14',
    scheduleKey: 'suggested-2',
    shopName: null,
    status: 'performed',
  },
  {
    kind: 'repair',
    notes: 'Front brake pads replaced',
    odometer: 40100,
    performedOn: '2023-02-01',
    scheduleKey: 'suggested-1',
    status: 'performed',
  },
  {
    kind: 'service',
    notes: 'Recommend wheel alignment',
    odometer: 40100,
    performedOn: '2023-02-01',
    status: 'recommended',
  },
  { kind: 'service', notes: 'Vehicle serviced', odometer: 31000, performedOn: null },
  { kind: 'service', notes: 'Inspection', odometer: null, performedOn: '2022-03-03' },
]

describe('normalizeHistoryEvents', () => {
  test('splits performed work from recommendations and undated records', () => {
    const { history, skipped } = normalizeHistoryEvents(
      carfaxFixture.map(event => ({ documentIndex: 0, event })),
      context
    )
    expect(history.map(h => h.notes)).toEqual([
      'Oil and filter changed',
      'Tires rotated',
      'Inspection',
      'Front brake pads replaced',
    ])
    expect(skipped.map(s => s.reason)).toEqual([
      'No date on the record',
      'Recommended, not performed',
    ])
  })

  test('links services to known schedule keys and leaves repairs unlinked', () => {
    const { history } = normalizeHistoryEvents(
      carfaxFixture.map(event => ({ documentIndex: 0, event })),
      context
    )
    const byNotes = new Map(history.map(h => [h.notes, h]))
    expect(byNotes.get('Oil and filter changed')!.scheduleKey).toBe('suggested-1')
    expect(byNotes.get('Oil and filter changed')!.odometer).toBe(24512)
    expect(byNotes.get('Oil and filter changed')!.performedOn).toBe('2021-06-14')
    expect(byNotes.get('Tires rotated')!.scheduleKey).toBe('suggested-2')
    expect(byNotes.get('Front brake pads replaced')!.scheduleKey).toBeNull()
  })

  test('fills an unrecorded shop name and keeps missing odometers for manual entry', () => {
    const { history } = normalizeHistoryEvents(
      carfaxFixture.map(event => ({ documentIndex: 0, event })),
      context
    )
    const byNotes = new Map(history.map(h => [h.notes, h]))
    expect(byNotes.get('Tires rotated')!.shopName).toBe(UNRECORDED_SHOP_NAME)
    expect(byNotes.get('Inspection')!.odometer).toBeNull()
  })

  test('drops unknown schedule keys', () => {
    const { history } = normalizeHistoryEvents(
      [
        {
          documentIndex: 0,
          event: { notes: 'Oil', odometer: 1000, performedOn: '2024-01-01', scheduleKey: 'nope' },
        },
      ],
      context
    )
    expect(history[0]!.scheduleKey).toBeNull()
  })

  test('dedupes the same visit across documents and keeps the richer details', () => {
    const visit = {
      kind: 'service',
      notes: 'Oil change',
      odometer: 50000,
      odometerUnit: 'km',
      performedOn: '2024-05-01',
      scheduleKey: 'suggested-1',
    }
    const { history } = normalizeHistoryEvents(
      [
        { documentIndex: 0, event: { ...visit, shopName: null } },
        {
          documentIndex: 1,
          event: {
            ...visit,
            costEnteredCents: 89.99,
            notes: 'Synthetic oil and filter change',
            shopName: 'Toyota on the Trail',
          },
        },
      ],
      context
    )
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      costEnteredCents: 8999,
      documentIndex: 0,
      notes: 'Synthetic oil and filter change',
      shopName: 'Toyota on the Trail',
    })
  })

  test('flags possible duplicates of existing logs', () => {
    const { history } = normalizeHistoryEvents(
      [
        {
          documentIndex: 0,
          event: { notes: 'Oil', odometer: 1000, odometerUnit: 'km', performedOn: '2024-01-01' },
        },
      ],
      {
        ...context,
        existingLogs: [{ kind: 'service', odometerKm: 1001, performedOn: '2024-01-01' }],
      }
    )
    expect(history[0]!.possibleDuplicate).toBe(true)
  })

  test('defaults missing odometers when the context provides one (towables)', () => {
    const { history } = normalizeHistoryEvents(
      [{ documentIndex: 0, event: { notes: 'Winterized plumbing', performedOn: '2024-10-15' } }],
      { ...context, defaultOdometer: 0 }
    )
    expect(history[0]!.odometer).toBe(0)
  })

  test('skips future-dated records', () => {
    const { skipped } = normalizeHistoryEvents(
      [{ documentIndex: 0, event: { notes: 'Oil', odometer: 1, performedOn: '2027-01-01' } }],
      context
    )
    expect(skipped[0]!.reason).toBe('Date is in the future')
  })
})

describe('toBillOfSale', () => {
  test('normalizes purchase details and defaults the unit', () => {
    expect(toBillOfSale({ odometer: '45,120', purchasedOn: '03/14/2024' }, context)).toEqual({
      odometer: 45120,
      odometerUnit: 'mi',
      purchasedOn: '2024-03-14',
    })
  })

  test('drops future dates and returns null when not a bill of sale', () => {
    expect(toBillOfSale({ odometerUnit: 'km', purchasedOn: '2027-01-01' }, context)).toEqual({
      odometer: null,
      odometerUnit: 'km',
      purchasedOn: null,
    })
    expect(toBillOfSale(null, context)).toBeNull()
  })
})

describe('chunkText', () => {
  test('splits long text on whitespace without losing words', () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`)
    const chunks = chunkText(words.join(' '), 300)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.length <= 300)).toBe(true)
    expect(chunks.join(' ').split(' ')).toEqual(words)
  })
})
