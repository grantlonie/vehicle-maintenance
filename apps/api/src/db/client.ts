import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { mkdirSync } from 'fs'
import path from 'path'
import * as schema from './schema'

const workspaceData = path.resolve(import.meta.dir, '../../../data')
const dataRoot = process.env.DATA_ROOT
  ? path.isAbsolute(process.env.DATA_ROOT)
    ? process.env.DATA_ROOT
    : path.resolve(process.cwd(), process.env.DATA_ROOT)
  : workspaceData

mkdirSync(dataRoot, { recursive: true })
mkdirSync(path.join(dataRoot, 'attachments'), { recursive: true })
mkdirSync(path.join(dataRoot, 'vehicles'), { recursive: true })

const dbPath = path.join(dataRoot, 'app.db')
const sqlite = new Database(dbPath, { create: true })
sqlite.exec('PRAGMA foreign_keys = ON;')

export const db = drizzle(sqlite, { schema })
export { dataRoot, sqlite }

export function migrate() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      default_display_unit TEXT NOT NULL DEFAULT 'km'
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      year INTEGER NOT NULL,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      vin TEXT,
      image_id TEXT,
      image_ext TEXT,
      image_content_type TEXT,
      current_odometer_km REAL NOT NULL,
      display_unit TEXT NOT NULL DEFAULT 'km',
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS odometer_readings (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      odometer_km REAL NOT NULL,
      recorded_on TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_schedules (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      active_period TEXT NOT NULL,
      season TEXT,
      active_months_json TEXT,
      frequency_mode TEXT NOT NULL,
      interval_km REAL,
      interval_months INTEGER,
      warn_km REAL,
      warn_days INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_logs (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      schedule_id TEXT REFERENCES service_schedules(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      performed_on TEXT NOT NULL,
      odometer_km REAL NOT NULL,
      performed_by TEXT NOT NULL,
      shop_name TEXT,
      cost_usd_cents INTEGER,
      cost_entered_currency TEXT,
      cost_entered_cents INTEGER,
      fx_rate_to_usd REAL,
      fx_fetched_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      service_log_id TEXT NOT NULL REFERENCES service_logs(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      ext TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_template_items (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES schedule_templates(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      active_period TEXT NOT NULL,
      season TEXT,
      active_months_json TEXT,
      frequency_mode TEXT NOT NULL,
      interval_km REAL,
      interval_months INTEGER,
      warn_km REAL,
      warn_days INTEGER
    );
  `)

  const row = sqlite.query('SELECT COUNT(*) as c FROM settings').get() as { c: number }
  if (row.c === 0) {
    const unit = process.env.DEFAULT_DISPLAY_UNIT === 'mi' ? 'mi' : 'km'
    sqlite.run('INSERT INTO settings (default_display_unit) VALUES (?)', [unit])
  }
}
