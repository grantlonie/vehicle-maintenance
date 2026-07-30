import { useState } from 'react'
import { authedUrl } from '../lib/api'
import type { Attachment } from '../lib/types'
import { Dialog } from './Dialog'
import { IconButton } from './IconButton'
import { ImageFileIcon, PdfFileIcon } from './icons'

interface AttachmentIconsProps {
  attachments: Attachment[]
  className?: string
  onRemove?: (id: string) => void
}

export function AttachmentIcons({ attachments, className = '', onRemove }: AttachmentIconsProps) {
  const [preview, setPreview] = useState<Attachment | null>(null)

  if (attachments.length === 0) return null

  return (
    <>
      <div className={`flex flex-wrap gap-1.5 ${className}`.trim()}>
        {attachments.map(file => (
          <div className="relative" key={file.id}>
            <IconButton
              aria-label={
                isPdf(file)
                  ? `View PDF ${file.originalFilename}`
                  : `View image ${file.originalFilename}`
              }
              icon={isPdf(file) ? <PdfFileIcon /> : <ImageFileIcon />}
              onClick={() => setPreview(file)}
              size="sm"
              tooltip={{ content: isPdf(file) ? 'PDF' : 'Image' }}
            />
            {onRemove ? (
              <button
                aria-label={`Remove ${file.originalFilename}`}
                className="absolute -right-1 -top-1 flex size-4 cursor-pointer items-center justify-center rounded-full bg-ink text-white shadow-sm hover:bg-overdue"
                onClick={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (preview?.id === file.id) setPreview(null)
                  onRemove(file.id)
                }}
                type="button"
              >
                <RemoveIcon />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {preview ? (
        <Dialog
          onClose={() => setPreview(null)}
          placement="center"
          size="lg"
          title={isPdf(preview) ? 'PDF' : 'Image'}
        >
          <AttachmentPreview attachment={preview} />
        </Dialog>
      ) : null}
    </>
  )
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const url = previewSrc(attachment.url)

  if (isPdf(attachment)) {
    return (
      <iframe
        className="h-[min(70vh,36rem)] w-full rounded-md border border-line bg-white"
        src={url}
        title={attachment.originalFilename}
      />
    )
  }

  if (attachment.contentType.startsWith('image/')) {
    return (
      <img
        alt={attachment.originalFilename}
        className="mx-auto max-h-[min(70vh,36rem)] max-w-full object-contain"
        src={url}
      />
    )
  }

  return (
    <p className="text-sm text-ink-muted">
      Preview not available.{' '}
      <a className="text-accent hover:underline" href={url} rel="noreferrer" target="_blank">
        Open file
      </a>
    </p>
  )
}

function RemoveIcon() {
  return (
    <svg
      className="size-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

function isPdf(attachment: Attachment): boolean {
  return (
    attachment.contentType === 'application/pdf' ||
    attachment.originalFilename.toLowerCase().endsWith('.pdf')
  )
}

function previewSrc(url: string): string {
  if (url.startsWith('blob:') || url.startsWith('data:')) return url
  return authedUrl(url)
}
