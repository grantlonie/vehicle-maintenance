import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { IntakePreview } from '@vehicles/shared'
import { importVehicleDocuments } from '../lib/api'
import { reviewStateFromPreview, toImportLogs, type ImportReviewState } from '../lib/importReview'
import type { Schedule } from '../lib/types'
import { Button } from './Button'
import { ImportReview } from './ImportReview'

interface LogEntriesReviewProps {
  file: File
  onClose: () => void
  onSaved: () => void
  preview: IntakePreview
  schedules: Schedule[]
  vehicleId: string
}

export function LogEntriesReview({
  file,
  onClose,
  onSaved,
  preview,
  schedules,
  vehicleId,
}: LogEntriesReviewProps) {
  const queryClient = useQueryClient()
  const [review, setReview] = useState<ImportReviewState>(() => reviewStateFromPreview(preview))

  const scheduleOptions = schedules.map(schedule => ({ key: schedule.id, name: schedule.name }))
  const selectedCount = review.history.filter(row => row.selected).length

  const saveMutation = useMutation({
    mutationFn: () =>
      importVehicleDocuments(
        vehicleId,
        { logs: toImportLogs(review, new Set(scheduleOptions.map(option => option.key))) },
        [file]
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['logs', vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['documents', vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['due'] }),
      ])
      onSaved()
    },
  })

  return (
    <div className="space-y-4">
      <ImportReview
        documents={preview.documents}
        onChange={setReview}
        scheduleOptions={scheduleOptions}
        showSchedules={false}
        state={review}
      />
      {saveMutation.error ? (
        <p className="text-sm text-overdue">{saveMutation.error.message}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button disabled={saveMutation.isPending} onClick={onClose} variant="text">
          Cancel
        </Button>
        <Button
          className="w-36"
          disabled={selectedCount === 0}
          loading={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {selectedCount === 1 ? 'Save 1 entry' : `Save ${selectedCount} entries`}
        </Button>
      </div>
    </div>
  )
}
