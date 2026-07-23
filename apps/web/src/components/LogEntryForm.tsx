import { centsToDollars, dollarsToCents, formatUsd } from '@vehicles/shared'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { roundInput } from '../lib/format'
import type { LogEntry, Schedule, Vehicle } from '../lib/types'

export interface LogFormValues {
  costEnteredCents: number | null
  costEnteredCurrency: 'USD' | 'CAD' | null
  costUsdCents: number | null
  fxFetchedAt: string | null
  fxRateToUsd: number | null
  kind: 'service' | 'repair'
  notes: string | null
  odometer: number
  odometerUnit: 'km' | 'mi'
  performedBy: 'self' | 'shop'
  performedOn: string
  scheduleId: string | null
  shopName: string | null
}

interface LogEntryFormProps {
  initial?: LogEntry
  onCancel?: () => void
  onSubmit: (values: LogFormValues) => void
  pending?: boolean
  schedules: Schedule[]
  submitLabel?: string
  vehicle: Vehicle
}

export function LogEntryForm({
  initial,
  onCancel,
  onSubmit,
  pending,
  schedules,
  submitLabel = 'Save entry',
  vehicle,
}: LogEntryFormProps) {
  const [kind, setKind] = useState<'service' | 'repair'>(initial?.kind ?? 'service')
  const [performedBy, setPerformedBy] = useState<'self' | 'shop'>(initial?.performedBy ?? 'self')
  const [currency, setCurrency] = useState<'USD' | 'CAD'>(
    (initial?.costEnteredCurrency as 'USD' | 'CAD' | null) ?? 'CAD'
  )
  const [amount, setAmount] = useState(
    initial?.costEnteredCents != null
      ? String(centsToDollars(initial.costEnteredCents))
      : initial?.costUsdCents != null
        ? String(centsToDollars(initial.costUsdCents))
        : ''
  )
  const [error, setError] = useState('')

  const fxQuery = useQuery({
    enabled: currency === 'CAD',
    queryFn: () => api<{ fetchedAt: string; rate: number }>('/api/fx/cad-usd'),
    queryKey: ['fx', 'cad-usd'],
    refetchInterval: 30 * 60 * 1000,
  })

  const usdPreview = useMemo(() => {
    const dollars = Number(amount)
    if (!amount || Number.isNaN(dollars)) return null
    const cents = dollarsToCents(dollars)
    if (currency === 'USD') return cents
    if (!fxQuery.data?.rate) return null
    return Math.round(cents * fxQuery.data.rate)
  }, [amount, currency, fxQuery.data?.rate])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (currency === 'CAD' && amount && !fxQuery.data?.rate) {
      setError('CAD conversion unavailable. Enter USD or try again.')
      return
    }
    const data = new FormData(event.currentTarget)
    onSubmit({
      costEnteredCents: amount ? dollarsToCents(Number(amount)) : null,
      costEnteredCurrency: amount ? currency : null,
      costUsdCents: currency === 'USD' && amount ? dollarsToCents(Number(amount)) : null,
      fxFetchedAt: currency === 'CAD' ? fxQuery.data?.fetchedAt ?? null : null,
      fxRateToUsd: currency === 'CAD' ? fxQuery.data?.rate ?? null : null,
      kind,
      notes: String(data.get('notes') || '') || null,
      odometer: Number(data.get('odometer')),
      odometerUnit: vehicle.displayUnit,
      performedBy,
      performedOn: String(data.get('performedOn')),
      scheduleId: kind === 'service' ? String(data.get('scheduleId') || '') || null : null,
      shopName: performedBy === 'shop' ? String(data.get('shopName') || '') : null,
    })
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
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
          defaultValue={initial?.performedOn ?? new Date().toISOString().slice(0, 10)}
          name="performedOn"
          required
          type="date"
        />
      </label>

      <label className="block text-sm">
        Odometer ({vehicle.displayUnit})
        <input
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          defaultValue={
            initial
              ? roundInput(initial.odometerKm, vehicle.displayUnit)
              : roundInput(vehicle.currentOdometerKm, vehicle.displayUnit)
          }
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
            defaultValue={initial?.scheduleId ?? ''}
            name="scheduleId"
          >
            <option value="">None (ad-hoc)</option>
            {schedules.map(schedule => (
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
            defaultValue={initial?.shopName ?? ''}
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
          defaultValue={initial?.notes ?? ''}
          name="notes"
          rows={3}
        />
      </label>

      {error ? <p className="text-sm text-overdue">{error}</p> : null}

      <div className="flex gap-2">
        <button
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {submitLabel}
        </button>
        {onCancel ? (
          <button
            className="rounded-md border border-line px-4 py-2 text-sm"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  )
}
