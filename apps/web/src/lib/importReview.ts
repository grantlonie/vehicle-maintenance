import type { HistoryDraft, ImportLog, IntakePreview, ScheduleDraft } from '@vehicles/shared'
import type { Schedule } from './types'

export interface ReviewScheduleRow {
  draft: ScheduleDraft
  selected: boolean
}

export interface ReviewHistoryRow {
  draft: HistoryDraft
  selected: boolean
}

export interface ImportReviewState {
  history: ReviewHistoryRow[]
  schedules: ReviewScheduleRow[]
  skipped: HistoryDraft[]
}

export interface ScheduleOption {
  key: string
  name: string
}

export function reviewStateFromPreview(preview: IntakePreview): ImportReviewState {
  return {
    history: preview.history.map(draft => ({
      draft,
      selected: isHistoryDraftComplete(draft) && !draft.possibleDuplicate,
    })),
    schedules: preview.schedules.map(draft => ({ draft, selected: true })),
    skipped: preview.skipped,
  }
}

export function isHistoryDraftComplete(draft: HistoryDraft): boolean {
  if (!draft.performedOn || draft.odometer == null) return false
  if (draft.performedBy === 'shop' && !draft.shopName?.trim()) return false
  return true
}

export function promoteSkipped(state: ImportReviewState, key: string): ImportReviewState {
  const draft = state.skipped.find(item => item.key === key)
  if (!draft) return state
  const promoted = { ...draft, reason: null }
  return {
    ...state,
    history: [
      ...state.history,
      { draft: promoted, selected: isHistoryDraftComplete(promoted) },
    ].sort((a, b) => (a.draft.performedOn ?? '').localeCompare(b.draft.performedOn ?? '')),
    skipped: state.skipped.filter(item => item.key !== key),
  }
}

export function selectedScheduleDrafts(state: ImportReviewState): ScheduleDraft[] {
  return state.schedules.filter(row => row.selected).map(row => row.draft)
}

export function toImportLogs(
  state: ImportReviewState,
  validScheduleKeys: Set<string>
): ImportLog[] {
  return state.history
    .filter(row => row.selected && isHistoryDraftComplete(row.draft))
    .map(({ draft }) => ({
      costEnteredCents: draft.costEnteredCents,
      costEnteredCurrency: draft.costEnteredCents != null ? draft.costEnteredCurrency : null,
      documentIndex: draft.documentIndex,
      kind: draft.kind,
      notes: draft.notes.trim() || null,
      odometer: draft.odometer!,
      odometerUnit: draft.odometerUnit,
      performedBy: draft.performedBy,
      performedOn: draft.performedOn!,
      scheduleKey:
        draft.kind === 'service' && draft.scheduleKey && validScheduleKeys.has(draft.scheduleKey)
          ? draft.scheduleKey
          : null,
      shopName: draft.performedBy === 'shop' ? draft.shopName?.trim() || null : null,
    }))
}

/** Adapt a draft to the `Schedule` shape used by `describeSchedule`. */
export function draftAsSchedule(draft: ScheduleDraft): Schedule {
  return {
    activePeriod: draft.schedule.activePeriod,
    frequencyMode: draft.schedule.frequencyMode,
    id: draft.key,
    intervalKm: draft.schedule.intervalKm ?? null,
    intervalMonths: draft.schedule.intervalMonths ?? null,
    name: draft.schedule.name,
    notes: draft.schedule.notes ?? null,
    seasons: draft.schedule.seasons ?? null,
    vehicleId: '',
  }
}

export function formatDraftOdometer(draft: HistoryDraft): string {
  if (draft.odometer == null) return 'No odometer'
  return `${Math.round(draft.odometer).toLocaleString()} ${draft.odometerUnit}`
}
