export type Season = 'spring' | 'summer' | 'fall' | 'winter'

/** Calendar months (1–12) for each named season. Internal only — not stored on schedules. */
export const SEASON_MONTHS: Record<Season, number[]> = {
  fall: [9, 10, 11],
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  winter: [12, 1, 2],
}

export const SEASON_ORDER: Season[] = ['spring', 'summer', 'fall', 'winter']

/** Automatic "soon" window for odometer-based schedules */
export const SOON_KM = 1000

export type ActivePeriod = 'year_round' | 'seasonal'
export type FrequencyMode = 'interval' | 'once_per_season'
export type DueStatus = 'ok' | 'soon' | 'overdue' | 'inactive' | 'never'

export interface ScheduleDueInput {
  activePeriod: ActivePeriod
  /** Used when there is no last service (e.g. Jan 1 of model year). */
  baselineDate: string
  baselineOdometerKm: number
  currentOdometerKm: number
  frequencyMode: FrequencyMode
  intervalKm: number | null
  intervalMonths: number | null
  lastService: { odometerKm: number; performedOn: string } | null
  seasons: Season[] | null
  today: Date
}

export interface ScheduleDueResult {
  dueDate: string | null
  dueOdometerKm: number | null
  seasonWindowStart: string | null
  status: DueStatus
}

export function seasonForMonth(month: number, seasons: Season[]): Season | null {
  for (const season of SEASON_ORDER) {
    if (seasons.includes(season) && SEASON_MONTHS[season].includes(month)) {
      return season
    }
  }
  return null
}

export function seasonWindowStart(today: Date, seasons: Season[]): Date | null {
  if (seasons.length === 0) return null
  const month = today.getUTCMonth() + 1
  const season = seasonForMonth(month, seasons)
  if (!season) return null

  if (season === 'winter') {
    const year = month >= 12 ? today.getUTCFullYear() : today.getUTCFullYear() - 1
    return utcDate(year, 12, 1)
  }

  return utcDate(today.getUTCFullYear(), SEASON_MONTHS[season][0]!, 1)
}

export function evaluateScheduleDue(input: ScheduleDueInput): ScheduleDueResult {
  const seasons =
    input.activePeriod === 'seasonal' ? (input.seasons ?? []) : SEASON_ORDER
  const month = input.today.getUTCMonth() + 1
  const activeSeason = seasonForMonth(month, seasons)

  if (!activeSeason) {
    return {
      dueDate: null,
      dueOdometerKm: null,
      seasonWindowStart: null,
      status: 'inactive',
    }
  }

  if (input.frequencyMode === 'once_per_season') {
    const windowStart = seasonWindowStart(input.today, seasons)
    if (!windowStart) {
      return {
        dueDate: null,
        dueOdometerKm: null,
        seasonWindowStart: null,
        status: 'inactive',
      }
    }
    const windowStartIso = toIsoDate(windowStart)
    const completed =
      input.lastService !== null && input.lastService.performedOn >= windowStartIso
    return {
      dueDate: windowStartIso,
      dueOdometerKm: null,
      seasonWindowStart: windowStartIso,
      status: completed ? 'ok' : 'overdue',
    }
  }

  const hasKm = input.intervalKm !== null && input.intervalKm > 0
  const hasMonths = input.intervalMonths !== null && input.intervalMonths > 0

  if (!hasKm && !hasMonths) {
    return {
      dueDate: null,
      dueOdometerKm: null,
      seasonWindowStart: null,
      status: 'never',
    }
  }

  const lastService =
    input.lastService ??
    ({
      odometerKm: input.baselineOdometerKm,
      performedOn: input.baselineDate,
    } as const)

  let dueOdometerKm: number | null = null
  let dueDate: string | null = null
  let overdue = false
  let soon = false

  if (hasKm && input.intervalKm !== null) {
    dueOdometerKm = lastService.odometerKm + input.intervalKm
    const kmStatus = statusFromKm(input.currentOdometerKm, dueOdometerKm)
    if (kmStatus === 'overdue') overdue = true
    if (kmStatus === 'soon') soon = true
  }

  if (hasMonths && input.intervalMonths !== null) {
    const last = parseIsoDate(lastService.performedOn)
    const next = addMonths(last, input.intervalMonths)
    dueDate = toIsoDate(next)
    const dateStatus = statusFromDueDate(input.today, next)
    if (dateStatus === 'overdue') overdue = true
    if (dateStatus === 'soon') soon = true
  }

  return {
    dueDate,
    dueOdometerKm,
    seasonWindowStart: null,
    status: overdue ? 'overdue' : soon ? 'soon' : 'ok',
  }
}

function statusFromKm(
  currentOdometerKm: number,
  dueOdometerKm: number
): 'ok' | 'soon' | 'overdue' {
  if (currentOdometerKm >= dueOdometerKm) return 'overdue'
  if (currentOdometerKm >= dueOdometerKm - SOON_KM) return 'soon'
  return 'ok'
}

/** Soon when the due date falls in the current calendar month (and is not overdue). */
function statusFromDueDate(today: Date, due: Date): 'ok' | 'soon' | 'overdue' {
  const todayStart = startOfDay(today)
  const dueStart = startOfDay(due)
  if (todayStart >= dueStart) return 'overdue'
  if (
    dueStart.getUTCFullYear() === todayStart.getUTCFullYear() &&
    dueStart.getUTCMonth() === todayStart.getUTCMonth()
  ) {
    return 'soon'
  }
  return 'ok'
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return utcDate(y!, m!, d!)
}

function startOfDay(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function addMonths(date: Date, months: number): Date {
  const result = utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}
