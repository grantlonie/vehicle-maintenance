import type { ReceiptOcrPreview } from '@vehicles/shared'

const TOKEN_KEY = 'vehicles_app_token'
const OCR_TIMEOUT_MS = 100_000

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(path, { ...init, headers })
  if (!response.ok) {
    let message = response.statusText
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }

  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return response.json() as Promise<T>
  return undefined as T
}

export function authedUrl(path: string): string {
  const token = getToken()
  if (!token) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}token=${encodeURIComponent(token)}`
}

export async function ocrReceipt(
  file: File,
  options?: {
    odometerHint?: number
    odometerUnit?: 'km' | 'mi'
    vehicleId?: string
  }
): Promise<ReceiptOcrPreview> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('today', new Date().toISOString().slice(0, 10))
  if (options?.odometerHint != null) {
    formData.append('odometerHint', String(options.odometerHint))
  }
  if (options?.odometerUnit) {
    formData.append('odometerUnit', options.odometerUnit)
  }
  if (options?.vehicleId) {
    formData.append('vehicleId', options.vehicleId)
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), OCR_TIMEOUT_MS)
  try {
    return await api<ReceiptOcrPreview>('/api/logs/ocr', {
      body: formData,
      method: 'POST',
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Receipt scan timed out. Try again or enter manually.')
    }
    throw err
  } finally {
    window.clearTimeout(timer)
  }
}

export async function downloadExport(vehicleId: string) {
  const response = await fetch(authedUrl(`/api/vehicles/${vehicleId}/export`))
  if (!response.ok) throw new Error('Export failed')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'vehicle-export.zip'
  a.click()
  URL.revokeObjectURL(url)
}
