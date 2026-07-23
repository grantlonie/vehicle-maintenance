import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ScheduleInput, Season } from '@vehicles/shared'
import { SEASON_ORDER, toKm } from '@vehicles/shared'
import { api } from '../lib/api'

interface ScheduleFormProps {
  initial?: Partial<ScheduleInput> & { name?: string }
  onCancel?: () => void
  onSubmit: (values: ScheduleInput) => void
  pending?: boolean
  submitLabel?: string
}

const SEASON_LABELS: Record<Season, string> = {
  fall: 'Fall (Sep–Nov)',
  spring: 'Spring (Mar–May)',
  summer: 'Summer (Jun–Aug)',
  winter: 'Winter (Dec–Feb)',
}

export function ScheduleForm({
  initial,
  onCancel,
  onSubmit,
  pending,
  submitLabel = 'Save schedule',
}: ScheduleFormProps) {
  const [seasonal, setSeasonal] = useState(initial?.activePeriod === 'seasonal')
  const [seasons, setSeasons] = useState<Season[]>(initial?.seasons ?? ['spring'])
  const [frequencyMode, setFrequencyMode] = useState(
    seasonal ? (initial?.frequencyMode ?? 'once_per_season') : 'interval'
  )
  const [useKm, setUseKm] = useState(initial?.intervalKm != null)
  const [useMonths, setUseMonths] = useState(
    initial?.intervalMonths != null || initial?.frequencyMode !== 'once_per_season'
  )

  function handleSeasonalToggle(next: boolean) {
    setSeasonal(next)
    if (!next) {
      setFrequencyMode('interval')
      if (!useKm && !useMonths) setUseMonths(true)
      return
    }
    if (seasons.length === 0) setSeasons(['spring'])
    setFrequencyMode('once_per_season')
  }

  function toggleSeason(season: Season) {
    setSeasons(prev => {
      if (prev.includes(season)) {
        if (prev.length === 1) return prev
        return prev.filter(item => item !== season)
      }
      return SEASON_ORDER.filter(item => item === season || prev.includes(item))
    })
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const intervalKmRaw = Number(form.get('intervalKm') || 0)
    const intervalMonthsRaw = Number(form.get('intervalMonths') || 0)
    const unit = (form.get('intervalUnit') as 'km' | 'mi') || 'km'
    const mode = seasonal ? frequencyMode : 'interval'

    onSubmit({
      activePeriod: seasonal ? 'seasonal' : 'year_round',
      frequencyMode: mode,
      intervalKm:
        mode === 'interval' && useKm && intervalKmRaw > 0 ? toKm(intervalKmRaw, unit) : null,
      intervalMonths:
        mode === 'interval' && useMonths && intervalMonthsRaw > 0 ? intervalMonthsRaw : null,
      name: String(form.get('name') || ''),
      notes: String(form.get('notes') || '') || null,
      seasons: seasonal ? seasons : null,
    })
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

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>Seasonal</span>
          <button
            aria-checked={seasonal}
            aria-label="Seasonal"
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              seasonal ? 'bg-accent' : 'bg-line'
            }`}
            onClick={() => handleSeasonalToggle(!seasonal)}
            role="switch"
            type="button"
          >
            <span
              className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform ${
                seasonal ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </label>

        {seasonal ? (
          <div className="flex flex-wrap gap-2">
            {SEASON_ORDER.map(season => (
              <button
                className={`rounded border px-3 py-1.5 text-sm ${
                  seasons.includes(season)
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-white'
                }`}
                key={season}
                onClick={() => toggleSeason(season)}
                type="button"
              >
                {SEASON_LABELS[season]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {seasonal ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">How often</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={frequencyMode === 'once_per_season'}
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
            <IntervalFields
              initial={initial}
              setUseKm={setUseKm}
              setUseMonths={setUseMonths}
              useKm={useKm}
              useMonths={useMonths}
            />
          ) : null}
        </fieldset>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Repeat</legend>
          <IntervalFields
            initial={initial}
            setUseKm={setUseKm}
            setUseMonths={setUseMonths}
            useKm={useKm}
            useMonths={useMonths}
          />
        </fieldset>
      )}

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
          disabled={pending || (seasonal && seasons.length === 0)}
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

interface IntervalFieldsProps {
  initial?: Partial<ScheduleInput>
  setUseKm: (value: boolean) => void
  setUseMonths: (value: boolean) => void
  useKm: boolean
  useMonths: boolean
}

function IntervalFields({
  initial,
  setUseKm,
  setUseMonths,
  useKm,
  useMonths,
}: IntervalFieldsProps) {
  return (
    <div className="space-y-2">
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
