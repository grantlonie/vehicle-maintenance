import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { findPossibleDuplicateLogs, toKm, type ReceiptFieldConfidence } from '@vehicles/shared'
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { LogEntryForm, type LogFormValues } from '../components/LogEntryForm'
import { api, isDuplicateLogError, uploadLogAttachments } from '../lib/api'
import { distanceLabel, formatDate } from '../lib/format'
import type { LogPageLocationState, VehiclePageLocationState } from '../lib/logEntryFlow'
import type { LogEntry, Schedule, Vehicle } from '../lib/types'

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

type DuplicateMatch = Pick<
  LogEntry,
  'id' | 'kind' | 'notes' | 'odometerKm' | 'performedOn' | 'shopName'
>

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
  const [pendingValues, setPendingValues] = useState<LogFormValues | null>(null)
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([])

  const vehicleQuery = useQuery({
    queryFn: () => api<Vehicle>(`/api/vehicles/${id}`),
    queryKey: ['vehicle', id],
  })
  const schedulesQuery = useQuery({
    queryFn: () => api<{ schedules: Schedule[] }>(`/api/vehicles/${id}/schedules`),
    queryKey: ['schedules', id],
  })
  const logsQuery = useQuery({
    queryFn: () => api<{ logs: LogEntry[] }>(`/api/vehicles/${id}/logs`),
    queryKey: ['logs', id],
  })

  const vehicle = vehicleQuery.data

  const lowConfidenceLabels = useMemo(() => {
    const confidence = state?.ocrPreview?.confidence
    if (!confidence) return []
    return (Object.keys(CONFIDENCE_LABELS) as Array<keyof ReceiptFieldConfidence>)
      .filter(key => confidence[key] === 'low')
      .map(key => CONFIDENCE_LABELS[key])
  }, [state?.ocrPreview?.confidence])

  const ocrDuplicates = useMemo(() => {
    const preview = state?.ocrPreview
    const logs = logsQuery.data?.logs
    if (!preview?.performedOn || preview.odometer == null || !preview.kind || !logs) return []
    const unit = preview.odometerUnit ?? vehicle?.displayUnit ?? 'km'
    return findPossibleDuplicateLogs(
      {
        kind: preview.kind,
        odometerKm: toKm(preview.odometer, unit),
        performedOn: preview.performedOn,
      },
      logs
    )
  }, [logsQuery.data?.logs, state?.ocrPreview, vehicle?.displayUnit])

  const saveMutation = useMutation({
    mutationFn: async ({
      allowDuplicate,
      values,
    }: {
      allowDuplicate?: boolean
      values: LogFormValues
    }) => {
      const log = await api<{ id: string }>(`/api/vehicles/${id}/logs`, {
        body: JSON.stringify({ ...values, allowDuplicate }),
        method: 'POST',
      })

      await uploadLogAttachments(log.id, files)

      return log
    },
    onSuccess: async () => {
      setDuplicateMatches([])
      setPendingValues(null)
      await queryClient.invalidateQueries({ queryKey: ['logs', id] })
      await queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
      navigate(`/vehicles/${id}`)
    },
  })

  function openExisting(logId: string) {
    const nextState: VehiclePageLocationState = { editLogId: logId }
    navigate(`/vehicles/${id}`, { state: nextState })
  }

  function handleSubmit(values: LogFormValues) {
    setError('')
    saveMutation.mutate(
      { values },
      {
        onError: err => {
          if (isDuplicateLogError(err)) {
            setPendingValues(values)
            setDuplicateMatches(err.body.matches as DuplicateMatch[])
            return
          }
          setError(err instanceof Error ? err.message : 'Save failed')
        },
      }
    )
  }

  function handleSaveAnyway() {
    if (!pendingValues) return
    setError('')
    saveMutation.mutate(
      { allowDuplicate: true, values: pendingValues },
      {
        onError: err => setError(err instanceof Error ? err.message : 'Save failed'),
      }
    )
  }

  if (!vehicle) return <p className="text-ink-muted">Loading…</p>

  const warningMatches = duplicateMatches.length > 0 ? duplicateMatches : ocrDuplicates
  const match = warningMatches[0]

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

      {match && duplicateMatches.length === 0 ? (
        <div className="rounded-xl border border-soon/40 bg-soon/10 px-4 py-3 text-sm">
          <p className="font-medium text-ink">Similar entry already exists</p>
          <p className="mt-1 text-ink-muted">
            {formatDate(match.performedOn)} · {distanceLabel(match.odometerKm, vehicle.displayUnit)}
            {match.shopName ? ` · ${match.shopName}` : ''}
            {match.notes ? ` — ${match.notes}` : ''}
          </p>
          <div className="mt-3">
            <Button onClick={() => openExisting(match.id)} size="sm" variant="outlined">
              Open existing
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-line bg-panel p-4">
        <LogEntryForm
          ocrDraft={state?.ocrPreview ?? undefined}
          onClose={() => navigate(`/vehicles/${id}`)}
          onPendingFilesChange={setFiles}
          onSubmit={({ values }) => handleSubmit(values)}
          pending={saveMutation.isPending}
          pendingFiles={files}
          schedules={schedulesQuery.data?.schedules ?? []}
          vehicle={vehicle}
        />
        {error ? <p className="mt-2 text-sm text-overdue">{error}</p> : null}
      </div>

      <Dialog
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={saveMutation.isPending}
              onClick={() => {
                setDuplicateMatches([])
                setPendingValues(null)
              }}
              variant="text"
            >
              Cancel
            </Button>
            <Button
              disabled={saveMutation.isPending || !match}
              onClick={() => match && openExisting(match.id)}
              variant="outlined"
            >
              Open existing
            </Button>
            <Button loading={saveMutation.isPending} onClick={handleSaveAnyway}>
              Save anyway
            </Button>
          </div>
        }
        onClose={() => {
          if (saveMutation.isPending) return
          setDuplicateMatches([])
          setPendingValues(null)
        }}
        open={duplicateMatches.length > 0}
        placement="center"
        role="alertdialog"
        size="sm"
        title="Possible duplicate"
      >
        <p className="text-sm text-ink-muted">
          An entry with the same date, kind, and similar odometer already exists
          {match
            ? ` (${formatDate(match.performedOn)} · ${distanceLabel(match.odometerKm, vehicle.displayUnit)}${match.shopName ? ` · ${match.shopName}` : ''})`
            : ''}
          . Open it instead, or save a new entry anyway.
        </p>
      </Dialog>
    </div>
  )
}
