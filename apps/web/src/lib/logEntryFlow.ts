import type { IntakePreview, ReceiptOcrPreview } from '@vehicles/shared'

/** Router location.state for `/vehicles/:id/log` after chooser / OCR. */
export interface LogPageLocationState {
  attachmentFile?: File
  /** Set when the document contains several entries; the log page reviews them as a list. */
  multiPreview?: IntakePreview
  ocrPreview?: ReceiptOcrPreview
}

/** Router location.state for `/vehicles/:id` (e.g. open an existing log after duplicate warn). */
export interface VehiclePageLocationState {
  editLogId?: string
}

export function logPageState(result: {
  file: File | null
  multiPreview: IntakePreview | null
  preview: ReceiptOcrPreview | null
}): LogPageLocationState {
  const state: LogPageLocationState = {}
  if (result.file) state.attachmentFile = result.file
  if (result.multiPreview) state.multiPreview = result.multiPreview
  else if (result.preview) state.ocrPreview = result.preview
  return state
}
