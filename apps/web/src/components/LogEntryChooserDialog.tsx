import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import type { BillOfSaleDetails, IntakePreview, ReceiptOcrPreview } from '@vehicles/shared'
import { fromKm, toKm } from '@vehicles/shared'
import {
  applyPurchaseBillOfSale,
  ocrReceipt,
  previewIntake,
  type PurchaseBillOfSaleResult,
} from '../lib/api'
import { distanceLabel, formatDate } from '../lib/format'
import { useDisplayUnit } from '../lib/settings'
import { Button } from './Button'
import { CameraCaptureDialog, isCameraCaptureSupported } from './CameraCaptureDialog'
import { Dialog } from './Dialog'

const FILE_ACCEPT = 'image/*,application/pdf,.pdf'

interface AppliedBillOfSale {
  details: BillOfSaleDetails
  filename: string
  result: PurchaseBillOfSaleResult
}

export interface LogEntryChooserResult {
  file: File | null
  /** Set when the document holds more than one entry. */
  multiPreview: IntakePreview | null
  preview: ReceiptOcrPreview | null
}

interface LogEntryChooserDialogProps {
  currentOdometerKm?: number
  onClose: () => void
  onChoose: (result: LogEntryChooserResult) => void
  open: boolean
  vehicleId?: string
}

export function LogEntryChooserDialog({
  currentOdometerKm,
  onChoose,
  onClose,
  open,
  vehicleId,
}: LogEntryChooserDialogProps) {
  const displayUnit = useDisplayUnit()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraFallbackRef = useRef<HTMLInputElement>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [billOfSale, setBillOfSale] = useState<AppliedBillOfSale | null>(null)

  function handleClose() {
    if (pending) return
    setError('')
    setCameraOpen(false)
    setBillOfSale(null)
    onClose()
  }

  function handleManual() {
    onChoose({ file: null, multiPreview: null, preview: null })
  }

  async function processFile(file: File) {
    setError('')
    setPending(true)
    try {
      const [single, multi] = await Promise.allSettled([
        ocrReceipt(file, {
          odometerHint:
            currentOdometerKm != null
              ? Math.round(fromKm(currentOdometerKm, displayUnit))
              : undefined,
          odometerUnit: displayUnit,
          vehicleId,
        }),
        previewIntake({ suggestSchedules: false, vehicleId }, [file]),
      ])
      const billOfSaleDetails =
        multi.status === 'fulfilled' ? multi.value.documents[0]?.billOfSale : null
      if (billOfSaleDetails && vehicleId) {
        const result = await applyPurchaseBillOfSale(vehicleId, billOfSaleDetails, file)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] }),
          queryClient.invalidateQueries({ queryKey: ['bill-of-sale', vehicleId] }),
        ])
        setBillOfSale({ details: billOfSaleDetails, filename: file.name, result })
        return
      }
      if (multi.status === 'fulfilled' && multi.value.history.length > 1) {
        onChoose({ file, multiPreview: multi.value, preview: null })
        return
      }
      if (single.status === 'rejected') throw single.reason
      onChoose({ file, multiPreview: null, preview: single.value })
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
            {billOfSale ? (
              <Button onClick={handleClose}>Done</Button>
            ) : (
              <Button disabled={pending} onClick={handleClose} variant="text">
                Cancel
              </Button>
            )}
          </div>
        }
        onClose={handleClose}
        open={open && !cameraOpen}
        size="sm"
        title={billOfSale ? 'Bill of sale' : 'Log entry'}
      >
        {billOfSale ? (
          <BillOfSaleSummary applied={billOfSale} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">
              Scan a receipt, take a photo, or enter the details yourself. A document with several
              services or visits, like a multi-item invoice or a service history, is split into
              separate entries for you to review.
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
              {pending
                ? 'Scanning document…'
                : 'Drop a receipt or document here, or click to browse'}
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
        )}
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

function BillOfSaleSummary({ applied }: { applied: AppliedBillOfSale }) {
  const displayUnit = useDisplayUnit()
  const { details, filename, result } = applied
  const changes = [
    result.filledDate && details.purchasedOn
      ? `Purchase date set to ${formatDate(details.purchasedOn)}`
      : null,
    result.filledOdometer && details.odometer != null
      ? `Purchase odometer set to ${distanceLabel(toKm(details.odometer, details.odometerUnit), displayUnit)}`
      : null,
    result.attachedFile ? `${filename} attached to the purchase` : null,
  ].filter(change => change != null)

  return (
    <div className="space-y-2 text-sm">
      {changes.length > 0 ? (
        <>
          <p>This looks like a bill of sale, so it was saved to Ownership instead of the log.</p>
          <ul className="list-disc space-y-1 pl-5 text-ink-muted">
            {changes.map(change => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          This looks like a bill of sale, but Ownership already has its purchase details, so nothing
          changed.
        </p>
      )}
    </div>
  )
}
