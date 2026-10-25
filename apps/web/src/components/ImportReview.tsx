import { useState } from 'react'
import type { HistoryDraft, IntakeDocument, ScheduleInput, VinDecode } from '@vehicles/shared'
import { formatDate, formatUsd } from '@vehicles/shared'
import {
  draftAsSchedule,
  formatDraftOdometer,
  isHistoryDraftComplete,
  promoteSkipped,
  type ImportReviewState,
  type ScheduleOption,
} from '../lib/importReview'
import { describeSchedule } from '../lib/schedules'
import { useDisplayUnit } from '../lib/settings'
import { Dialog } from './Dialog'
import { HistoryDraftDialog } from './HistoryDraftDialog'
import { IconButton } from './IconButton'
import { PencilIcon, TrashIcon } from './icons'
import { ScheduleForm } from './ScheduleForm'

interface ImportReviewProps {
  documents: IntakeDocument[]
  onChange: (state: ImportReviewState) => void
  scheduleError?: string | null
  scheduleOptions: ScheduleOption[]
  showSchedules: boolean
  state: ImportReviewState
  vinDecode?: VinDecode | null
}

export function ImportReview({
  documents,
  onChange,
  scheduleError,
  scheduleOptions,
  showSchedules,
  state,
  vinDecode,
}: ImportReviewProps) {
  const displayUnit = useDisplayUnit()
  const [editScheduleKey, setEditScheduleKey] = useState<string | null>(null)
  const [editHistoryKey, setEditHistoryKey] = useState<string | null>(null)

  const scheduleNameByKey = new Map(scheduleOptions.map(option => [option.key, option.name]))
  const filenameByIndex = new Map(documents.map(doc => [doc.index, doc.filename]))
  const failedDocuments = documents.filter(doc => doc.error)
  const editingSchedule = state.schedules.find(row => row.draft.key === editScheduleKey)
  const editingHistory = state.history.find(row => row.draft.key === editHistoryKey)
  const vinSummary = vinDecode ? describeVin(vinDecode) : ''

  function toggleSchedule(key: string) {
    onChange({
      ...state,
      schedules: state.schedules.map(row =>
        row.draft.key === key ? { ...row, selected: !row.selected } : row
      ),
    })
  }

  function removeSchedule(key: string) {
    onChange({ ...state, schedules: state.schedules.filter(row => row.draft.key !== key) })
  }

  function saveSchedule(key: string, schedule: ScheduleInput) {
    onChange({
      ...state,
      schedules: state.schedules.map(row =>
        row.draft.key === key ? { ...row, draft: { key, schedule } } : row
      ),
    })
    setEditScheduleKey(null)
  }

  function toggleHistory(key: string) {
    onChange({
      ...state,
      history: state.history.map(row =>
        row.draft.key === key ? { ...row, selected: !row.selected } : row
      ),
    })
  }

  function removeHistory(key: string) {
    onChange({ ...state, history: state.history.filter(row => row.draft.key !== key) })
  }

  function saveHistory(draft: HistoryDraft) {
    onChange({
      ...state,
      history: state.history.map(row => {
        if (row.draft.key !== draft.key) return row
        const becameComplete = !isHistoryDraftComplete(row.draft) && isHistoryDraftComplete(draft)
        return { draft, selected: becameComplete || row.selected }
      }),
    })
    setEditHistoryKey(null)
  }

  const selectedHistory = state.history.filter(row => row.selected).length
  const selectedSchedules = state.schedules.filter(row => row.selected).length

  return (
    <div className="space-y-6">
      {failedDocuments.length > 0 ? (
        <div className="rounded-lg border border-overdue/40 bg-overdue/5 p-3 text-sm">
          {failedDocuments.map(doc => (
            <p key={doc.index}>
              Could not read <span className="font-medium">{doc.filename}</span>: {doc.error}
            </p>
          ))}
        </div>
      ) : null}

      {showSchedules ? (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="font-semibold">Maintenance schedule</h4>
            <span className="text-xs text-ink-muted">
              {selectedSchedules} of {state.schedules.length} selected
            </span>
          </div>
          {vinSummary ? <p className="text-xs text-ink-muted">From VIN: {vinSummary}</p> : null}
          {scheduleError ? (
            <p className="text-sm text-overdue">Could not suggest a schedule: {scheduleError}</p>
          ) : null}
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {state.schedules.map(row => (
              <li className="flex items-start gap-3 px-3 py-2" key={row.draft.key}>
                <input
                  aria-label={`Include ${row.draft.schedule.name}`}
                  checked={row.selected}
                  className="mt-1"
                  onChange={() => toggleSchedule(row.draft.key)}
                  type="checkbox"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.draft.schedule.name}</p>
                  <p className="text-sm text-ink-muted">
                    {describeSchedule(draftAsSchedule(row.draft), displayUnit)}
                  </p>
                  {row.draft.schedule.notes ? (
                    <p className="text-xs text-ink-muted">{row.draft.schedule.notes}</p>
                  ) : null}
                </div>
                <RowActions
                  label="schedule"
                  onEdit={() => setEditScheduleKey(row.draft.key)}
                  onRemove={() => removeSchedule(row.draft.key)}
                />
              </li>
            ))}
            {state.schedules.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-muted">No schedule items.</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {documents.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="font-semibold">Service history</h4>
            <span className="text-xs text-ink-muted">
              {selectedHistory} of {state.history.length} selected
            </span>
          </div>
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {state.history.map(row => {
              const complete = isHistoryDraftComplete(row.draft)
              const scheduleName = row.draft.scheduleKey
                ? scheduleNameByKey.get(row.draft.scheduleKey)
                : undefined
              return (
                <li className="flex items-start gap-3 px-3 py-2" key={row.draft.key}>
                  <input
                    aria-label={`Include ${row.draft.notes}`}
                    checked={row.selected && complete}
                    className="mt-1"
                    disabled={!complete}
                    onChange={() => toggleHistory(row.draft.key)}
                    type="checkbox"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {row.draft.performedOn ? formatDate(row.draft.performedOn) : 'No date'}{' '}
                      <span className="font-mono text-xs uppercase text-ink-muted">
                        [{row.draft.kind}]
                      </span>
                    </p>
                    <p className="text-sm text-ink-muted">
                      {formatDraftOdometer(row.draft)} ·{' '}
                      {row.draft.performedBy === 'self' ? 'Self' : row.draft.shopName || 'Shop'}
                      {row.draft.costEnteredCents != null
                        ? ` · ${row.draft.costEnteredCurrency === 'CAD' ? 'CA' : ''}${formatUsd(row.draft.costEnteredCents)}`
                        : ''}
                    </p>
                    {scheduleName ? <p className="text-sm">{scheduleName}</p> : null}
                    <p className="text-sm">{row.draft.notes}</p>
                    <p className="text-xs text-ink-muted">
                      {filenameByIndex.get(row.draft.documentIndex)}
                      {!complete ? ' · Add a date and odometer to import' : ''}
                      {row.draft.possibleDuplicate
                        ? ' · Possible duplicate of an existing entry'
                        : ''}
                    </p>
                  </div>
                  <RowActions
                    label="entry"
                    onEdit={() => setEditHistoryKey(row.draft.key)}
                    onRemove={() => removeHistory(row.draft.key)}
                  />
                </li>
              )
            })}
            {state.history.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-muted">No completed work found.</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {state.skipped.length > 0 ? (
        <section className="space-y-2">
          <h4 className="font-semibold">Not imported</h4>
          <p className="text-xs text-ink-muted">
            Recommendations and incomplete records. Check one to move it into the history list.
          </p>
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {state.skipped.map(draft => (
              <li className="flex items-start gap-3 px-3 py-2" key={draft.key}>
                <input
                  aria-label={`Import ${draft.notes}`}
                  checked={false}
                  className="mt-1"
                  onChange={() => onChange(promoteSkipped(state, draft.key))}
                  type="checkbox"
                />
                <div className="min-w-0 flex-1 text-sm">
                  <p>
                    {draft.performedOn ? `${formatDate(draft.performedOn)} · ` : ''}
                    {draft.notes}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {draft.reason} · {filenameByIndex.get(draft.documentIndex)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editingSchedule ? (
        <Dialog onClose={() => setEditScheduleKey(null)} title="Edit schedule">
          <ScheduleForm
            initial={editingSchedule.draft.schedule}
            onCancel={() => setEditScheduleKey(null)}
            onSubmit={values => saveSchedule(editingSchedule.draft.key, values)}
            submitLabel="Save changes"
          />
        </Dialog>
      ) : null}

      {editingHistory ? (
        <HistoryDraftDialog
          draft={editingHistory.draft}
          onClose={() => setEditHistoryKey(null)}
          onSave={saveHistory}
          scheduleOptions={scheduleOptions}
        />
      ) : null}
    </div>
  )
}

interface RowActionsProps {
  label: string
  onEdit: () => void
  onRemove: () => void
}

function RowActions({ label, onEdit, onRemove }: RowActionsProps) {
  return (
    <div className="flex shrink-0 items-center">
      <IconButton
        aria-label={`Edit ${label}`}
        icon={<PencilIcon />}
        onClick={onEdit}
        size="sm"
        tooltip={{ content: `Edit ${label}` }}
      />
      <IconButton
        aria-label={`Remove ${label}`}
        icon={<TrashIcon />}
        onClick={onRemove}
        size="sm"
        tooltip={{ content: `Remove ${label}` }}
      />
    </div>
  )
}

function describeVin(decoded: VinDecode): string {
  const engine = [
    decoded.displacementL ? `${decoded.displacementL}L` : null,
    decoded.engineCylinders ? `${decoded.engineCylinders}-cyl` : null,
  ]
    .filter(Boolean)
    .join(' ')
  return [decoded.trim, engine, decoded.fuelType, decoded.driveType].filter(Boolean).join(' · ')
}
