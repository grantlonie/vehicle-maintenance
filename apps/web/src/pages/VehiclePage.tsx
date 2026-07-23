import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ScheduleInput } from '@vehicles/shared'
import { ScheduleForm, useCreateSchedule } from '../components/ScheduleForm'
import { api, authedUrl, downloadExport, getToken } from '../lib/api'
import { distanceLabel, moneyLabel, roundInput, statusClass, statusLabel } from '../lib/format'
import type { DueItem, LogEntry, Schedule, Template, Vehicle } from '../lib/types'

export function VehiclePage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [showSchedule, setShowSchedule] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<'all' | 'service' | 'repair'>('all')
  const [odometer, setOdometer] = useState('')

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
  const dueQuery = useQuery({
    queryFn: () => api<{ items: DueItem[] }>(`/api/due?vehicleId=${id}`),
    queryKey: ['due', id],
  })
  const templatesQuery = useQuery({
    queryFn: () => api<{ templates: Template[] }>('/api/templates'),
    queryKey: ['templates'],
  })

  const createSchedule = useCreateSchedule(id)

  const odometerMutation = useMutation({
    mutationFn: () =>
      api(`/api/vehicles/${id}/odometer`, {
        body: JSON.stringify({
          odometer: Number(odometer),
          odometerUnit: vehicleQuery.data?.displayUnit ?? 'km',
        }),
        method: 'POST',
      }),
    onSuccess: async () => {
      setOdometer('')
      await queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: () => api(`/api/vehicles/${id}/archive`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      window.location.href = '/'
    },
  })

  const deleteSchedule = useMutation({
    mutationFn: (scheduleId: string) => api(`/api/schedules/${scheduleId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['schedules', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
    },
  })

  const applyTemplate = useMutation({
    mutationFn: (templateId: string) =>
      api('/api/templates/apply', {
        body: JSON.stringify({ templateId, vehicleId: id }),
        method: 'POST',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['schedules', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
    },
  })

  const vehicle = vehicleQuery.data
  if (vehicleQuery.isLoading || !vehicle) {
    return <p className="text-ink-muted">Loading…</p>
  }

  const logs = (logsQuery.data?.logs ?? []).filter(log =>
    historyFilter === 'all' ? true : log.kind === historyFilter
  )
  const dueBySchedule = new Map((dueQuery.data?.items ?? []).map(d => [d.scheduleId, d]))

  async function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    await fetch(`/api/vehicles/${id}/image`, {
      body: form,
      headers: { Authorization: `Bearer ${getToken()}` },
      method: 'POST',
    })
    await queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
    await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="text-sm text-ink-muted hover:text-accent" to="/">
            ← Garage
          </Link>
          <h2 className="mt-2 text-2xl font-semibold">{vehicle.name}</h2>
          <p className="text-ink-muted">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </p>
          <p className="mt-1 font-mono">
            {distanceLabel(vehicle.currentOdometerKm, vehicle.displayUnit)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white no-underline hover:bg-accent-dark"
            to={`/vehicles/${id}/log`}
          >
            Log entry
          </Link>
          <button
            className="rounded-md border border-line bg-panel px-3 py-2 text-sm"
            onClick={() => downloadExport(id)}
            type="button"
          >
            Export
          </button>
          <button
            className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-overdue"
            onClick={() => archiveMutation.mutate()}
            type="button"
          >
            Archive
          </button>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-[240px_1fr]">
        <div className="overflow-hidden rounded-xl border border-line bg-bg-deep">
          <div className="aspect-square">
            {vehicle.imageUrl ? (
              <img
                alt={vehicle.name}
                className="h-full w-full object-cover"
                src={authedUrl(vehicle.imageUrl)}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs uppercase tracking-widest text-ink-muted">
                No photo
              </div>
            )}
          </div>
          <label className="block cursor-pointer border-t border-line bg-panel px-3 py-2 text-center text-sm">
            Upload photo
            <input accept="image/*" className="hidden" onChange={handleImageUpload} type="file" />
          </label>
        </div>

        <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
          <h3 className="font-medium">Quick odometer</h3>
          <div className="flex flex-wrap gap-2">
            <input
              className="w-40 rounded-md border border-line bg-white px-3 py-2"
              onChange={e => setOdometer(e.target.value)}
              placeholder={String(roundInput(vehicle.currentOdometerKm, vehicle.displayUnit))}
              type="number"
              value={odometer}
            />
            <span className="self-center text-sm text-ink-muted">{vehicle.displayUnit}</span>
            <button
              className="rounded-md bg-ink px-3 py-2 text-sm text-white"
              disabled={!odometer || odometerMutation.isPending}
              onClick={() => odometerMutation.mutate()}
              type="button"
            >
              Update
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Schedules</h3>
          <button
            className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm"
            onClick={() => setShowSchedule(v => !v)}
            type="button"
          >
            {showSchedule ? 'Cancel' : 'Add schedule'}
          </button>
        </div>

        {(templatesQuery.data?.templates.length ?? 0) > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-muted">Apply template:</span>
            {templatesQuery.data!.templates.map(template => (
              <button
                className="rounded border border-line bg-panel px-2 py-1"
                key={template.id}
                onClick={() => applyTemplate.mutate(template.id)}
                type="button"
              >
                {template.name}
              </button>
            ))}
          </div>
        ) : null}

        {showSchedule ? (
          <ScheduleForm
            onCancel={() => setShowSchedule(false)}
            onSubmit={(values: ScheduleInput) => {
              createSchedule.mutate(values, { onSuccess: () => setShowSchedule(false) })
            }}
            pending={createSchedule.isPending}
          />
        ) : null}

        <ul className="space-y-2">
          {(schedulesQuery.data?.schedules ?? []).map(schedule => {
            const due = dueBySchedule.get(schedule.id)
            return (
              <li
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-panel/80 px-3 py-3"
                key={schedule.id}
              >
                <div>
                  <p className="font-medium">{schedule.name}</p>
                  <p className="text-sm text-ink-muted">{describeSchedule(schedule)}</p>
                  {due ? (
                    <p className={`mt-1 font-mono text-xs uppercase ${statusClass(due.status)}`}>
                      {statusLabel(due.status)}
                      {due.dueDate ? ` · date ${due.dueDate}` : ''}
                      {due.dueOdometerKm != null
                        ? ` · ${distanceLabel(due.dueOdometerKm, vehicle.displayUnit)}`
                        : ''}
                    </p>
                  ) : null}
                </div>
                <button
                  className="text-sm text-overdue"
                  onClick={() => deleteSchedule.mutate(schedule.id)}
                  type="button"
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">History</h3>
          <div className="flex gap-1 rounded-md border border-line bg-panel p-1 text-sm">
            {(['all', 'service', 'repair'] as const).map(filter => (
              <button
                className={`rounded px-2 py-1 ${
                  historyFilter === filter ? 'bg-ink text-white' : 'text-ink-muted'
                }`}
                key={filter}
                onClick={() => setHistoryFilter(filter)}
                type="button"
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
        <ul className="space-y-2">
          {logs.map(log => (
            <li className="rounded-lg border border-line bg-panel/80 px-3 py-3" key={log.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-medium">
                  {log.performedOn}{' '}
                  <span className="font-mono text-xs uppercase text-ink-muted">[{log.kind}]</span>
                </p>
                <p className="font-mono text-sm">{moneyLabel(log.costUsdCents)}</p>
              </div>
              <p className="text-sm text-ink-muted">
                {distanceLabel(log.odometerKm, vehicle.displayUnit)} ·{' '}
                {log.performedBy === 'self' ? 'Self' : log.shopName || 'Shop'}
              </p>
              {log.notes ? <p className="mt-1 text-sm">{log.notes}</p> : null}
              {log.attachments.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
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
            </li>
          ))}
          {logs.length === 0 ? <p className="text-ink-muted">No entries yet.</p> : null}
        </ul>
      </section>
    </div>
  )
}

function describeSchedule(schedule: Schedule): string {
  const bits = [schedule.activePeriod]
  if (schedule.season) bits.push(schedule.season)
  if (schedule.frequencyMode === 'once_per_season') bits.push('once per season')
  if (schedule.intervalMonths) bits.push(`every ${schedule.intervalMonths} mo`)
  if (schedule.intervalKm) bits.push(`every ${Math.round(schedule.intervalKm)} km`)
  return bits.join(' · ')
}
