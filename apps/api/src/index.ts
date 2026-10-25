import {
  convertCadCentsToUsdCents,
  copySchedulesSchema,
  documentImportSchema,
  findPossibleDuplicateLogs,
  intakePreviewRequestSchema,
  logInputSchema,
  billOfSaleDetailsSchema,
  billOfSaleSideSchema,
  scheduleInputSchema,
  sellVehicleSchema,
  settingsSchema,
  toKm,
  vehicleCreateSchema,
  vehicleIntakeSchema,
  vehicleOwnershipSchema,
  vehicleUpdateSchema,
  odometerReadingSchema,
  type BillOfSaleSide,
  type ImportLog,
  type IntakePreview,
  type ScheduleDraft,
  type ScheduleInput,
  type VehicleType,
} from '@vehicles/shared'
import { desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import path from 'path'
import { requireToken } from './auth'
import { dataRoot, db, migrate } from './db/client'
import {
  attachments,
  billOfSaleFiles,
  odometerReadings,
  serviceLogs,
  serviceSchedules,
  settings,
  vehicleDocuments,
  vehicles,
} from './db/schema'
import { getDueSummary } from './dueService'
import { buildVehicleExportZip } from './export'
import { fireworksApiKey, LlmError } from './fireworks'
import { getCadToUsdRate } from './fx'
import { extractHistoryFromFiles } from './historyImport'
import {
  applyPurchaseBillOfSale,
  fxForLogs,
  highestImportedOdometerKm,
  insertBillOfSaleFile,
  insertImportedHistory,
  insertSchedules,
  removeBillOfSaleFile,
  removeDocumentFiles,
  writeBillOfSaleFile,
  writeDocumentFiles,
  type FxRate,
} from './intakeService'
import { sendDigestIfNeeded, startNotifyScheduler } from './notify'
import { PdfExtractError } from './pdfExtract'
import { ocrReceiptFile } from './receiptOcr'
import { suggestSchedules } from './scheduleSuggest'
import {
  attachmentPath,
  billOfSalePath,
  documentPath,
  extensionFromFilename,
  getDisplayUnit,
  newId,
  nowIso,
  parseSeasons,
  todayIso,
  vehicleImagePath,
} from './util'
import { decodeVin } from './vinDecode'

const MAX_INTAKE_FILES = 10

migrate()

const app = new Hono()
app.use('/api/*', cors())
app.get('/api/health', c => c.json({ ok: true }))

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') return next()
  return requireToken(c, next)
})

app.get('/api/settings', async c => {
  const row = await db.query.settings.findFirst()
  return c.json({ displayUnit: await getDisplayUnit() })
})

app.put('/api/settings', async c => {
  const body = settingsSchema.parse(await c.req.json())
  const row = await db.query.settings.findFirst()
  if (row) {
    await db
      .update(settings)
      .set({ defaultDisplayUnit: body.displayUnit })
      .where(eq(settings.id, row.id))
  }
  return c.json(body)
})

app.get('/api/fx/cad-usd', async c => {
  try {
    const rate = await getCadToUsdRate()
    return c.json(rate)
  } catch (err) {
    return c.json({ error: String(err) }, 502)
  }
})

app.post('/api/notify/run', async c => {
  try {
    const result = await sendDigestIfNeeded({ force: true })
    return c.json(result)
  } catch (err) {
    return c.json({ error: String(err) }, 502)
  }
})

app.get('/api/due', async c => {
  const vehicleId = c.req.query('vehicleId')
  const items = await getDueSummary(vehicleId || undefined)
  return c.json({ items })
})

app.get('/api/vehicles', async c => {
  const archived = c.req.query('archived') === '1'
  const rows = await db
    .select()
    .from(vehicles)
    .where(archived ? isNotNull(vehicles.archivedAt) : isNull(vehicles.archivedAt))
    .orderBy(vehicles.name)
  return c.json({ vehicles: rows.map(serializeVehicle) })
})

app.post('/api/vehicles', async c => {
  const body = vehicleCreateSchema.parse(await c.req.json())
  const id = newId()
  const now = nowIso()
  const odometerKm = toKm(body.odometer, body.odometerUnit)
  await db.insert(vehicles).values({
    createdAt: now,
    currentOdometerKm: odometerKm,
    id,
    make: body.make,
    model: body.model,
    name: body.name,
    updatedAt: now,
    vehicleType: body.vehicleType ?? 'car',
    vin: body.vin ?? null,
    year: body.year,
  })
  await db.insert(odometerReadings).values({
    createdAt: now,
    id: newId(),
    odometerKm,
    recordedOn: todayIso(),
    vehicleId: id,
  })
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
  return c.json(serializeVehicle(vehicle!), 201)
})

app.post('/api/intake/preview', async c => {
  if (!fireworksApiKey()) {
    return c.json({ error: 'FIREWORKS_API_KEY is not configured' }, 503)
  }
  const form = await c.req.parseBody({ all: true })
  const parsed = intakePreviewRequestSchema.safeParse(jsonField(form.payload))
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400)
  const body = parsed.data
  const files = multipartFiles(form.files)
  if (files.length > MAX_INTAKE_FILES) {
    return c.json({ error: `Upload at most ${MAX_INTAKE_FILES} documents at a time` }, 400)
  }

  const vehicle = body.vehicleId
    ? await db.query.vehicles.findFirst({ where: eq(vehicles.id, body.vehicleId) })
    : null
  if (body.vehicleId && !vehicle) return c.json({ error: 'Vehicle not found' }, 404)

  let schedules: ScheduleDraft[] = []
  let scheduleError: string | null = null
  const vinDecode =
    body.suggestSchedules && body.vin ? await decodeVin(body.vin, { modelYear: body.year }) : null
  if (body.suggestSchedules) {
    if (!body.year || !body.make?.trim() || !body.model?.trim()) {
      return c.json({ error: 'Year, make, and model are required to suggest a schedule' }, 400)
    }
    try {
      schedules = await suggestSchedules({
        make: body.make.trim(),
        model: body.model.trim(),
        vehicleType: body.vehicleType ?? 'car',
        vinDecode,
        year: body.year,
      })
      if (schedules.length === 0) scheduleError = 'No schedule items were suggested'
    } catch (err) {
      scheduleError = err instanceof Error ? err.message : String(err)
    }
  }

  const matchVehicleId = vehicle?.id ?? body.copyFromVehicleId ?? null
  const scheduleContext = matchVehicleId
    ? (
        await db
          .select({ id: serviceSchedules.id, name: serviceSchedules.name })
          .from(serviceSchedules)
          .where(eq(serviceSchedules.vehicleId, matchVehicleId))
      ).map(row => ({ key: row.id, name: row.name }))
    : schedules.map(draft => ({ key: draft.key, name: draft.schedule.name }))
  const existingLogs = vehicle
    ? await db.select().from(serviceLogs).where(eq(serviceLogs.vehicleId, vehicle.id))
    : []

  try {
    const history = files.length
      ? await extractHistoryFromFiles(files, {
          defaultOdometer: (vehicle?.vehicleType ?? body.vehicleType) === 'towable' ? 0 : null,
          defaultUnit: await getDisplayUnit(),
          existingLogs,
          schedules: scheduleContext,
          today: todayIso(),
        })
      : { documents: [], history: [], skipped: [] }
    const preview: IntakePreview = { ...history, scheduleError, schedules, vinDecode }
    return c.json(preview)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})

app.post('/api/vehicles/intake', async c => {
  const form = await c.req.parseBody({ all: true })
  const parsed = vehicleIntakeSchema.safeParse(jsonField(form.payload))
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400)
  const body = parsed.data
  const files = multipartFiles(form.files)
  if (files.length > MAX_INTAKE_FILES) {
    return c.json({ error: `Upload at most ${MAX_INTAKE_FILES} documents at a time` }, 400)
  }

  const sourceSchedules = body.copyFromVehicleId
    ? await db
        .select()
        .from(serviceSchedules)
        .where(eq(serviceSchedules.vehicleId, body.copyFromVehicleId))
    : []
  if (body.copyFromVehicleId) {
    const source = await db.query.vehicles.findFirst({
      where: eq(vehicles.id, body.copyFromVehicleId),
    })
    if (!source) return c.json({ error: 'Source vehicle not found' }, 404)
  }

  const scheduleKeys = new Set([
    ...body.schedules.map(draft => draft.key),
    ...sourceSchedules.map(row => row.id),
  ])
  const invalid = validateImportLogs(body.logs, files.length, scheduleKeys)
  if (invalid) return c.json({ error: invalid }, 400)
  const billOfSale = body.billOfSale ?? null
  if (billOfSale) {
    if (billOfSale.documentIndex >= files.length) {
      return c.json({ error: 'billOfSale.documentIndex is out of range' }, 400)
    }
    if (body.logs.some(log => log.documentIndex === billOfSale.documentIndex)) {
      return c.json({ error: 'History cannot come from the bill of sale document' }, 400)
    }
  }

  let fx: FxRate | null
  try {
    fx = await fxForLogs(body.logs)
  } catch (err) {
    return c.json({ error: `Could not fetch CAD→USD rate: ${String(err)}` }, 502)
  }

  const historyFiles = files.filter((_, index) => index !== billOfSale?.documentIndex)
  const storedHistory = await writeDocumentFiles(historyFiles)
  const storedBillOfSale = billOfSale
    ? await writeBillOfSaleFile(files[billOfSale.documentIndex]!)
    : null
  let nextHistory = 0
  const stored = files.map((_, index) =>
    index === billOfSale?.documentIndex ? null : storedHistory[nextHistory++]!
  )
  const id = newId()
  const now = nowIso()
  const formOdometerKm = toKm(body.vehicle.odometer, body.vehicle.odometerUnit)
  try {
    db.transaction(tx => {
      tx.insert(vehicles)
        .values({
          createdAt: now,
          currentOdometerKm: Math.max(formOdometerKm, highestImportedOdometerKm(body.logs)),
          id,
          make: body.vehicle.make,
          model: body.vehicle.model,
          name: body.vehicle.name,
          purchaseOdometerKm:
            billOfSale?.odometer != null
              ? toKm(billOfSale.odometer, billOfSale.odometerUnit)
              : null,
          purchasedOn: billOfSale?.purchasedOn ?? null,
          updatedAt: now,
          vehicleType: body.vehicle.vehicleType ?? 'car',
          vin: body.vehicle.vin ?? null,
          year: body.vehicle.year,
        })
        .run()
      if (storedBillOfSale) insertBillOfSaleFile(tx, id, 'purchase', storedBillOfSale)
      tx.insert(odometerReadings)
        .values({
          createdAt: now,
          id: newId(),
          odometerKm: formOdometerKm,
          recordedOn: todayIso(),
          vehicleId: id,
        })
        .run()

      const scheduleIdByKey = insertSchedules(tx, id, [
        ...sourceSchedules.map(row => ({ key: row.id, schedule: scheduleInputFromRow(row) })),
        ...body.schedules,
      ])
      insertImportedHistory(tx, {
        currentOdometerKm: formOdometerKm,
        documents: stored,
        fx,
        logs: body.logs,
        scheduleIdByKey,
        vehicleId: id,
      })
    })
  } catch (err) {
    await removeDocumentFiles(storedHistory)
    if (storedBillOfSale) await removeBillOfSaleFile(storedBillOfSale)
    throw err
  }

  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
  return c.json(serializeVehicle(vehicle!), 201)
})

app.post('/api/vehicles/:id/documents/import', async c => {
  const vehicleId = c.req.param('id')
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) })
  if (!vehicle) return c.json({ error: 'Not found' }, 404)

  const form = await c.req.parseBody({ all: true })
  const parsed = documentImportSchema.safeParse(jsonField(form.payload))
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400)
  const body = parsed.data
  const files = multipartFiles(form.files)
  if (files.length > MAX_INTAKE_FILES) {
    return c.json({ error: `Upload at most ${MAX_INTAKE_FILES} documents at a time` }, 400)
  }

  const scheduleRows = await db
    .select({ id: serviceSchedules.id })
    .from(serviceSchedules)
    .where(eq(serviceSchedules.vehicleId, vehicleId))
  const scheduleIdByKey = new Map(scheduleRows.map(row => [row.id, row.id]))
  const invalid = validateImportLogs(body.logs, files.length, new Set(scheduleIdByKey.keys()))
  if (invalid) return c.json({ error: invalid }, 400)

  let fx: FxRate | null
  try {
    fx = await fxForLogs(body.logs)
  } catch (err) {
    return c.json({ error: `Could not fetch CAD→USD rate: ${String(err)}` }, 502)
  }

  const stored = await writeDocumentFiles(files)
  let result: ReturnType<typeof insertImportedHistory>
  try {
    result = db.transaction(tx => {
      const inserted = insertImportedHistory(tx, {
        currentOdometerKm: vehicle.currentOdometerKm,
        documents: stored,
        fx,
        logs: body.logs,
        scheduleIdByKey,
        vehicleId,
      })
      const highest = highestImportedOdometerKm(body.logs)
      if (highest > vehicle.currentOdometerKm) {
        tx.update(vehicles)
          .set({ currentOdometerKm: highest, updatedAt: nowIso() })
          .where(eq(vehicles.id, vehicleId))
          .run()
      }
      return inserted
    })
  } catch (err) {
    await removeDocumentFiles(stored)
    throw err
  }

  return c.json({ count: result.createdLogIds.length, documentIds: result.documentIds }, 201)
})

app.get('/api/vehicles/:id/documents', async c => {
  const rows = await db
    .select()
    .from(vehicleDocuments)
    .where(eq(vehicleDocuments.vehicleId, c.req.param('id')))
    .orderBy(desc(vehicleDocuments.createdAt))
  return c.json({ documents: rows.map(serializeDocument) })
})

app.get('/api/documents/:id', async c => {
  const row = await db.query.vehicleDocuments.findFirst({
    where: eq(vehicleDocuments.id, c.req.param('id')),
  })
  if (!row) return c.json({ error: 'Not found' }, 404)
  const file = documentPath(row.id, row.ext)
  if (!existsSync(file)) return c.json({ error: 'Not found' }, 404)
  return new Response(Bun.file(file), {
    headers: {
      'Content-Disposition': `inline; filename="${row.originalFilename}"`,
      'Content-Type': row.contentType,
    },
  })
})

app.delete('/api/documents/:id', async c => {
  const row = await db.query.vehicleDocuments.findFirst({
    where: eq(vehicleDocuments.id, c.req.param('id')),
  })
  if (!row) return c.json({ error: 'Not found' }, 404)
  await removeDocumentFiles([row])
  await db.delete(vehicleDocuments).where(eq(vehicleDocuments.id, row.id))
  return c.json({ ok: true })
})

app.get('/api/vehicles/:id', async c => {
  const vehicle = await db.query.vehicles.findFirst({
    where: eq(vehicles.id, c.req.param('id')),
  })
  if (!vehicle) return c.json({ error: 'Not found' }, 404)
  return c.json(serializeVehicle(vehicle))
})

app.patch('/api/vehicles/:id', async c => {
  const id = c.req.param('id')
  const body = vehicleUpdateSchema.parse(await c.req.json())
  const existing = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db
    .update(vehicles)
    .set({
      make: body.make ?? existing.make,
      model: body.model ?? existing.model,
      name: body.name ?? existing.name,
      updatedAt: nowIso(),
      vehicleType: body.vehicleType ?? existing.vehicleType,
      vin: body.vin === undefined ? existing.vin : body.vin,
      year: body.year ?? existing.year,
    })
    .where(eq(vehicles.id, id))
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
  return c.json(serializeVehicle(vehicle!))
})

app.post('/api/vehicles/:id/archive', async c => {
  const id = c.req.param('id')
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
  if (!vehicle) return c.json({ error: 'Not found' }, 404)
  const raw = await c.req.text()
  const sale = raw ? sellVehicleSchema.parse(JSON.parse(raw)) : null
  const now = nowIso()
  const soldOdometerKm =
    sale?.soldOdometer != null ? toKm(sale.soldOdometer, sale.odometerUnit) : null

  await db
    .update(vehicles)
    .set({
      archivedAt: now,
      ...(sale ? { soldOdometerKm, soldOn: sale.soldOn } : {}),
      ...(soldOdometerKm != null && soldOdometerKm > vehicle.currentOdometerKm
        ? { currentOdometerKm: soldOdometerKm }
        : {}),
      updatedAt: now,
    })
    .where(eq(vehicles.id, id))

  if (sale && soldOdometerKm != null && soldOdometerKm > vehicle.currentOdometerKm) {
    await db.insert(odometerReadings).values({
      createdAt: now,
      id: newId(),
      odometerKm: soldOdometerKm,
      recordedOn: sale.soldOn,
      vehicleId: id,
    })
  }
  return c.json({ ok: true })
})

app.put('/api/vehicles/:id/ownership', async c => {
  const id = c.req.param('id')
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
  if (!vehicle) return c.json({ error: 'Not found' }, 404)
  const body = vehicleOwnershipSchema.parse(await c.req.json())
  await db
    .update(vehicles)
    .set({
      purchaseOdometerKm:
        body.purchaseOdometer != null ? toKm(body.purchaseOdometer, body.odometerUnit) : null,
      purchasedOn: body.purchasedOn,
      soldOdometerKm: body.soldOdometer != null ? toKm(body.soldOdometer, body.odometerUnit) : null,
      soldOn: body.soldOn,
      updatedAt: nowIso(),
    })
    .where(eq(vehicles.id, id))
  const row = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
  return c.json(serializeVehicle(row!))
})

app.get('/api/vehicles/:id/bill-of-sale', async c => {
  const rows = await db
    .select()
    .from(billOfSaleFiles)
    .where(eq(billOfSaleFiles.vehicleId, c.req.param('id')))
  return c.json({ files: rows.map(serializeBillOfSaleFile) })
})

app.post('/api/vehicles/:id/bill-of-sale/:side', async c => {
  const vehicleId = c.req.param('id')
  const side = billOfSaleSideSchema.parse(c.req.param('side'))
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) })
  if (!vehicle) return c.json({ error: 'Not found' }, 404)

  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) return c.json({ error: 'file required' }, 400)

  const stored = await writeBillOfSaleFile(file)
  insertBillOfSaleFile(db, vehicleId, side, stored)
  const row = await db.query.billOfSaleFiles.findFirst({ where: eq(billOfSaleFiles.id, stored.id) })
  return c.json(serializeBillOfSaleFile(row!), 201)
})

app.post('/api/vehicles/:id/purchase-bill-of-sale', async c => {
  const form = await c.req.parseBody({ all: true })
  const parsed = billOfSaleDetailsSchema.safeParse(jsonField(form.payload))
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400)
  const [file] = multipartFiles(form.files)
  if (!file) return c.json({ error: 'file required' }, 400)

  const result = await applyPurchaseBillOfSale(c.req.param('id'), parsed.data, file)
  if (!result) return c.json({ error: 'Not found' }, 404)
  return c.json(result)
})

app.get('/api/bill-of-sale/:id', async c => {
  const row = await db.query.billOfSaleFiles.findFirst({
    where: eq(billOfSaleFiles.id, c.req.param('id')),
  })
  if (!row) return c.json({ error: 'Not found' }, 404)
  const file = billOfSalePath(row.id, row.ext)
  if (!existsSync(file)) return c.json({ error: 'Not found' }, 404)
  return new Response(Bun.file(file), {
    headers: {
      'Content-Disposition': `inline; filename="${row.originalFilename}"`,
      'Content-Type': row.contentType,
    },
  })
})

app.delete('/api/bill-of-sale/:id', async c => {
  const row = await db.query.billOfSaleFiles.findFirst({
    where: eq(billOfSaleFiles.id, c.req.param('id')),
  })
  if (!row) return c.json({ error: 'Not found' }, 404)
  const file = billOfSalePath(row.id, row.ext)
  if (existsSync(file)) await unlink(file)
  await db.delete(billOfSaleFiles).where(eq(billOfSaleFiles.id, row.id))
  return c.json({ ok: true })
})

app.post('/api/vehicles/:id/unarchive', async c => {
  const id = c.req.param('id')
  await db
    .update(vehicles)
    .set({ archivedAt: null, updatedAt: nowIso() })
    .where(eq(vehicles.id, id))
  return c.json({ ok: true })
})

app.post('/api/vehicles/:id/odometer', async c => {
  const id = c.req.param('id')
  const body = odometerReadingSchema.parse(await c.req.json())
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
  if (!vehicle) return c.json({ error: 'Not found' }, 404)
  const odometerKm = toKm(body.odometer, body.odometerUnit)
  const now = nowIso()
  await db.insert(odometerReadings).values({
    createdAt: now,
    id: newId(),
    odometerKm,
    recordedOn: body.recordedOn ?? todayIso(),
    vehicleId: id,
  })
  await db
    .update(vehicles)
    .set({ currentOdometerKm: odometerKm, updatedAt: now })
    .where(eq(vehicles.id, id))
  return c.json({ currentOdometerKm: odometerKm })
})

app.post('/api/vehicles/:id/image', async c => {
  const id = c.req.param('id')
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
  if (!vehicle) return c.json({ error: 'Not found' }, 404)

  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) return c.json({ error: 'file required' }, 400)

  if (vehicle.imageId && vehicle.imageExt) {
    const old = vehicleImagePath(vehicle.imageId, vehicle.imageExt)
    if (existsSync(old)) await unlink(old)
  }

  const imageId = newId()
  const ext = extensionFromFilename(file.name, file.type)
  const dest = vehicleImagePath(imageId, ext)
  await Bun.write(dest, file)
  await db
    .update(vehicles)
    .set({
      imageContentType: file.type || 'application/octet-stream',
      imageExt: ext,
      imageId,
      updatedAt: nowIso(),
    })
    .where(eq(vehicles.id, id))

  return c.json({ imageId, imageUrl: `/api/vehicles/${id}/image` })
})

app.delete('/api/vehicles/:id/image', async c => {
  const id = c.req.param('id')
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
  if (!vehicle) return c.json({ error: 'Not found' }, 404)
  if (vehicle.imageId && vehicle.imageExt) {
    const old = vehicleImagePath(vehicle.imageId, vehicle.imageExt)
    if (existsSync(old)) await unlink(old)
  }
  await db
    .update(vehicles)
    .set({ imageContentType: null, imageExt: null, imageId: null, updatedAt: nowIso() })
    .where(eq(vehicles.id, id))
  return c.json({ ok: true })
})

app.get('/api/vehicles/:id/image', async c => {
  const vehicle = await db.query.vehicles.findFirst({
    where: eq(vehicles.id, c.req.param('id')),
  })
  if (!vehicle?.imageId || !vehicle.imageExt) return c.json({ error: 'Not found' }, 404)
  const file = vehicleImagePath(vehicle.imageId, vehicle.imageExt)
  if (!existsSync(file)) return c.json({ error: 'Not found' }, 404)
  return new Response(Bun.file(file), {
    headers: {
      'Content-Type': vehicle.imageContentType || 'application/octet-stream',
    },
  })
})

app.get('/api/vehicles/:id/export', async c => {
  try {
    const buffer = await buildVehicleExportZip(c.req.param('id'))
    return new Response(buffer, {
      headers: {
        'Content-Disposition': 'attachment; filename="vehicle-export.zip"',
        'Content-Type': 'application/zip',
      },
    })
  } catch (err) {
    return c.json({ error: String(err) }, 404)
  }
})

app.get('/api/vehicles/:id/schedules', async c => {
  const rows = await db
    .select()
    .from(serviceSchedules)
    .where(eq(serviceSchedules.vehicleId, c.req.param('id')))
    .orderBy(serviceSchedules.name)
  return c.json({ schedules: rows.map(serializeSchedule) })
})

app.post('/api/vehicles/:id/schedules', async c => {
  const vehicleId = c.req.param('id')
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) })
  if (!vehicle) return c.json({ error: 'Not found' }, 404)
  const body = scheduleInputSchema.parse(await c.req.json())
  const id = newId()
  await db.insert(serviceSchedules).values(scheduleValues(id, vehicleId, body))
  const row = await db.query.serviceSchedules.findFirst({ where: eq(serviceSchedules.id, id) })
  return c.json(serializeSchedule(row!), 201)
})

app.patch('/api/schedules/:id', async c => {
  const id = c.req.param('id')
  const existing = await db.query.serviceSchedules.findFirst({
    where: eq(serviceSchedules.id, id),
  })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const body = scheduleInputSchema.parse(await c.req.json())
  await db
    .update(serviceSchedules)
    .set({
      activePeriod: body.activePeriod,
      frequencyMode: body.frequencyMode,
      intervalKm: body.intervalKm ?? null,
      intervalMonths: body.intervalMonths ?? null,
      name: body.name,
      notes: body.notes ?? null,
      seasonsJson: body.seasons ? JSON.stringify(body.seasons) : null,
    })
    .where(eq(serviceSchedules.id, id))
  const row = await db.query.serviceSchedules.findFirst({ where: eq(serviceSchedules.id, id) })
  return c.json(serializeSchedule(row!))
})

app.delete('/api/schedules/:id', async c => {
  await db.delete(serviceSchedules).where(eq(serviceSchedules.id, c.req.param('id')))
  return c.json({ ok: true })
})

app.post('/api/vehicles/:id/schedules/copy', async c => {
  const vehicleId = c.req.param('id')
  const body = copySchedulesSchema.parse(await c.req.json())
  if (body.sourceVehicleId === vehicleId) {
    return c.json({ error: 'Cannot copy schedules from the same vehicle' }, 400)
  }

  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) })
  if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404)

  const source = await db.query.vehicles.findFirst({
    where: eq(vehicles.id, body.sourceVehicleId),
  })
  if (!source) return c.json({ error: 'Source vehicle not found' }, 404)

  const items = await db
    .select()
    .from(serviceSchedules)
    .where(eq(serviceSchedules.vehicleId, body.sourceVehicleId))

  const created = []
  for (const item of items) {
    const id = newId()
    await db.insert(serviceSchedules).values({
      activePeriod: item.activePeriod,
      createdAt: nowIso(),
      frequencyMode: item.frequencyMode,
      id,
      intervalKm: item.intervalKm,
      intervalMonths: item.intervalMonths,
      name: item.name,
      notes: item.notes,
      seasonsJson: item.seasonsJson,
      vehicleId,
    })
    created.push(id)
  }
  return c.json({ created, count: created.length }, 201)
})

app.post('/api/logs/ocr', async c => {
  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) return c.json({ error: 'file required' }, 400)

  const odometerHintRaw = typeof form.odometerHint === 'string' ? Number(form.odometerHint) : NaN
  const odometerUnit =
    form.odometerUnit === 'km' || form.odometerUnit === 'mi' ? form.odometerUnit : null
  const today = typeof form.today === 'string' && form.today.trim() ? form.today.trim() : undefined
  const vehicleId = typeof form.vehicleId === 'string' ? form.vehicleId.trim() : ''

  let schedules: Array<{ id: string; name: string }> = []
  if (vehicleId) {
    const rows = await db
      .select({ id: serviceSchedules.id, name: serviceSchedules.name })
      .from(serviceSchedules)
      .where(eq(serviceSchedules.vehicleId, vehicleId))
    schedules = rows
  }

  try {
    const preview = await ocrReceiptFile(file, {
      odometerHint: Number.isFinite(odometerHintRaw) ? odometerHintRaw : null,
      odometerUnit,
      schedules,
      today,
    })
    return c.json(preview)
  } catch (err) {
    if (err instanceof LlmError) {
      const status = err.message.includes('not configured') ? 503 : 502
      return c.json({ error: err.message }, status)
    }
    if (err instanceof PdfExtractError) {
      return c.json({ error: err.message }, 400)
    }
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

app.get('/api/vehicles/:id/logs', async c => {
  const kind = c.req.query('kind')
  const rows = await db
    .select()
    .from(serviceLogs)
    .where(eq(serviceLogs.vehicleId, c.req.param('id')))
    .orderBy(
      desc(serviceLogs.odometerKm),
      desc(serviceLogs.performedOn),
      desc(serviceLogs.createdAt)
    )
  const filtered = kind ? rows.filter(r => r.kind === kind) : rows
  const withAttachments = []
  for (const log of filtered) {
    const files = await db.select().from(attachments).where(eq(attachments.serviceLogId, log.id))
    withAttachments.push({ ...serializeLog(log), attachments: files.map(serializeAttachment) })
  }
  return c.json({ logs: withAttachments })
})

app.post('/api/vehicles/:id/logs', async c => {
  const vehicleId = c.req.param('id')
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) })
  if (!vehicle) return c.json({ error: 'Not found' }, 404)
  const body = logInputSchema.parse(await c.req.json())
  const odometerKm = toKm(body.odometer, body.odometerUnit)

  if (!body.allowDuplicate) {
    const existingLogs = await db
      .select()
      .from(serviceLogs)
      .where(eq(serviceLogs.vehicleId, vehicleId))
    const matches = findPossibleDuplicateLogs(
      { kind: body.kind, odometerKm, performedOn: body.performedOn },
      existingLogs
    )
    if (matches.length > 0) {
      return c.json(
        {
          code: 'duplicate_log',
          error: 'Possible duplicate log entry',
          matches: matches.map(serializeLog),
        },
        409
      )
    }
  }

  let costUsdCents = body.costUsdCents ?? null
  if (body.costEnteredCurrency === 'CAD' && body.costEnteredCents != null && body.fxRateToUsd) {
    costUsdCents = convertCadCentsToUsdCents(body.costEnteredCents, body.fxRateToUsd)
  } else if (body.costEnteredCurrency === 'USD' && body.costEnteredCents != null) {
    costUsdCents = body.costEnteredCents
  }

  const id = newId()
  const now = nowIso()
  await db.insert(serviceLogs).values({
    costEnteredCents: body.costEnteredCents ?? null,
    costEnteredCurrency: body.costEnteredCurrency ?? null,
    costUsdCents,
    createdAt: now,
    fxFetchedAt: body.fxFetchedAt ?? null,
    fxRateToUsd: body.fxRateToUsd ?? null,
    id,
    kind: body.kind,
    notes: body.notes ?? null,
    odometerKm,
    performedBy: body.performedBy,
    performedOn: body.performedOn,
    scheduleId: body.scheduleId ?? null,
    shopName: body.performedBy === 'shop' ? (body.shopName ?? null) : null,
    vehicleId,
  })

  if (odometerKm > vehicle.currentOdometerKm) {
    await db
      .update(vehicles)
      .set({ currentOdometerKm: odometerKm, updatedAt: now })
      .where(eq(vehicles.id, vehicleId))
    await db.insert(odometerReadings).values({
      createdAt: now,
      id: newId(),
      odometerKm,
      recordedOn: body.performedOn,
      vehicleId,
    })
  }

  const log = await db.query.serviceLogs.findFirst({ where: eq(serviceLogs.id, id) })
  return c.json({ ...serializeLog(log!), attachments: [] }, 201)
})

app.patch('/api/logs/:id', async c => {
  const id = c.req.param('id')
  const existing = await db.query.serviceLogs.findFirst({ where: eq(serviceLogs.id, id) })
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = logInputSchema.parse(await c.req.json())
  const odometerKm = toKm(body.odometer, body.odometerUnit)

  let costUsdCents = body.costUsdCents ?? null
  if (body.costEnteredCurrency === 'CAD' && body.costEnteredCents != null && body.fxRateToUsd) {
    costUsdCents = convertCadCentsToUsdCents(body.costEnteredCents, body.fxRateToUsd)
  } else if (body.costEnteredCurrency === 'USD' && body.costEnteredCents != null) {
    costUsdCents = body.costEnteredCents
  } else if (body.costEnteredCents == null && body.costUsdCents == null) {
    costUsdCents = null
  }

  await db
    .update(serviceLogs)
    .set({
      costEnteredCents: body.costEnteredCents ?? null,
      costEnteredCurrency: body.costEnteredCurrency ?? null,
      costUsdCents,
      fxFetchedAt: body.fxFetchedAt ?? null,
      fxRateToUsd: body.fxRateToUsd ?? null,
      kind: body.kind,
      notes: body.notes ?? null,
      odometerKm,
      performedBy: body.performedBy,
      performedOn: body.performedOn,
      scheduleId: body.scheduleId ?? null,
      shopName: body.performedBy === 'shop' ? (body.shopName ?? null) : null,
    })
    .where(eq(serviceLogs.id, id))

  const vehicle = await db.query.vehicles.findFirst({
    where: eq(vehicles.id, existing.vehicleId),
  })
  if (vehicle && odometerKm > vehicle.currentOdometerKm) {
    await db
      .update(vehicles)
      .set({ currentOdometerKm: odometerKm, updatedAt: nowIso() })
      .where(eq(vehicles.id, vehicle.id))
  }

  const log = await db.query.serviceLogs.findFirst({ where: eq(serviceLogs.id, id) })
  const files = await db.select().from(attachments).where(eq(attachments.serviceLogId, id))
  return c.json({ ...serializeLog(log!), attachments: files.map(serializeAttachment) })
})

app.delete('/api/logs/:id', async c => {
  const id = c.req.param('id')
  const existing = await db.query.serviceLogs.findFirst({ where: eq(serviceLogs.id, id) })
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const files = await db.select().from(attachments).where(eq(attachments.serviceLogId, id))
  for (const file of files) {
    const path = attachmentPath(file.id, file.ext)
    if (existsSync(path)) await unlink(path)
  }
  await db.delete(serviceLogs).where(eq(serviceLogs.id, id))
  return c.json({ ok: true })
})

app.post('/api/logs/:id/attachments', async c => {
  const logId = c.req.param('id')
  const log = await db.query.serviceLogs.findFirst({ where: eq(serviceLogs.id, logId) })
  if (!log) return c.json({ error: 'Not found' }, 404)

  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) return c.json({ error: 'file required' }, 400)

  const id = newId()
  const ext = extensionFromFilename(file.name, file.type)
  await Bun.write(attachmentPath(id, ext), file)
  await db.insert(attachments).values({
    contentType: file.type || 'application/octet-stream',
    createdAt: nowIso(),
    ext,
    id,
    originalFilename: file.name,
    serviceLogId: logId,
    sizeBytes: file.size,
  })
  const row = await db.query.attachments.findFirst({ where: eq(attachments.id, id) })
  return c.json(serializeAttachment(row!), 201)
})

app.get('/api/attachments/:id', async c => {
  const row = await db.query.attachments.findFirst({
    where: eq(attachments.id, c.req.param('id')),
  })
  if (!row) return c.json({ error: 'Not found' }, 404)
  const file = attachmentPath(row.id, row.ext)
  if (!existsSync(file)) return c.json({ error: 'Not found' }, 404)
  return new Response(Bun.file(file), {
    headers: {
      'Content-Disposition': `inline; filename="${row.originalFilename}"`,
      'Content-Type': row.contentType,
    },
  })
})

app.delete('/api/attachments/:id', async c => {
  const row = await db.query.attachments.findFirst({
    where: eq(attachments.id, c.req.param('id')),
  })
  if (!row) return c.json({ error: 'Not found' }, 404)
  const file = attachmentPath(row.id, row.ext)
  if (existsSync(file)) await unlink(file)
  await db.delete(attachments).where(eq(attachments.id, row.id))
  return c.json({ ok: true })
})

function scheduleValues(id: string, vehicleId: string, body: ScheduleInput) {
  return {
    activePeriod: body.activePeriod,
    createdAt: nowIso(),
    frequencyMode: body.frequencyMode,
    id,
    intervalKm: body.intervalKm ?? null,
    intervalMonths: body.intervalMonths ?? null,
    name: body.name,
    notes: body.notes ?? null,
    seasonsJson: body.seasons ? JSON.stringify(body.seasons) : null,
    vehicleId,
  }
}

function jsonField(value: unknown): unknown {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function multipartFiles(value: unknown): File[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value]
  return list.filter((item): item is File => item instanceof File)
}

function validateImportLogs(
  logs: ImportLog[],
  fileCount: number,
  scheduleKeys: Set<string>
): string | null {
  for (const log of logs) {
    if (log.documentIndex != null && log.documentIndex >= fileCount) {
      return 'Log references a document that was not uploaded'
    }
    if (log.scheduleKey && !scheduleKeys.has(log.scheduleKey)) {
      return 'Log references an unknown schedule'
    }
    if (log.performedBy === 'shop' && !log.shopName?.trim()) {
      return 'shopName is required when performedBy is shop'
    }
  }
  return null
}

function scheduleInputFromRow(row: typeof serviceSchedules.$inferSelect): ScheduleInput {
  return {
    activePeriod: row.activePeriod as ScheduleInput['activePeriod'],
    frequencyMode: row.frequencyMode as ScheduleInput['frequencyMode'],
    intervalKm: row.intervalKm,
    intervalMonths: row.intervalMonths,
    name: row.name,
    notes: row.notes,
    seasons: parseSeasons(row.seasonsJson),
  }
}

function serializeDocument(d: typeof vehicleDocuments.$inferSelect) {
  return {
    contentType: d.contentType,
    createdAt: d.createdAt,
    id: d.id,
    originalFilename: d.originalFilename,
    sizeBytes: d.sizeBytes,
    url: `/api/documents/${d.id}`,
  }
}

function serializeVehicle(v: typeof vehicles.$inferSelect) {
  return {
    archivedAt: v.archivedAt,
    createdAt: v.createdAt,
    currentOdometerKm: v.currentOdometerKm,
    hasImage: Boolean(v.imageId),
    id: v.id,
    imageUrl: v.imageId ? `/api/vehicles/${v.id}/image` : null,
    make: v.make,
    model: v.model,
    name: v.name,
    purchaseOdometerKm: v.purchaseOdometerKm,
    purchasedOn: v.purchasedOn,
    soldOdometerKm: v.soldOdometerKm,
    soldOn: v.soldOn,
    updatedAt: v.updatedAt,
    vehicleType: v.vehicleType as VehicleType,
    vin: v.vin,
    year: v.year,
  }
}

function serializeSchedule(s: typeof serviceSchedules.$inferSelect) {
  return {
    activePeriod: s.activePeriod,
    createdAt: s.createdAt,
    frequencyMode: s.frequencyMode,
    id: s.id,
    intervalKm: s.intervalKm,
    intervalMonths: s.intervalMonths,
    name: s.name,
    notes: s.notes,
    seasons: parseSeasons(s.seasonsJson),
    vehicleId: s.vehicleId,
  }
}

function serializeLog(l: typeof serviceLogs.$inferSelect) {
  return {
    costEnteredCents: l.costEnteredCents,
    costEnteredCurrency: l.costEnteredCurrency,
    costUsdCents: l.costUsdCents,
    createdAt: l.createdAt,
    fxFetchedAt: l.fxFetchedAt,
    fxRateToUsd: l.fxRateToUsd,
    id: l.id,
    kind: l.kind,
    notes: l.notes,
    odometerKm: l.odometerKm,
    performedBy: l.performedBy,
    performedOn: l.performedOn,
    scheduleId: l.scheduleId,
    shopName: l.shopName,
    sourceDocumentId: l.sourceDocumentId,
    vehicleId: l.vehicleId,
  }
}

function serializeAttachment(a: typeof attachments.$inferSelect) {
  return {
    contentType: a.contentType,
    id: a.id,
    originalFilename: a.originalFilename,
    sizeBytes: a.sizeBytes,
    url: `/api/attachments/${a.id}`,
  }
}

function serializeBillOfSaleFile(f: typeof billOfSaleFiles.$inferSelect) {
  return {
    contentType: f.contentType,
    id: f.id,
    originalFilename: f.originalFilename,
    side: f.side as BillOfSaleSide,
    sizeBytes: f.sizeBytes,
    url: `/api/bill-of-sale/${f.id}`,
  }
}

const distDir = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : path.resolve(import.meta.dir, '../../web/dist')

if (existsSync(distDir)) {
  app.use('/*', serveStatic({ root: distDir }))
  app.get('*', async c => {
    const index = path.join(distDir, 'index.html')
    if (existsSync(index)) return c.html(await Bun.file(index).text())
    return c.text('Not found', 404)
  })
}

const port = Number(process.env.PORT || 3002)
console.log(`vehicles api listening on :${port} (data: ${dataRoot})`)
startNotifyScheduler()

export default {
  fetch: app.fetch,
  port,
}
