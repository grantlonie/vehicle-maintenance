import {
  receiptOcrPreviewSchema,
  type ConfidenceLevel,
  type OdometerCandidate,
  type ReceiptFieldConfidence,
  type ReceiptOcrPreview,
} from '@vehicles/shared'
import sharp from 'sharp'
import { completeJson, extractJsonObject, LlmError } from './fireworks'
import {
  extractPdfText,
  hasUsablePdfText,
  PdfExtractError,
  rasterizePdfFirstPage,
} from './pdfExtract'

export interface ReceiptOcrContext {
  /** Vehicle current odometer in the given unit — used only for server-side ranking. */
  odometerHint?: number | null
  odometerUnit?: 'km' | 'mi' | null
  /** Vehicle service schedules to match against the receipt. */
  schedules?: Array<{ id: string; name: string }>
  /** ISO date YYYY-MM-DD for "today" when the receipt was scanned. */
  today?: string
}

const SYSTEM_PROMPT = `You extract vehicle maintenance receipt / invoice fields from an image or text.

Return JSON only in this exact shape:
{
  "kind": "service" | "repair" | null,
  "performedOn": "YYYY-MM-DD" | null,
  "odometerCandidates": [
    {"value": number, "unit": "km" | "mi" | null, "source": string, "rank": number}
  ],
  "odometer": number | null,
  "odometerUnit": "km" | "mi" | null,
  "performedBy": "self" | "shop" | null,
  "shopName": string | null,
  "costEnteredCents": number | null,
  "costEnteredCurrency": "USD" | "CAD" | null,
  "notes": string | null,
  "scheduleId": string | null,
  "confidence": {
    "kind": "high" | "medium" | "low",
    "performedOn": "high" | "medium" | "low",
    "odometer": "high" | "medium" | "low",
    "performedBy": "high" | "medium" | "low",
    "shopName": "high" | "medium" | "low",
    "cost": "high" | "medium" | "low",
    "notes": "high" | "medium" | "low",
    "schedule": "high" | "medium" | "low"
  }
}

## Odometer (HIGH PRIORITY)
- Find EVERY number that could be an odometer / mileage reading. List them all in odometerCandidates.
- Include: MILEAGE IN, MILEAGE OUT, MILEAGE IN/OUT, ODOMETER, KM, MILES, and mileage digits repeated in tech notes (e.g. "14136 Confirmed noise…").
- For each candidate set source to the exact label or context (e.g. "MILEAGE IN/OUT", "tech notes").
- Rank 1 = best. Ranking rules (highest first):
  1. Explicit MILEAGE IN / OUT or ODOMETER box values
  2. Same mileage repeated in tech notes matching that box
  3. Other labeled mileage fields
  4. Ambiguous numbers that merely look like mileage (lower rank)
- Do NOT include invoice #, phone, VIN fragments, labor rate, estimate $, RO codes, or hours as candidates.
- Set odometer + odometerUnit to the rank-1 candidate. If none, both null and odometerCandidates [].
- unit: "mi" only if label says miles/mi; Canadian dealers (AB, BC, ON, CAD, C$, Edmonton, etc.) → "km".
- Read digits character-by-character from the printed receipt only. NEVER invent or substitute a mileage from memory, prior knowledge, or any number supplied outside the image.

## Date (performedOn)
- Prefer INV DATE, Invoice Date, R.O. Opened, Ready, Date of Service.
- Prefer the most recent of those (today / this year / last year).
- NEVER use DEL DATE, production date, or old delivery stamps.
- Parse 30JUL26 / 30JUL24 as day+mon+yy.

## Cost (actual payment only)
- Use ONLY PLEASE PAY THIS AMOUNT / Amount Due / Balance Due / final Total Charges.
- NEVER use ESTIMATE.
- If pay amount is 0.00 or N/C / No Charge / complimentary-only → costEnteredCents null.
- costEnteredCents is integer cents ($123.45 → 12345).

## Kind
- "repair": diagnose/adjust/align/replace/fix complaint (hatch, latch, noise, etc.).
- "service": routine maintenance / inspection alone (oil change, tire rotation, filters, wash).
- If both repair work and a routine service appear, prefer "repair" unless the receipt is clearly a packaged service visit (oil package, maintenance package) with no complaint/repair — then "service".

## Schedule match
- When the user message lists vehicle schedules, set scheduleId to the UUID of the best matching schedule for the work done.
- Match by meaning, not exact wording (e.g. "Premium Synthetic Package / Oil change" → schedule named "Change oil").
- Only match when kind is "service". For "repair", scheduleId must be null.
- If no schedule fits well, scheduleId is null.
- confidence.schedule: high for a clear match, medium if plausible, low if null or ambiguous.

## Confidence
- high: clearly printed and unambiguous
- medium: readable but slightly uncertain
- low: guessy, conflicting, blurry, or missing (null fields → low)
- Set confidence for EVERY key listed above. No prose confidence notes.

## Shop / notes
- performedBy "shop" + shopName when a dealer is present.
- notes: short primary work summary.
- Use null for unknown fields. Output JSON only.`

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

const FIELD_KEYS = [
  'cost',
  'kind',
  'notes',
  'odometer',
  'performedBy',
  'performedOn',
  'schedule',
  'shopName',
] as const

export async function ocrReceiptFile(
  file: File,
  context: ReceiptOcrContext = {}
): Promise<ReceiptOcrPreview> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentType = (file.type || guessMime(file.name)).toLowerCase()
  const ext = extensionOf(file.name)

  if (contentType === 'application/pdf' || ext === 'pdf') {
    return ocrPdf(bytes, context)
  }

  if (IMAGE_TYPES.has(contentType) || isImageExt(ext)) {
    return ocrImage(bytes, contentType, ext, context)
  }

  throw new LlmError('Unsupported file type. Upload a JPEG, PNG, WebP, HEIC, or PDF receipt.')
}

async function ocrPdf(bytes: Uint8Array, context: ReceiptOcrContext): Promise<ReceiptOcrPreview> {
  let text = ''
  try {
    text = await extractPdfText(bytes)
  } catch (err) {
    throw new PdfExtractError(
      `Could not read PDF: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (hasUsablePdfText(text)) {
    const content = await completeJson({
      maxTokens: 2048,
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `${contextBlock(context)}Extract maintenance receipt fields from this PDF text:\n\n${text}`,
    })
    return finalizePreview(content, context)
  }

  const image = await rasterizePdfFirstPage(bytes)
  const content = await completeJson({
    image,
    maxTokens: 2048,
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `${contextBlock(context)}The receipt is a scanned PDF page image. List every odometer candidate, then extract fields.`,
  })
  return finalizePreview(content, context)
}

async function ocrImage(
  bytes: Uint8Array,
  contentType: string,
  ext: string,
  context: ReceiptOcrContext
): Promise<ReceiptOcrPreview> {
  const prepared = await prepareImage(bytes, contentType, ext)
  const content = await completeJson({
    image: prepared,
    maxTokens: 2048,
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `${contextBlock(context)}The receipt is a photo. HIGH PRIORITY: read MILEAGE IN/OUT digits from the print (character by character). List every mileage candidate with source+rank. Do not invent numbers.`,
  })
  return finalizePreview(content, context)
}

function contextBlock(context: ReceiptOcrContext): string {
  const today = context.today?.trim() || new Date().toISOString().slice(0, 10)
  const lines = [
    `Today's date is ${today}.`,
    // Do NOT send the vehicle odometer hint — the model will copy it instead of reading digits.
  ]

  if (context.schedules && context.schedules.length > 0) {
    lines.push(
      'Vehicle schedules (pick the best matching scheduleId UUID when kind is service; otherwise null):'
    )
    for (const schedule of context.schedules) {
      lines.push(`- ${schedule.id}: ${schedule.name}`)
    }
  }

  return `${lines.join('\n')}\n\n`
}

async function prepareImage(
  bytes: Uint8Array,
  contentType: string,
  ext: string
): Promise<{ base64: string; mediaType: string }> {
  const needsConvert =
    contentType.includes('heic') || contentType.includes('heif') || ext === 'heic' || ext === 'heif'

  try {
    let pipeline = sharp(bytes).rotate()
    if (needsConvert) {
      pipeline = pipeline.jpeg({ quality: 92 })
    } else if (contentType === 'image/png' || ext === 'png') {
      pipeline = pipeline.png()
    } else if (contentType === 'image/webp' || ext === 'webp') {
      pipeline = pipeline.webp({ quality: 92 })
    } else {
      pipeline = pipeline.jpeg({ quality: 92 })
    }

    const buffer = await pipeline.normalize().sharpen({ sigma: 0.8 }).toBuffer()
    const mediaType =
      contentType === 'image/png' || ext === 'png'
        ? 'image/png'
        : contentType === 'image/webp' || ext === 'webp'
          ? 'image/webp'
          : 'image/jpeg'
    return { base64: buffer.toString('base64'), mediaType: needsConvert ? 'image/jpeg' : mediaType }
  } catch (err) {
    if (!needsConvert && (contentType.startsWith('image/') || isImageExt(ext))) {
      const mediaType =
        contentType === 'image/jpg' || !contentType.startsWith('image/')
          ? mediaTypeFromExt(ext)
          : contentType
      return { base64: Buffer.from(bytes).toString('base64'), mediaType }
    }
    throw new LlmError(
      `Could not process image (HEIC may be unsupported): ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

function finalizePreview(content: string, context: ReceiptOcrContext): ReceiptOcrPreview {
  const preview = parsePreview(content)
  return postProcessPreview(preview, context)
}

function parsePreview(content: string): ReceiptOcrPreview {
  const jsonText = extractJsonObject(content)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new LlmError('Model returned invalid JSON')
  }
  const result = receiptOcrPreviewSchema.safeParse(normalizeRaw(parsed))
  if (!result.success) {
    throw new LlmError(`Model JSON failed validation: ${result.error.message}`)
  }
  return result.data
}

function postProcessPreview(
  preview: ReceiptOcrPreview,
  context: ReceiptOcrContext
): ReceiptOcrPreview {
  let next = preview

  if (next.costEnteredCents === 0) {
    next = {
      ...next,
      costEnteredCents: null,
      costEnteredCurrency: null,
    }
  }

  next = applyBestOdometerCandidate(next, context)

  const unit = resolveOdometerUnit(next, context)
  if (unit !== next.odometerUnit) {
    next = { ...next, odometerUnit: unit }
  }

  next = sanitizeOdometerAgainstHint(next, context)
  next = resolveScheduleMatch(next, context)
  return {
    ...next,
    confidence: normalizeConfidence(next.confidence, next),
  }
}

/** Re-rank LLM candidates with vehicle hint + source quality; pick the winner. */
function applyBestOdometerCandidate(
  preview: ReceiptOcrPreview,
  context: ReceiptOcrContext
): ReceiptOcrPreview {
  const candidates = [...preview.odometerCandidates]
  if (preview.odometer != null) {
    const already = candidates.some(c => c.value === preview.odometer)
    if (!already) {
      candidates.push({
        rank: 99,
        source: 'model-primary',
        unit: preview.odometerUnit,
        value: preview.odometer,
      })
    }
  }
  if (candidates.length === 0) return preview

  const scored = candidates
    .map(candidate => ({
      candidate,
      score: scoreOdometerCandidate(candidate, context),
    }))
    .sort((a, b) => b.score - a.score || a.candidate.rank - b.candidate.rank)

  const best = scored[0]?.candidate
  if (!best) return preview

  const canadian =
    preview.costEnteredCurrency === 'CAD' ||
    looksCanadianShop(preview.shopName) ||
    context.odometerUnit === 'km'
  const unit = best.unit ?? (canadian ? 'km' : null) ?? context.odometerUnit ?? preview.odometerUnit

  const topScore = scored[0]?.score ?? 0
  const secondScore = scored[1]?.score ?? 0
  let odometerConfidence: ConfidenceLevel = preview.confidence.odometer
  if (topScore >= 80 && topScore - secondScore >= 15) odometerConfidence = 'high'
  else if (topScore >= 50) odometerConfidence = 'medium'
  else odometerConfidence = 'low'

  return {
    ...preview,
    confidence: { ...preview.confidence, odometer: odometerConfidence },
    odometer: best.value,
    odometerCandidates: scored.map((row, index) => ({
      ...row.candidate,
      rank: index + 1,
    })),
    odometerUnit: unit,
  }
}

function scoreOdometerCandidate(candidate: OdometerCandidate, context: ReceiptOcrContext): number {
  let score = Math.max(0, 40 - (candidate.rank - 1) * 5)
  const source = (candidate.source ?? '').toLowerCase()

  if (/mileage\s*in\s*\/\s*out|mileage in\/out|odometer/.test(source)) score += 40
  else if (/mileage\s*in|mileage\s*out|mileage/.test(source)) score += 30
  else if (/tech|note|description|complaint/.test(source)) score += 15
  else if (/model-primary/.test(source)) score += 5
  else score -= 10

  const hint = context.odometerHint
  if (hint != null && Number.isFinite(hint) && hint > 0) {
    const unit = candidate.unit ?? context.odometerUnit ?? 'km'
    const valueInHintUnit =
      unit === (context.odometerUnit ?? 'km')
        ? candidate.value
        : unit === 'mi' && context.odometerUnit === 'km'
          ? candidate.value * 1.609344
          : unit === 'km' && context.odometerUnit === 'mi'
            ? candidate.value / 1.609344
            : candidate.value
    const ratio = Math.abs(valueInHintUnit - hint) / hint
    if (ratio <= 0.05) score += 50
    else if (ratio <= 0.15) score += 35
    else if (ratio <= 0.3) score += 15
    else if (ratio <= 0.5) score -= 10
    else score -= 60
  }

  // Typical passenger-vehicle odometer magnitudes.
  if (candidate.value >= 100 && candidate.value <= 500_000) score += 5
  else score -= 20

  return score
}

function sanitizeOdometerAgainstHint(
  preview: ReceiptOcrPreview,
  context: ReceiptOcrContext
): ReceiptOcrPreview {
  const hint = context.odometerHint
  const reading = preview.odometer
  if (hint == null || reading == null || !Number.isFinite(hint) || hint <= 0) {
    return preview
  }

  const unit = preview.odometerUnit ?? context.odometerUnit ?? 'km'
  const readingInHintUnit =
    unit === (context.odometerUnit ?? 'km')
      ? reading
      : unit === 'mi' && context.odometerUnit === 'km'
        ? reading * 1.609344
        : unit === 'km' && context.odometerUnit === 'mi'
          ? reading / 1.609344
          : reading

  const ratio = Math.abs(readingInHintUnit - hint) / hint
  if (ratio <= 0.5) return preview

  const topSource = (preview.odometerCandidates[0]?.source ?? '').toLowerCase()
  const strongMileageLabel = /mileage|odometer/.test(topSource)

  // Strong labeled mileage from the receipt wins over a mismatched vehicle hint
  // (e.g. receipt scanned onto the wrong vehicle). Flag low confidence instead of wiping.
  if (strongMileageLabel) {
    return {
      ...preview,
      confidence: { ...preview.confidence, odometer: 'low' },
    }
  }

  return {
    ...preview,
    confidence: { ...preview.confidence, odometer: 'low' },
    odometer: null,
    odometerUnit: null,
  }
}

function resolveOdometerUnit(
  preview: ReceiptOcrPreview,
  context: ReceiptOcrContext
): 'km' | 'mi' | null {
  if (preview.odometer == null) return preview.odometerUnit

  const canadian =
    preview.costEnteredCurrency === 'CAD' ||
    looksCanadianShop(preview.shopName) ||
    context.odometerUnit === 'km'

  if (canadian && preview.odometerUnit !== 'mi') {
    return 'km'
  }

  const hint = context.odometerHint
  const hintUnit = context.odometerUnit ?? 'km'
  if (hint != null && Number.isFinite(hint) && hint > 0) {
    const asHintUnit = Math.abs(preview.odometer - hint) / hint
    const asMilesThenHint =
      hintUnit === 'km'
        ? Math.abs(preview.odometer * 1.609344 - hint) / hint
        : Math.abs(preview.odometer / 1.609344 - hint) / hint

    if (asHintUnit <= 0.25) return hintUnit
    if (preview.odometerUnit === 'mi' && asMilesThenHint > asHintUnit + 0.2) {
      return hintUnit
    }
  }

  if (canadian) return 'km'
  return preview.odometerUnit
}

function resolveScheduleMatch(
  preview: ReceiptOcrPreview,
  context: ReceiptOcrContext
): ReceiptOcrPreview {
  const schedules = context.schedules ?? []
  if (schedules.length === 0) {
    return {
      ...preview,
      confidence: {
        ...preview.confidence,
        schedule: preview.scheduleId ? preview.confidence.schedule : 'low',
      },
      scheduleId: null,
    }
  }

  if (preview.kind === 'repair') {
    return {
      ...preview,
      confidence: { ...preview.confidence, schedule: 'high' },
      scheduleId: null,
    }
  }

  const knownIds = new Set(schedules.map(s => s.id))
  const llmPick = preview.scheduleId && knownIds.has(preview.scheduleId) ? preview.scheduleId : null

  const scored = schedules
    .map(schedule => ({
      id: schedule.id,
      name: schedule.name,
      score: scoreScheduleMatch(schedule.name, preview.notes, preview.kind),
    }))
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  const second = scored[1]
  const serverPick = best && best.score >= 8 ? best.id : null

  let scheduleId = llmPick
  let confidence: ConfidenceLevel = preview.confidence.schedule

  if (serverPick && (!llmPick || serverPick === llmPick)) {
    scheduleId = serverPick
    confidence =
      best && second && best.score - second.score >= 4
        ? 'high'
        : best && best.score >= 12
          ? 'high'
          : 'medium'
  } else if (serverPick && llmPick && serverPick !== llmPick) {
    // Prefer higher server score when it clearly beats a weak/ambiguous LLM pick.
    if (best && best.score >= 12) {
      scheduleId = serverPick
      confidence = 'medium'
    } else {
      scheduleId = llmPick
      confidence = 'medium'
    }
  } else if (!llmPick && !serverPick) {
    scheduleId = null
    confidence = 'low'
  }

  return {
    ...preview,
    confidence: { ...preview.confidence, schedule: confidence },
    scheduleId,
  }
}

function scoreScheduleMatch(
  scheduleName: string,
  notes: string | null,
  kind: 'service' | 'repair' | null
): number {
  if (kind === 'repair') return 0
  const haystack = normalizeMatchText(`${notes ?? ''} ${kind ?? ''}`)
  const needle = normalizeMatchText(scheduleName)
  if (!haystack || !needle) return 0

  let score = 0
  const scheduleTokens = tokenize(needle)
  const noteTokens = new Set(tokenize(haystack))

  for (const token of scheduleTokens) {
    if (noteTokens.has(token)) score += 4
    else if ([...noteTokens].some(t => t.includes(token) || token.includes(t))) score += 2
  }

  // Phrase / synonym boosts for common maintenance items.
  const pairs: Array<[RegExp, RegExp]> = [
    [/oil/, /oil|synthetic|lubricant/],
    [/tire|tyre/, /tire|tyre|rotate|rotation|swap/],
    [/brake/, /brake|pad|rotor/],
    [/cabin|air filter/, /cabin|filter|air filter/],
    [/wiper|fluid/, /wiper|washer|fluid/],
    [/wash|wax/, /wash|wax|rinse|detail/],
    [/spark|coolant/, /spark|coolant|plug/],
    [/transmission|transaxle/, /transmission|transaxle|gearbox/],
    [/belt/, /belt/],
    [/leather|seat/, /leather|seat|condition/],
  ]
  for (const [scheduleRe, noteRe] of pairs) {
    if (scheduleRe.test(needle) && noteRe.test(haystack)) score += 6
  }

  if (needle.length >= 6 && haystack.includes(needle)) score += 10
  return score
}

function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenize(value: string): string[] {
  return value
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !['and', 'the', 'for', 'with'].includes(t))
}

function looksCanadianShop(shopName: string | null): boolean {
  if (!shopName) return false
  const s = shopName.toLowerCase()
  return (
    s.includes('canada') ||
    /\b(ab|bc|on|qc|mb|sk|ns|nb|nl|pe|yt|nt|nu)\b/.test(s) ||
    s.includes('edmonton') ||
    s.includes('calgary') ||
    s.includes('toronto') ||
    s.includes('vancouver') ||
    s.includes('on the trail')
  )
}

function normalizeRaw(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const raw = value as Record<string, unknown>
  const candidates = normalizeCandidates(raw.odometerCandidates)
  const odometer = nullishNumber(raw.odometer) ?? candidates[0]?.value ?? null
  const odometerUnit = nullishEnum(raw.odometerUnit, ['km', 'mi']) ?? candidates[0]?.unit ?? null
  const scheduleRaw = nullishString(raw.scheduleId)
  const scheduleId =
    scheduleRaw &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scheduleRaw)
      ? scheduleRaw
      : null

  return {
    confidence: normalizeConfidenceRaw(raw.confidence),
    costEnteredCents: nullishCostCents(raw.costEnteredCents),
    costEnteredCurrency: nullishEnum(raw.costEnteredCurrency, ['USD', 'CAD']),
    kind: nullishEnum(raw.kind, ['service', 'repair']),
    notes: nullishString(raw.notes),
    odometer,
    odometerCandidates: candidates,
    odometerUnit,
    performedBy: nullishEnum(raw.performedBy, ['self', 'shop']),
    performedOn: nullishDate(raw.performedOn),
    scheduleId,
    shopName: nullishString(raw.shopName),
  }
}

function normalizeCandidates(value: unknown): OdometerCandidate[] {
  if (!Array.isArray(value)) return []
  const rows: OdometerCandidate[] = []
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const parsedValue = nullishNumber(row.value ?? row.odometer ?? row.reading)
    if (parsedValue == null) continue
    rows.push({
      rank:
        nullishNumber(row.rank) != null
          ? Math.max(1, Math.round(nullishNumber(row.rank)!))
          : index + 1,
      source: nullishString(row.source ?? row.label ?? row.field),
      unit: nullishEnum(row.unit, ['km', 'mi']),
      value: parsedValue,
    })
  }
  return rows.sort((a, b) => a.rank - b.rank)
}

function normalizeConfidenceRaw(value: unknown): ReceiptFieldConfidence {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const out = {} as ReceiptFieldConfidence
  for (const key of FIELD_KEYS) {
    out[key] = nullishEnum(raw[key], ['high', 'medium', 'low']) ?? 'medium'
  }
  return out
}

function normalizeConfidence(
  confidence: ReceiptFieldConfidence,
  preview: ReceiptOcrPreview
): ReceiptFieldConfidence {
  return {
    cost:
      preview.costEnteredCents == null && preview.costEnteredCurrency == null
        ? confidence.cost
        : confidence.cost,
    kind: preview.kind == null ? 'low' : confidence.kind,
    notes: preview.notes == null ? 'low' : confidence.notes,
    odometer: preview.odometer == null ? 'low' : confidence.odometer,
    performedBy: preview.performedBy == null ? 'low' : confidence.performedBy,
    performedOn: preview.performedOn == null ? 'low' : confidence.performedOn,
    schedule:
      preview.kind === 'repair' && preview.scheduleId == null
        ? 'high'
        : preview.scheduleId == null
          ? 'low'
          : confidence.schedule,
    shopName: preview.shopName == null ? 'low' : confidence.shopName,
  }
}

function nullishString(value: unknown): string | null {
  if (value == null || value === '') return null
  return String(value)
}

function nullishNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function nullishCostCents(value: unknown): number | null {
  if (value == null || value === '') return null
  const raw = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(raw)) return null
  if (!Number.isInteger(raw)) return Math.round(raw * 100)
  return Math.round(raw)
}

function nullishEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (value == null || value === '') return null
  const s = String(value).toLowerCase()
  const match = allowed.find(a => a.toLowerCase() === s)
  return match ?? null
}

function nullishDate(value: unknown): string | null {
  if (value == null || value === '') return null
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const dealer = parseDealerDate(s)
  if (dealer) return dealer
  const parsed = Date.parse(s)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString().slice(0, 10)
}

function parseDealerDate(value: string): string | null {
  const match = value
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2})([A-Z]{3})(\d{2}|\d{4})$/)
  if (!match) return null
  const day = Number(match[1])
  const monthToken = match[2]
  const yearToken = match[3]
  if (!monthToken || !yearToken) return null
  const months: Record<string, number> = {
    JAN: 1,
    FEB: 2,
    MAR: 3,
    APR: 4,
    MAY: 5,
    JUN: 6,
    JUL: 7,
    AUG: 8,
    SEP: 9,
    OCT: 10,
    NOV: 11,
    DEC: 12,
  }
  const mon = months[monthToken]
  if (!mon || day < 1 || day > 31) return null
  let year = Number(yearToken)
  if (year < 100) year += 2000
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function guessMime(filename: string): string {
  const ext = extensionOf(filename)
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : ''
}

function isImageExt(ext: string): boolean {
  return ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)
}

function mediaTypeFromExt(ext: string): string {
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}
