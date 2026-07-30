import { useEffect, useRef, useState } from 'react'
import type { Attachment } from '../lib/types'
import { AttachmentIcons } from './AttachmentIcons'
import { Button } from './Button'
import { CameraCaptureDialog, isCameraCaptureSupported } from './CameraCaptureDialog'
import { Popover } from './Popover'

const FILE_ACCEPT = 'image/*,application/pdf,.pdf'

interface AttachmentsFieldProps {
  className?: string
  files: File[]
  onChange: (files: File[]) => void
}

export function AttachmentsField({ className = '', files, onChange }: AttachmentsFieldProps) {
  const addRef = useRef<HTMLSpanElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraFallbackRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const previews = useLocalAttachmentPreviews(files)

  function addFiles(next: File[]) {
    if (next.length === 0) return
    onChange([...files, ...next])
  }

  function handleRemove(id: string) {
    const index = previews.findIndex(preview => preview.id === id)
    if (index < 0) return
    onChange(files.filter((_, i) => i !== index))
  }

  function handleBrowseChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.files ? Array.from(event.target.files) : []
    event.target.value = ''
    addFiles(next)
  }

  function handleCameraFallbackChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) addFiles([file])
  }

  function handleBrowse() {
    setMenuOpen(false)
    fileInputRef.current?.click()
  }

  function handleTakePhoto() {
    setMenuOpen(false)
    if (isCameraCaptureSupported()) {
      setCameraOpen(true)
      return
    }
    cameraFallbackRef.current?.click()
  }

  function handleCapture(file: File) {
    setCameraOpen(false)
    addFiles([file])
  }

  return (
    <div className={className}>
      <p className="text-sm font-medium">Attachments</p>
      {previews.length > 0 ? (
        <AttachmentIcons attachments={previews} className="mt-1" onRemove={handleRemove} />
      ) : null}

      <span className="mt-2 inline-block" ref={addRef}>
        <Button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen(open => !open)}
          size="sm"
          variant="outlined"
        >
          Add files
        </Button>
      </span>

      <Popover
        anchorRef={addRef}
        onClose={() => setMenuOpen(false)}
        open={menuOpen}
        widthClassName="w-44"
      >
        <div className="flex flex-col gap-0.5" role="menu">
          <MenuItem label="Browse files" onClick={handleBrowse} />
          <MenuItem label="Take photo" onClick={handleTakePhoto} />
        </div>
      </Popover>

      <input
        accept={FILE_ACCEPT}
        className="hidden"
        multiple
        onChange={handleBrowseChange}
        ref={fileInputRef}
        type="file"
      />
      <input
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCameraFallbackChange}
        ref={cameraFallbackRef}
        type="file"
      />

      <CameraCaptureDialog
        onCapture={handleCapture}
        onClose={() => setCameraOpen(false)}
        open={cameraOpen}
        title="Photograph attachment"
      />
    </div>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-deep"
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      {label}
    </button>
  )
}

function useLocalAttachmentPreviews(files: File[]): Attachment[] {
  const [previews, setPreviews] = useState<Attachment[]>([])

  useEffect(() => {
    const next = files.map((file, index) => ({
      contentType: file.type || contentTypeFromName(file.name),
      id: `local-${file.name}-${file.size}-${file.lastModified}-${index}`,
      originalFilename: file.name,
      sizeBytes: file.size,
      url: URL.createObjectURL(file),
    }))
    setPreviews(next)
    return () => {
      for (const item of next) URL.revokeObjectURL(item.url)
    }
  }, [files])

  return previews
}

function contentTypeFromName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}
