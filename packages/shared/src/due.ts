export type Season = 'spring' | 'summer' | 'fall' | 'winter'

export const SEASON_MONTHS: Record<Season, number[]> = {
  fall: [9, 10, 11],
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  winter: [12, 1, 2],
}

/** Automatic "soon" window for odometer-based schedules */
export const SOON_KM = 1000

export type ActivePeriod = 'year_round' | 'season' | 'custom_months'
export type FrequencyMode = 'interval' | 'once_per_season'
export type DueStatus = 'ok' | 'soon' | 'overdue' | 'inactive' | 'never'

export interface ScheduleDueInput {
  activeMonths: number[] | null
  activePeriod: ActivePeriod
  /** Used when there is no last service (e.g. Jan 1 of model year). */
  baselineDate: string
  baselineOdometerKm: number
  currentOdometerKm: number
  frequencyMode: FrequencyMode
  intervalKm: number | null
  intervalMonths: number | null
  lastService: { odometerKm: number; performedOn: string } | null
  season: Season | null
  today: Date
}

export interface ScheduleDueResult {
  dueDate: string | null
  dueOdometerKm: number | null
  seasonWindowStart: string | null
  status: DueStatus
}

export function resolveActiveMonths(input: {
  activeMonths: number[] | null
  activePeriod: ActivePeriod
  season: Season | null
}): number[] {
  if (input.activePeriod === 'year_round') {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  }
  if (input.activePeriod === 'season') {
    if (!input.season) return []
    return SEASON_MONTHS[input.season]
  }
  return input.activeMonths ?? []
}

export function isMonthActive(month: number, activeMonths: number[]): boolean {
  return activeMonths.includes(month)
}

export function seasonWindowStart(today: Date, activeMonths: number[]): Date | null {
  if (activeMonths.length === 0) return null
  if (!isMonthActive(today.getUTCMonth() + 1, activeMonths)) return null

  const sorted = [...activeMonths].sort((a, b) => a - b)
  const wraps = sorted.includes(1) && sorted.includes(12)

  if (wraps) {
    const month = today.getUTCMonth() + 1
    if (month >= 12 || month <= Math.max(...sorted.filter(m => m < 6))) {
      const year = month >= 12 ? today.getUTCFullYear() : today.getUTCFullYear() - 1
      return utcDate(year, 12, 1)
    }
  }

  const contiguousStart = findContiguousStart(today.getUTCMonth() + 1, sorted)
  return utcDate(today.getUTCFullYear(), contiguousStart, 1)
}

export function evaluateScheduleDue(input: ScheduleDueInput): ScheduleDueResult {
  const activeMonths = resolveActiveMonths(input)
  const month = input.today.getUTCMonth() + 1

  if (!isMonthActive(month, activeMonths)) {
    return {
      dueDate: null,
      dueOdometerKm: null,
      seasonWindowStart: null,
      status: 'inactive',
    }
  }

  if (input.frequencyMode === 'once_per_season') {
    const windowStart = seasonWindowStart(input.today, activeMonths)
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

function findContiguousStart(currentMonth: number, sortedMonths: number[]): number {
  let start = currentMonth
  while (true) {
    const prev = start === 1 ? 12 : start - 1
    if (!sortedMonths.includes(prev)) break
    if (prev > start && !(sortedMonths.includes(12) && sortedMonths.includes(1))) break
    start = prev
    if (start === currentMonth) break
  }
  return start
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
