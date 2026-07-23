import path from 'path'
import { dataRoot } from './db/client'

export function vehicleImagePath(imageId: string, ext: string): string {
  return path.join(dataRoot, 'vehicles', `${imageId}.${ext}`)
}

export function attachmentPath(id: string, ext: string): string {
  return path.join(dataRoot, 'attachments', `${id}.${ext}`)
}

export function extensionFromFilename(filename: string, contentType: string): string {
  const fromName = path.extname(filename).replace('.', '').toLowerCase()
  if (fromName) return fromName
  if (contentType === 'image/jpeg') return 'jpg'
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  if (contentType === 'application/pdf') return 'pdf'
  return 'bin'
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function newId(): string {
  return crypto.randomUUID()
}

export function parseActiveMonths(json: string | null): number[] | null {
  if (!json) return null
  try {
    const value = JSON.parse(json) as number[]
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}
