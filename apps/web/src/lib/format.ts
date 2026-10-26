import {
  formatDistance,
  formatUsd,
  fromKm,
  type DisplayUnit,
  type DueStatus,
  type VehicleType,
} from '@vehicles/shared'

export { formatDate } from '@vehicles/shared'

export function distanceLabel(km: number, unit: DisplayUnit): string {
  return formatDistance(km, unit, 0)
}

export function moneyLabel(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return formatUsd(cents)
}

export function logDetailLine(
  log: {
    costUsdCents: number | null
    odometerKm: number | null
    performedBy: 'self' | 'shop'
    shopName: string | null
  },
  unit: DisplayUnit
): string {
  const parts: string[] = []
  if (log.odometerKm != null) parts.push(distanceLabel(log.odometerKm, unit))
  parts.push(log.performedBy === 'self' ? 'Self' : log.shopName || 'Shop')
  if (log.costUsdCents != null && log.costUsdCents > 0) parts.push(moneyLabel(log.costUsdCents))
  return parts.join(' · ')
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

const SHORT_TYPE_LABELS: Record<VehicleType, string | null> = {
  car: null,
  motorhome: 'Motorhome',
  towable: 'Camper',
}

export function vehicleSubtitle(vehicle: {
  make: string
  model: string
  vehicleType: VehicleType
  year: number
}): string {
  const base = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
  const type = SHORT_TYPE_LABELS[vehicle.vehicleType]
  return type ? `${base} · ${type}` : base
}

export function roundInput(km: number, unit: DisplayUnit): number {
  return Math.round(fromKm(km, unit))
}
