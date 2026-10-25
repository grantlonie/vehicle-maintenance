import {
  findPossibleDuplicateLogs,
  toKm,
  UNRECORDED_SHOP_NAME,
  type BillOfSaleDetails,
  type DisplayUnit,
  type HistoryDraft,
  type IntakeDocument,
} from '@vehicles/shared'
import { completeJson, extractJsonObject, LlmError, type LlmImage } from './fireworks'
import { extractPdfText, hasUsablePdfText, PdfExtractError, rasterizePdfPages } from './pdfExtract'
import {
  extensionOf,
  guessMime,
  IMAGE_TYPES,
  isImageExt,
  nullishCostCents,
  nullishDate,
  nullishEnum,
  nullishNumber,
  nullishString,
  prepareImage,
} from './receiptOcr'

export const MAX_SCANNED_PAGES = 8
const SCANNED_PAGES_PER_CALL = 4
const TEXT_CHUNK_CHARS = 12_000

export interface HistoryImportContext {
  defaultUnit: DisplayUnit
  /** Towables often have no odometer; their records default to 0 instead of needing manual entry. */
  defaultOdometer?: number | null
  existingLogs?: Array<{ kind: string; odometerKm: number; performedOn: string }>
  schedules: Array<{ key: string; name: string }>
  today: string
}

export interface HistoryImportResult {
  documents: IntakeDocument[]
  history: HistoryDraft[]
  skipped: HistoryDraft[]
}

const SYSTEM_PROMPT = `You extract a used vehicle's maintenance and repair history from documents such as a CARFAX / AutoCheck vehicle history report, inspection reports, dealer service histories, invoices, or owner maintenance logs.

A document can contain MANY visits. Return every visit as JSON only in this exact shape:
{
  "billOfSale": null | {
    "purchasedOn": "YYYY-MM-DD" | null,
    "odometer": number | null,
    "odometerUnit": "km" | "mi" | null
  },
  "events": [
    {
      "status": "performed" | "recommended",
      "performedOn": "YYYY-MM-DD" | null,
      "odometer": number | null,
      "odometerUnit": "km" | "mi" | null,
      "kind": "service" | "repair",
      "performedBy": "self" | "shop" | null,
      "shopName": string | null,
      "costEnteredCents": number | null,
      "costEnteredCurrency": "USD" | "CAD" | null,
      "notes": string,
      "scheduleKey": string | null
    }
  ]
}

## What counts
- status "performed": work that was actually done (oil changed, tires rotated, brakes replaced, inspection completed, recall performed).
- status "recommended": items the shop or inspector only RECOMMENDED, advised, quoted, declined, or flagged for later ("recommend alignment", "front pads at 3mm", "customer declined"). Never mark these performed.
- Ignore records that are not maintenance or repair: title / registration events, ownership changes, listings, auctions, odometer-only reports, emissions-only registration renewals without work, accident or damage reports without a repair.

## Fields
- Never invent or estimate dates, mileage, or costs. Use null when the document does not state them.
- performedOn: the date the work happened. CARFAX dates like 06/14/2021 are MM/DD/YYYY.
- odometer: the reported mileage for that visit, digits exactly as printed. odometerUnit "mi" for miles (US reports, CARFAX US), "km" for kilometres (Canadian reports, "km").
- kind "service" for routine maintenance and inspections, including RV and trailer upkeep (winterizing, de-winterizing, roof resealing, generator service, wheel bearing repacks, LP leak tests); "repair" for fixing a fault, replacing failed parts, collision repair, or recalls.
- performedBy "shop" when a dealer, shop, or inspection station did the work; "self" only when the record says the owner did it. shopName is the business name if printed, otherwise null.
- costEnteredCents: integer cents of the amount actually paid for that visit, only when printed.
- notes: short plain summary of the work (e.g. "Oil and filter changed; tires rotated").

## Schedule match
- When the user message lists schedules, set scheduleKey to the key of the schedule a performed SERVICE event satisfies. Match by meaning ("Oil and filter changed" satisfies "Change engine oil and filter").
- When one visit performed several items that match DIFFERENT schedules, emit one event per matched schedule (same date, odometer, shop), each with notes for that item. Put any remaining unmatched items from that visit in one more event with scheduleKey null. Put the visit's cost on only one of those events.
- Repairs and recommended items always have scheduleKey null. If nothing fits, null.

## Bill of sale
- Set billOfSale only when the document itself is a vehicle bill of sale, purchase agreement, sales contract, buyer's order, or odometer disclosure statement for a sale. Otherwise billOfSale is null.
- A history report (CARFAX, AutoCheck) that merely lists ownership changes is NOT a bill of sale.
- purchasedOn: the sale / delivery date. odometer: the odometer reading disclosed at sale, digits exactly as printed, with its unit.
- When billOfSale is set, events is [].

Output JSON only.`

export async function extractHistoryFromFiles(
  files: File[],
  context: HistoryImportContext
): Promise<HistoryImportResult> {
  const documents: IntakeDocument[] = []
  const rawEvents: Array<{ documentIndex: number; event: unknown }> = []

  const results = await Promise.all(
    files.map(async (file, index) => {
      try {
        return { ...(await extractFileEvents(file, context)), index }
      } catch (err) {
        return { billOfSale: null, error: errorMessage(err), events: [], index }
      }
    })
  )

  for (const result of results) {
    const billOfSale = toBillOfSale(result.billOfSale, context)
    documents.push({
      billOfSale,
      error: result.error ?? null,
      filename: files[result.index]!.name,
      index: result.index,
    })
    if (billOfSale) continue
    for (const event of result.events) rawEvents.push({ documentIndex: result.index, event })
  }

  return { documents, ...normalizeHistoryEvents(rawEvents, context) }
}

export function normalizeHistoryEvents(
  rawEvents: Array<{ documentIndex: number; event: unknown }>,
  context: HistoryImportContext
): { history: HistoryDraft[]; skipped: HistoryDraft[] } {
  const scheduleKeys = new Set(context.schedules.map(s => s.key))
  const merged = new Map<string, HistoryDraft>()

  for (const { documentIndex, event } of rawEvents) {
    const draft = toDraft(event, documentIndex, context, scheduleKeys)
    if (!draft) continue
    const key = dedupeKey(draft)
    const existing = merged.get(key)
    merged.set(key, existing ? mergeDrafts(existing, draft) : draft)
  }

  const history: HistoryDraft[] = []
  const skipped: HistoryDraft[] = []
  let counter = 0
  for (const draft of merged.values()) {
    const withKey = { ...draft, key: `history-${++counter}` }
    const odometerKm =
      withKey.odometer != null ? toKm(withKey.odometer, withKey.odometerUnit) : null
    if (withKey.performedOn && odometerKm != null && context.existingLogs?.length) {
      const matches = findPossibleDuplicateLogs(
        { kind: withKey.kind, odometerKm, performedOn: withKey.performedOn },
        context.existingLogs
      )
      withKey.possibleDuplicate = matches.length > 0
    }
    if (withKey.reason) skipped.push(withKey)
    else history.push(withKey)
  }

  return { history: sortByDate(history), skipped: sortByDate(skipped) }
}

interface ExtractedEvents {
  billOfSale: unknown
  events: unknown[]
}

async function extractFileEvents(
  file: File,
  context: HistoryImportContext
): Promise<ExtractedEvents> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentType = (file.type || guessMime(file.name)).toLowerCase()
  const ext = extensionOf(file.name)

  if (contentType === 'application/pdf' || ext === 'pdf') {
    return extractPdfEvents(bytes, context)
  }
  if (IMAGE_TYPES.has(contentType) || isImageExt(ext)) {
    const image = await prepareImage(bytes, contentType, ext)
    return requestEvents(context, 'The document is a photo or scan. Extract every visit.', [image])
  }
  throw new LlmError('Unsupported file type. Upload a PDF, JPEG, PNG, WebP, or HEIC document.')
}

async function extractPdfEvents(
  bytes: Uint8Array,
  context: HistoryImportContext
): Promise<ExtractedEvents> {
  let text = ''
  try {
    text = await extractPdfText(bytes.slice())
  } catch (err) {
    throw new PdfExtractError(`Could not read PDF: ${errorMessage(err)}`)
  }

  if (hasUsablePdfText(text)) {
    const chunks = chunkText(text, TEXT_CHUNK_CHARS)
    const results = await Promise.all(
      chunks.map((chunk, i) =>
        requestEvents(
          context,
          `Document text${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ''}:\n\n${chunk}`
        )
      )
    )
    return mergeExtracted(results)
  }

  const pages = await rasterizePdfPages(bytes.slice(), MAX_SCANNED_PAGES, 1.5)
  const batches: LlmImage[][] = []
  for (let i = 0; i < pages.length; i += SCANNED_PAGES_PER_CALL) {
    batches.push(pages.slice(i, i + SCANNED_PAGES_PER_CALL))
  }
  const results = await Promise.all(
    batches.map((batch, i) =>
      requestEvents(
        context,
        `These are scanned pages ${i * SCANNED_PAGES_PER_CALL + 1}-${
          i * SCANNED_PAGES_PER_CALL + batch.length
        } of the document. Extract every visit.`,
        batch
      )
    )
  )
  return mergeExtracted(results)
}

function mergeExtracted(results: ExtractedEvents[]): ExtractedEvents {
  return {
    billOfSale: results.find(result => result.billOfSale)?.billOfSale ?? null,
    events: results.flatMap(result => result.events),
  }
}

async function requestEvents(
  context: HistoryImportContext,
  message: string,
  images?: LlmImage[]
): Promise<ExtractedEvents> {
  const content = await completeJson({
    images,
    maxTokens: 8192,
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `${contextBlock(context)}${message}`,
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonObject(content))
  } catch (err) {
    if (err instanceof LlmError) throw err
    throw new LlmError('Model returned invalid JSON')
  }
  const { billOfSale, events } = (parsed ?? {}) as { billOfSale?: unknown; events?: unknown }
  return { billOfSale: billOfSale ?? null, events: Array.isArray(events) ? events : [] }
}

export function toBillOfSale(
  raw: unknown,
  context: HistoryImportContext
): BillOfSaleDetails | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const odometer = nullishNumber(value.odometer)
  const purchasedOn = nullishDate(value.purchasedOn)
  return {
    odometer: odometer != null && odometer >= 0 ? odometer : null,
    odometerUnit: nullishEnum(value.odometerUnit, ['km', 'mi'] as const) ?? context.defaultUnit,
    purchasedOn: purchasedOn && purchasedOn <= context.today ? purchasedOn : null,
  }
}

function contextBlock(context: HistoryImportContext): string {
  const lines = [`Today's date is ${context.today}.`]
  if (context.schedules.length > 0) {
    lines.push('Vehicle schedules (use the key in scheduleKey):')
    for (const schedule of context.schedules) lines.push(`- ${schedule.key}: ${schedule.name}`)
  }
  return `${lines.join('\n')}\n\n`
}

function toDraft(
  event: unknown,
  documentIndex: number,
  context: HistoryImportContext,
  scheduleKeys: Set<string>
): HistoryDraft | null {
  if (!event || typeof event !== 'object') return null
  const raw = event as Record<string, unknown>
  const notes = nullishString(raw.notes)?.trim() ?? ''
  const performedOn = nullishDate(raw.performedOn)
  const odometer = nullishNumber(raw.odometer)
  if (!notes && !performedOn && odometer == null) return null

  const kind = nullishEnum(raw.kind, ['service', 'repair'] as const) ?? 'service'
  const recommended =
    nullishEnum(raw.status, ['performed', 'recommended'] as const) === 'recommended'
  const shopNameRaw = nullishString(raw.shopName)?.trim() || null
  const performedBy = nullishEnum(raw.performedBy, ['self', 'shop'] as const) ?? 'shop'
  const scheduleKeyRaw = nullishString(raw.scheduleKey)
  const scheduleKey =
    kind === 'service' && !recommended && scheduleKeyRaw && scheduleKeys.has(scheduleKeyRaw)
      ? scheduleKeyRaw
      : null
  const cost = nullishCostCents(raw.costEnteredCents)

  let reason: string | null = null
  if (recommended) reason = 'Recommended, not performed'
  else if (!performedOn) reason = 'No date on the record'
  else if (performedOn > context.today) reason = 'Date is in the future'

  return {
    costEnteredCents: cost && cost > 0 ? cost : null,
    costEnteredCurrency:
      cost && cost > 0
        ? (nullishEnum(raw.costEnteredCurrency, ['USD', 'CAD'] as const) ?? 'USD')
        : null,
    documentIndex,
    key: '',
    kind,
    notes: notes || (kind === 'repair' ? 'Repair' : 'Service'),
    odometer: odometer != null && odometer > 0 ? odometer : (context.defaultOdometer ?? null),
    odometerUnit: nullishEnum(raw.odometerUnit, ['km', 'mi'] as const) ?? context.defaultUnit,
    performedBy,
    performedOn,
    possibleDuplicate: false,
    reason,
    scheduleKey,
    shopName: performedBy === 'shop' ? (shopNameRaw ?? UNRECORDED_SHOP_NAME) : null,
  }
}

function dedupeKey(draft: HistoryDraft): string {
  const odometerKm =
    draft.odometer != null ? Math.round(toKm(draft.odometer, draft.odometerUnit)) : ''
  const summary =
    draft.scheduleKey ??
    draft.notes
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  return [
    draft.performedOn ?? '',
    odometerKm,
    draft.kind,
    draft.reason ? 'skip' : 'keep',
    summary,
  ].join('|')
}

function mergeDrafts(a: HistoryDraft, b: HistoryDraft): HistoryDraft {
  const shopName =
    a.shopName && a.shopName !== UNRECORDED_SHOP_NAME ? a.shopName : (b.shopName ?? a.shopName)
  return {
    ...a,
    costEnteredCents: a.costEnteredCents ?? b.costEnteredCents,
    costEnteredCurrency: a.costEnteredCents != null ? a.costEnteredCurrency : b.costEnteredCurrency,
    notes: b.notes.length > a.notes.length ? b.notes : a.notes,
    shopName,
  }
}

function sortByDate(drafts: HistoryDraft[]): HistoryDraft[] {
  return [...drafts].sort((a, b) => (a.performedOn ?? '').localeCompare(b.performedOn ?? ''))
}

export function chunkText(text: string, size: number): string[] {
  if (text.length <= size) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + size, text.length)
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end)
      if (lastSpace > start + size / 2) end = lastSpace
    }
    chunks.push(text.slice(start, end).trim())
    start = end
  }
  return chunks.filter(Boolean)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
