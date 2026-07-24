interface PencilButtonProps {
  label: string
  onClick: () => void
}

export function PencilButton({ label, onClick }: PencilButtonProps) {
  return (
    <button
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-bg-deep hover:text-accent cursor-pointer"
      onClick={onClick}
      title={label}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        viewBox="0 0 24 24"
      >
        <path
          d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
