import { useRef, useState } from 'react'
import type { DisplayUnit, ReceiptOcrPreview } from '@vehicles/shared'
import { fromKm } from '@vehicles/shared'
import { ocrReceipt } from '../lib/api'
import { Button } from './Button'
import { CameraCaptureDialog, isCameraCaptureSupported } from './CameraCaptureDialog'
import { Dialog } from './Dialog'

const FILE_ACCEPT = 'image/*,application/pdf,.pdf'

export interface LogEntryChooserResult {
  file: File | null
  preview: ReceiptOcrPreview | null
}

interface LogEntryChooserDialogProps {
  currentOdometerKm?: number
  displayUnit?: DisplayUnit
  onClose: () => void
  onChoose: (result: LogEntryChooserResult) => void
  open: boolean
  vehicleId?: string
}

export function LogEntryChooserDialog({
  currentOdometerKm,
  displayUnit = 'km',
  onChoose,
  onClose,
  open,
  vehicleId,
}: LogEntryChooserDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraFallbackRef = useRef<HTMLInputElement>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  function handleClose() {
    if (pending) return
    setError('')
    setCameraOpen(false)
    onClose()
  }

  function handleManual() {
    onChoose({ file: null, preview: null })
  }

  async function processFile(file: File) {
    setError('')
    setPending(true)
    try {
      const preview = await ocrReceipt(file, {
        odometerHint:
          currentOdometerKm != null
            ? Math.round(fromKm(currentOdometerKm, displayUnit))
            : undefined,
        odometerUnit: displayUnit,
        vehicleId,
      })
      onChoose({ file, preview })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OCR failed')
    } finally {
      setPending(false)
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void processFile(file)
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragging(false)
    if (pending) return
    const file = event.dataTransfer.files?.[0]
    if (file) void processFile(file)
  }

  function handleCameraClick() {
    setError('')
    if (isCameraCaptureSupported()) {
      setCameraOpen(true)
      return
    }
    cameraFallbackRef.current?.click()
  }

  function handleCapture(file: File) {
    setCameraOpen(false)
    void processFile(file)
  }

  return (
    <>
      <Dialog
        footer={
          <div className="flex justify-end">
            <Button disabled={pending} onClick={handleClose} variant="text">
              Cancel
            </Button>
          </div>
        }
        onClose={handleClose}
        open={open && !cameraOpen}
        size="sm"
        title="Log entry"
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            Scan a receipt, take a photo, or enter the details yourself.
          </p>

          <button
            className={`w-full rounded-lg border border-dashed px-4 py-8 text-center text-sm transition-colors ${
              dragging
                ? 'border-accent bg-accent/5 text-accent'
                : 'border-line bg-bg-deep text-ink-muted hover:border-accent hover:text-ink'
            } disabled:opacity-60`}
            disabled={pending}
            onClick={() => fileInputRef.current?.click()}
            onDragLeave={() => setDragging(false)}
            onDragOver={event => {
              event.preventDefault()
              setDragging(true)
            }}
            onDrop={handleDrop}
            type="button"
          >
            {pending ? 'Scanning receipt…' : 'Drop a receipt here, or click to browse'}
            <span className="mt-1 block text-xs opacity-80">JPEG, PNG, WebP, HEIC, or PDF</span>
          </button>

          <input
            accept={FILE_ACCEPT}
            className="hidden"
            onChange={handleFileChange}
            ref={fileInputRef}
            type="file"
          />
          <input
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
            ref={cameraFallbackRef}
            type="file"
          />

          <Button
            className="w-full"
            disabled={pending}
            onClick={handleCameraClick}
            variant="outlined"
          >
            Take photo
          </Button>

          <Button className="w-full" disabled={pending} onClick={handleManual} variant="outlined">
            Enter manually
          </Button>

          {error ? <p className="text-sm text-overdue">{error}</p> : null}
        </div>
      </Dialog>

      <CameraCaptureDialog
        onCapture={handleCapture}
        onClose={() => setCameraOpen(false)}
        open={cameraOpen}
        title="Photograph receipt"
      />
    </>
  )
}
