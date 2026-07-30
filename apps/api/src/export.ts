import { formatDate, formatUsd, fromKm, type DisplayUnit } from '@vehicles/shared'
import archiver from 'archiver'
import { eq } from 'drizzle-orm'
import { createWriteStream, existsSync, readFileSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { db } from './db/client'
import {
  attachments,
  serviceLogs,
  serviceSchedules,
  vehicles,
} from './db/schema'
import { attachmentPath, parseSeasons, vehicleImagePath } from './util'

const VEHICLE_IMAGE_MAX_WIDTH = 280
const APPENDIX_IMAGE_MAX_WIDTH = 450
const APPENDIX_IMAGE_MAX_HEIGHT = 360
const LINK_COLOR = '#0B57D0'

function photoDestination(attachmentId: string): string {
  return `photo-${attachmentId}`
}

interface ExportAttachment {
  contentType: string
  filePath: string
  id: string
  originalFilename: string
  relativePath: string
  serviceLogId: string
}

interface ExportLog {
  costUsdCents: number | null
  id: string
  kind: string
  notes: string | null
  odometerDisplay: number
  odometerUnit: string
  performedBy: string
  performedOn: string
  scheduleId: string | null
  shopName: string | null
}

interface ExportSchedule {
  activePeriod: string
  frequencyMode: string
  id: string
  intervalKm: number | null
  intervalMonths: number | null
  name: string
  seasons: string[] | null
}

interface ExportVehicle {
  currentOdometerDisplay: number
  displayUnit: string
  imagePath: string | null
  make: string
  model: string
  vin: string | null
  year: number
}

interface HistoryPdfData {
  attachments: ExportAttachment[]
  logs: ExportLog[]
  schedules: ExportSchedule[]
  vehicle: ExportVehicle
}

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
  const attachmentRows: (typeof attachments.$inferSelect)[] = []
  for (const log of logs) {
    const rows = await db.select().from(attachments).where(eq(attachments.serviceLogId, log.id))
    attachmentRows.push(...rows)
  }

  const unit = vehicle.displayUnit as DisplayUnit
  const vehicleImage =
    vehicle.imageId && vehicle.imageExt
      ? vehicleImagePath(vehicle.imageId, vehicle.imageExt)
      : null
  const exportAttachments: ExportAttachment[] = attachmentRows.map(a => ({
    contentType: a.contentType,
    filePath: attachmentPath(a.id, a.ext),
    id: a.id,
    originalFilename: a.originalFilename,
    relativePath: `attachments/${a.id}.${a.ext}`,
    serviceLogId: a.serviceLogId,
  }))

  const exportJson = {
    attachments: exportAttachments.map(a => ({
      contentType: a.contentType,
      id: a.id,
      originalFilename: a.originalFilename,
      relativePath: a.relativePath,
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
      activePeriod: s.activePeriod,
      frequencyMode: s.frequencyMode,
      id: s.id,
      intervalKm: s.intervalKm,
      intervalMonths: s.intervalMonths,
      name: s.name,
      notes: s.notes,
      seasons: parseSeasons(s.seasonsJson),
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

  const pdfData: HistoryPdfData = {
    attachments: exportAttachments,
    logs: exportJson.logs.map(log => ({
      costUsdCents: log.costUsdCents,
      id: log.id,
      kind: log.kind,
      notes: log.notes,
      odometerDisplay: log.odometerDisplay,
      odometerUnit: log.odometerUnit,
      performedBy: log.performedBy,
      performedOn: log.performedOn,
      scheduleId: log.scheduleId,
      shopName: log.shopName,
    })),
    schedules: exportJson.schedules.map(s => ({
      activePeriod: s.activePeriod,
      frequencyMode: s.frequencyMode,
      id: s.id,
      intervalKm: s.intervalKm,
      intervalMonths: s.intervalMonths,
      name: s.name,
      seasons: s.seasons,
    })),
    vehicle: {
      currentOdometerDisplay: exportJson.vehicle.currentOdometerDisplay,
      displayUnit: exportJson.vehicle.displayUnit,
      imagePath: vehicleImage && existsSync(vehicleImage) ? vehicleImage : null,
      make: exportJson.vehicle.make,
      model: exportJson.vehicle.model,
      vin: exportJson.vehicle.vin,
      year: exportJson.vehicle.year,
    },
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vehicle-export-'))
  const jsonPath = path.join(tmpDir, 'vehicle.json')
  const pdfPath = path.join(tmpDir, 'history.pdf')
  const zipPath = path.join(tmpDir, 'export.zip')

  await Bun.write(jsonPath, JSON.stringify(exportJson, null, 2))
  await writeHistoryPdf(pdfPath, pdfData)

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', () => resolve())
    archive.on('error', reject)
    archive.pipe(output)
    archive.file(jsonPath, { name: 'vehicle.json' })
    archive.file(pdfPath, { name: 'history.pdf' })

    if (vehicleImage && existsSync(vehicleImage)) {
      archive.file(vehicleImage, { name: `vehicle-image.${vehicle.imageExt}` })
    }

    for (const a of exportAttachments) {
      if (existsSync(a.filePath)) {
        archive.file(a.filePath, { name: a.relativePath })
      }
    }

    void archive.finalize()
  })

  const buffer = readFileSync(zipPath)
  await rm(tmpDir, { force: true, recursive: true })
  return buffer
}

async function writeHistoryPdf(pdfPath: string, data: HistoryPdfData): Promise<void> {
  const scheduleNameById = new Map(data.schedules.map(s => [s.id, s.name]))
  const attachmentsByLogId = new Map<string, ExportAttachment[]>()
  for (const attachment of data.attachments) {
    const list = attachmentsByLogId.get(attachment.serviceLogId) ?? []
    list.push(attachment)
    attachmentsByLogId.set(attachment.serviceLogId, list)
  }

  const vehicleImageBuffer = data.vehicle.imagePath
    ? await jpegBufferForPdf(data.vehicle.imagePath, VEHICLE_IMAGE_MAX_WIDTH)
    : null

  const attachmentImageBuffers = new Map<string, Buffer>()
  for (const attachment of data.attachments) {
    if (!isImageContentType(attachment.contentType) || !existsSync(attachment.filePath)) continue
    const buffer = await jpegBufferForPdf(attachment.filePath, APPENDIX_IMAGE_MAX_WIDTH)
    if (buffer) attachmentImageBuffers.set(attachment.id, buffer)
  }

  const sorted = [...data.logs].sort((a, b) => {
    if (b.odometerDisplay !== a.odometerDisplay) return b.odometerDisplay - a.odometerDisplay
    return b.performedOn.localeCompare(a.performedOn)
  })
  const appendixEntries = sorted.flatMap(log => {
    const scheduleName = log.scheduleId ? scheduleNameById.get(log.scheduleId) : undefined
    return (attachmentsByLogId.get(log.id) ?? [])
      .filter(a => attachmentImageBuffers.has(a.id))
      .map(attachment => ({ attachment, log, scheduleName }))
  })

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 })
    const stream = createWriteStream(pdfPath)
    doc.pipe(stream)
    stream.on('finish', () => resolve())
    stream.on('error', reject)

    doc
      .fontSize(20)
      .text(`${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}`)
    if (data.vehicle.vin) {
      doc.fontSize(12).text(`VIN ${data.vehicle.vin}`)
    }
    doc
      .fontSize(12)
      .text(
        `${Math.round(data.vehicle.currentOdometerDisplay).toLocaleString()} ${data.vehicle.displayUnit}`
      )

    if (vehicleImageBuffer) {
      doc.moveDown(0.5)
      ensureSpace(doc, 200)
      doc.image(vehicleImageBuffer, {
        fit: [VEHICLE_IMAGE_MAX_WIDTH, 200],
      })
      doc.moveDown(0.5)
    } else {
      doc.moveDown()
    }

    doc.fontSize(16).fillColor('#000').text('Schedules')
    doc.moveDown(0.5)
    for (const s of data.schedules) {
      const bits = [
        s.activePeriod,
        s.seasons?.join('+') ?? null,
        s.frequencyMode,
        s.intervalKm != null ? `${s.intervalKm} km` : null,
        s.intervalMonths != null ? `${s.intervalMonths} mo` : null,
      ].filter(Boolean)
      doc.fontSize(11).text(`${s.name} — ${bits.join(', ')}`)
      doc.moveDown(0.5)
    }

    doc.moveDown(0.5)
    doc.fontSize(16).text('Service & repair history')
    doc.moveDown(0.5)

    for (const log of sorted) {
      const who = log.performedBy === 'self' ? 'Self' : log.shopName || 'Shop'
      const cost = log.costUsdCents != null ? formatUsd(log.costUsdCents) : '—'
      const scheduleName = log.scheduleId ? scheduleNameById.get(log.scheduleId) : undefined
      ensureSpace(doc, 60)
      doc
        .fontSize(11)
        .fillColor('#000')
        .text(
          `${formatDate(log.performedOn)}  [${log.kind}]  ${Math.round(log.odometerDisplay).toLocaleString()} ${log.odometerUnit}  ${who}  ${cost}`
        )
      if (scheduleName) {
        doc.fontSize(10).text(scheduleName)
      }
      if (log.notes) {
        doc.fontSize(10).fillColor('#444').text(log.notes).fillColor('#000')
      }

      const logAttachments = attachmentsByLogId.get(log.id) ?? []
      for (const attachment of logAttachments) {
        if (attachmentImageBuffers.has(attachment.id)) {
          doc
            .fontSize(9)
            .fillColor(LINK_COLOR)
            .text(attachment.originalFilename, {
              goTo: photoDestination(attachment.id),
              underline: true,
            })
            .fillColor('#000')
        } else {
          doc
            .fontSize(9)
            .fillColor('#666')
            .text(`Attachment: ${attachment.originalFilename}`)
            .fillColor('#000')
        }
      }

      doc.moveDown(0.8)
    }

    if (appendixEntries.length > 0) {
      doc.addPage()
      doc.fontSize(16).fillColor('#000').text('Appendix: Photos')
      doc.moveDown(0.75)

      for (const { attachment, log, scheduleName } of appendixEntries) {
        const imageBuffer = attachmentImageBuffers.get(attachment.id)
        if (!imageBuffer) continue

        ensureSpace(doc, APPENDIX_IMAGE_MAX_HEIGHT + 48)
        const captionBits = [
          formatDate(log.performedOn),
          scheduleName,
          `[${log.kind}]`,
        ].filter(Boolean)
        doc
          .fontSize(11)
          .fillColor('#000')
          .text(attachment.originalFilename, {
            destination: photoDestination(attachment.id),
          })
        doc.fontSize(9).fillColor('#666').text(captionBits.join(' · ')).fillColor('#000')
        doc.moveDown(0.25)
        doc.image(imageBuffer, {
          fit: [APPENDIX_IMAGE_MAX_WIDTH, APPENDIX_IMAGE_MAX_HEIGHT],
        })
        doc.moveDown(0.75)
      }
    }

    doc.end()
  })
}

function isImageContentType(contentType: string): boolean {
  return contentType.startsWith('image/')
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  const bottom = doc.page.height - doc.page.margins.bottom
  if (doc.y + needed > bottom) doc.addPage()
}

async function jpegBufferForPdf(filePath: string, maxWidth: number): Promise<Buffer | null> {
  try {
    return await sharp(filePath)
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()
  } catch {
    return null
  }
}
