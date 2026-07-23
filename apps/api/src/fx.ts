let cached: { fetchedAt: number; rate: number } | null = null
const CACHE_MS = 60 * 60 * 1000

export async function getCadToUsdRate(): Promise<{ fetchedAt: string; rate: number }> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return {
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      rate: cached.rate,
    }
  }

  const response = await fetch('https://api.frankfurter.dev/v1/latest?base=CAD&symbols=USD')
  if (!response.ok) {
    throw new Error(`FX provider returned ${response.status}`)
  }

  const body = (await response.json()) as { rates?: { USD?: number } }
  const rate = body.rates?.USD
  if (typeof rate !== 'number' || rate <= 0) {
    throw new Error('FX provider returned an invalid rate')
  }

  cached = { fetchedAt: Date.now(), rate }
  return {
    fetchedAt: new Date(cached.fetchedAt).toISOString(),
    rate,
  }
}
