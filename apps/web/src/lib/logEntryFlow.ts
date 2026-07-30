import type { ReceiptOcrPreview } from '@vehicles/shared'

/** Router location.state for `/vehicles/:id/log` after chooser / OCR. */
export interface LogPageLocationState {
  attachmentFile?: File
  ocrPreview?: ReceiptOcrPreview
}
