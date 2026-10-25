import type { DisplayUnit } from '@vehicles/shared'
import type { Attachment } from '../lib/types'
import { AttachmentsField } from './AttachmentsField'

export interface TransferFieldValues {
  date: string
  odometer: string
}

interface TransferFieldsProps {
  dateLabel: string
  dateRequired?: boolean
  existingFiles: Attachment[]
  files: File[]
  onChange: (values: TransferFieldValues) => void
  onFilesChange: (files: File[]) => void
  onRemoveExistingFile: (id: string) => void
  title?: string
  unit: DisplayUnit
  values: TransferFieldValues
}

export function TransferFields({
  dateLabel,
  dateRequired = false,
  existingFiles,
  files,
  onChange,
  onFilesChange,
  onRemoveExistingFile,
  title,
  unit,
  values,
}: TransferFieldsProps) {
  return (
    <fieldset className="space-y-3">
      {title ? <legend className="mb-2 font-semibold">{title}</legend> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          {dateLabel}
          <input
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            onChange={e => onChange({ ...values, date: e.target.value })}
            required={dateRequired}
            type="date"
            value={values.date}
          />
        </label>
        <label className="block text-sm">
          Odometer ({unit})
          <input
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            min={0}
            onChange={e => onChange({ ...values, odometer: e.target.value })}
            step="any"
            type="number"
            value={values.odometer}
          />
        </label>
      </div>
      <AttachmentsField
        existing={existingFiles}
        files={files}
        label="Bill of sale"
        onChange={onFilesChange}
        onRemoveExisting={onRemoveExistingFile}
      />
    </fieldset>
  )
}
