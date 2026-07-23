import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ScheduleInput } from '@vehicles/shared'
import { toKm } from '@vehicles/shared'
import { api } from '../lib/api'

interface ScheduleFormProps {
  initial?: Partial<ScheduleInput> & { name?: string }
  onCancel?: () => void
  onSubmit: (values: ScheduleInput) => void
  pending?: boolean
  submitLabel?: string
}

const MONTHS = [
  { label: 'Jan', value: 1 },
  { label: 'Feb', value: 2 },
  { label: 'Mar', value: 3 },
  { label: 'Apr', value: 4 },
  { label: 'May', value: 5 },
  { label: 'Jun', value: 6 },
  { label: 'Jul', value: 7 },
  { label: 'Aug', value: 8 },
  { label: 'Sep', value: 9 },
  { label: 'Oct', value: 10 },
  { label: 'Nov', value: 11 },
  { label: 'Dec', value: 12 },
]

export function ScheduleForm({
  initial,
  onCancel,
  onSubmit,
  pending,
  submitLabel = 'Save schedule',
}: ScheduleFormProps) {
  const [activePeriod, setActivePeriod] = useState(initial?.activePeriod ?? 'year_round')
  const [frequencyMode, setFrequencyMode] = useState(initial?.frequencyMode ?? 'interval')
  const [season, setSeason] = useState(initial?.season ?? 'winter')
  const [activeMonths, setActiveMonths] = useState<number[]>(initial?.activeMonths ?? [])
  const [useKm, setUseKm] = useState(initial?.intervalKm != null)
  const [useMonths, setUseMonths] = useState(
    initial?.intervalMonths != null || initial?.frequencyMode !== 'once_per_season'
  )

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const intervalKmRaw = Number(form.get('intervalKm') || 0)
    const intervalMonthsRaw = Number(form.get('intervalMonths') || 0)
    const unit = (form.get('intervalUnit') as 'km' | 'mi') || 'km'

    onSubmit({
      activeMonths: activePeriod === 'custom_months' ? activeMonths : null,
      activePeriod,
      frequencyMode,
      intervalKm:
        frequencyMode === 'interval' && useKm && intervalKmRaw > 0
          ? toKm(intervalKmRaw, unit)
          : null,
      intervalMonths:
        frequencyMode === 'interval' && useMonths && intervalMonthsRaw > 0
          ? intervalMonthsRaw
          : null,
      name: String(form.get('name') || ''),
      notes: String(form.get('notes') || '') || null,
      season: activePeriod === 'season' ? season : null,
    })
  }

  function toggleMonth(month: number) {
    setActiveMonths(prev =>
      prev.includes(month) ? prev.filter(m => m !== month) : [...prev, month].sort((a, b) => a - b)
    )
  }

  return (
    <form className="space-y-4 rounded-xl border border-line bg-panel p-4" onSubmit={handleSubmit}>
      <label className="block text-sm">
        Name
        <input
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          defaultValue={initial?.name ?? ''}
          name="name"
          required
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Active period</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={activePeriod === 'year_round'}
            onChange={() => setActivePeriod('year_round')}
            type="radio"
          />
          Year-round
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={activePeriod === 'season'}
            onChange={() => setActivePeriod('season')}
            type="radio"
          />
          Seasonal
        </label>
        {activePeriod === 'season' ? (
          <select
            className="ml-6 rounded-md border border-line bg-white px-3 py-2 text-sm"
            onChange={e => setSeason(e.target.value as typeof season)}
            value={season ?? 'winter'}
          >
            <option value="spring">Spring (Mar–May)</option>
            <option value="summer">Summer (Jun–Aug)</option>
            <option value="fall">Fall (Sep–Nov)</option>
            <option value="winter">Winter (Dec–Feb)</option>
          </select>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={activePeriod === 'custom_months'}
            onChange={() => setActivePeriod('custom_months')}
            type="radio"
          />
          Custom months
        </label>
        {activePeriod === 'custom_months' ? (
          <div className="ml-6 flex flex-wrap gap-2">
            {MONTHS.map(month => (
              <button
                className={`rounded border px-2 py-1 text-xs ${
                  activeMonths.includes(month.value)
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-white'
                }`}
                key={month.value}
                onClick={() => toggleMonth(month.value)}
                type="button"
              >
                {month.label}
              </button>
            ))}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">How often</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={frequencyMode === 'once_per_season'}
            disabled={activePeriod === 'year_round'}
            onChange={() => setFrequencyMode('once_per_season')}
            type="radio"
          />
          Once per active season
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={frequencyMode === 'interval'}
            onChange={() => setFrequencyMode('interval')}
            type="radio"
          />
          Repeat while active
        </label>
        {frequencyMode === 'interval' ? (
          <div className="ml-6 space-y-2">
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input
                checked={useMonths}
                onChange={e => setUseMonths(e.target.checked)}
                type="checkbox"
              />
              every
              <input
                className="w-20 rounded-md border border-line bg-white px-2 py-1"
                defaultValue={initial?.intervalMonths ?? 1}
                disabled={!useMonths}
                min={1}
                name="intervalMonths"
                type="number"
              />
              months
            </label>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input checked={useKm} onChange={e => setUseKm(e.target.checked)} type="checkbox" />
              every
              <input
                className="w-28 rounded-md border border-line bg-white px-2 py-1"
                defaultValue={initial?.intervalKm ?? 10000}
                disabled={!useKm}
                min={1}
                name="intervalKm"
                step="any"
                type="number"
              />
              <select
                className="rounded-md border border-line bg-white px-2 py-1"
                defaultValue="km"
                disabled={!useKm}
                name="intervalUnit"
              >
                <option value="km">km</option>
                <option value="mi">mi</option>
              </select>
            </label>
          </div>
        ) : null}
      </fieldset>

      <label className="block text-sm">
        Notes
        <textarea
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          defaultValue={initial?.notes ?? ''}
          name="notes"
          rows={3}
        />
      </label>

      <div className="flex gap-3">
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

export function useCreateSchedule(vehicleId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ScheduleInput) =>
      api(`/api/vehicles/${vehicleId}/schedules`, {
        body: JSON.stringify(body),
        method: 'POST',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['schedules', vehicleId] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
    },
  })
}
