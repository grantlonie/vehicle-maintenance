import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import type { DisplayUnit, ScheduleInput, Season } from '@vehicles/shared'
import { SEASON_ORDER, toKm } from '@vehicles/shared'
import { api } from '../lib/api'
import { roundInput } from '../lib/format'
import { Button } from './Button'
import { Popover } from './Popover'

interface ScheduleFormProps {
  displayUnit: DisplayUnit
  initial?: Partial<ScheduleInput> & { name?: string }
  onCancel?: () => void
  onSubmit: (values: ScheduleInput) => void
  pending?: boolean
  submitLabel?: string
}

type TimeUnit = 'months' | 'years' | 'seasons'

const SEASON_LABELS: Record<Season, string> = {
  fall: 'Fall',
  spring: 'Spring',
  summer: 'Summer',
  winter: 'Winter',
}

const SEASONAL_TOOLTIP =
  'When enabled, this schedule is only active during the seasons you select. Outside those seasons it stays inactive.'

const DEFAULT_INTERVAL_KM = 10000

export function ScheduleForm({
  displayUnit,
  initial,
  onCancel,
  onSubmit,
  pending,
  submitLabel = 'Save schedule',
}: ScheduleFormProps) {
  const seasonalInfoRef = useRef<HTMLButtonElement>(null)
  const [seasonalInfoOpen, setSeasonalInfoOpen] = useState(false)
  const [seasonal, setSeasonal] = useState(initialSeasonal(initial))
  const [seasons, setSeasons] = useState<Season[]>(initial?.seasons ?? ['spring'])
  const [timeUnit, setTimeUnit] = useState<TimeUnit>(initialTimeUnit(initial))
  const [useKm, setUseKm] = useState(initial?.intervalKm != null)
  const [useTime, setUseTime] = useState(
    initial?.intervalMonths != null ||
      initial?.frequencyMode === 'once_per_season' ||
      initial?.intervalKm == null
  )

  function handleSeasonalToggle(next: boolean) {
    setSeasonal(next)
    if (!next) {
      if (!useKm && !useTime) setUseTime(true)
      return
    }
    if (seasons.length === 0) setSeasons(['spring'])
    setTimeUnit('months')
    if (!useKm && !useTime) setUseTime(true)
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

  function handleTimeUnitChange(next: TimeUnit) {
    setTimeUnit(next)
    if (next === 'seasons' && seasons.length === 0) setSeasons(['spring'])
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const intervalKmRaw = Number(form.get('intervalKm') || 0)
    const intervalTimeRaw = Number(form.get('intervalTime') || 0)
    const unit = (form.get('intervalUnit') as DisplayUnit) || displayUnit
    const effectiveTimeUnit = seasonal ? 'months' : timeUnit
    const usingSeasonsInterval = !seasonal && useTime && effectiveTimeUnit === 'seasons'

    if (usingSeasonsInterval) {
      onSubmit({
        activePeriod: 'seasonal',
        frequencyMode: 'once_per_season',
        intervalKm: null,
        intervalMonths: null,
        name: String(form.get('name') || ''),
        notes: String(form.get('notes') || '') || null,
        seasons,
      })
      return
    }

    const intervalMonths =
      useTime && intervalTimeRaw > 0
        ? effectiveTimeUnit === 'years'
          ? intervalTimeRaw * 12
          : intervalTimeRaw
        : null

    onSubmit({
      activePeriod: seasonal ? 'seasonal' : 'year_round',
      frequencyMode: 'interval',
      intervalKm: useKm && intervalKmRaw > 0 ? toKm(intervalKmRaw, unit) : null,
      intervalMonths,
      name: String(form.get('name') || ''),
      notes: String(form.get('notes') || '') || null,
      seasons: seasonal ? seasons : null,
    })
  }

  const seasonsRequired =
    (seasonal || (!seasonal && useTime && timeUnit === 'seasons')) && seasons.length === 0
  const repeatRequired = !useTime && !useKm

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
        <div className="flex items-center justify-between gap-3 text-sm font-medium">
          <span className="flex items-center gap-1.5">
            Seasonal
            <button
              aria-expanded={seasonalInfoOpen}
              aria-label="About seasonal schedules"
              className="inline-flex size-5 items-center justify-center rounded-full border border-line text-xs font-semibold text-ink-muted hover:bg-white"
              onClick={() => setSeasonalInfoOpen(open => !open)}
              ref={seasonalInfoRef}
              type="button"
            >
              i
            </button>
            <Popover
              anchorRef={seasonalInfoRef}
              onClose={() => setSeasonalInfoOpen(false)}
              open={seasonalInfoOpen}
              widthClassName="w-72"
            >
              <p className="text-sm font-normal text-ink">{SEASONAL_TOOLTIP}</p>
            </Popover>
          </span>
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
        </div>

        {seasonal ? <SeasonButtons onToggle={toggleSeason} seasons={seasons} /> : null}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Repeat</legend>
        <IntervalFields
          allowTimeUnits={!seasonal}
          displayUnit={displayUnit}
          initial={initial}
          onTimeUnitChange={handleTimeUnitChange}
          onToggleSeason={toggleSeason}
          seasons={seasons}
          setUseKm={setUseKm}
          setUseTime={setUseTime}
          timeUnit={timeUnit}
          useKm={useKm}
          useTime={useTime}
        />
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

      <div className="flex gap-2">
        <Button disabled={seasonsRequired || repeatRequired} loading={pending} type="submit">
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button onClick={onCancel} variant="text">
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  )
}

interface SeasonButtonsProps {
  onToggle: (season: Season) => void
  seasons: Season[]
}

function SeasonButtons({ onToggle, seasons }: SeasonButtonsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {SEASON_ORDER.map(season => (
        <button
          className={`rounded border px-3 py-1.5 text-sm ${
            seasons.includes(season)
              ? 'border-accent bg-accent text-white'
              : 'border-line bg-white'
          }`}
          key={season}
          onClick={() => onToggle(season)}
          type="button"
        >
          {SEASON_LABELS[season]}
        </button>
      ))}
    </div>
  )
}

interface IntervalFieldsProps {
  allowTimeUnits: boolean
  displayUnit: DisplayUnit
  initial?: Partial<ScheduleInput>
  onTimeUnitChange: (unit: TimeUnit) => void
  onToggleSeason: (season: Season) => void
  seasons: Season[]
  setUseKm: (value: boolean) => void
  setUseTime: (value: boolean) => void
  timeUnit: TimeUnit
  useKm: boolean
  useTime: boolean
}

function IntervalFields({
  allowTimeUnits,
  displayUnit,
  initial,
  onTimeUnitChange,
  onToggleSeason,
  seasons,
  setUseKm,
  setUseTime,
  timeUnit,
  useKm,
  useTime,
}: IntervalFieldsProps) {
  const effectiveTimeUnit = allowTimeUnits ? timeUnit : 'months'
  const showSeasonsUnit = allowTimeUnits && timeUnit === 'seasons'
  const intervalDisplay =
    initial?.intervalKm != null
      ? roundInput(initial.intervalKm, displayUnit)
      : roundInput(DEFAULT_INTERVAL_KM, displayUnit)

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input
            checked={useTime}
            onChange={e => setUseTime(e.target.checked)}
            type="checkbox"
          />
          every
          {showSeasonsUnit ? null : (
            <input
              className="w-20 rounded-md border border-line bg-white px-2 py-1"
              defaultValue={initialIntervalTimeValue(initial, effectiveTimeUnit)}
              disabled={!useTime}
              key={effectiveTimeUnit}
              min={1}
              name="intervalTime"
              type="number"
            />
          )}
          {allowTimeUnits ? (
            <select
              className="rounded-md border border-line bg-white px-2 py-1"
              disabled={!useTime}
              onChange={e => onTimeUnitChange(e.target.value as TimeUnit)}
              value={timeUnit}
            >
              <option value="months">months</option>
              <option value="years">years</option>
              <option value="seasons">seasons</option>
            </select>
          ) : (
            <span>months</span>
          )}
        </label>
        {showSeasonsUnit ? (
          <div className={useTime ? '' : 'pointer-events-none opacity-50'}>
            <SeasonButtons onToggle={onToggleSeason} seasons={seasons} />
          </div>
        ) : null}
      </div>
      {showSeasonsUnit ? null : (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input checked={useKm} onChange={e => setUseKm(e.target.checked)} type="checkbox" />
          every
          <input
            className="w-28 rounded-md border border-line bg-white px-2 py-1"
            defaultValue={intervalDisplay}
            disabled={!useKm}
            key={`${displayUnit}-${initial?.intervalKm ?? 'default'}`}
            min={1}
            name="intervalKm"
            step="any"
            type="number"
          />
          <select
            className="rounded-md border border-line bg-white px-2 py-1"
            defaultValue={displayUnit}
            disabled={!useKm}
            key={displayUnit}
            name="intervalUnit"
          >
            <option value="km">km</option>
            <option value="mi">mi</option>
          </select>
        </label>
      )}
    </div>
  )
}

function initialSeasonal(initial?: Partial<ScheduleInput>): boolean {
  if (initial?.frequencyMode === 'once_per_season') return false
  return initial?.activePeriod === 'seasonal'
}

function initialTimeUnit(initial?: Partial<ScheduleInput>): TimeUnit {
  if (initial?.frequencyMode === 'once_per_season') return 'seasons'
  const months = initial?.intervalMonths
  if (months != null && months >= 12 && months % 12 === 0) return 'years'
  return 'months'
}

function initialIntervalTimeValue(
  initial: Partial<ScheduleInput> | undefined,
  timeUnit: TimeUnit
): number {
  const months = initial?.intervalMonths ?? 1
  if (timeUnit === 'years') return Math.max(1, Math.round(months / 12))
  return months
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
