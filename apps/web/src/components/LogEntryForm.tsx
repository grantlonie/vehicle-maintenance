import { useQuery } from '@tanstack/react-query'
import {
  centsToDollars,
  dollarsToCents,
  formatUsd,
  toKm,
  type ReceiptOcrPreview,
} from '@vehicles/shared'
import { isEqual } from 'lodash-es'
import { useId, useState } from 'react'
import { api } from '../lib/api'
import { roundInput } from '../lib/format'
import type { LogEntry, Schedule, Vehicle } from '../lib/types'
import { Button, DONE_SAVE_WIDTH } from './Button'
import { Dialog } from './Dialog'

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

interface LogFieldState {
  amount: string
  currency: 'USD' | 'CAD'
  kind: 'service' | 'repair'
  notes: string
  odometer: string
  performedBy: 'self' | 'shop'
  performedOn: string
  scheduleId: string
  shopName: string
}

interface LogEntryFormProps {
  initial?: LogEntry
  ocrDraft?: ReceiptOcrPreview
  onClose: () => void
  onDelete?: () => void
  onSubmit: (values: LogFormValues) => void
  pending?: boolean
  schedules: Schedule[]
  variant?: 'dialog' | 'page'
  vehicle: Vehicle
}

const FORM_ID = 'log-entry-form'

export function LogEntryForm({
  initial,
  ocrDraft,
  onClose,
  onDelete,
  onSubmit,
  pending,
  schedules,
  variant = 'page',
  vehicle,
}: LogEntryFormProps) {
  const reactId = useId()
  const formId = `${FORM_ID}-${reactId}`
  const [baseline] = useState(() =>
    // OCR draft should count as dirty so Save persists without forcing edits.
    ocrDraft && !initial ? toFieldState(undefined, vehicle) : toFieldState(initial, vehicle)
  )
  const [values, setValues] = useState(() => toFieldState(initial, vehicle, ocrDraft))
  const [error, setError] = useState('')
  const [fromOcr] = useState(() => Boolean(ocrDraft) && !initial)

  const dirty = fromOcr || !isEqual(values, baseline)

  const fxQuery = useQuery({
    enabled: values.currency === 'CAD',
    queryFn: () => api<{ fetchedAt: string; rate: number }>('/api/fx/cad-usd'),
    queryKey: ['fx', 'cad-usd'],
    refetchInterval: 30 * 60 * 1000,
  })

  const usdPreview = previewUsd(values.amount, values.currency, fxQuery.data?.rate)

  function patch(partial: Partial<LogFieldState>) {
    setValues(prev => ({ ...prev, ...partial }))
  }

  function handleDiscard() {
    setValues(baseline)
    setError('')
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dirty) {
      onClose()
      return
    }
    setError('')
    if (values.currency === 'CAD' && values.amount && !fxQuery.data?.rate) {
      setError('CAD conversion unavailable. Enter USD or try again.')
      return
    }
    onSubmit(toSubmitValues(values, vehicle, fxQuery.data))
  }

  const fields = (
    <>
      <div className="flex gap-2">
        {(['service', 'repair'] as const).map(value => (
          <button
            className={`flex-1 rounded-md border px-3 py-2 text-sm ${
              values.kind === value ? 'border-accent bg-accent text-white' : 'border-line bg-white'
            }`}
            key={value}
            onClick={() =>
              patch({
                kind: value,
                scheduleId: value === 'repair' ? '' : values.scheduleId,
              })
            }
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
          onChange={e => patch({ performedOn: e.target.value })}
          required
          type="date"
          value={values.performedOn}
        />
      </label>

      <label className="block text-sm">
        Odometer ({vehicle.displayUnit})
        <input
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          min={0}
          onChange={e => patch({ odometer: e.target.value })}
          required
          step="any"
          type="number"
          value={values.odometer}
        />
      </label>

      {values.kind === 'service' ? (
        <label className="block text-sm">
          Schedule
          <select
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            onChange={e => patch({ scheduleId: e.target.value })}
            value={values.scheduleId}
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
            checked={values.performedBy === 'self'}
            onChange={() => patch({ performedBy: 'self', shopName: '' })}
            type="radio"
          />
          Self
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={values.performedBy === 'shop'}
            onChange={() => patch({ performedBy: 'shop' })}
            type="radio"
          />
          Shop
        </label>
        {values.performedBy === 'shop' ? (
          <input
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
            onChange={e => patch({ shopName: e.target.value })}
            placeholder="Shop name"
            required
            value={values.shopName}
          />
        ) : null}
      </fieldset>

      <div className="space-y-2">
        <div className="flex gap-2">
          {(['CAD', 'USD'] as const).map(value => (
            <button
              className={`rounded-md border px-3 py-1.5 text-sm ${
                values.currency === value
                  ? 'border-accent bg-accent text-white'
                  : 'border-line bg-white'
              }`}
              key={value}
              onClick={() => patch({ currency: value })}
              type="button"
            >
              {value}
            </button>
          ))}
        </div>
        <label className="block text-sm">
          Cost ({values.currency})
          <input
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            min={0}
            onChange={e => patch({ amount: e.target.value })}
            step="0.01"
            type="number"
            value={values.amount}
          />
        </label>
        {values.currency === 'CAD' ? (
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
          onChange={e => patch({ notes: e.target.value })}
          rows={3}
          value={values.notes}
        />
      </label>

      {error ? <p className="text-sm text-overdue">{error}</p> : null}
    </>
  )

  const actions = (
    <>
      {dirty ? (
        <Button onClick={handleDiscard} variant="text">
          Cancel
        </Button>
      ) : null}
      <Button
        className={DONE_SAVE_WIDTH}
        form={dirty && variant === 'dialog' ? formId : undefined}
        loading={dirty && pending}
        onClick={dirty ? undefined : onClose}
        type={dirty ? 'submit' : 'button'}
      >
        {dirty ? 'Save' : 'Done'}
      </Button>
    </>
  )

  if (variant === 'dialog') {
    return (
      <Dialog
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            {onDelete ? (
              <Button color="error" onClick={onDelete} variant="text">
                Delete entry
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">{actions}</div>
          </div>
        }
        onClose={onClose}
        title="Edit log entry"
      >
        <form className="space-y-4" id={formId} onSubmit={handleSubmit}>
          {fields}
        </form>
      </Dialog>
    )
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {fields}
      <div className="flex justify-end gap-2">{actions}</div>
    </form>
  )
}

function toFieldState(
  initial: LogEntry | undefined,
  vehicle: Vehicle,
  ocrDraft?: ReceiptOcrPreview
): LogFieldState {
  if (initial) {
    const amountCents = initial.costEnteredCents ?? initial.costUsdCents ?? null
    return {
      amount: amountCents != null ? String(centsToDollars(amountCents)) : '',
      currency: (initial.costEnteredCurrency as 'USD' | 'CAD' | null) ?? 'CAD',
      kind: initial.kind,
      notes: initial.notes ?? '',
      odometer: String(roundInput(initial.odometerKm, vehicle.displayUnit)),
      performedBy: initial.performedBy,
      performedOn: initial.performedOn,
      scheduleId: initial.scheduleId ?? '',
      shopName: initial.shopName ?? '',
    }
  }

  const odometerDisplay =
    ocrDraft?.odometer != null
      ? roundInput(
          toKm(ocrDraft.odometer, ocrDraft.odometerUnit ?? vehicle.displayUnit),
          vehicle.displayUnit
        )
      : roundInput(vehicle.currentOdometerKm, vehicle.displayUnit)

  const performedBy = ocrDraft?.performedBy ?? (ocrDraft?.shopName ? 'shop' : 'self')

  return {
    amount:
      ocrDraft?.costEnteredCents != null ? String(centsToDollars(ocrDraft.costEnteredCents)) : '',
    currency: ocrDraft?.costEnteredCurrency ?? 'CAD',
    kind: ocrDraft?.kind ?? 'service',
    notes: ocrDraft?.notes ?? '',
    odometer: String(odometerDisplay),
    performedBy,
    performedOn: ocrDraft?.performedOn ?? new Date().toISOString().slice(0, 10),
    scheduleId: ocrDraft?.scheduleId ?? '',
    shopName: ocrDraft?.shopName ?? '',
  }
}

function previewUsd(
  amount: string,
  currency: 'USD' | 'CAD',
  rate: number | undefined
): number | null {
  const dollars = Number(amount)
  if (!amount || Number.isNaN(dollars)) return null
  const cents = dollarsToCents(dollars)
  if (currency === 'USD') return cents
  if (!rate) return null
  return Math.round(cents * rate)
}

function toSubmitValues(
  values: LogFieldState,
  vehicle: Vehicle,
  fx: { fetchedAt: string; rate: number } | undefined
): LogFormValues {
  const hasAmount = Boolean(values.amount)
  return {
    costEnteredCents: hasAmount ? dollarsToCents(Number(values.amount)) : null,
    costEnteredCurrency: hasAmount ? values.currency : null,
    costUsdCents:
      values.currency === 'USD' && hasAmount ? dollarsToCents(Number(values.amount)) : null,
    fxFetchedAt: values.currency === 'CAD' ? (fx?.fetchedAt ?? null) : null,
    fxRateToUsd: values.currency === 'CAD' ? (fx?.rate ?? null) : null,
    kind: values.kind,
    notes: values.notes || null,
    odometer: Number(values.odometer),
    odometerUnit: vehicle.displayUnit,
    performedBy: values.performedBy,
    performedOn: values.performedOn,
    scheduleId: values.kind === 'service' ? values.scheduleId || null : null,
    shopName: values.performedBy === 'shop' ? values.shopName || null : null,
  }
}
