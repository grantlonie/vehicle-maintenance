interface SwitchProps {
  checked: boolean
  description?: string
  label: string
  onChange: (checked: boolean) => void
}

export function Switch({ checked, description, label, onChange }: SwitchProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-sm font-medium">
        <span>{label}</span>
        <button
          aria-checked={checked}
          aria-label={label}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            checked ? 'bg-accent' : 'bg-line'
          }`}
          onClick={() => onChange(!checked)}
          role="switch"
          type="button"
        >
          <span
            className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      {description ? <p className="text-xs font-normal text-ink-muted">{description}</p> : null}
    </div>
  )
}
