import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { extractText } from 'unpdf'

const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'vehicle-export-test-'))
process.env.DATA_ROOT = dataRoot

let exportModule: typeof import('./export')
const vehicleId = crypto.randomUUID()

beforeAll(async () => {
  const { db, migrate } = await import('./db/client')
  const { billOfSaleFiles, vehicles } = await import('./db/schema')
  const { billOfSalePath } = await import('./util')
  exportModule = await import('./export')

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
})
