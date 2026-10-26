/** Max odometer gap (km) for treating two logs as possible duplicates. */
export const DUPLICATE_ODOMETER_TOLERANCE_KM = 2

export interface LogDuplicateFields {
  kind: string
  notes?: string | null
  odometerKm: number | null
  performedOn: string
  scheduleId?: string | null
}

/** Same visit scanned twice: date, kind, schedule, notes, and near odometer. */
export function isPossibleDuplicateLog(
  candidate: LogDuplicateFields,
  existing: LogDuplicateFields
): boolean {
  if (candidate.performedOn !== existing.performedOn) return false
  if (candidate.kind !== existing.kind) return false
  if (!sameSchedule(candidate.scheduleId, existing.scheduleId)) return false
  if (!notesLookTheSame(candidate.notes, existing.notes)) return false
  if (candidate.odometerKm == null || existing.odometerKm == null) return true
  return Math.abs(candidate.odometerKm - existing.odometerKm) <= DUPLICATE_ODOMETER_TOLERANCE_KM
}

export function findPossibleDuplicateLogs<T extends LogDuplicateFields>(
  candidate: LogDuplicateFields,
  existing: T[]
): T[] {
  return existing.filter(row => isPossibleDuplicateLog(candidate, row))
}

function sameSchedule(
  candidate: string | null | undefined,
  existing: string | null | undefined
): boolean {
  return (candidate ?? null) === (existing ?? null)
}

function notesLookTheSame(
  candidate: string | null | undefined,
  existing: string | null | undefined
): boolean {
  const left = normalizeNotes(candidate)
  const right = normalizeNotes(existing)
  if (!left || !right) return true
  return left === right
}

function normalizeNotes(notes: string | null | undefined): string {
  return (notes ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}
