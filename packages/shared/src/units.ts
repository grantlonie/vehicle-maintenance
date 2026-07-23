export const KM_PER_MILE = 1.609344

export type DisplayUnit = 'km' | 'mi'

export function toKm(value: number, unit: DisplayUnit): number {
  if (unit === 'km') return value
  return value * KM_PER_MILE
}

export function fromKm(km: number, unit: DisplayUnit): number {
  if (unit === 'km') return km
  return km / KM_PER_MILE
}

export function formatDistance(km: number, unit: DisplayUnit, digits = 0): string {
  const value = fromKm(km, unit)
  const rounded = Number(value.toFixed(digits))
  return `${rounded.toLocaleString()} ${unit}`
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100)
}

export function centsToDollars(cents: number): number {
  return cents / 100
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    centsToDollars(cents)
  )
}

export function convertCadCentsToUsdCents(cadCents: number, rateCadToUsd: number): number {
  return Math.round(cadCents * rateCadToUsd)
}
