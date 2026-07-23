import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LogEntryForm, type LogFormValues } from '../components/LogEntryForm'
import { Modal, PencilButton } from '../components/Modal'
import { api, authedUrl } from '../lib/api'
import { distanceLabel, moneyLabel } from '../lib/format'
import type { LogEntry, Schedule, Vehicle } from '../lib/types'

export function VehicleHistoryPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'service' | 'repair'>('all')
  const [editLog, setEditLog] = useState<LogEntry | null>(null)

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
    mutationFn: ({ logId, body }: { body: LogFormValues; logId: string }) =>
      api(`/api/logs/${logId}`, { body: JSON.stringify(body), method: 'PATCH' }),
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
      setEditLog(null)
      await queryClient.invalidateQueries({ queryKey: ['logs', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
    },
  })

  const vehicle = vehicleQuery.data
  const logs = (logsQuery.data?.logs ?? []).filter(log =>
    filter === 'all' ? true : log.kind === filter
  )

  if (!vehicle) return <p className="text-ink-muted">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link className="text-sm text-ink-muted hover:text-accent" to={`/vehicles/${id}`}>
            ← {vehicle.name}
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">History</h2>
        </div>
        <Link
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white no-underline"
          to={`/vehicles/${id}/log`}
        >
          Log entry
        </Link>
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
            {value}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
        <ul className="divide-y divide-line">
          {logs.map(log => (
            <li
              className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
              key={log.id}
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {log.performedOn}{' '}
                  <span className="font-mono text-xs uppercase text-ink-muted">[{log.kind}]</span>
                </p>
                <p className="text-sm text-ink-muted">
                  {distanceLabel(log.odometerKm, vehicle.displayUnit)} ·{' '}
                  {log.performedBy === 'self' ? 'Self' : log.shopName || 'Shop'}
                  {log.costUsdCents != null && log.costUsdCents > 0
                    ? ` · ${moneyLabel(log.costUsdCents)}`
                    : null}
                </p>
                {log.notes ? <p className="mt-1 text-sm">{log.notes}</p> : null}
                {log.attachments.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {log.attachments.map(file => (
                      <a
                        className="text-sm text-accent hover:underline"
                        href={authedUrl(file.url)}
                        key={file.id}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {file.originalFilename}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
              <PencilButton label="Edit log entry" onClick={() => setEditLog(log)} />
            </li>
          ))}
          {logs.length === 0 ? (
            <li className="py-2 text-sm text-ink-muted">No entries yet.</li>
          ) : null}
        </ul>
      </section>

      {editLog ? (
        <Modal onClose={() => setEditLog(null)} title="Edit log entry">
          <LogEntryForm
            initial={editLog}
            onCancel={() => setEditLog(null)}
            onSubmit={values => updateLog.mutate({ body: values, logId: editLog.id })}
            pending={updateLog.isPending}
            schedules={schedulesQuery.data?.schedules ?? []}
            submitLabel="Save changes"
            vehicle={vehicle}
          />
          <button
            className="mt-3 text-sm text-overdue"
            onClick={() => {
              if (confirm('Delete this log entry?')) deleteLog.mutate(editLog.id)
            }}
            type="button"
          >
            Delete entry
          </button>
        </Modal>
      ) : null}
    </div>
  )
}
