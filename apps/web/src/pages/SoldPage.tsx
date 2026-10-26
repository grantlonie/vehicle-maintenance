import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { PlusIcon } from '../components/icons'
import { api, authedUrl } from '../lib/api'
import { distanceLabel, vehicleSubtitle } from '../lib/format'
import { useDisplayUnit } from '../lib/settings'
import type { Vehicle } from '../lib/types'

export function SoldPage() {
  const unit = useDisplayUnit()
  const queryClient = useQueryClient()

  const vehiclesQuery = useQuery({
    queryFn: () => api<{ vehicles: Vehicle[] }>('/api/vehicles?archived=1'),
    queryKey: ['vehicles', 'archived'],
  })

  const unarchiveMutation = useMutation({
    mutationFn: (vehicleId: string) =>
      api(`/api/vehicles/${vehicleId}/unarchive`, { method: 'POST' }),
    onSuccess: async (_data, vehicleId) => {
      await queryClient.invalidateQueries({ queryKey: ['due'] })
      await queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] })
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    },
  })

  const vehicles = vehiclesQuery.data?.vehicles ?? []

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <Link className="text-sm text-ink-muted hover:text-accent" to="/">
          ← Garage
        </Link>
        <h2 className="text-xl font-semibold">Sold vehicles</h2>
      </section>

      {vehiclesQuery.isLoading ? <p className="text-ink-muted">Loading…</p> : null}

      <section className="grid gap-4 sm:grid-cols-2">
        {vehicles.map(vehicle => (
          <article
            className="overflow-hidden rounded-xl border border-line bg-panel/90 shadow-sm"
            key={vehicle.id}
          >
            <Link className="block no-underline" to={`/vehicles/${vehicle.id}`}>
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
              </div>
            </Link>
            <div className="px-4 pb-4">
              <Button
                leftIcon={<PlusIcon />}
                loading={unarchiveMutation.isPending && unarchiveMutation.variables === vehicle.id}
                onClick={() => unarchiveMutation.mutate(vehicle.id)}
                size="sm"
                variant="outlined"
              >
                Add to garage
              </Button>
            </div>
          </article>
        ))}
      </section>

      {vehicles.length === 0 && !vehiclesQuery.isLoading ? (
        <p className="text-ink-muted">No sold vehicles.</p>
      ) : null}
    </div>
  )
}
