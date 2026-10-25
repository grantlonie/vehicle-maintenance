import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { IntakePreview } from '@vehicles/shared'
import { importVehicleDocuments, previewIntake } from '../lib/api'
import { reviewStateFromPreview, toImportLogs, type ImportReviewState } from '../lib/importReview'
import type { Schedule, Vehicle } from '../lib/types'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { DocumentDropZone } from './DocumentDropZone'
import { ImportReview } from './ImportReview'

interface ImportDocumentsDialogProps {
  onClose: () => void
  schedules: Schedule[]
  vehicle: Vehicle
}

export function ImportDocumentsDialog({ onClose, schedules, vehicle }: ImportDocumentsDialogProps) {
  const queryClient = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<IntakePreview | null>(null)
  const [review, setReview] = useState<ImportReviewState | null>(null)

  const scheduleOptions = schedules.map(schedule => ({ key: schedule.id, name: schedule.name }))

  const previewMutation = useMutation({
    mutationFn: () => previewIntake({ suggestSchedules: false, vehicleId: vehicle.id }, files),
    onSuccess: result => {
      setPreview(result)
      setReview(reviewStateFromPreview(result))
    },
  })

  const importMutation = useMutation({
    mutationFn: (state: ImportReviewState) =>
      importVehicleDocuments(
        vehicle.id,
        { logs: toImportLogs(state, new Set(scheduleOptions.map(option => option.key))) },
        files
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['logs', vehicle.id] }),
        queryClient.invalidateQueries({ queryKey: ['documents', vehicle.id] }),
        queryClient.invalidateQueries({ queryKey: ['vehicle', vehicle.id] }),
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['due'] }),
      ])
      onClose()
    },
  })

  const busy = previewMutation.isPending || importMutation.isPending
  const selectedCount = review?.history.filter(row => row.selected).length ?? 0

  function handleBack() {
    setPreview(null)
    setReview(null)
    importMutation.reset()
  }

  const footer =
    preview && review ? (
      <div className="flex items-center justify-between gap-2">
        <Button disabled={busy} onClick={handleBack} variant="text">
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button disabled={busy} onClick={onClose} variant="text">
            Cancel
          </Button>
          <Button loading={importMutation.isPending} onClick={() => importMutation.mutate(review)}>
            {selectedCount > 0 ? `Import ${selectedCount}` : 'Save documents'}
          </Button>
        </div>
      </div>
    ) : (
      <div className="flex items-center justify-end gap-2">
        <Button disabled={busy} onClick={onClose} variant="text">
          Cancel
        </Button>
        <Button
          disabled={files.length === 0}
          loading={previewMutation.isPending}
          onClick={() => previewMutation.mutate()}
        >
          {previewMutation.isPending ? 'Reading…' : 'Continue'}
        </Button>
      </div>
    )

  return (
    <Dialog
      backdrop={{ clickaway: false }}
      footer={footer}
      onClose={busy ? () => undefined : onClose}
      size="full"
      title="Import documents"
    >
      {preview && review ? (
        <div className="space-y-3">
          <ImportReview
            documents={preview.documents}
            onChange={setReview}
            scheduleOptions={scheduleOptions}
            showSchedules={false}
            state={review}
          />
          {importMutation.error ? (
            <p className="text-sm text-overdue">{importMutation.error.message}</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            Add a CARFAX report, inspection report, or service records. Past work is matched to this
            vehicle&apos;s schedules and listed for review before anything is saved.
          </p>
          <DocumentDropZone disabled={busy} files={files} onChange={setFiles} />
          {previewMutation.isPending ? (
            <p className="text-sm text-ink-muted">Reading documents. This can take a minute.</p>
          ) : null}
          {previewMutation.error ? (
            <p className="text-sm text-overdue">{previewMutation.error.message}</p>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
