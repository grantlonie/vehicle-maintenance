import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const settings = sqliteTable('settings', {
  defaultDisplayUnit: text('default_display_unit').notNull().default('km'),
  id: integer('id').primaryKey({ autoIncrement: true }),
})

export const vehicles = sqliteTable('vehicles', {
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
  currentOdometerKm: real('current_odometer_km').notNull(),
  displayUnit: text('display_unit').notNull().default('km'),
  id: text('id').primaryKey(),
  imageContentType: text('image_content_type'),
  imageExt: text('image_ext'),
  imageId: text('image_id'),
  make: text('make').notNull(),
  model: text('model').notNull(),
  name: text('name').notNull(),
  updatedAt: text('updated_at').notNull(),
  vin: text('vin'),
  year: integer('year').notNull(),
})

export const odometerReadings = sqliteTable('odometer_readings', {
  createdAt: text('created_at').notNull(),
  id: text('id').primaryKey(),
  odometerKm: real('odometer_km').notNull(),
  recordedOn: text('recorded_on').notNull(),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
})

export const serviceSchedules = sqliteTable('service_schedules', {
  activePeriod: text('active_period').notNull(),
  createdAt: text('created_at').notNull(),
  frequencyMode: text('frequency_mode').notNull(),
  id: text('id').primaryKey(),
  intervalKm: real('interval_km'),
  intervalMonths: integer('interval_months'),
  name: text('name').notNull(),
  notes: text('notes'),
  seasonsJson: text('seasons_json'),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
})

export const serviceLogs = sqliteTable('service_logs', {
  costEnteredCents: integer('cost_entered_cents'),
  costEnteredCurrency: text('cost_entered_currency'),
  costUsdCents: integer('cost_usd_cents'),
  createdAt: text('created_at').notNull(),
  fxFetchedAt: text('fx_fetched_at'),
  fxRateToUsd: real('fx_rate_to_usd'),
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  notes: text('notes'),
  odometerKm: real('odometer_km').notNull(),
  performedBy: text('performed_by').notNull(),
  performedOn: text('performed_on').notNull(),
  scheduleId: text('schedule_id').references(() => serviceSchedules.id, {
    onDelete: 'set null',
  }),
  shopName: text('shop_name'),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
})

export const attachments = sqliteTable('attachments', {
  contentType: text('content_type').notNull(),
  createdAt: text('created_at').notNull(),
  ext: text('ext').notNull(),
  id: text('id').primaryKey(),
  originalFilename: text('original_filename').notNull(),
  serviceLogId: text('service_log_id')
    .notNull()
    .references(() => serviceLogs.id, { onDelete: 'cascade' }),
  sizeBytes: integer('size_bytes').notNull(),
})

export const scheduleTemplates = sqliteTable('schedule_templates', {
  createdAt: text('created_at').notNull(),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
})

export const scheduleTemplateItems = sqliteTable('schedule_template_items', {
  activePeriod: text('active_period').notNull(),
  frequencyMode: text('frequency_mode').notNull(),
  id: text('id').primaryKey(),
  intervalKm: real('interval_km'),
  intervalMonths: integer('interval_months'),
  name: text('name').notNull(),
  notes: text('notes'),
  seasonsJson: text('seasons_json'),
  templateId: text('template_id')
    .notNull()
    .references(() => scheduleTemplates.id, { onDelete: 'cascade' }),
})
