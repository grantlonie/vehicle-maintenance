import {
  convertCadCentsToUsdCents,
  copySchedulesSchema,
  logInputSchema,
  scheduleInputSchema,
  settingsSchema,
  toKm,
  vehicleCreateSchema,
  vehicleUpdateSchema,
  odometerReadingSchema,
  type DisplayUnit,
  type ScheduleInput,
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
  odometerReadings,
  serviceLogs,
  serviceSchedules,
  settings,
  vehicles,
} from './db/schema'
import { getDueSummary } from './dueService'
import { buildVehicleExportZip } from './export'
import { getCadToUsdRate } from './fx'
import { sendDigestIfNeeded, startNotifyScheduler } from './notify'
import {
  attachmentPath,
  extensionFromFilename,
  newId,
  nowIso,
  parseSeasons,
  todayIso,
  vehicleImagePath,
} from './util'

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
  return c.json({ defaultDisplayUnit: row?.defaultDisplayUnit ?? 'km' })
})

app.put('/api/settings', async c => {
  const body = settingsSchema.parse(await c.req.json())
  const row = await db.query.settings.findFirst()
  if (row) {
    await db
      .update(settings)
      .set({ defaultDisplayUnit: body.defaultDisplayUnit })
      .where(eq(settings.id, row.id))
  }
  await db.update(vehicles).set({ displayUnit: body.defaultDisplayUnit, updatedAt: nowIso() })
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
  const settingsRow = await db.query.settings.findFirst()
  const id = newId()
  const now = nowIso()
  const odometerKm = toKm(body.odometer, body.odometerUnit)
  await db.insert(vehicles).values({
    createdAt: now,
    currentOdometerKm: odometerKm,
    displayUnit: body.displayUnit ?? settingsRow?.defaultDisplayUnit ?? 'km',
    id,
    make: body.make,
    model: body.model,
    name: body.name,
    updatedAt: now,
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
      displayUnit: body.displayUnit ?? existing.displayUnit,
      make: body.make ?? existing.make,
      model: body.model ?? existing.model,
      name: body.name ?? existing.name,
      updatedAt: nowIso(),
      vin: body.vin === undefined ? existing.vin : body.vin,
      year: body.year ?? existing.year,
    })
    .where(eq(vehicles.id, id))
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
  return c.json(serializeVehicle(vehicle!))
})

app.post('/api/vehicles/:id/archive', async c => {
  const id = c.req.param('id')
  await db
    .update(vehicles)
    .set({ archivedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(vehicles.id, id))
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

app.get('/api/vehicles/:id/logs', async c => {
  const kind = c.req.query('kind')
  const rows = await db
    .select()
    .from(serviceLogs)
    .where(eq(serviceLogs.vehicleId, c.req.param('id')))
    .orderBy(desc(serviceLogs.performedOn), desc(serviceLogs.createdAt))
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

function serializeVehicle(v: typeof vehicles.$inferSelect) {
  return {
    archivedAt: v.archivedAt,
    createdAt: v.createdAt,
    currentOdometerKm: v.currentOdometerKm,
    displayUnit: v.displayUnit as DisplayUnit,
    hasImage: Boolean(v.imageId),
    id: v.id,
    imageUrl: v.imageId ? `/api/vehicles/${v.id}/image` : null,
    make: v.make,
    model: v.model,
    name: v.name,
    updatedAt: v.updatedAt,
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
