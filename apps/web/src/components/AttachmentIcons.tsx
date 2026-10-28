import { authedUrl } from '../lib/api'
import type { Attachment } from '../lib/types'
import { buttonClassName } from './Button'
import { ImageFileIcon, PdfFileIcon } from './icons'
import { Tooltip } from './Tooltip'

interface AttachmentIconsProps {
  attachments: Attachment[]
  className?: string
  onRemove?: (id: string) => void
}

export function AttachmentIcons({ attachments, className = '', onRemove }: AttachmentIconsProps) {
  if (attachments.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`.trim()}>
      {attachments.map(file => (
        <div className="relative" key={file.id}>
          <Tooltip content={isPdf(file) ? 'PDF' : 'Image'}>
            <a
              aria-label={
                isPdf(file)
                  ? `View PDF ${file.originalFilename}`
                  : `View image ${file.originalFilename}`
              }
              className={buttonClassName({
                className: '!h-8 !w-8 !px-0',
                size: 'sm',
                variant: 'text',
              })}
              href={previewSrc(file.url)}
              rel="noreferrer"
              target="_blank"
            >
              <span aria-hidden="true" className="inline-flex items-center justify-center">
                {isPdf(file) ? <PdfFileIcon /> : <ImageFileIcon />}
              </span>
            </a>
          </Tooltip>
          {onRemove ? (
            <button
              aria-label={`Remove ${file.originalFilename}`}
              className="absolute -right-1 -top-1 flex size-4 cursor-pointer items-center justify-center rounded-full bg-ink text-bg shadow-sm hover:bg-overdue hover:text-white"
              onClick={event => {
                event.preventDefault()
                event.stopPropagation()
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
