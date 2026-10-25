import {
  convertCadCentsToUsdCents,
  toKm,
  type ImportLog,
  type ScheduleInput,
} from '@vehicles/shared'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { db } from './db/client'
import { odometerReadings, serviceLogs, serviceSchedules, vehicleDocuments } from './db/schema'
import { getCadToUsdRate } from './fx'
import { documentPath, extensionFromFilename, newId, nowIso } from './util'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface StoredDocument {
  contentType: string
  ext: string
  id: string
  originalFilename: string
  sizeBytes: number
}

export interface FxRate {
  fetchedAt: string
  rate: number
}

export async function writeDocumentFiles(files: File[]): Promise<StoredDocument[]> {
  const stored: StoredDocument[] = []
  try {
    for (const file of files) {
      const id = newId()
      const ext = extensionFromFilename(file.name, file.type)
      await Bun.write(documentPath(id, ext), file)
      stored.push({
        contentType: file.type || 'application/octet-stream',
        ext,
        id,
        originalFilename: file.name,
        sizeBytes: file.size,
      })
    }
  } catch (err) {
    await removeDocumentFiles(stored)
    throw err
  }
  return stored
}

export async function removeDocumentFiles(documents: Array<{ ext: string; id: string }>) {
  for (const doc of documents) {
    const file = documentPath(doc.id, doc.ext)
    if (existsSync(file)) await unlink(file)
  }
}

export async function fxForLogs(logs: ImportLog[]): Promise<FxRate | null> {
  if (!logs.some(log => log.costEnteredCurrency === 'CAD' && log.costEnteredCents != null)) {
    return null
  }
  return getCadToUsdRate()
}

export function insertSchedules(
  tx: Tx,
  vehicleId: string,
  schedules: Array<{ key: string; schedule: ScheduleInput }>
): Map<string, string> {
  const idByKey = new Map<string, string>()
  for (const { key, schedule } of schedules) {
    const id = newId()
    tx.insert(serviceSchedules)
      .values({
        activePeriod: schedule.activePeriod,
        createdAt: nowIso(),
        frequencyMode: schedule.frequencyMode,
        id,
        intervalKm: schedule.intervalKm ?? null,
        intervalMonths: schedule.intervalMonths ?? null,
        name: schedule.name,
        notes: schedule.notes ?? null,
        seasonsJson: schedule.seasons ? JSON.stringify(schedule.seasons) : null,
        vehicleId,
      })
      .run()
    idByKey.set(key, id)
  }
  return idByKey
}

/** Also records an odometer reading when an imported log exceeds `currentOdometerKm`. */
export function insertImportedHistory(
  tx: Tx,
  options: {
    currentOdometerKm: number
    documents: StoredDocument[]
    fx: FxRate | null
    logs: ImportLog[]
    scheduleIdByKey: Map<string, string>
    vehicleId: string
  }
): { createdLogIds: string[]; documentIds: string[] } {
  const now = nowIso()
  for (const doc of options.documents) {
    tx.insert(vehicleDocuments)
      .values({ ...doc, createdAt: now, vehicleId: options.vehicleId })
      .run()
  }

  const createdLogIds: string[] = []
  let highest: { odometerKm: number; recordedOn: string } | null = null
  for (const log of options.logs) {
    const odometerKm = toKm(log.odometer, log.odometerUnit)
    const isCad = log.costEnteredCurrency === 'CAD' && log.costEnteredCents != null
    const costUsdCents =
      log.costEnteredCents == null
        ? null
        : isCad
          ? convertCadCentsToUsdCents(log.costEnteredCents, options.fx!.rate)
          : log.costEnteredCents
    const scheduleId =
      log.kind === 'service' && log.scheduleKey
        ? (options.scheduleIdByKey.get(log.scheduleKey) ?? null)
        : null
    const sourceDocumentId =
      log.documentIndex != null ? (options.documents[log.documentIndex]?.id ?? null) : null

    const id = newId()
    tx.insert(serviceLogs)
      .values({
        costEnteredCents: log.costEnteredCents,
        costEnteredCurrency: log.costEnteredCents != null ? log.costEnteredCurrency : null,
        costUsdCents,
        createdAt: now,
        fxFetchedAt: isCad ? options.fx!.fetchedAt : null,
        fxRateToUsd: isCad ? options.fx!.rate : null,
        id,
        kind: log.kind,
        notes: log.notes,
        odometerKm,
        performedBy: log.performedBy,
        performedOn: log.performedOn,
        scheduleId,
        shopName: log.performedBy === 'shop' ? log.shopName : null,
        sourceDocumentId,
        vehicleId: options.vehicleId,
      })
      .run()
    createdLogIds.push(id)

    if (odometerKm > options.currentOdometerKm && (!highest || odometerKm > highest.odometerKm)) {
      highest = { odometerKm, recordedOn: log.performedOn }
    }
  }

  if (highest) {
    tx.insert(odometerReadings)
      .values({
        createdAt: now,
        id: newId(),
        odometerKm: highest.odometerKm,
        recordedOn: highest.recordedOn,
        vehicleId: options.vehicleId,
      })
      .run()
  }

  return { createdLogIds, documentIds: options.documents.map(doc => doc.id) }
}

export function highestImportedOdometerKm(logs: ImportLog[]): number {
  return logs.reduce((max, log) => Math.max(max, toKm(log.odometer, log.odometerUnit)), 0)
}
