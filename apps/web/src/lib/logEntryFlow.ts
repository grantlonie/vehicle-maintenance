import type { ReceiptOcrPreview } from '@vehicles/shared'

/** Router location.state for `/vehicles/:id/log` after chooser / OCR. */
export interface LogPageLocationState {
  attachmentFile?: File
  ocrPreview?: ReceiptOcrPreview
}

/** Router location.state for `/vehicles/:id` (e.g. open an existing log after duplicate warn). */
export interface VehiclePageLocationState {
  editLogId?: string
}
