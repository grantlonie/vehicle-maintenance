import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { dollarsToCents, formatUsd } from '@vehicles/shared'
import { api, getToken } from '../lib/api'
import { roundInput } from '../lib/format'
import type { Schedule, Vehicle } from '../lib/types'

export function LogPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [kind, setKind] = useState<'service' | 'repair'>('service')
  const [performedBy, setPerformedBy] = useState<'self' | 'shop'>('self')
  const [currency, setCurrency] = useState<'USD' | 'CAD'>('CAD')
  const [amount, setAmount] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const [error, setError] = useState('')

  const vehicleQuery = useQuery({
    queryFn: () => api<Vehicle>(`/api/vehicles/${id}`),
    queryKey: ['vehicle', id],
  })
  const schedulesQuery = useQuery({
    queryFn: () => api<{ schedules: Schedule[] }>(`/api/vehicles/${id}/schedules`),
    queryKey: ['schedules', id],
  })
  const fxQuery = useQuery({
    enabled: currency === 'CAD',
    queryFn: () => api<{ fetchedAt: string; rate: number }>('/api/fx/cad-usd'),
    queryKey: ['fx', 'cad-usd'],
    refetchInterval: 30 * 60 * 1000,
  })

  const vehicle = vehicleQuery.data
  const usdPreview = useMemo(() => {
    const dollars = Number(amount)
    if (!amount || Number.isNaN(dollars)) return null
    const cents = dollarsToCents(dollars)
    if (currency === 'USD') return cents
    if (!fxQuery.data?.rate) return null
    return Math.round(cents * fxQuery.data.rate)
  }, [amount, currency, fxQuery.data?.rate])

  useEffect(() => {
    if (kind === 'repair') setPerformedBy(prev => prev)
  }, [kind])

  const saveMutation = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      const data = new FormData(form)
      const body = {
        costEnteredCents: amount ? dollarsToCents(Number(amount)) : null,
        costEnteredCurrency: amount ? currency : null,
        costUsdCents: currency === 'USD' && amount ? dollarsToCents(Number(amount)) : null,
        fxFetchedAt: currency === 'CAD' ? fxQuery.data?.fetchedAt ?? null : null,
        fxRateToUsd: currency === 'CAD' ? fxQuery.data?.rate ?? null : null,
        kind,
        notes: String(data.get('notes') || '') || null,
        odometer: Number(data.get('odometer')),
        odometerUnit: vehicle!.displayUnit,
        performedBy,
        performedOn: String(data.get('performedOn')),
        scheduleId: kind === 'service' ? String(data.get('scheduleId') || '') || null : null,
        shopName: performedBy === 'shop' ? String(data.get('shopName') || '') : null,
      }

      const log = await api<{ id: string }>(`/api/vehicles/${id}/logs`, {
        body: JSON.stringify(body),
        method: 'POST',
      })

      if (files) {
        for (const file of Array.from(files)) {
          const formData = new FormData()
          formData.append('file', file)
          const response = await fetch(`/api/logs/${log.id}/attachments`, {
            body: formData,
            headers: { Authorization: `Bearer ${getToken()}` },
            method: 'POST',
          })
          if (!response.ok) throw new Error('Attachment upload failed')
        }
      }

      return log
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['logs', id] })
      await queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
      navigate(`/vehicles/${id}`)
    },
  })

  if (!vehicle) return <p className="text-ink-muted">Loading…</p>

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (currency === 'CAD' && amount && !fxQuery.data?.rate) {
      setError('CAD conversion unavailable. Enter USD or try again.')
      return
    }
    saveMutation.mutate(event.currentTarget, {
      onError: err => setError(err instanceof Error ? err.message : 'Save failed'),
    })
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link className="text-sm text-ink-muted hover:text-accent" to={`/vehicles/${id}`}>
          ← {vehicle.name}
        </Link>
        <h2 className="mt-2 text-2xl font-semibold">Log entry</h2>
      </div>

      <form className="space-y-4 rounded-xl border border-line bg-panel p-4" onSubmit={handleSubmit}>
        <div className="flex gap-2">
          {(['service', 'repair'] as const).map(value => (
            <button
              className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                kind === value ? 'border-accent bg-accent text-white' : 'border-line bg-white'
              }`}
              key={value}
              onClick={() => setKind(value)}
              type="button"
            >
              {value}
            </button>
          ))}
        </div>

        <label className="block text-sm">
          Date
          <input
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            defaultValue={new Date().toISOString().slice(0, 10)}
            name="performedOn"
            required
            type="date"
          />
        </label>

        <label className="block text-sm">
          Odometer ({vehicle.displayUnit})
          <input
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            defaultValue={roundInput(vehicle.currentOdometerKm, vehicle.displayUnit)}
            min={0}
            name="odometer"
            required
            step="any"
            type="number"
          />
        </label>

        {kind === 'service' ? (
          <label className="block text-sm">
            Schedule
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
              defaultValue=""
              name="scheduleId"
            >
              <option value="">None (ad-hoc)</option>
              {(schedulesQuery.data?.schedules ?? []).map(schedule => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Who did it</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={performedBy === 'self'}
              onChange={() => setPerformedBy('self')}
              type="radio"
            />
            Self
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={performedBy === 'shop'}
              onChange={() => setPerformedBy('shop')}
              type="radio"
            />
            Shop
          </label>
          {performedBy === 'shop' ? (
            <input
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              name="shopName"
              placeholder="Shop name"
              required
            />
          ) : null}
        </fieldset>

        <div className="space-y-2">
          <div className="flex gap-2">
            {(['CAD', 'USD'] as const).map(value => (
              <button
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  currency === value ? 'border-accent bg-accent text-white' : 'border-line bg-white'
                }`}
                key={value}
                onClick={() => setCurrency(value)}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>
          <label className="block text-sm">
            Cost ({currency})
            <input
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
              min={0}
              onChange={e => setAmount(e.target.value)}
              step="0.01"
              type="number"
              value={amount}
            />
          </label>
          {currency === 'CAD' ? (
            <p className="text-xs text-ink-muted">
              {fxQuery.isError
                ? 'Could not load CAD→USD rate'
                : fxQuery.data
                  ? `Rate ${fxQuery.data.rate.toFixed(4)} · stores as ${
                      usdPreview != null ? formatUsd(usdPreview) : '—'
                    }`
                  : 'Loading rate…'}
            </p>
          ) : usdPreview != null ? (
            <p className="text-xs text-ink-muted">Stores as {formatUsd(usdPreview)}</p>
          ) : null}
        </div>

        <label className="block text-sm">
          Notes
          <textarea
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            name="notes"
            rows={3}
          />
        </label>

        <label className="block text-sm">
          Attachments
          <input
            className="mt-1 block w-full text-sm"
            multiple
            onChange={e => setFiles(e.target.files)}
            type="file"
          />
        </label>

        {error ? <p className="text-sm text-overdue">{error}</p> : null}

        <button
          className="w-full rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-60"
          disabled={saveMutation.isPending}
          type="submit"
        >
          Save entry
        </button>
      </form>
    </div>
  )
}
