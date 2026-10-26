import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AddVehicleDialog } from '../components/AddVehicleDialog'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import { EllipsisVerticalIcon, PlusIcon } from '../components/icons'
import { Popover } from '../components/Popover'
import { api, authedUrl } from '../lib/api'
import { distanceLabel, statusClass, statusLabel, vehicleSubtitle } from '../lib/format'
import { useDisplayUnit } from '../lib/settings'
import type { DueItem, Vehicle } from '../lib/types'

export function HomePage() {
  const unit = useDisplayUnit()
  const navigate = useNavigate()
  const moreAnchorRef = useRef<HTMLDivElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const vehiclesQuery = useQuery({
    queryFn: () => api<{ vehicles: Vehicle[] }>('/api/vehicles'),
    queryKey: ['vehicles'],
  })
  const dueQuery = useQuery({
    queryFn: () => api<{ items: DueItem[] }>('/api/due'),
    queryKey: ['due'],
  })

  function handleCreated(vehicle: Vehicle) {
    setShowForm(false)
    navigate(`/vehicles/${vehicle.id}`)
  }

  const vehicles = vehiclesQuery.data?.vehicles ?? []
  const dueItems = dueQuery.data?.items ?? []
  const attention = dueItems.filter(d => d.status === 'overdue' || d.status === 'soon')

  function openSoldVehicles() {
    setMoreOpen(false)
    navigate('/sold')
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Garage</h2>
          <p className="text-sm text-ink-muted">
            {attention.length} reminder{attention.length === 1 ? '' : 's'} need attention
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button leftIcon={<PlusIcon />} onClick={() => setShowForm(true)}>
            Add vehicle
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
            <Button className="w-full !justify-start" onClick={openSoldVehicles} variant="text">
              Sold vehicles
            </Button>
          </Popover>
        </div>
      </section>

      {showForm ? (
        <AddVehicleDialog
          onClose={() => setShowForm(false)}
          onCreated={handleCreated}
          vehicles={vehicles}
        />
      ) : null}

      {attention.length > 0 ? (
        <section className="rounded-xl border border-line bg-panel/80 p-4">
          <h3 className="font-medium">Needs attention</h3>
          <ul className="mt-3 space-y-2">
            {attention.map(item => (
              <li className="flex items-start justify-between gap-3 text-sm" key={item.scheduleId}>
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
                <p className="text-sm text-ink-muted">{vehicleSubtitle(vehicle)}</p>
                {vehicle.trackOdometer ? (
                  <p className="font-mono text-sm">
                    {distanceLabel(vehicle.currentOdometerKm, unit)}
                  </p>
                ) : null}
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
