import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, authedUrl } from '../lib/api'
import { distanceLabel, statusClass, statusLabel } from '../lib/format'
import type { DueItem, Vehicle } from '../lib/types'

export function HomePage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)

  const vehiclesQuery = useQuery({
    queryFn: () => api<{ vehicles: Vehicle[] }>('/api/vehicles'),
    queryKey: ['vehicles'],
  })
  const dueQuery = useQuery({
    queryFn: () => api<{ items: DueItem[] }>('/api/due'),
    queryKey: ['due'],
  })
  const settingsQuery = useQuery({
    queryFn: () => api<{ defaultDisplayUnit: 'km' | 'mi' }>('/api/settings'),
    queryKey: ['settings'],
  })

  const createMutation = useMutation({
    mutationFn: async (input: {
      copyFromVehicleId: string | null
      vehicle: Record<string, unknown>
    }) => {
      const created = await api<Vehicle>('/api/vehicles', {
        body: JSON.stringify(input.vehicle),
        method: 'POST',
      })
      if (input.copyFromVehicleId) {
        await api(`/api/vehicles/${created.id}/schedules/copy`, {
          body: JSON.stringify({ sourceVehicleId: input.copyFromVehicleId }),
          method: 'POST',
        })
      }
      return created
    },
    onSuccess: async () => {
      setShowForm(false)
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
      await queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
  })

  const vehicles = vehiclesQuery.data?.vehicles ?? []
  const dueItems = dueQuery.data?.items ?? []
  const attention = dueItems.filter(d => d.status === 'overdue' || d.status === 'soon')

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Garage</h2>
          <p className="text-sm text-ink-muted">
            {attention.length} reminder{attention.length === 1 ? '' : 's'} need attention
          </p>
        </div>
        <button
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark"
          onClick={() => setShowForm(v => !v)}
          type="button"
        >
          {showForm ? 'Cancel' : 'Add vehicle'}
        </button>
      </section>

      {showForm ? (
        <VehicleCreateForm
          defaultUnit={settingsQuery.data?.defaultDisplayUnit ?? 'km'}
          onSubmit={values => createMutation.mutate(values)}
          pending={createMutation.isPending}
          vehicles={vehicles}
        />
      ) : null}

      {attention.length > 0 ? (
        <section className="rounded-xl border border-line bg-panel/80 p-4">
          <h3 className="font-medium">Needs attention</h3>
          <ul className="mt-3 space-y-2">
            {attention.map(item => (
              <li
                className="flex items-start justify-between gap-3 text-sm"
                key={item.scheduleId}
              >
                <Link
                  className="min-w-0 flex-1 text-ink hover:text-accent"
                  to={`/vehicles/${item.vehicleId}`}
                >
                  {item.vehicleName} — {item.scheduleName}
                </Link>
                <span className={`shrink-0 font-mono uppercase ${statusClass(item.status)}`}>
                  {statusLabel(item.status)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        {vehicles.map(vehicle => {
          const vehicleDue = dueItems.filter(
            d => d.vehicleId === vehicle.id && (d.status === 'overdue' || d.status === 'soon')
          )
          return (
            <Link
              className="overflow-hidden rounded-xl border border-line bg-panel/90 no-underline shadow-sm transition hover:border-accent"
              key={vehicle.id}
              to={`/vehicles/${vehicle.id}`}
            >
              <div className="aspect-[16/9] bg-bg-deep">
                {vehicle.imageUrl ? (
                  <img
                    alt={vehicle.name}
                    className="h-full w-full object-cover"
                    src={authedUrl(vehicle.imageUrl)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest text-ink-muted">
                    No photo
                  </div>
                )}
              </div>
              <div className="space-y-1 p-4">
                <h3 className="text-lg font-semibold text-ink">{vehicle.name}</h3>
                <p className="text-sm text-ink-muted">
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </p>
                <p className="font-mono text-sm">
                  {distanceLabel(vehicle.currentOdometerKm, vehicle.displayUnit)}
                </p>
                <p className="text-xs text-ink-muted">
                  {vehicleDue.length ? `${vehicleDue.length} due / soon` : 'All caught up'}
                </p>
              </div>
            </Link>
          )
        })}
      </section>

      {vehicles.length === 0 && !showForm ? (
        <p className="text-ink-muted">No vehicles yet. Add your first one.</p>
      ) : null}
    </div>
  )
}

interface VehicleCreateFormProps {
  defaultUnit: 'km' | 'mi'
  onSubmit: (values: {
    copyFromVehicleId: string | null
    vehicle: Record<string, unknown>
  }) => void
  pending: boolean
  vehicles: Vehicle[]
}

function VehicleCreateForm({
  defaultUnit,
  onSubmit,
  pending,
  vehicles,
}: VehicleCreateFormProps) {
  const [displayUnit, setDisplayUnit] = useState<'km' | 'mi'>(defaultUnit)
  const [copyFromVehicleId, setCopyFromVehicleId] = useState('')

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    onSubmit({
      copyFromVehicleId: copyFromVehicleId || null,
      vehicle: {
        displayUnit,
        make: String(form.get('make') || ''),
        model: String(form.get('model') || ''),
        name: String(form.get('name') || ''),
        odometer: Number(form.get('odometer') || 0),
        odometerUnit: displayUnit,
        vin: String(form.get('vin') || '') || null,
        year: Number(form.get('year') || new Date().getFullYear()),
      },
    })
  }

  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2"
      onSubmit={handleSubmit}
    >
      <Field label="Name" name="name" required />
      <Field label="Year" name="year" required type="number" />
      <Field label="Make" name="make" required />
      <Field label="Model" name="model" required />
      <Field label="VIN" name="vin" />
      <label className="block text-sm">
        Odometer ({displayUnit})
        <input
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          min={0}
          name="odometer"
          required
          step="any"
          type="number"
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        Display unit
        <select
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          onChange={e => setDisplayUnit(e.target.value as 'km' | 'mi')}
          value={displayUnit}
        >
          <option value="km">Kilometers</option>
          <option value="mi">Miles</option>
        </select>
      </label>
      {vehicles.length > 0 ? (
        <label className="block text-sm sm:col-span-2">
          Copy schedules from
          <select
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            onChange={e => setCopyFromVehicleId(e.target.value)}
            value={copyFromVehicleId}
          >
            <option value="">None — start empty</option>
            {vehicles.map(vehicle => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.name} ({vehicle.year} {vehicle.make} {vehicle.model})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60 sm:col-span-2"
        disabled={pending}
        type="submit"
      >
        Save vehicle
      </button>
    </form>
  )
}

function Field({
  label,
  name,
  required,
  type = 'text',
}: {
  label: string
  name: string
  required?: boolean
  type?: string
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
        name={name}
        required={required}
        type={type}
      />
    </label>
  )
}
