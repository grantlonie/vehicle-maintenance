import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { ScheduleInput } from '@vehicles/shared'
import { VEHICLE_TYPE_LABELS } from '@vehicles/shared'
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
import {
  EllipsisVerticalIcon,
  ExportIcon,
  PdfFileIcon,
  PencilIcon,
  PlusIcon,
  SoldIcon,
  TrashIcon,
} from '../components/icons'
import { OwnershipDialog } from '../components/OwnershipDialog'
import { Popover } from '../components/Popover'
import { ScheduleForm, useCreateSchedule } from '../components/ScheduleForm'
import { ScheduleListItem } from '../components/ScheduleListItem'
import { SellVehicleDialog } from '../components/SellVehicleDialog'
import { api, authedUrl, downloadExport, getToken, uploadLogAttachments } from '../lib/api'
import { distanceLabel, formatDate, moneyLabel, roundInput, vehicleSubtitle } from '../lib/format'
import { logPageState, type VehiclePageLocationState } from '../lib/logEntryFlow'
import { rankSchedules } from '../lib/schedules'
import { useDisplayUnit } from '../lib/settings'
import type { DueItem, LogEntry, Schedule, Vehicle, VehicleDocument } from '../lib/types'

const PREVIEW_COUNT = 5

export function VehiclePage() {
  const unit = useDisplayUnit()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const odometerInputRef = useRef<HTMLInputElement>(null)
  const odometerAnchorRef = useRef<HTMLDivElement>(null)
  const moreAnchorRef = useRef<HTMLDivElement>(null)

  const [moreOpen, setMoreOpen] = useState(false)
  const [odometerOpen, setOdometerOpen] = useState(false)
  const [odometerValue, setOdometerValue] = useState('')
  const [editVehicle, setEditVehicle] = useState(false)
  const [addSchedule, setAddSchedule] = useState(false)
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null)
  const [editLog, setEditLog] = useState<LogEntry | null>(null)
  const [logChooserOpen, setLogChooserOpen] = useState(false)
  const [ownershipOpen, setOwnershipOpen] = useState(false)
  const [sellOpen, setSellOpen] = useState(false)
  const [confirmDeleteSchedule, setConfirmDeleteSchedule] = useState(false)
  const [confirmDeleteLog, setConfirmDeleteLog] = useState(false)
  const [deleteDocument, setDeleteDocument] = useState<VehicleDocument | null>(null)
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
  const documentsQuery = useQuery({
    queryFn: () => api<{ documents: VehicleDocument[] }>(`/api/vehicles/${id}/documents`),
    queryKey: ['documents', id],
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
          odometerUnit: unit,
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
      pendingFiles,
      removedAttachmentIds,
      values,
    }: {
      logId: string
      pendingFiles: File[]
      removedAttachmentIds: string[]
      values: LogFormValues
    }) => {
      await api(`/api/logs/${logId}`, { body: JSON.stringify(values), method: 'PATCH' })
      for (const attachmentId of removedAttachmentIds) {
        await api(`/api/attachments/${attachmentId}`, { method: 'DELETE' })
      }
      await uploadLogAttachments(logId, pendingFiles)
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

  const deleteDocumentMutation = useMutation({
    mutationFn: (documentId: string) => api(`/api/documents/${documentId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeleteDocument(null)
      await queryClient.invalidateQueries({ queryKey: ['documents', id] })
    },
  })

  const unarchiveMutation = useMutation({
    mutationFn: () => api(`/api/vehicles/${id}/unarchive`, { method: 'POST' }),
    onSuccess: async () => {
      setMoreOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      await queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
      navigate('/')
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
  const documents = documentsQuery.data?.documents ?? []
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
    setOdometerValue(String(roundInput(vehicle!.currentOdometerKm, unit)))
    setOdometerOpen(true)
    requestAnimationFrame(() => odometerInputRef.current?.select())
  }

  function handleLogChooser(result: LogEntryChooserResult) {
    setLogChooserOpen(false)
    navigate(`/vehicles/${id}/log`, { state: logPageState(result) })
  }

  function handleLogSchedule(scheduleId: string) {
    navigate(`/vehicles/${id}/log`, { state: logPageState({ scheduleId }) })
  }

  function handleExport() {
    setMoreOpen(false)
    void downloadExport(id)
  }

  function handleEdit() {
    setMoreOpen(false)
    setEditVehicle(true)
  }

  function handleOwnership() {
    setMoreOpen(false)
    setOwnershipOpen(true)
  }

  function handleSell() {
    setOwnershipOpen(false)
    setSellOpen(true)
  }

  async function handleSold() {
    setSellOpen(false)
    await queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
    await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    await queryClient.invalidateQueries({ queryKey: ['due'] })
    await queryClient.invalidateQueries({ queryKey: ['bill-of-sale', id] })
    navigate('/')
  }

  function handleAddToGarage() {
    unarchiveMutation.mutate()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          className="text-sm text-ink-muted hover:text-accent"
          to={vehicle.archivedAt ? '/sold' : '/'}
        >
          {vehicle.archivedAt ? '← Sold vehicles' : '← Garage'}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Button leftIcon={<PlusIcon />} onClick={() => setLogChooserOpen(true)}>
            Log entry
          </Button>
          <div ref={moreAnchorRef}>
            <IconButton
              aria-label="More"
              icon={<EllipsisVerticalIcon />}
              onClick={() => setMoreOpen(open => !open)}
              tooltip={{ content: 'More' }}
            />
          </div>
          <Popover
            anchorRef={moreAnchorRef}
            onClose={() => setMoreOpen(false)}
            open={moreOpen}
            widthClassName="w-48"
          >
            <div className="flex flex-col">
              <Button
                className="w-full !justify-start"
                leftIcon={<PencilIcon />}
                onClick={handleEdit}
                variant="text"
              >
                Edit
              </Button>
              <Button
                className="w-full !justify-start"
                leftIcon={<SoldIcon />}
                onClick={handleOwnership}
                variant="text"
              >
                Ownership
              </Button>
              <Button
                className="w-full !justify-start"
                leftIcon={<ExportIcon />}
                onClick={handleExport}
                variant="text"
              >
                Export
              </Button>
              {vehicle.archivedAt ? (
                <Button
                  className="w-full !justify-start"
                  leftIcon={<PlusIcon />}
                  loading={unarchiveMutation.isPending}
                  onClick={handleAddToGarage}
                  variant="text"
                >
                  Add to garage
                </Button>
              ) : null}
            </div>
          </Popover>
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
            <h2 className="text-2xl font-semibold tracking-tight">{vehicle.name}</h2>
            <p className="text-ink-muted">{vehicleSubtitle(vehicle)}</p>
            <div className="mt-2 flex items-center gap-1" ref={odometerAnchorRef}>
              <p className="font-mono text-lg">{distanceLabel(vehicle.currentOdometerKm, unit)}</p>
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
                  Odometer ({unit})
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
            <Button
              leftIcon={<PlusIcon />}
              onClick={() => setAddSchedule(true)}
              size="sm"
              variant="outlined"
            >
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
          {visibleSchedules.map(schedule => (
            <ScheduleListItem
              clampNotes
              due={dueBySchedule.get(schedule.id)}
              key={schedule.id}
              onEdit={() => setEditSchedule(schedule)}
              onLog={() => handleLogSchedule(schedule.id)}
              schedule={schedule}
              unit={unit}
            />
          ))}
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
                    {distanceLabel(log.odometerKm, unit)} ·{' '}
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

      {documents.length > 0 ? (
        <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
          <h3 className="mb-3 font-semibold">Documents</h3>
          <ul className="divide-y divide-line">
            {documents.map(doc => (
              <li
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                key={doc.id}
              >
                <a
                  className="flex min-w-0 items-center gap-2 text-sm text-ink hover:text-accent"
                  href={authedUrl(doc.url)}
                  rel="noreferrer"
                  target="_blank"
                >
                  <PdfFileIcon />
                  <span className="truncate">{doc.originalFilename}</span>
                </a>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="text-xs text-ink-muted">
                    {formatDate(doc.createdAt.slice(0, 10))}
                  </span>
                  <IconButton
                    aria-label="Delete document"
                    icon={<TrashIcon />}
                    onClick={() => setDeleteDocument(doc)}
                    size="sm"
                    tooltip={{ content: 'Delete document' }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editVehicle ? (
        <Dialog onClose={() => setEditVehicle(false)} title="Edit vehicle">
          <VehicleEditForm
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
          onSubmit={({ pendingFiles, removedAttachmentIds, values }: LogFormSubmit) =>
            updateLog.mutate({ logId: editLog.id, pendingFiles, removedAttachmentIds, values })
          }
          pending={updateLog.isPending}
          schedules={schedulesQuery.data?.schedules ?? []}
          variant="dialog"
          vehicle={vehicle}
        />
      ) : null}

      <LogEntryChooserDialog
        currentOdometerKm={vehicle.currentOdometerKm}
        onChoose={handleLogChooser}
        onClose={() => setLogChooserOpen(false)}
        open={logChooserOpen}
        vehicleId={vehicle.id}
      />

      {ownershipOpen ? (
        <OwnershipDialog
          onClose={() => setOwnershipOpen(false)}
          onSell={handleSell}
          vehicle={vehicle}
        />
      ) : null}

      {sellOpen ? (
        <SellVehicleDialog
          onClose={() => setSellOpen(false)}
          onSold={handleSold}
          vehicle={vehicle}
        />
      ) : null}

      <AlertDialog
        onClose={() => setDeleteDocument(null)}
        onConfirm={() => {
          if (deleteDocument) deleteDocumentMutation.mutate(deleteDocument.id)
        }}
        open={deleteDocument != null}
        pending={deleteDocumentMutation.isPending}
        title="Delete this document?"
      >
        <p className="text-sm text-ink-muted">
          History entries from this document stay; they just lose the link to this file.
        </p>
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
  onCancel: () => void
  onSubmit: (values: Record<string, unknown>) => void
  pending: boolean
  vehicle: Vehicle
}

function VehicleEditForm({ onCancel, onSubmit, pending, vehicle }: VehicleEditFormProps) {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    onSubmit({
      make: String(form.get('make') || ''),
      model: String(form.get('model') || ''),
      name: String(form.get('name') || ''),
      vehicleType: String(form.get('vehicleType')),
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
      <label className="block text-sm">
        Type
        <select
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          defaultValue={vehicle.vehicleType}
          name="vehicleType"
        >
          {Object.entries(VEHICLE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
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
      </div>
    </form>
  )
}
