import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ImportLog } from '@vehicles/shared'
import { eq } from 'drizzle-orm'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { extractText } from 'unpdf'

const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'vehicle-export-test-'))
process.env.DATA_ROOT = dataRoot

let db: typeof import('./db/client').db
let exportModule: typeof import('./export')
let attachments: typeof import('./db/schema').attachments
let serviceLogs: typeof import('./db/schema').serviceLogs
let insertImportedHistory: typeof import('./intakeService').insertImportedHistory
let attachmentPath: typeof import('./util').attachmentPath
let documentPath: typeof import('./util').documentPath
const vehicleId = crypto.randomUUID()
const trailerId = crypto.randomUUID()

beforeAll(async () => {
  const client = await import('./db/client')
  db = client.db
  const { migrate } = client
  const schema = await import('./db/schema')
  const { billOfSaleFiles, vehicles } = schema
  attachments = schema.attachments
  serviceLogs = schema.serviceLogs
  const util = await import('./util')
  attachmentPath = util.attachmentPath
  documentPath = util.documentPath
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
  await Bun.write(util.billOfSalePath(fileId, 'pdf'), 'bill of sale')
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

function importLog(
  partial: Partial<ImportLog> & Pick<ImportLog, 'notes' | 'odometer' | 'performedOn'>
): ImportLog {
  return {
    costEnteredCents: null,
    costEnteredCurrency: null,
    documentIndex: null,
    kind: 'repair',
    odometerUnit: 'km',
    performedBy: 'shop',
    scheduleKey: null,
    shopName: 'Shop',
    ...partial,
  }
}

describe.serial('stored files', () => {
  test('includes purchase and sale details but not bills of sale', async () => {
    const bundle = await exportModule.collectVehicleExport(vehicleId)
    const json = JSON.stringify(bundle.json)

    expect(json).toContain('2015-03-01')
    expect(json).toContain('2026-10-01')
    expect(json).not.toContain('bill-of-sale.pdf')
    expect(json).not.toContain('"documents"')
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
        writtenAttachments: [],
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

describe('imported documents', () => {
  test('attaches one uploaded document to every service log it creates', async () => {
    const docId = crypto.randomUUID()
    const pdf = 'same history document'
    writeFileSync(documentPath(docId, 'pdf'), pdf)
    const writtenAttachments: Array<{ ext: string; id: string }> = []

    db.transaction(tx => {
      insertImportedHistory(tx, {
        currentOdometerKm: 90000,
        documents: [
          {
            contentType: 'application/pdf',
            ext: 'pdf',
            id: docId,
            originalFilename: 'carfax.pdf',
            sizeBytes: pdf.length,
          },
        ],
        fx: null,
        logs: [
          importLog({
            documentIndex: 0,
            notes: 'Oil',
            odometer: 100,
            performedOn: '2020-01-01',
          }),
          importLog({
            documentIndex: 0,
            notes: 'Brakes',
            odometer: 200,
            performedOn: '2021-01-01',
          }),
          importLog({
            documentIndex: null,
            notes: 'Entered by hand',
            odometer: 50,
            performedOn: '2019-01-01',
          }),
        ],
        scheduleIdByKey: new Map(),
        vehicleId,
        writtenAttachments,
      })
    })

    const logs = await db.select().from(serviceLogs).where(eq(serviceLogs.vehicleId, vehicleId))
    const byNotes = new Map(logs.map(log => [log.notes, log]))
    const oilFiles = await db
      .select()
      .from(attachments)
      .where(eq(attachments.serviceLogId, byNotes.get('Oil')!.id))
    const brakeFiles = await db
      .select()
      .from(attachments)
      .where(eq(attachments.serviceLogId, byNotes.get('Brakes')!.id))
    const manualFiles = await db
      .select()
      .from(attachments)
      .where(eq(attachments.serviceLogId, byNotes.get('Entered by hand')!.id))

    expect(writtenAttachments).toHaveLength(2)
    expect(oilFiles.map(file => file.originalFilename)).toEqual(['carfax.pdf'])
    expect(brakeFiles.map(file => file.originalFilename)).toEqual(['carfax.pdf'])
    expect(manualFiles).toHaveLength(0)
    expect(readFileSync(attachmentPath(oilFiles[0]!.id, oilFiles[0]!.ext), 'utf8')).toBe(pdf)
    expect(readFileSync(attachmentPath(brakeFiles[0]!.id, brakeFiles[0]!.ext), 'utf8')).toBe(pdf)
    expect(oilFiles[0]!.id).not.toBe(brakeFiles[0]!.id)
  })
})
