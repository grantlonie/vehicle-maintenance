import {
  scheduleInputSchema,
  seasonSchema,
  toKm,
  type ScheduleDraft,
  type VehicleType,
  type VinDecode,
} from '@vehicles/shared'
import { completeJson, extractJsonObject, LlmError } from './fireworks'
import { nullishEnum, nullishNumber, nullishString } from './receiptOcr'
import { describeVinDecode } from './vinDecode'

export const MAX_SCHEDULE_SUGGESTIONS = 50

export interface ScheduleSuggestInput {
  make: string
  model: string
  vehicleType: VehicleType
  vinDecode: VinDecode | null
  year: number
}

const SYSTEM_PROMPT = `You are a vehicle maintenance planner for cars, trucks, motorhomes, and towable RVs. Given a vehicle's type, year, make, model (and optional decoded VIN details), return its recommended recurring maintenance schedule.

Return JSON only in this exact shape:
{
  "items": [
    {
      "name": string,
      "intervalDistance": number | null,
      "distanceUnit": "km" | "mi" | null,
      "intervalMonths": number | null,
      "seasonal": boolean,
      "seasons": ["spring" | "summer" | "fall" | "winter"] | null,
      "oncePerSeason": boolean,
      "source": string
    }
  ]
}

Rules:
- Use the NORMAL (not severe / special operating conditions) manufacturer schedule for that specific model year and powertrain. For RV house systems and trailer running gear, use the RV, appliance, or axle manufacturer's published intervals (e.g. Dexter / Lippert axles, Dometic / Suburban appliances, Onan / Cummins generators), or widely accepted RV industry intervals when none are published.
- Use the distance unit the manufacturer publishes for the vehicle's market (US schedules are usually miles). Do NOT convert units yourself.
- Give each item a short imperative name an owner would recognize (e.g. "Change engine oil and filter", "Rotate tires", "Replace cabin air filter", "Inspect and reseal roof", "Repack wheel bearings", "Change generator oil").
- An item can have a distance interval, a time interval (intervalMonths), or both ("whichever comes first"). Hour-based items (generators, engine hours) cannot be tracked: give the time interval and put the hour interval in source.
- source: one short line describing where the interval comes from, e.g. "Normal schedule, 10,000 mi / 12 months" or "Onan: every 150 hours or 12 months".
- Only include items you are confident apply to this exact vehicle. Omit anything uncertain (e.g. timing belt when the engine may use a chain, transmission fluid on sealed units, CVT fluid when the transmission type is unknown, slide-out items when the unit may not have slides).
- Seasonal items (e.g. "Swap to winter tires" each fall, "Winterize plumbing" each fall, "De-winterize and sanitize water system" each spring) set seasonal true, seasons to the relevant season(s), oncePerSeason true, and no intervals.
- Do not include one-off inspections, recalls, or items with no recurring interval.
- Follow the vehicle-type guidance in the user message. Include every item that applies, most important first, without padding the list. Stay within the item limit.
- Output JSON only.`

const TYPE_GUIDANCE: Record<VehicleType, string> = {
  car: `Type: car, truck, or SUV. Cover the engine, drivetrain, brakes, tires, filters, and fluids. Only include seasonal items when they are clearly standard for the vehicle.`,
  motorhome: `Type: motorhome (Class A, B, or C). The VIN usually decodes to the CHASSIS maker (e.g. Ford E-450 / F-53, Mercedes-Benz Sprinter, Ram ProMaster, Freightliner); the make/model entered may be the coach builder (e.g. Winnebago View, Thor Four Winds).
Cover BOTH:
1. Chassis and engine, from the chassis manufacturer's normal schedule (engine oil, fuel filters on diesels, air filters, transmission, coolant, brake fluid, DEF/emissions items when applicable, chassis lubrication).
2. House systems: roof and exterior sealant inspection/reseal, generator oil change and exercise, water heater anode or tank flush, fresh water sanitizing, LP system leak test, smoke/CO/LP detector testing, house battery maintenance, A/C filters, slide-out and leveling jack lubrication, and tire replacement by age (every 6 to 7 years regardless of tread).
Include "Winterize plumbing" (fall) and "De-winterize and sanitize water system" (spring) as once-per-season items.`,
  towable: `Type: towable RV or camper with NO engine (travel trailer, fifth wheel, toy hauler, pop-up, or truck camper). Do not include any engine, transmission, or engine-fluid items.
Cover: wheel bearing repack and inspection, electric brake adjustment, breakaway switch and battery check, lug nut torque, tire replacement by age (every 5 to 7 years regardless of tread), hitch / coupler / safety chain inspection, roof and exterior sealant inspection/reseal, water heater anode or tank flush, fresh water sanitizing, LP system leak test, smoke/CO/LP detector testing, house battery maintenance, A/C filters, slide-out and stabilizer jack lubrication, and generator service for toy haulers with a built-in generator.
For truck campers and pop-ups, skip items that do not apply (no axles, brakes, or bearings on truck campers; usually no slides on pop-ups).
Include "Winterize plumbing" (fall) and "De-winterize and sanitize water system" (spring) as once-per-season items.`,
}

export async function suggestSchedules(input: ScheduleSuggestInput): Promise<ScheduleDraft[]> {
  const content = await completeJson({
    maxTokens: 12288,
    systemPrompt: SYSTEM_PROMPT,
    userMessage: buildUserMessage(input),
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonObject(content))
  } catch (err) {
    if (err instanceof LlmError) throw err
    throw new LlmError('Model returned invalid JSON')
  }
  return normalizeScheduleSuggestions(parsed)
}

export function buildUserMessage(input: ScheduleSuggestInput): string {
  const lines = [
    `Vehicle: ${input.year} ${input.make} ${input.model}`,
    TYPE_GUIDANCE[input.vehicleType],
    `Item limit: ${MAX_SCHEDULE_SUGGESTIONS}`,
  ]
  if (input.vinDecode) {
    const details = describeVinDecode(input.vinDecode)
    if (details) lines.push(`Decoded VIN details: ${details}`)
  }
  return lines.join('\n')
}

export function normalizeScheduleSuggestions(
  raw: unknown,
  maxItems = MAX_SCHEDULE_SUGGESTIONS
): ScheduleDraft[] {
  const items =
    raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: unknown[] }).items as unknown[])
      : []

  const seen = new Set<string>()
  const drafts: ScheduleDraft[] = []
  for (const item of items) {
    if (drafts.length >= maxItems) break
    const schedule = toScheduleInput(item)
    if (!schedule) continue
    const dedupeKey = schedule.name.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    drafts.push({ key: `suggested-${drafts.length + 1}`, schedule })
  }
  return drafts
}

function toScheduleInput(item: unknown) {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const name = nullishString(record.name)?.trim()
  if (!name) return null

  const seasons = Array.isArray(record.seasons)
    ? record.seasons
        .map(season => seasonSchema.safeParse(String(season).toLowerCase()))
        .flatMap(result => (result.success ? [result.data] : []))
    : []
  const seasonal = record.seasonal === true && seasons.length > 0
  const oncePerSeason = seasonal && record.oncePerSeason === true

  const distance = nullishNumber(record.intervalDistance ?? record.intervalKm)
  const unit = nullishEnum(record.distanceUnit, ['km', 'mi'] as const) ?? 'km'
  const months = nullishNumber(record.intervalMonths)

  const candidate = {
    activePeriod: seasonal ? 'seasonal' : 'year_round',
    frequencyMode: oncePerSeason ? 'once_per_season' : 'interval',
    intervalKm: !oncePerSeason && distance && distance > 0 ? toKm(distance, unit) : null,
    intervalMonths: !oncePerSeason && months && months > 0 ? Math.round(months) : null,
    name,
    notes: nullishString(record.source)?.trim() || null,
    seasons: seasonal ? seasons : null,
  }
  const result = scheduleInputSchema.safeParse(candidate)
  return result.success ? result.data : null
}
