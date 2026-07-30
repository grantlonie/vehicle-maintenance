import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { ScheduleInput } from '@vehicles/shared'
import { AlertDialog } from '../components/AlertDialog'
import { AttachmentIcons } from '../components/AttachmentIcons'
import { Button, buttonClassName } from '../components/Button'
import { Dialog } from '../components/Dialog'
import {
  LogEntryChooserDialog,
  type LogEntryChooserResult,
} from '../components/LogEntryChooserDialog'
import { LogEntryForm, type LogFormSubmit, type LogFormValues } from '../components/LogEntryForm'
import { IconButton } from '../components/IconButton'
import { PencilIcon } from '../components/icons'
import { Popover } from '../components/Popover'
import { ScheduleForm, useCreateSchedule } from '../components/ScheduleForm'
import { api, authedUrl, downloadExport, getToken } from '../lib/api'
import type { LogPageLocationState, VehiclePageLocationState } from '../lib/logEntryFlow'
import {
  distanceLabel,
  formatDate,
  moneyLabel,
  roundInput,
  statusClass,
  statusLabel,
} from '../lib/format'
import { describeSchedule, rankSchedules } from '../lib/schedules'
import type { DueItem, LogEntry, Schedule, Vehicle } from '../lib/types'

const PREVIEW_COUNT = 5

export function VehiclePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const odometerInputRef = useRef<HTMLInputElement>(null)
  const odometerAnchorRef = useRef<HTMLDivElement>(null)

  const [odometerOpen, setOdometerOpen] = useState(false)
  const [odometerValue, setOdometerValue] = useState('')
  const [editVehicle, setEditVehicle] = useState(false)
  const [addSchedule, setAddSchedule] = useState(false)
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null)
  const [editLog, setEditLog] = useState<LogEntry | null>(null)
  const [logChooserOpen, setLogChooserOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmDeleteSchedule, setConfirmDeleteSchedule] = useState(false)
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
  const dueQuery = useQuery({
    queryFn: () => api<{ items: DueItem[] }>(`/api/due?vehicleId=${id}`),
    queryKey: ['due', id],
  })

  useEffect(() => {
    const editLogId = (location.state as VehiclePageLocationState | null)?.editLogId
    if (!editLogId || !logsQuery.data?.logs) return
    const log = logsQuery.data.logs.find(row => row.id === editLogId)
    if (!log) return
    setEditLog(log)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, logsQuery.data?.logs, navigate])

  const createSchedule = useCreateSchedule(id)

  const odometerMutation = useMutation({
    mutationFn: (value: number) =>
      api(`/api/vehicles/${id}/odometer`, {
        body: JSON.stringify({
          odometer: value,
          odometerUnit: vehicleQuery.data?.displayUnit ?? 'km',
        }),
        method: 'POST',
      }),
    onSuccess: async () => {
      setOdometerOpen(false)
      setOdometerValue('')
      await queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    },
  })

  const updateVehicle = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/vehicles/${id}`, { body: JSON.stringify(body), method: 'PATCH' }),
    onSuccess: async () => {
      setEditVehicle(false)
      await queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    },
  })

  const updateSchedule = useMutation({
    mutationFn: ({ scheduleId, body }: { body: ScheduleInput; scheduleId: string }) =>
      api(`/api/schedules/${scheduleId}`, { body: JSON.stringify(body), method: 'PATCH' }),
    onSuccess: async () => {
      setEditSchedule(null)
      await queryClient.invalidateQueries({ queryKey: ['schedules', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
    },
  })

  const deleteSchedule = useMutation({
    mutationFn: (scheduleId: string) => api(`/api/schedules/${scheduleId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setConfirmDeleteSchedule(false)
      setEditSchedule(null)
      await queryClient.invalidateQueries({ queryKey: ['schedules', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
    },
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

  const archiveMutation = useMutation({
    mutationFn: () => api(`/api/vehicles/${id}/archive`, { method: 'POST' }),
    onSuccess: async () => {
      setConfirmArchive(false)
      setEditVehicle(false)
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      window.location.href = '/'
    },
  })

  const vehicle = vehicleQuery.data
  const dueBySchedule = useMemo(
    () => new Map((dueQuery.data?.items ?? []).map(d => [d.scheduleId, d])),
    [dueQuery.data?.items]
  )

  const rankedSchedules = useMemo(
    () => rankSchedules(schedulesQuery.data?.schedules ?? [], dueBySchedule),
    [dueBySchedule, schedulesQuery.data?.schedules]
  )

  const visibleSchedules = rankedSchedules.slice(0, PREVIEW_COUNT)
  const scheduleNameById = useMemo(
    () => new Map((schedulesQuery.data?.schedules ?? []).map(s => [s.id, s.name])),
    [schedulesQuery.data?.schedules]
  )
  const logs = logsQuery.data?.logs ?? []
  const visibleLogs = logs.slice(0, PREVIEW_COUNT)

  if (vehicleQuery.isLoading || !vehicle) {
    return <p className="text-ink-muted">Loading…</p>
  }

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

  function openOdometer() {
    setOdometerValue(String(roundInput(vehicle!.currentOdometerKm, vehicle!.displayUnit)))
    setOdometerOpen(true)
    requestAnimationFrame(() => odometerInputRef.current?.select())
  }

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
        <Link className="text-sm text-ink-muted hover:text-accent" to="/">
          ← Garage
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setLogChooserOpen(true)}>Log entry</Button>
          <Button onClick={() => downloadExport(id)} variant="outlined">
            Export
          </Button>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
        <div className="grid sm:grid-cols-[200px_1fr]">
          <div className="relative aspect-[4/3] bg-bg-deep sm:aspect-auto sm:min-h-[180px]">
            {vehicle.imageUrl ? (
              <img
                alt={vehicle.name}
                className="h-full w-full object-cover"
                src={authedUrl(vehicle.imageUrl)}
              />
            ) : (
              <div className="flex h-full min-h-[140px] items-center justify-center font-mono text-xs uppercase tracking-widest text-ink-muted">
                No photo
              </div>
            )}
            <label className="absolute bottom-2 left-2 cursor-pointer rounded-md bg-panel/95 px-2 py-1 text-xs shadow">
              Photo
              <input accept="image/*" className="hidden" onChange={handleImageUpload} type="file" />
            </label>
          </div>

          <div className="flex flex-col justify-center gap-1 p-4 sm:p-5">
            <div className="flex items-start gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">{vehicle.name}</h2>
              <IconButton
                aria-label="Edit vehicle"
                icon={<PencilIcon />}
                onClick={() => setEditVehicle(true)}
                size="sm"
                tooltip={{ content: 'Edit vehicle' }}
              />
            </div>
            <p className="text-ink-muted">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </p>
            <div className="mt-2 flex items-center gap-1" ref={odometerAnchorRef}>
              <p className="font-mono text-lg">
                {distanceLabel(vehicle.currentOdometerKm, vehicle.displayUnit)}
              </p>
              <IconButton
                aria-label="Update odometer"
                icon={<PencilIcon />}
                onClick={openOdometer}
                size="sm"
                tooltip={{ content: 'Update odometer' }}
              />
              <Popover
                anchorRef={odometerAnchorRef}
                onClose={() => setOdometerOpen(false)}
                open={odometerOpen}
              >
                <label className="block text-xs font-medium text-ink-muted">
                  Odometer ({vehicle.displayUnit})
                  <input
                    className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                    onChange={e => setOdometerValue(e.target.value)}
                    ref={odometerInputRef}
                    step="any"
                    type="number"
                    value={odometerValue}
                  />
                </label>
                <div className="mt-2 flex gap-2">
                  <Button
                    disabled={!odometerValue}
                    loading={odometerMutation.isPending}
                    onClick={() => odometerMutation.mutate(Number(odometerValue))}
                  >
                    Save
                  </Button>
                  <Button onClick={() => setOdometerOpen(false)} variant="text">
                    Cancel
                  </Button>
                </div>
              </Popover>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Scheduled</h3>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAddSchedule(true)} size="sm" variant="outlined">
              Add
            </Button>
            <Link
              className={buttonClassName({
                className: 'no-underline',
                size: 'sm',
                variant: 'outlined',
              })}
              to={`/vehicles/${id}/schedules`}
            >
              View all
            </Link>
          </div>
        </div>

        <ul className="divide-y divide-line">
          {visibleSchedules.map(schedule => {
            const due = dueBySchedule.get(schedule.id)
            return (
              <li
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                key={schedule.id}
              >
                <div className="min-w-0">
                  <p className="font-medium">{schedule.name}</p>
                  <p className="text-sm text-ink-muted">
                    {describeSchedule(schedule, vehicle.displayUnit)}
                  </p>
                  {schedule.notes ? (
                    <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{schedule.notes}</p>
                  ) : null}
                  {due ? (
                    <p className={`mt-1 font-mono text-xs uppercase ${statusClass(due.status)}`}>
                      {statusLabel(due.status)}
                      {due.dueDate ? ` · ${formatDate(due.dueDate)}` : ''}
                      {due.dueOdometerKm != null
                        ? ` · ${distanceLabel(due.dueOdometerKm, vehicle.displayUnit)}`
                        : ''}
                    </p>
                  ) : null}
                </div>
                <IconButton
                  aria-label="Edit schedule"
                  icon={<PencilIcon />}
                  onClick={() => setEditSchedule(schedule)}
                  size="sm"
                  tooltip={{ content: 'Edit schedule' }}
                />
              </li>
            )
          })}
          {rankedSchedules.length === 0 ? (
            <li className="py-2 text-sm text-ink-muted">No schedules yet.</li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">History</h3>
          <Link
            className={buttonClassName({
              className: 'no-underline',
              size: 'sm',
              variant: 'outlined',
            })}
            to={`/vehicles/${id}/history`}
          >
            Show all
          </Link>
        </div>
        <ul className="divide-y divide-line">
          {visibleLogs.map(log => {
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
                  {scheduleName ? (
                    <p className="mt-1 line-clamp-2 text-sm">{scheduleName}</p>
                  ) : null}
                  {log.notes ? (
                    <p
                      className={`line-clamp-2 text-sm ${
                        scheduleName ? 'mt-0.5 text-ink-muted' : 'mt-1'
                      }`}
                    >
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
            <li className="py-2 text-sm text-ink-muted">No history yet.</li>
          ) : null}
        </ul>
      </section>

      {editVehicle ? (
        <Dialog onClose={() => setEditVehicle(false)} title="Edit vehicle">
          <VehicleEditForm
            onArchive={() => setConfirmArchive(true)}
            onCancel={() => setEditVehicle(false)}
            onSubmit={values => updateVehicle.mutate(values)}
            pending={updateVehicle.isPending}
            vehicle={vehicle}
          />
        </Dialog>
      ) : null}

      {addSchedule ? (
        <Dialog onClose={() => setAddSchedule(false)} title="Add schedule">
          <ScheduleForm
            displayUnit={vehicle.displayUnit}
            onCancel={() => setAddSchedule(false)}
            onSubmit={values => {
              createSchedule.mutate(values, { onSuccess: () => setAddSchedule(false) })
            }}
            pending={createSchedule.isPending}
          />
        </Dialog>
      ) : null}

      {editSchedule ? (
        <Dialog onClose={() => setEditSchedule(null)} title="Edit schedule">
          <ScheduleForm
            displayUnit={vehicle.displayUnit}
            initial={{
              activePeriod: editSchedule.activePeriod as ScheduleInput['activePeriod'],
              frequencyMode: editSchedule.frequencyMode as ScheduleInput['frequencyMode'],
              intervalKm: editSchedule.intervalKm,
              intervalMonths: editSchedule.intervalMonths,
              name: editSchedule.name,
              notes: editSchedule.notes,
              seasons: editSchedule.seasons as ScheduleInput['seasons'],
            }}
            onCancel={() => setEditSchedule(null)}
            onSubmit={values =>
              updateSchedule.mutate({ body: values, scheduleId: editSchedule.id })
            }
            pending={updateSchedule.isPending}
            submitLabel="Save changes"
          />
          <Button
            className="mt-3"
            color="error"
            onClick={() => setConfirmDeleteSchedule(true)}
            variant="text"
          >
            Delete schedule
          </Button>
        </Dialog>
      ) : null}

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
        confirmLabel="Archive"
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => archiveMutation.mutate()}
        open={confirmArchive}
        pending={archiveMutation.isPending}
        title="Archive this vehicle?"
      >
        <p className="text-sm text-ink-muted">It will be hidden from your garage.</p>
      </AlertDialog>

      <AlertDialog
        onClose={() => setConfirmDeleteSchedule(false)}
        onConfirm={() => {
          if (editSchedule) deleteSchedule.mutate(editSchedule.id)
        }}
        open={confirmDeleteSchedule}
        pending={deleteSchedule.isPending}
        title="Delete this schedule?"
      >
        <p className="text-sm text-ink-muted">This cannot be undone.</p>
      </AlertDialog>

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

interface VehicleEditFormProps {
  onArchive: () => void
  onCancel: () => void
  onSubmit: (values: Record<string, unknown>) => void
  pending: boolean
  vehicle: Vehicle
}

function VehicleEditForm({
  onArchive,
  onCancel,
  onSubmit,
  pending,
  vehicle,
}: VehicleEditFormProps) {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    onSubmit({
      displayUnit: String(form.get('displayUnit')),
      make: String(form.get('make') || ''),
      model: String(form.get('model') || ''),
      name: String(form.get('name') || ''),
      vin: String(form.get('vin') || '') || null,
      year: Number(form.get('year')),
    })
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <label className="block text-sm">
        Name
        <input
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          defaultValue={vehicle.name}
          name="name"
          required
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          Year
          <input
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            defaultValue={vehicle.year}
            name="year"
            required
            type="number"
          />
        </label>
        <label className="block text-sm">
          Display unit
          <select
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            defaultValue={vehicle.displayUnit}
            name="displayUnit"
          >
            <option value="km">Kilometers</option>
            <option value="mi">Miles</option>
          </select>
        </label>
      </div>
      <label className="block text-sm">
        Make
        <input
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          defaultValue={vehicle.make}
          name="make"
          required
        />
      </label>
      <label className="block text-sm">
        Model
        <input
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          defaultValue={vehicle.model}
          name="model"
          required
        />
      </label>
      <label className="block text-sm">
        VIN
        <input
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          defaultValue={vehicle.vin ?? ''}
          name="vin"
        />
      </label>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button loading={pending} type="submit">
          Save
        </Button>
        <Button onClick={onCancel} variant="text">
          Cancel
        </Button>
        <Button className="ml-auto" color="error" onClick={onArchive} variant="text">
          Archive
        </Button>
      </div>
    </form>
  )
}
