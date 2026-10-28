import { THEME_PREFERENCES, type ThemePreference, useThemePreference } from '../lib/theme'

const LABELS: Record<ThemePreference, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'System',
}

export function ThemeToggle() {
  const [preference, setPreference] = useThemePreference()

  return (
    <div>
      <p className="text-sm">Appearance</p>
      <div
        aria-label="Appearance"
        className="mt-1 flex gap-1 rounded-md border border-line bg-input p-1"
        role="radiogroup"
      >
        {THEME_PREFERENCES.map(value => (
          <button
            aria-checked={preference === value}
            className={`flex-1 cursor-pointer rounded px-2 py-1.5 text-sm ${
              preference === value ? 'bg-ink text-bg' : 'text-ink-muted hover:text-ink'
            }`}
            key={value}
            onClick={() => setPreference(value)}
            role="radio"
            type="button"
          >
            {LABELS[value]}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-ink-muted">Default follows the device theme.</p>
    </div>
  )
}
