import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertDialog } from '../components/AlertDialog'
import { AttachmentIcons } from '../components/AttachmentIcons'
import { Button } from '../components/Button'
import {
  LogEntryChooserDialog,
  type LogEntryChooserResult,
} from '../components/LogEntryChooserDialog'
import { LogEntryForm, type LogFormSubmit, type LogFormValues } from '../components/LogEntryForm'
import { IconButton } from '../components/IconButton'
import { PencilIcon } from '../components/icons'
import { api } from '../lib/api'
import type { LogPageLocationState } from '../lib/logEntryFlow'
import { distanceLabel, formatDate, moneyLabel } from '../lib/format'
import type { LogEntry, Schedule, Vehicle } from '../lib/types'

export function VehicleHistoryPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'service' | 'repair'>('all')
  const [editLog, setEditLog] = useState<LogEntry | null>(null)
  const [logChooserOpen, setLogChooserOpen] = useState(false)
  const [confirmDeleteLog, setConfirmDeleteLog] = useState(false)

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

  const updateLog = useMutation({
    mutationFn: async ({
      logId,
      removedAttachmentIds,
      values,
    }: {
      logId: string
      removedAttachmentIds: string[]
      values: LogFormValues
    }) => {
      await api(`/api/logs/${logId}`, { body: JSON.stringify(values), method: 'PATCH' })
      for (const attachmentId of removedAttachmentIds) {
        await api(`/api/attachments/${attachmentId}`, { method: 'DELETE' })
      }
    },
    onSuccess: async () => {
      setEditLog(null)
      await queryClient.invalidateQueries({ queryKey: ['logs', id] })
      await queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
    },
  })

  const deleteLog = useMutation({
    mutationFn: (logId: string) => api(`/api/logs/${logId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setConfirmDeleteLog(false)
      setEditLog(null)
      await queryClient.invalidateQueries({ queryKey: ['logs', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
    },
  })

  const vehicle = vehicleQuery.data
  const scheduleNameById = useMemo(
    () => new Map((schedulesQuery.data?.schedules ?? []).map(s => [s.id, s.name])),
    [schedulesQuery.data?.schedules]
  )
  const logs = (logsQuery.data?.logs ?? []).filter(log =>
    filter === 'all' ? true : log.kind === filter
  )

  if (!vehicle) return <p className="text-ink-muted">Loading…</p>

  function handleLogChooser(result: LogEntryChooserResult) {
    setLogChooserOpen(false)
    const state: LogPageLocationState = {}
    if (result.file) state.attachmentFile = result.file
    if (result.preview) state.ocrPreview = result.preview
    navigate(`/vehicles/${id}/log`, { state })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link className="text-sm text-ink-muted hover:text-accent" to={`/vehicles/${id}`}>
            ← {vehicle.name}
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">History</h2>
        </div>
        <Button onClick={() => setLogChooserOpen(true)}>Log entry</Button>
      </div>

      <div className="flex gap-1 rounded-md border border-line bg-panel p-1 text-sm w-fit">
        {(['all', 'service', 'repair'] as const).map(value => (
          <button
            className={`rounded px-2 py-1 ${
              filter === value ? 'bg-ink text-white' : 'text-ink-muted'
            }`}
            key={value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {value === 'all' ? 'All' : value === 'service' ? 'Service' : 'Repair'}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
        <ul className="divide-y divide-line">
          {logs.map(log => {
            const scheduleName = log.scheduleId ? scheduleNameById.get(log.scheduleId) : undefined
            return (
              <li
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                key={log.id}
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {formatDate(log.performedOn)}{' '}
                    <span className="font-mono text-xs uppercase text-ink-muted">[{log.kind}]</span>
                  </p>
                  <p className="text-sm text-ink-muted">
                    {distanceLabel(log.odometerKm, vehicle.displayUnit)} ·{' '}
                    {log.performedBy === 'self' ? 'Self' : log.shopName || 'Shop'}
                    {log.costUsdCents != null && log.costUsdCents > 0
                      ? ` · ${moneyLabel(log.costUsdCents)}`
                      : null}
                  </p>
                  {scheduleName ? <p className="mt-1 text-sm">{scheduleName}</p> : null}
                  {log.notes ? (
                    <p className={`text-sm ${scheduleName ? 'mt-0.5 text-ink-muted' : 'mt-1'}`}>
                      {log.notes}
                    </p>
                  ) : null}
                  <AttachmentIcons attachments={log.attachments} className="mt-1" />
                </div>
                <IconButton
                  aria-label="Edit log entry"
                  icon={<PencilIcon />}
                  onClick={() => setEditLog(log)}
                  size="sm"
                  tooltip={{ content: 'Edit log entry' }}
                />
              </li>
            )
          })}
          {logs.length === 0 ? (
            <li className="py-2 text-sm text-ink-muted">No entries yet.</li>
          ) : null}
        </ul>
      </section>

      {editLog ? (
        <LogEntryForm
          initial={editLog}
          onClose={() => setEditLog(null)}
          onDelete={() => setConfirmDeleteLog(true)}
          onSubmit={({ removedAttachmentIds, values }: LogFormSubmit) =>
            updateLog.mutate({ logId: editLog.id, removedAttachmentIds, values })
          }
          pending={updateLog.isPending}
          schedules={schedulesQuery.data?.schedules ?? []}
          variant="dialog"
          vehicle={vehicle}
        />
      ) : null}

      <LogEntryChooserDialog
        currentOdometerKm={vehicle.currentOdometerKm}
        displayUnit={vehicle.displayUnit}
        onChoose={handleLogChooser}
        onClose={() => setLogChooserOpen(false)}
        open={logChooserOpen}
        vehicleId={vehicle.id}
      />

      <AlertDialog
        onClose={() => setConfirmDeleteLog(false)}
        onConfirm={() => {
          if (editLog) deleteLog.mutate(editLog.id)
        }}
        open={confirmDeleteLog}
        pending={deleteLog.isPending}
        title="Delete this log entry?"
      >
        <p className="text-sm text-ink-muted">This cannot be undone.</p>
      </AlertDialog>
    </div>
  )
}
