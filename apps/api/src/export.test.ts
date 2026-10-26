import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ImportLog } from '@vehicles/shared'
import { eq } from 'drizzle-orm'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { extractText } from 'unpdf'

const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'vehicle-export-test-'))
process.env.DATA_ROOT = dataRoot

let db: typeof import('./db/client').db
let exportModule: typeof import('./export')
let insertImportedHistory: typeof import('./intakeService').insertImportedHistory
const vehicleId = crypto.randomUUID()
const trailerId = crypto.randomUUID()

beforeAll(async () => {
  const client = await import('./db/client')
  db = client.db
  const { migrate } = client
  const { billOfSaleFiles, serviceLogs, vehicles } = await import('./db/schema')
  const { billOfSalePath } = await import('./util')
  exportModule = await import('./export')
  ;({ insertImportedHistory } = await import('./intakeService'))

  migrate()
  const now = new Date().toISOString()
  await db.insert(vehicles).values({
    archivedAt: now,
    createdAt: now,
    currentOdometerKm: 90000,
    id: vehicleId,
    make: 'Toyota',
    model: 'Tacoma',
    name: 'Truck',
    purchaseOdometerKm: 10,
    purchasedOn: '2015-03-01',
    soldOdometerKm: 90000,
    soldOn: '2026-10-01',
    updatedAt: now,
    year: 2015,
  })
  await db.insert(vehicles).values({
    createdAt: now,
    currentOdometerKm: 0,
    id: trailerId,
    make: 'Forest River',
    model: 'R-Pod',
    name: 'Trailer',
    trackOdometer: false,
    updatedAt: now,
    vehicleType: 'towable',
    year: 2018,
  })
  await db.insert(serviceLogs).values({
    createdAt: now,
    id: crypto.randomUUID(),
    kind: 'service',
    notes: 'Winterize',
    odometerKm: 14000,
    performedBy: 'self',
    performedOn: '2026-10-01',
    vehicleId: trailerId,
  })

  const fileId = crypto.randomUUID()
  await Bun.write(billOfSalePath(fileId, 'pdf'), 'bill of sale')
  await db.insert(billOfSaleFiles).values({
    contentType: 'application/pdf',
    createdAt: now,
    ext: 'pdf',
    id: fileId,
    originalFilename: 'bill-of-sale.pdf',
    side: 'purchase',
    sizeBytes: 12,
    vehicleId,
  })
})

afterAll(() => {
  rmSync(dataRoot, { force: true, recursive: true })
})

describe('vehicle export', () => {
  test('includes purchase and sale details but not bills of sale', async () => {
    const bundle = await exportModule.collectVehicleExport(vehicleId)
    const json = JSON.stringify(bundle.json)

    expect(json).toContain('2015-03-01')
    expect(json).toContain('2026-10-01')
    expect(json).not.toContain('bill-of-sale.pdf')
    expect(bundle.files.some(file => file.filePath.includes('bills-of-sale'))).toBe(false)

    const pdfPath = path.join(dataRoot, 'history.pdf')
    await exportModule.writeHistoryPdf(pdfPath, bundle.pdfData)
    const { text } = await extractText(new Uint8Array(readFileSync(pdfPath)), {
      mergePages: true,
    })
    expect(text).toContain('Purchased 03/01/2015')
    expect(text).toContain('Sold 10/01/2026')
  })

  test('omits log odometer for vehicles that do not track it', async () => {
    const bundle = await exportModule.collectVehicleExport(trailerId)
    const logs = (
      bundle.json as {
        logs: Array<{ odometerDisplay: number | null; odometerKm: number | null }>
      }
    ).logs
    expect(logs[0]?.odometerKm).toBeNull()
    expect(logs[0]?.odometerDisplay).toBeNull()

    const pdfPath = path.join(dataRoot, 'trailer-history.pdf')
    await exportModule.writeHistoryPdf(pdfPath, bundle.pdfData)
    const { text } = await extractText(new Uint8Array(readFileSync(pdfPath)), {
      mergePages: true,
    })
    expect(text).toContain('Winterize')
    expect(text).not.toContain('14,000')
    expect(text).not.toContain('14000')
  })
})

describe('insertImportedHistory', () => {
  test('does not store odometer when the vehicle is not tracking it', async () => {
    const { serviceLogs } = await import('./db/schema')
    const importedLog: ImportLog = {
      costEnteredCents: null,
      costEnteredCurrency: null,
      documentIndex: null,
      kind: 'repair',
      notes: 'Seal roof',
      odometer: 14000,
      odometerUnit: 'km',
      performedBy: 'self',
      performedOn: '2026-09-15',
      scheduleKey: null,
      shopName: null,
    }

    const result = db.transaction(tx =>
      insertImportedHistory(tx, {
        currentOdometerKm: 0,
        documents: [],
        fx: null,
        logs: [importedLog],
        scheduleIdByKey: new Map(),
        trackOdometer: false,
        vehicleId: trailerId,
      })
    )

    expect(result.createdLogIds).toHaveLength(1)
    const rows = await db
      .select()
      .from(serviceLogs)
      .where(eq(serviceLogs.id, result.createdLogIds[0]!))
    expect(rows[0]?.odometerKm).toBeNull()
    expect(rows[0]?.notes).toBe('Seal roof')
  })
})
