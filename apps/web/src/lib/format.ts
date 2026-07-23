import { formatDistance, formatUsd, fromKm, type DisplayUnit, type DueStatus } from '@vehicles/shared'

export function distanceLabel(km: number, unit: DisplayUnit): string {
  return formatDistance(km, unit, unit === 'km' ? 0 : 1)
}

export function moneyLabel(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return formatUsd(cents)
}

export function statusClass(status: DueStatus): string {
  if (status === 'overdue') return 'text-overdue'
  if (status === 'soon') return 'text-soon'
  if (status === 'inactive') return 'text-inactive'
  if (status === 'ok') return 'text-ok'
  return 'text-ink-muted'
}

export function statusLabel(status: DueStatus): string {
  if (status === 'never') return 'Needs baseline'
  return status
}

export function roundInput(km: number, unit: DisplayUnit): number {
  const value = fromKm(km, unit)
  return unit === 'km' ? Math.round(value) : Number(value.toFixed(1))
}
