import {
  applyTemplateSchema,
  convertCadCentsToUsdCents,
  logInputSchema,
  scheduleInputSchema,
  settingsSchema,
  templateCreateSchema,
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
  scheduleTemplateItems,
  scheduleTemplates,
  serviceLogs,
  serviceSchedules,
  settings,
  vehicles,
} from './db/schema'
import { getDueSummary } from './dueService'
import { buildVehicleExportZip } from './export'
import { getCadToUsdRate } from './fx'
import {
  attachmentPath,
  extensionFromFilename,
  newId,
  nowIso,
  parseActiveMonths,
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
  await db.update(vehicles).set({ archivedAt: nowIso(), updatedAt: nowIso() }).where(eq(vehicles.id, id))
  return c.json({ ok: true })
})

app.post('/api/vehicles/:id/unarchive', async c => {
  const id = c.req.param('id')
  await db.update(vehicles).set({ archivedAt: null, updatedAt: nowIso() }).where(eq(vehicles.id, id))
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
      activeMonthsJson: body.activeMonths ? JSON.stringify(body.activeMonths) : null,
      activePeriod: body.activePeriod,
      frequencyMode: body.frequencyMode,
      intervalKm: body.intervalKm ?? null,
      intervalMonths: body.intervalMonths ?? null,
      name: body.name,
      season: body.season ?? null,
      warnDays: body.warnDays ?? null,
      warnKm: body.warnKm ?? null,
    })
    .where(eq(serviceSchedules.id, id))
  const row = await db.query.serviceSchedules.findFirst({ where: eq(serviceSchedules.id, id) })
  return c.json(serializeSchedule(row!))
})

app.delete('/api/schedules/:id', async c => {
  await db.delete(serviceSchedules).where(eq(serviceSchedules.id, c.req.param('id')))
  return c.json({ ok: true })
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
    shopName: body.performedBy === 'shop' ? body.shopName ?? null : null,
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

app.get('/api/templates', async c => {
  const templates = await db.select().from(scheduleTemplates).orderBy(scheduleTemplates.name)
  const result = []
  for (const t of templates) {
    const items = await db
      .select()
      .from(scheduleTemplateItems)
      .where(eq(scheduleTemplateItems.templateId, t.id))
    result.push({
      createdAt: t.createdAt,
      id: t.id,
      items: items.map(serializeTemplateItem),
      name: t.name,
    })
  }
  return c.json({ templates: result })
})

app.post('/api/templates', async c => {
  const body = templateCreateSchema.parse(await c.req.json())
  const id = newId()
  await db.insert(scheduleTemplates).values({
    createdAt: nowIso(),
    id,
    name: body.name,
  })
  for (const item of body.items) {
    await db.insert(scheduleTemplateItems).values({
      activeMonthsJson: item.activeMonths ? JSON.stringify(item.activeMonths) : null,
      activePeriod: item.activePeriod,
      frequencyMode: item.frequencyMode,
      id: newId(),
      intervalKm: item.intervalKm ?? null,
      intervalMonths: item.intervalMonths ?? null,
      name: item.name,
      season: item.season ?? null,
      templateId: id,
      warnDays: item.warnDays ?? null,
      warnKm: item.warnKm ?? null,
    })
  }
  return c.json({ id, name: body.name }, 201)
})

app.delete('/api/templates/:id', async c => {
  await db.delete(scheduleTemplates).where(eq(scheduleTemplates.id, c.req.param('id')))
  return c.json({ ok: true })
})

app.post('/api/templates/apply', async c => {
  const body = applyTemplateSchema.parse(await c.req.json())
  const template = await db.query.scheduleTemplates.findFirst({
    where: eq(scheduleTemplates.id, body.templateId),
  })
  if (!template) return c.json({ error: 'Template not found' }, 404)
  const vehicle = await db.query.vehicles.findFirst({
    where: eq(vehicles.id, body.vehicleId),
  })
  if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404)

  const items = await db
    .select()
    .from(scheduleTemplateItems)
    .where(eq(scheduleTemplateItems.templateId, body.templateId))

  const created = []
  for (const item of items) {
    const id = newId()
    await db.insert(serviceSchedules).values({
      activeMonthsJson: item.activeMonthsJson,
      activePeriod: item.activePeriod,
      createdAt: nowIso(),
      frequencyMode: item.frequencyMode,
      id,
      intervalKm: item.intervalKm,
      intervalMonths: item.intervalMonths,
      name: item.name,
      season: item.season,
      vehicleId: body.vehicleId,
      warnDays: item.warnDays,
      warnKm: item.warnKm,
    })
    created.push(id)
  }
  return c.json({ created }, 201)
})

function scheduleValues(id: string, vehicleId: string, body: ScheduleInput) {
  return {
    activeMonthsJson: body.activeMonths ? JSON.stringify(body.activeMonths) : null,
    activePeriod: body.activePeriod,
    createdAt: nowIso(),
    frequencyMode: body.frequencyMode,
    id,
    intervalKm: body.intervalKm ?? null,
    intervalMonths: body.intervalMonths ?? null,
    name: body.name,
    season: body.season ?? null,
    vehicleId,
    warnDays: body.warnDays ?? null,
    warnKm: body.warnKm ?? null,
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
    activeMonths: parseActiveMonths(s.activeMonthsJson),
    activePeriod: s.activePeriod,
    createdAt: s.createdAt,
    frequencyMode: s.frequencyMode,
    id: s.id,
    intervalKm: s.intervalKm,
    intervalMonths: s.intervalMonths,
    name: s.name,
    season: s.season,
    vehicleId: s.vehicleId,
    warnDays: s.warnDays,
    warnKm: s.warnKm,
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

function serializeTemplateItem(i: typeof scheduleTemplateItems.$inferSelect) {
  return {
    activeMonths: parseActiveMonths(i.activeMonthsJson),
    activePeriod: i.activePeriod,
    frequencyMode: i.frequencyMode,
    id: i.id,
    intervalKm: i.intervalKm,
    intervalMonths: i.intervalMonths,
    name: i.name,
    season: i.season,
    warnDays: i.warnDays,
    warnKm: i.warnKm,
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

export default {
  fetch: app.fetch,
  port,
}
