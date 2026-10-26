import {
  convertCadCentsToUsdCents,
  toKm,
  type BillOfSaleDetails,
  type BillOfSaleSide,
  type ImportLog,
  type ScheduleInput,
} from '@vehicles/shared'
import { and, eq } from 'drizzle-orm'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { db } from './db/client'
import {
  billOfSaleFiles,
  odometerReadings,
  serviceLogs,
  serviceSchedules,
  vehicleDocuments,
  vehicles,
} from './db/schema'
import { getCadToUsdRate } from './fx'
import { billOfSalePath, documentPath, extensionFromFilename, newId, nowIso } from './util'

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

export async function writeBillOfSaleFile(file: File): Promise<StoredDocument> {
  const id = newId()
  const ext = extensionFromFilename(file.name, file.type)
  await Bun.write(billOfSalePath(id, ext), file)
  return {
    contentType: file.type || 'application/octet-stream',
    ext,
    id,
    originalFilename: file.name,
    sizeBytes: file.size,
  }
}

export async function removeBillOfSaleFile(doc: { ext: string; id: string }) {
  const file = billOfSalePath(doc.id, doc.ext)
  if (existsSync(file)) await unlink(file)
}

export function insertBillOfSaleFile(
  tx: Tx | typeof db,
  vehicleId: string,
  side: BillOfSaleSide,
  stored: StoredDocument
) {
  tx.insert(billOfSaleFiles)
    .values({ ...stored, createdAt: nowIso(), side, vehicleId })
    .run()
}

export interface PurchaseBillOfSaleResult {
  attachedFile: boolean
  filledDate: boolean
  filledOdometer: boolean
}

/** Fills only purchase fields that are still empty; attaches the file when no purchase file exists. */
export async function applyPurchaseBillOfSale(
  vehicleId: string,
  details: BillOfSaleDetails,
  file: File
): Promise<PurchaseBillOfSaleResult | null> {
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) })
  if (!vehicle) return null
  const existingFile = await db.query.billOfSaleFiles.findFirst({
    where: and(eq(billOfSaleFiles.vehicleId, vehicleId), eq(billOfSaleFiles.side, 'purchase')),
  })

  const result: PurchaseBillOfSaleResult = {
    attachedFile: !existingFile,
    filledDate: !vehicle.purchasedOn && details.purchasedOn != null,
    filledOdometer: vehicle.purchaseOdometerKm == null && details.odometer != null,
  }
  const stored = result.attachedFile ? await writeBillOfSaleFile(file) : null
  try {
    db.transaction(tx => {
      if (result.filledDate || result.filledOdometer) {
        tx.update(vehicles)
          .set({
            ...(result.filledDate ? { purchasedOn: details.purchasedOn } : {}),
            ...(result.filledOdometer
              ? { purchaseOdometerKm: toKm(details.odometer!, details.odometerUnit) }
              : {}),
            updatedAt: nowIso(),
          })
          .where(eq(vehicles.id, vehicleId))
          .run()
      }
      if (stored) insertBillOfSaleFile(tx, vehicleId, 'purchase', stored)
    })
  } catch (err) {
    if (stored) await removeBillOfSaleFile(stored)
    throw err
  }
  return result
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
    /** Indexed by upload position; `null` slots were stored elsewhere (e.g. bill of sale). */
    documents: Array<StoredDocument | null>
    fx: FxRate | null
    logs: ImportLog[]
    scheduleIdByKey: Map<string, string>
    vehicleId: string
  }
): { createdLogIds: string[]; documentIds: string[] } {
  const now = nowIso()
  const documents = options.documents.filter(doc => doc != null)
  for (const doc of documents) {
    tx.insert(vehicleDocuments)
      .values({ ...doc, createdAt: now, vehicleId: options.vehicleId })
      .run()
  }

  const createdLogIds: string[] = []
  let highest: { odometerKm: number; recordedOn: string } | null = null
  for (const log of options.logs) {
    const odometerKm = log.odometer != null ? toKm(log.odometer, log.odometerUnit) : null
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

    if (
      odometerKm != null &&
      odometerKm > options.currentOdometerKm &&
      (!highest || odometerKm > highest.odometerKm)
    ) {
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

  return { createdLogIds, documentIds: documents.map(doc => doc.id) }
}

export function highestImportedOdometerKm(logs: ImportLog[]): number {
  return logs.reduce((max, log) => {
    if (log.odometer == null) return max
    return Math.max(max, toKm(log.odometer, log.odometerUnit))
  }, 0)
}
