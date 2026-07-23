import type { DisplayUnit, DueStatus } from '@vehicles/shared'

export interface Vehicle {
  archivedAt: string | null
  currentOdometerKm: number
  displayUnit: DisplayUnit
  hasImage: boolean
  id: string
  imageUrl: string | null
  make: string
  model: string
  name: string
  vin: string | null
  year: number
}

export interface Schedule {
  activeMonths: number[] | null
  activePeriod: string
  frequencyMode: string
  id: string
  intervalKm: number | null
  intervalMonths: number | null
  name: string
  season: string | null
  vehicleId: string
  warnDays: number | null
  warnKm: number | null
}

export interface Attachment {
  contentType: string
  id: string
  originalFilename: string
  sizeBytes: number
  url: string
}

export interface LogEntry {
  attachments: Attachment[]
  costUsdCents: number | null
  id: string
  kind: 'service' | 'repair'
  notes: string | null
  odometerKm: number
  performedBy: 'self' | 'shop'
  performedOn: string
  scheduleId: string | null
  shopName: string | null
}

export interface DueItem {
  dueDate: string | null
  dueOdometerKm: number | null
  scheduleId: string
  scheduleName: string
  status: DueStatus
  vehicleId: string
  vehicleName: string
}

export interface Template {
  id: string
  items: Array<{
    activeMonths: number[] | null
    activePeriod: string
    frequencyMode: string
    id?: string
    intervalKm: number | null
    intervalMonths: number | null
    name: string
    season: string | null
  }>
  name: string
}
