import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type {
  BillOfSaleDetails,
  DisplayUnit,
  IntakePreview,
  VehicleIntake,
  VehicleType,
} from '@vehicles/shared'
import { toKm, VEHICLE_TYPE_LABELS } from '@vehicles/shared'
import { api, previewIntake, saveVehicleIntake } from '../lib/api'
import { distanceLabel, formatDate } from '../lib/format'
import {
  reviewStateFromPreview,
  selectedScheduleDrafts,
  toImportLogs,
  type ImportReviewState,
  type ScheduleOption,
} from '../lib/importReview'
import { useDisplayUnit } from '../lib/settings'
import type { Schedule, Vehicle } from '../lib/types'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { DocumentDropZone } from './DocumentDropZone'
import { ImportReview } from './ImportReview'
import { Switch } from './Switch'

type ScheduleSource = 'copy' | 'none' | 'recommended'

interface AddVehicleDialogProps {
  onClose: () => void
  onCreated: (vehicle: Vehicle) => void
  vehicles: Vehicle[]
}

interface DetailsState {
  copyFromVehicleId: string
  make: string
  model: string
  name: string
  odometer: string
  scheduleSource: ScheduleSource
  trackOdometer: boolean
  vehicleType: VehicleType
  vin: string
  year: string
}

const FORM_ID = 'add-vehicle-form'

export function AddVehicleDialog({ onClose, onCreated, vehicles }: AddVehicleDialogProps) {
  const queryClient = useQueryClient()
  const unit = useDisplayUnit()
  const [details, setDetails] = useState<DetailsState>(() => ({
    copyFromVehicleId: '',
    make: '',
    model: '',
    name: '',
    odometer: '',
    scheduleSource: 'recommended',
    trackOdometer: true,
    vehicleType: 'car',
    vin: '',
    year: '',
  }))
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<IntakePreview | null>(null)
  const [review, setReview] = useState<ImportReviewState | null>(null)

  const copying = details.scheduleSource === 'copy' && Boolean(details.copyFromVehicleId)
  const needsPreview = details.scheduleSource === 'recommended' || files.length > 0
  const step = preview && review ? 'review' : 'details'

  const sourceSchedulesQuery = useQuery({
    enabled: copying,
    queryFn: () =>
      api<{ schedules: Schedule[] }>(`/api/vehicles/${details.copyFromVehicleId}/schedules`),
    queryKey: ['schedules', details.copyFromVehicleId],
  })

  const previewMutation = useMutation({
    mutationFn: () =>
      previewIntake(
        {
          copyFromVehicleId: copying ? details.copyFromVehicleId : null,
          make: details.make.trim(),
          model: details.model.trim(),
          suggestSchedules: details.scheduleSource === 'recommended',
          vehicleType: details.vehicleType,
          vin: details.vin.trim() || null,
          year: Number(details.year),
        },
        files
      ),
    onSuccess: result => {
      setPreview(result)
      setReview(reviewStateFromPreview(result))
    },
  })

  const saveMutation = useMutation({
    mutationFn: (payload: VehicleIntake) => saveVehicleIntake<Vehicle>(payload, files),
    onSuccess: async vehicle => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['due'] }),
        queryClient.invalidateQueries({ queryKey: ['schedules'] }),
      ])
      onCreated(vehicle)
    },
  })

  const billOfSaleDocument = preview?.documents.find(doc => doc.billOfSale) ?? null

  const scheduleOptions: ScheduleOption[] = copying
    ? (sourceSchedulesQuery.data?.schedules ?? []).map(s => ({ key: s.id, name: s.name }))
    : review
      ? selectedScheduleDrafts(review).map(d => ({ key: d.key, name: d.schedule.name }))
      : []

  function patch(partial: Partial<DetailsState>) {
    setDetails(prev => ({ ...prev, ...partial }))
  }

  function handleDetailsSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (needsPreview) {
      previewMutation.mutate()
      return
    }
    save()
  }

  function save() {
    const schedules =
      details.scheduleSource === 'recommended' && review ? selectedScheduleDrafts(review) : []
    const logs = review
      ? toImportLogs(
          review,
          new Set(scheduleOptions.map(option => option.key)),
          details.trackOdometer
        )
      : []
    saveMutation.mutate({
      billOfSale: billOfSaleDocument?.billOfSale
        ? { ...billOfSaleDocument.billOfSale, documentIndex: billOfSaleDocument.index }
        : null,
      copyFromVehicleId: copying ? details.copyFromVehicleId : null,
      logs,
      schedules,
      vehicle: {
        make: details.make.trim(),
        model: details.model.trim(),
        name: details.name.trim(),
        odometer: Number(details.odometer || 0),
        odometerUnit: unit,
        trackOdometer: details.trackOdometer,
        vehicleType: details.vehicleType,
        vin: details.vin.trim() || null,
        year: Number(details.year),
      },
    })
  }

  function handleBack() {
    setPreview(null)
    setReview(null)
    saveMutation.reset()
  }

  const busy = previewMutation.isPending || saveMutation.isPending
  const error = previewMutation.error ?? saveMutation.error

  const footer =
    step === 'details' ? (
      <div className="flex items-center justify-end gap-2">
        <Button disabled={busy} onClick={onClose} variant="text">
          Cancel
        </Button>
        <Button form={FORM_ID} loading={busy} type="submit">
          {needsPreview ? (previewMutation.isPending ? 'Reading…' : 'Continue') : 'Save vehicle'}
        </Button>
      </div>
    ) : (
      <div className="flex items-center justify-between gap-2">
        <Button disabled={busy} onClick={handleBack} variant="text">
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button disabled={busy} onClick={onClose} variant="text">
            Cancel
          </Button>
          <Button loading={saveMutation.isPending} onClick={save}>
            Save vehicle
          </Button>
        </div>
      </div>
    )

  return (
    <Dialog
      backdrop={{ clickaway: false }}
      footer={footer}
      onClose={busy ? () => undefined : onClose}
      size="full"
      title={step === 'details' ? 'Add vehicle' : `Review ${details.name || 'vehicle'}`}
    >
      {step === 'details' ? (
        <form className="grid gap-3 sm:grid-cols-2" id={FORM_ID} onSubmit={handleDetailsSubmit}>
          <label className="block text-sm sm:col-span-2">
            Type
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
              onChange={e => {
                const vehicleType = e.target.value as VehicleType
                patch({
                  trackOdometer: vehicleType !== 'towable',
                  vehicleType,
                })
              }}
              value={details.vehicleType}
            >
              {Object.entries(VEHICLE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="Name"
            onChange={name => patch({ name })}
            required
            value={details.name}
          />
          <TextField
            label="Year"
            onChange={year => patch({ year })}
            required
            type="number"
            value={details.year}
          />
          <TextField
            label="Make"
            onChange={make => patch({ make })}
            required
            value={details.make}
          />
          <TextField
            label="Model"
            onChange={model => patch({ model })}
            required
            value={details.model}
          />
          <TextField label="VIN" onChange={vin => patch({ vin })} value={details.vin} />
          {details.vehicleType === 'towable' ? (
            <div className="sm:col-span-2">
              <Switch
                checked={details.trackOdometer}
                description="When off, log entries hide odometer and do not save it. You can change this later in trailer settings."
                label="Track odometer"
                onChange={trackOdometer => patch({ trackOdometer })}
              />
            </div>
          ) : null}
          <TextField
            label={details.trackOdometer ? `Odometer (${unit})` : `Odometer (${unit}, optional)`}
            min={0}
            onChange={odometer => patch({ odometer })}
            required={details.trackOdometer}
            type="number"
            value={details.odometer}
          />

          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-sm font-medium">Maintenance schedule</legend>
            <ScheduleSourceOption
              checked={details.scheduleSource === 'recommended'}
              description={
                details.vehicleType === 'car'
                  ? 'Suggested from the year, make, and model (and VIN when entered). You review it before saving.'
                  : 'Suggested from the type, year, make, and model, including RV systems like the roof, water, LP, and winterizing. You review it before saving.'
              }
              label="Recommended schedule"
              onSelect={() => patch({ scheduleSource: 'recommended' })}
            />
            {vehicles.length > 0 ? (
              <ScheduleSourceOption
                checked={details.scheduleSource === 'copy'}
                label="Copy from another vehicle"
                onSelect={() =>
                  patch({
                    copyFromVehicleId: details.copyFromVehicleId || vehicles[0]!.id,
                    scheduleSource: 'copy',
                  })
                }
              />
            ) : null}
            {details.scheduleSource === 'copy' ? (
              <select
                className="ml-6 w-[calc(100%-1.5rem)] rounded-md border border-line bg-white px-3 py-2 text-sm"
                onChange={e => patch({ copyFromVehicleId: e.target.value })}
                value={details.copyFromVehicleId}
              >
                {vehicles.map(vehicle => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.name} ({vehicle.year} {vehicle.make} {vehicle.model})
                  </option>
                ))}
              </select>
            ) : null}
            <ScheduleSourceOption
              checked={details.scheduleSource === 'none'}
              label="None — start empty"
              onSelect={() => patch({ scheduleSource: 'none' })}
            />
          </fieldset>

          <div className="space-y-2 sm:col-span-2">
            <p className="text-sm font-medium">History documents (optional)</p>
            <p className="text-xs text-ink-muted">
              Past service found in these files is listed for review before anything is saved. A
              bill of sale fills in the purchase date and odometer under Ownership.
            </p>
            <DocumentDropZone disabled={busy} files={files} onChange={setFiles} />
          </div>

          {previewMutation.isPending ? (
            <p className="text-sm text-ink-muted sm:col-span-2">
              Reading documents and building a schedule. This can take a minute.
            </p>
          ) : null}
          {error ? <p className="text-sm text-overdue sm:col-span-2">{error.message}</p> : null}
        </form>
      ) : (
        <div className="space-y-3">
          {billOfSaleDocument?.billOfSale ? (
            <section className="space-y-1">
              <h4 className="font-semibold">Ownership</h4>
              <p className="text-sm text-ink-muted">
                {describePurchase(billOfSaleDocument.billOfSale, unit)} from the bill of sale in{' '}
                {billOfSaleDocument.filename}. It&apos;s saved to the vehicle&apos;s purchase
                details.
              </p>
            </section>
          ) : null}
          <ImportReview
            documents={preview!.documents}
            onChange={setReview}
            scheduleError={preview!.scheduleError}
            scheduleOptions={scheduleOptions}
            showSchedules={details.scheduleSource === 'recommended'}
            state={review!}
            trackOdometer={details.trackOdometer}
            vinDecode={preview!.vinDecode}
          />
          {copying ? (
            <p className="text-sm text-ink-muted">
              Schedules will be copied from{' '}
              {vehicles.find(v => v.id === details.copyFromVehicleId)?.name ??
                'the selected vehicle'}
              .
            </p>
          ) : null}
          {saveMutation.error ? (
            <p className="text-sm text-overdue">{saveMutation.error.message}</p>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}

function describePurchase(details: BillOfSaleDetails, unit: DisplayUnit): string {
  const parts = [
    details.purchasedOn ? formatDate(details.purchasedOn) : null,
    details.odometer != null
      ? distanceLabel(toKm(details.odometer, details.odometerUnit), unit)
      : null,
  ].filter(Boolean)
  return parts.length > 0 ? `Purchased ${parts.join(' at ')}` : 'Purchase document found'
}

interface ScheduleSourceOptionProps {
  checked: boolean
  description?: string
  label: string
  onSelect: () => void
}

function ScheduleSourceOption({
  checked,
  description,
  label,
  onSelect,
}: ScheduleSourceOptionProps) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input checked={checked} className="mt-1" onChange={onSelect} type="radio" />
      <span>
        {label}
        {description ? <span className="block text-xs text-ink-muted">{description}</span> : null}
      </span>
    </label>
  )
}

interface TextFieldProps {
  label: string
  min?: number
  onChange: (value: string) => void
  required?: boolean
  type?: string
  value: string
}

function TextField({ label, min, onChange, required, type = 'text', value }: TextFieldProps) {
  return (
    <label className="block text-sm">
      {label}
      <input
        className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
        min={min}
        onChange={e => onChange(e.target.value)}
        required={required}
        step={type === 'number' ? 'any' : undefined}
        type={type}
        value={value}
      />
    </label>
  )
}
