import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { ReceiptFieldConfidence } from '@vehicles/shared'
import { LogEntryForm, type LogFormValues } from '../components/LogEntryForm'
import { api, getToken } from '../lib/api'
import type { LogPageLocationState } from '../lib/logEntryFlow'
import type { Schedule, Vehicle } from '../lib/types'

const CONFIDENCE_LABELS: Record<keyof ReceiptFieldConfidence, string> = {
  cost: 'Cost',
  kind: 'Service/Repair',
  notes: 'Notes',
  odometer: 'Odometer',
  performedBy: 'Who did it',
  performedOn: 'Date',
  schedule: 'Schedule',
  shopName: 'Shop',
}

export function LogPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const state = (location.state ?? null) as LogPageLocationState | null
  const [error, setError] = useState('')
  const [files, setFiles] = useState<File[]>(() =>
    state?.attachmentFile ? [state.attachmentFile] : []
  )

  const vehicleQuery = useQuery({
    queryFn: () => api<Vehicle>(`/api/vehicles/${id}`),
    queryKey: ['vehicle', id],
  })
  const schedulesQuery = useQuery({
    queryFn: () => api<{ schedules: Schedule[] }>(`/api/vehicles/${id}/schedules`),
    queryKey: ['schedules', id],
  })

  const vehicle = vehicleQuery.data

  const lowConfidenceLabels = useMemo(() => {
    const confidence = state?.ocrPreview?.confidence
    if (!confidence) return []
    return (Object.keys(CONFIDENCE_LABELS) as Array<keyof ReceiptFieldConfidence>)
      .filter(key => confidence[key] === 'low')
      .map(key => CONFIDENCE_LABELS[key])
  }, [state?.ocrPreview?.confidence])

  const saveMutation = useMutation({
    mutationFn: async (values: LogFormValues) => {
      const log = await api<{ id: string }>(`/api/vehicles/${id}/logs`, {
        body: JSON.stringify(values),
        method: 'POST',
      })

      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        const response = await fetch(`/api/logs/${log.id}/attachments`, {
          body: formData,
          headers: { Authorization: `Bearer ${getToken()}` },
          method: 'POST',
        })
        if (!response.ok) throw new Error('Attachment upload failed')
      }

      return log
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['logs', id] })
      await queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
      navigate(`/vehicles/${id}`)
    },
  })

  if (!vehicle) return <p className="text-ink-muted">Loading…</p>

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link className="text-sm text-ink-muted hover:text-accent" to={`/vehicles/${id}`}>
          ← {vehicle.name}
        </Link>
        <h2 className="mt-2 text-2xl font-semibold">Log entry</h2>
        {state?.ocrPreview ? (
          <p className="mt-1 text-sm text-ink-muted">
            Prefilled from receipt scan — review before saving.
          </p>
        ) : null}
        {lowConfidenceLabels.length > 0 ? (
          <p className="mt-1 text-sm text-soon">Low confidence: {lowConfidenceLabels.join(', ')}</p>
        ) : null}
      </div>

      <div className="rounded-xl border border-line bg-panel p-4">
        <LogEntryForm
          ocrDraft={state?.ocrPreview ?? undefined}
          onClose={() => navigate(`/vehicles/${id}`)}
          onPendingFilesChange={setFiles}
          onSubmit={({ values }) => {
            setError('')
            saveMutation.mutate(values, {
              onError: err => setError(err instanceof Error ? err.message : 'Save failed'),
            })
          }}
          pending={saveMutation.isPending}
          pendingFiles={files}
          schedules={schedulesQuery.data?.schedules ?? []}
          vehicle={vehicle}
        />
        {error ? <p className="mt-2 text-sm text-overdue">{error}</p> : null}
      </div>
    </div>
  )
}
