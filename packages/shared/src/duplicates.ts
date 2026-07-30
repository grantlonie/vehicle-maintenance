/** Max odometer gap (km) for treating two logs as possible duplicates. */
export const DUPLICATE_ODOMETER_TOLERANCE_KM = 2

export interface LogDuplicateFields {
  kind: string
  odometerKm: number
  performedOn: string
}

/** Same date + kind, and odometer within a small tolerance (re-scanned receipt). */
export function isPossibleDuplicateLog(
  candidate: LogDuplicateFields,
  existing: LogDuplicateFields
): boolean {
  if (candidate.performedOn !== existing.performedOn) return false
  if (candidate.kind !== existing.kind) return false
  return Math.abs(candidate.odometerKm - existing.odometerKm) <= DUPLICATE_ODOMETER_TOLERANCE_KM
}

export function findPossibleDuplicateLogs<T extends LogDuplicateFields>(
  candidate: LogDuplicateFields,
  existing: T[]
): T[] {
  return existing.filter(row => isPossibleDuplicateLog(candidate, row))
}
