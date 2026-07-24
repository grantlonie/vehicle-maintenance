import { desc, eq, isNull } from 'drizzle-orm'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import nodemailer from 'nodemailer'
import path from 'path'
import { dataRoot, db } from './db/client'
import { odometerReadings, vehicles } from './db/schema'
import { getDueSummary, type DueItem } from './dueService'
import { todayIso } from './util'

const ODOMETER_STALE_DAYS = 90
const DUE_WINDOW_DAYS = 7
const STATE_FILENAME = 'notify-state.json'
const HOUR_MS = 60 * 60 * 1000

interface NotifyState {
  lastSentOn: string
}

interface StaleOdometerItem {
  lastRecordedOn: string | null
  vehicleId: string
  vehicleName: string
}

interface NotificationDigest {
  dueItems: DueItem[]
  staleOdometer: StaleOdometerItem[]
}

interface SendDigestOptions {
  force?: boolean
}

export async function collectNotifications(today: Date = new Date()): Promise<NotificationDigest> {
  const todayDate = todayIsoFrom(today)
  const weekEnd = addDaysIso(todayDate, DUE_WINDOW_DAYS)
  const allDue = await getDueSummary()
  const dueItems = allDue.filter(item => shouldNotifyDueItem(item, todayDate, weekEnd))
  const staleOdometer = await collectStaleOdometer(todayDate)
  return { dueItems, staleOdometer }
}

export async function sendDigestIfNeeded(
  options: SendDigestOptions = {}
): Promise<{ reason: string; sent: boolean }> {
  const config = readSmtpConfig()
  if (!config) {
    return { reason: 'smtp_not_configured', sent: false }
  }

  if (!options.force) {
    if (new Date().getUTCHours() !== config.notifyHourUtc) {
      return { reason: 'wrong_hour', sent: false }
    }
    const state = await readNotifyState()
    if (state?.lastSentOn === todayIso()) {
      return { reason: 'already_sent_today', sent: false }
    }
  }

  const digest = await collectNotifications()
  if (digest.dueItems.length === 0 && digest.staleOdometer.length === 0) {
    return { reason: 'nothing_to_report', sent: false }
  }

  await sendDigestEmail(config, digest)
  await writeNotifyState({ lastSentOn: todayIso() })
  return { reason: 'sent', sent: true }
}

export function startNotifyScheduler(): void {
  const config = readSmtpConfig()
  if (!config) {
    console.log('notify: SMTP_USER/SMTP_PASS not set; email digest disabled')
    return
  }

  console.log(`notify: daily digest enabled (to ${config.to}, hour ${config.notifyHourUtc} UTC)`)
  void tickNotifyScheduler()
  setInterval(() => {
    void tickNotifyScheduler()
  }, HOUR_MS)
}

async function tickNotifyScheduler(): Promise<void> {
  try {
    const result = await sendDigestIfNeeded()
    if (result.sent) {
      console.log('notify: digest sent')
    }
  } catch (err) {
    console.error('notify: failed to send digest', err)
  }
}

function shouldNotifyDueItem(item: DueItem, today: string, weekEnd: string): boolean {
  if (item.status === 'overdue') return true
  if (item.status === 'soon') {
    if (item.dueDate) return item.dueDate <= weekEnd
    return true
  }
  if (item.dueDate && item.dueDate >= today && item.dueDate <= weekEnd) return true
  return false
}

async function collectStaleOdometer(today: string): Promise<StaleOdometerItem[]> {
  const cutoff = addDaysIso(today, -ODOMETER_STALE_DAYS)
  const activeVehicles = await db.select().from(vehicles).where(isNull(vehicles.archivedAt))
  const stale: StaleOdometerItem[] = []

  for (const vehicle of activeVehicles) {
    const latest = await db
      .select()
      .from(odometerReadings)
      .where(eq(odometerReadings.vehicleId, vehicle.id))
      .orderBy(desc(odometerReadings.recordedOn), desc(odometerReadings.createdAt))
      .limit(1)

    const lastRecordedOn = latest[0]?.recordedOn ?? null
    if (lastRecordedOn === null || lastRecordedOn < cutoff) {
      stale.push({
        lastRecordedOn,
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
      })
    }
  }

  return stale
}

interface SmtpConfig {
  notifyHourUtc: number
  pass: string
  to: string
  user: string
}

function readSmtpConfig(): SmtpConfig | null {
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS?.trim()
  if (!user || !pass) return null

  const to = process.env.NOTIFY_TO?.trim() || user
  const hourRaw = process.env.NOTIFY_HOUR_UTC
  const notifyHourUtc = hourRaw !== undefined && hourRaw !== '' ? Number(hourRaw) : 14
  if (!Number.isInteger(notifyHourUtc) || notifyHourUtc < 0 || notifyHourUtc > 23) {
    console.warn(`notify: invalid NOTIFY_HOUR_UTC=${hourRaw}; using 14`)
    return { notifyHourUtc: 14, pass, to, user }
  }

  return { notifyHourUtc, pass, to, user }
}

async function sendDigestEmail(config: SmtpConfig, digest: NotificationDigest): Promise<void> {
  const subject = buildSubject(digest)
  const text = buildTextBody(digest)
  const html = buildHtmlBody(digest)

  const transporter = nodemailer.createTransport({
    auth: { pass: config.pass, user: config.user },
    service: 'gmail',
  })

  await transporter.sendMail({
    from: config.user,
    html,
    subject,
    text,
    to: config.to,
  })
}

function buildSubject(digest: NotificationDigest): string {
  const parts: string[] = []
  if (digest.dueItems.length > 0) {
    parts.push(`${digest.dueItems.length} due soon`)
  }
  if (digest.staleOdometer.length > 0) {
    parts.push(`${digest.staleOdometer.length} odometer updates needed`)
  }
  return `Vehicles: ${parts.join(', ')}`
}

function buildTextBody(digest: NotificationDigest): string {
  const lines: string[] = []

  if (digest.dueItems.length > 0) {
    lines.push('Due / soon:')
    for (const item of digest.dueItems) {
      lines.push(`- ${item.vehicleName}: ${item.scheduleName} (${formatDueDetail(item)})`)
    }
    lines.push('')
  }

  if (digest.staleOdometer.length > 0) {
    lines.push('Odometer updates needed (no reading in 90+ days):')
    for (const item of digest.staleOdometer) {
      const last = item.lastRecordedOn ?? 'never'
      lines.push(`- ${item.vehicleName}: last reading ${last}`)
    }
  }

  return lines.join('\n').trim() + '\n'
}

function buildHtmlBody(digest: NotificationDigest): string {
  const sections: string[] = []

  if (digest.dueItems.length > 0) {
    const items = digest.dueItems
      .map(
        item =>
          `<li><strong>${escapeHtml(item.vehicleName)}</strong>: ${escapeHtml(item.scheduleName)} (${escapeHtml(formatDueDetail(item))})</li>`
      )
      .join('')
    sections.push(`<h2>Due / soon</h2><ul>${items}</ul>`)
  }

  if (digest.staleOdometer.length > 0) {
    const items = digest.staleOdometer
      .map(item => {
        const last = item.lastRecordedOn ?? 'never'
        return `<li><strong>${escapeHtml(item.vehicleName)}</strong>: last reading ${escapeHtml(last)}</li>`
      })
      .join('')
    sections.push(`<h2>Odometer updates needed</h2><p>No reading in 90+ days.</p><ul>${items}</ul>`)
  }

  return `<div>${sections.join('')}</div>`
}

function formatDueDetail(item: DueItem): string {
  const parts = [`status ${item.status}`]
  if (item.dueDate) parts.push(`due ${item.dueDate}`)
  if (item.dueOdometerKm !== null) {
    parts.push(`due at ${Math.round(item.dueOdometerKm)} km`)
  }
  return parts.join(', ')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function statePath(): string {
  return path.join(dataRoot, STATE_FILENAME)
}

async function readNotifyState(): Promise<NotifyState | null> {
  const file = statePath()
  if (!existsSync(file)) return null
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as NotifyState
    if (typeof parsed.lastSentOn !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

async function writeNotifyState(state: NotifyState): Promise<void> {
  await writeFile(statePath(), `${JSON.stringify(state)}\n`, 'utf8')
}

function todayIsoFrom(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
