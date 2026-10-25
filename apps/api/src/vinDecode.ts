import type { VinDecode } from '@vehicles/shared'

const VPIC_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues'
const TIMEOUT_MS = 8000

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Decode a VIN with NHTSA vPIC. Returns null when the VIN is invalid or the lookup fails. */
export async function decodeVin(
  vin: string,
  options: { fetchImpl?: FetchLike; modelYear?: number } = {}
): Promise<VinDecode | null> {
  const cleaned = vin.trim().toUpperCase()
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(cleaned)) return null

  const fetchImpl = options.fetchImpl ?? fetch
  const params = new URLSearchParams({ format: 'json' })
  if (options.modelYear) params.set('modelyear', String(options.modelYear))

  try {
    const response = await fetchImpl(`${VPIC_URL}/${cleaned}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { Results?: Array<Record<string, unknown>> }
    return parseVpicResult(body.Results?.[0])
  } catch {
    return null
  }
}

export function parseVpicResult(row: Record<string, unknown> | undefined): VinDecode | null {
  if (!row) return null
  const decoded: VinDecode = {
    bodyClass: field(row.BodyClass),
    displacementL: formatDisplacement(field(row.DisplacementL)),
    driveType: field(row.DriveType),
    engineCylinders: field(row.EngineCylinders),
    engineModel: field(row.EngineModel),
    fuelType: field(row.FuelTypePrimary),
    make: field(row.Make),
    model: field(row.Model),
    transmission: field(row.TransmissionStyle),
    trim: field(row.Trim),
    year: Number(field(row.ModelYear)) || null,
  }
  if (!decoded.make && !decoded.model) return null
  return decoded
}

export function describeVinDecode(decoded: VinDecode): string {
  const engine = [
    decoded.displacementL ? `${decoded.displacementL}L` : null,
    decoded.engineCylinders ? `${decoded.engineCylinders}-cyl` : null,
    decoded.engineModel,
  ]
    .filter(Boolean)
    .join(' ')
  return [
    decoded.trim ? `Trim: ${decoded.trim}` : null,
    engine ? `Engine: ${engine}` : null,
    decoded.fuelType ? `Fuel: ${decoded.fuelType}` : null,
    decoded.driveType ? `Drive: ${decoded.driveType}` : null,
    decoded.transmission ? `Transmission: ${decoded.transmission}` : null,
    decoded.bodyClass ? `Body: ${decoded.bodyClass}` : null,
  ]
    .filter(Boolean)
    .join('; ')
}

function field(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  if (!text || text === 'Not Applicable' || text === '0') return null
  return text
}

function formatDisplacement(value: string | null): string | null {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : value
}
