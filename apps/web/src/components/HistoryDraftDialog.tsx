import { isEqual } from 'lodash-es'
import { useId, useState } from 'react'
import type { HistoryDraft } from '@vehicles/shared'
import { centsToDollars, dollarsToCents } from '@vehicles/shared'
import type { ScheduleOption } from '../lib/importReview'
import { Button, DONE_SAVE_WIDTH } from './Button'
import { Dialog } from './Dialog'

interface HistoryDraftDialogProps {
  draft: HistoryDraft
  onClose: () => void
  onSave: (draft: HistoryDraft) => void
  scheduleOptions: ScheduleOption[]
  trackOdometer?: boolean
}

interface DraftFields {
  amount: string
  currency: 'CAD' | 'USD'
  kind: 'repair' | 'service'
  notes: string
  odometer: string
  odometerUnit: 'km' | 'mi'
  performedBy: 'self' | 'shop'
  performedOn: string
  scheduleKey: string
  shopName: string
}

export function HistoryDraftDialog({
  draft,
  onClose,
  onSave,
  scheduleOptions,
  trackOdometer = true,
}: HistoryDraftDialogProps) {
  const formId = `history-draft-${useId()}`
  const [initial] = useState(() => toFields(draft))
  const [values, setValues] = useState(initial)
  const dirty = !isEqual(values, initial)

  function patch(partial: Partial<DraftFields>) {
    setValues(prev => ({ ...prev, ...partial }))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dirty) {
      onClose()
      return
    }
    const amount = Number(values.amount)
    const hasCost = values.amount !== '' && Number.isFinite(amount) && amount > 0
    onSave({
      ...draft,
      costEnteredCents: hasCost ? dollarsToCents(amount) : null,
      costEnteredCurrency: hasCost ? values.currency : null,
      kind: values.kind,
      notes: values.notes,
      odometer: trackOdometer && values.odometer !== '' ? Number(values.odometer) : null,
      odometerUnit: values.odometerUnit,
      performedBy: values.performedBy,
      performedOn: values.performedOn || null,
      scheduleKey: values.kind === 'service' && values.scheduleKey ? values.scheduleKey : null,
      shopName: values.performedBy === 'shop' ? values.shopName.trim() || null : null,
    })
  }

  return (
    <Dialog
      footer={
        <div className="flex justify-end gap-2">
          {dirty ? (
            <Button onClick={onClose} variant="text">
              Cancel
            </Button>
          ) : null}
          <Button
            className={DONE_SAVE_WIDTH}
            form={dirty ? formId : undefined}
            onClick={dirty ? undefined : onClose}
            type={dirty ? 'submit' : 'button'}
          >
            {dirty ? 'Save' : 'Done'}
          </Button>
        </div>
      }
      onClose={onClose}
      title="Edit history entry"
    >
      <form className="space-y-4" id={formId} onSubmit={handleSubmit}>
        <div className="flex gap-2">
          {(['service', 'repair'] as const).map(kind => (
            <button
              className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                values.kind === kind ? 'border-accent bg-accent text-white' : 'border-line bg-white'
              }`}
              key={kind}
              onClick={() => patch({ kind })}
              type="button"
            >
              {kind === 'service' ? 'Service' : 'Repair'}
            </button>
          ))}
        </div>

        <label className="block text-sm">
          Date
          <input
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            onChange={e => patch({ performedOn: e.target.value })}
            type="date"
            value={values.performedOn}
          />
        </label>

        {trackOdometer ? (
          <div className="flex gap-2">
            <label className="block flex-1 text-sm">
              Odometer
              <input
                className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
                min={0}
                onChange={e => patch({ odometer: e.target.value })}
                step="any"
                type="number"
                value={values.odometer}
              />
            </label>
            <label className="block text-sm">
              Unit
              <select
                className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
                onChange={e => patch({ odometerUnit: e.target.value as 'km' | 'mi' })}
                value={values.odometerUnit}
              >
                <option value="km">km</option>
                <option value="mi">mi</option>
              </select>
            </label>
          </div>
        ) : null}

        {values.kind === 'service' ? (
          <label className="block text-sm">
            Schedule
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
              onChange={e => patch({ scheduleKey: e.target.value })}
              value={values.scheduleKey}
            >
              <option value="">None (ad-hoc)</option>
              {scheduleOptions.map(option => (
                <option key={option.key} value={option.key}>
                  {option.name}
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
              onChange={() => patch({ performedBy: 'self' })}
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
              value={values.shopName}
            />
          ) : null}
        </fieldset>

        <div className="flex gap-2">
          <label className="block flex-1 text-sm">
            Cost
            <input
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
              min={0}
              onChange={e => patch({ amount: e.target.value })}
              step="0.01"
              type="number"
              value={values.amount}
            />
          </label>
          <label className="block text-sm">
            Currency
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
              onChange={e => patch({ currency: e.target.value as 'CAD' | 'USD' })}
              value={values.currency}
            >
              <option value="USD">USD</option>
              <option value="CAD">CAD</option>
            </select>
          </label>
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
      </form>
    </Dialog>
  )
}

function toFields(draft: HistoryDraft): DraftFields {
  return {
    amount: draft.costEnteredCents != null ? String(centsToDollars(draft.costEnteredCents)) : '',
    currency: draft.costEnteredCurrency ?? 'USD',
    kind: draft.kind,
    notes: draft.notes,
    odometer: draft.odometer != null ? String(draft.odometer) : '',
    odometerUnit: draft.odometerUnit,
    performedBy: draft.performedBy,
    performedOn: draft.performedOn ?? '',
    scheduleKey: draft.scheduleKey ?? '',
    shopName: draft.shopName ?? '',
  }
}
