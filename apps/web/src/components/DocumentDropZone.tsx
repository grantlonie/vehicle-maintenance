import { useRef, useState } from 'react'
import { IconButton } from './IconButton'
import { PdfFileIcon, TrashIcon } from './icons'

const FILE_ACCEPT = 'image/*,application/pdf,.pdf,.heic,.heif'

interface DocumentDropZoneProps {
  disabled?: boolean
  files: File[]
  maxFiles?: number
  onChange: (files: File[]) => void
}

export function DocumentDropZone({
  disabled = false,
  files,
  maxFiles = 10,
  onChange,
}: DocumentDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function addFiles(list: FileList | null) {
    if (!list?.length) return
    onChange([...files, ...Array.from(list)].slice(0, maxFiles))
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragging(false)
    if (!disabled) addFiles(event.dataTransfer.files)
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    addFiles(event.target.files)
    event.target.value = ''
  }

  return (
    <div className="space-y-2">
      <button
        className={`w-full rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors ${
          dragging
            ? 'border-accent bg-accent/5 text-accent'
            : 'border-line bg-bg-deep text-ink-muted hover:border-accent hover:text-ink'
        } disabled:opacity-60`}
        disabled={disabled || files.length >= maxFiles}
        onClick={() => inputRef.current?.click()}
        onDragLeave={() => setDragging(false)}
        onDragOver={event => {
          event.preventDefault()
          setDragging(true)
        }}
        onDrop={handleDrop}
        type="button"
      >
        Drop CARFAX reports, inspections, or service records here, or click to browse
        <span className="mt-1 block text-xs opacity-80">
          PDF, JPEG, PNG, WebP, or HEIC · up to {maxFiles} files
        </span>
      </button>
      <input
        accept={FILE_ACCEPT}
        className="hidden"
        multiple
        onChange={handleInputChange}
        ref={inputRef}
        type="file"
      />
      {files.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-input">
          {files.map((file, index) => (
            <li
              className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
              key={`${file.name}-${file.size}-${index}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <PdfFileIcon />
                <span className="truncate">{file.name}</span>
              </span>
              <IconButton
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                icon={<TrashIcon />}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                size="sm"
                tooltip={{ content: 'Remove' }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
