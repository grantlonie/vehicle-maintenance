import { formatUsd, fromKm, type DisplayUnit } from '@vehicles/shared'
import archiver from 'archiver'
import { eq } from 'drizzle-orm'
import { createWriteStream, existsSync, readFileSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import PDFDocument from 'pdfkit'
import { db } from './db/client'
import {
  attachments,
  serviceLogs,
  serviceSchedules,
  vehicles,
} from './db/schema'
import { attachmentPath, parseActiveMonths, vehicleImagePath } from './util'

export async function buildVehicleExportZip(vehicleId: string): Promise<Buffer> {
  const vehicle = await db.query.vehicles.findFirst({
    where: eq(vehicles.id, vehicleId),
  })
  if (!vehicle) throw new Error('Vehicle not found')

  const schedules = await db
    .select()
    .from(serviceSchedules)
    .where(eq(serviceSchedules.vehicleId, vehicleId))
  const logs = await db
    .select()
    .from(serviceLogs)
    .where(eq(serviceLogs.vehicleId, vehicleId))
  const attachmentRows = []
  for (const log of logs) {
    const rows = await db.select().from(attachments).where(eq(attachments.serviceLogId, log.id))
    attachmentRows.push(...rows)
  }

  const unit = vehicle.displayUnit as DisplayUnit
  const exportJson = {
    attachments: attachmentRows.map(a => ({
      contentType: a.contentType,
      id: a.id,
      originalFilename: a.originalFilename,
      relativePath: `attachments/${a.id}.${a.ext}`,
      serviceLogId: a.serviceLogId,
    })),
    exportedAt: new Date().toISOString(),
    logs: logs.map(log => ({
      costEnteredCents: log.costEnteredCents,
      costEnteredCurrency: log.costEnteredCurrency,
      costUsdCents: log.costUsdCents,
      fxRateToUsd: log.fxRateToUsd,
      id: log.id,
      kind: log.kind,
      notes: log.notes,
      odometerDisplay: fromKm(log.odometerKm, unit),
      odometerKm: log.odometerKm,
      odometerUnit: unit,
      performedBy: log.performedBy,
      performedOn: log.performedOn,
      scheduleId: log.scheduleId,
      shopName: log.shopName,
    })),
    schedules: schedules.map(s => ({
      activeMonths: parseActiveMonths(s.activeMonthsJson),
      activePeriod: s.activePeriod,
      frequencyMode: s.frequencyMode,
      id: s.id,
      intervalKm: s.intervalKm,
      intervalMonths: s.intervalMonths,
      name: s.name,
      notes: s.notes,
      season: s.season,
    })),
    vehicle: {
      currentOdometerDisplay: fromKm(vehicle.currentOdometerKm, unit),
      currentOdometerKm: vehicle.currentOdometerKm,
      displayUnit: unit,
      image: vehicle.imageId ? `vehicle-image.${vehicle.imageExt}` : null,
      make: vehicle.make,
      model: vehicle.model,
      name: vehicle.name,
      vin: vehicle.vin,
      year: vehicle.year,
    },
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vehicle-export-'))
  const jsonPath = path.join(tmpDir, 'vehicle.json')
  const pdfPath = path.join(tmpDir, 'history.pdf')
  const zipPath = path.join(tmpDir, 'export.zip')

  await Bun.write(jsonPath, JSON.stringify(exportJson, null, 2))
  await writeHistoryPdf(pdfPath, exportJson)

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', () => resolve())
    archive.on('error', reject)
    archive.pipe(output)
    archive.file(jsonPath, { name: 'vehicle.json' })
    archive.file(pdfPath, { name: 'history.pdf' })

    if (vehicle.imageId && vehicle.imageExt) {
      const img = vehicleImagePath(vehicle.imageId, vehicle.imageExt)
      if (existsSync(img)) {
        archive.file(img, { name: `vehicle-image.${vehicle.imageExt}` })
      }
    }

    for (const a of attachmentRows) {
      const file = attachmentPath(a.id, a.ext)
      if (existsSync(file)) {
        archive.file(file, { name: `attachments/${a.id}.${a.ext}` })
      }
    }

    void archive.finalize()
  })

  const buffer = readFileSync(zipPath)
  await rm(tmpDir, { force: true, recursive: true })
  return buffer
}

async function writeHistoryPdf(
  pdfPath: string,
  data: {
    logs: Array<{
      costUsdCents: number | null
      kind: string
      notes: string | null
      odometerDisplay: number
      odometerUnit: string
      performedBy: string
      performedOn: string
      shopName: string | null
    }>
    schedules: Array<{
      activePeriod: string
      frequencyMode: string
      intervalKm: number | null
      intervalMonths: number | null
      name: string
      season: string | null
    }>
    vehicle: {
      currentOdometerDisplay: number
      displayUnit: string
      make: string
      model: string
      name: string
      vin: string | null
      year: number
    }
  }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 })
    const stream = createWriteStream(pdfPath)
    doc.pipe(stream)
    stream.on('finish', () => resolve())
    stream.on('error', reject)

    doc.fontSize(20).text(data.vehicle.name)
    doc
      .fontSize(12)
      .text(
        `${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}` +
          (data.vehicle.vin ? `  VIN ${data.vehicle.vin}` : '')
      )
    doc.text(
      `Odometer: ${Math.round(data.vehicle.currentOdometerDisplay).toLocaleString()} ${data.vehicle.displayUnit}`
    )
    doc.moveDown()

    doc.fontSize(16).text('Schedules')
    doc.moveDown(0.5)
    for (const s of data.schedules) {
      const bits = [
        s.activePeriod,
        s.season,
        s.frequencyMode,
        s.intervalKm != null ? `${s.intervalKm} km` : null,
        s.intervalMonths != null ? `${s.intervalMonths} mo` : null,
      ].filter(Boolean)
      doc.fontSize(11).text(`${s.name} — ${bits.join(', ')}`)
    }

    doc.moveDown()
    doc.fontSize(16).text('Service & repair history')
    doc.moveDown(0.5)

    const sorted = [...data.logs].sort((a, b) => b.performedOn.localeCompare(a.performedOn))
    for (const log of sorted) {
      const who = log.performedBy === 'self' ? 'Self' : log.shopName || 'Shop'
      const cost = log.costUsdCents != null ? formatUsd(log.costUsdCents) : '—'
      doc
        .fontSize(11)
        .text(
          `${log.performedOn}  [${log.kind}]  ${Math.round(log.odometerDisplay).toLocaleString()} ${log.odometerUnit}  ${who}  ${cost}`
        )
      if (log.notes) doc.fontSize(10).fillColor('#444').text(log.notes).fillColor('#000')
      doc.moveDown(0.4)
    }

    doc.end()
  })
}
