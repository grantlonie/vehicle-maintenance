import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DisplayUnit } from '@vehicles/shared'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { ThemeToggle } from '../components/ThemeToggle'
import { api, setToken } from '../lib/api'
import { useDisplayUnit } from '../lib/settings'

export function SettingsPage() {
  const queryClient = useQueryClient()
  const unit = useDisplayUnit()

  const saveMutation = useMutation({
    mutationFn: (displayUnit: DisplayUnit) =>
      api('/api/settings', {
        body: JSON.stringify({ displayUnit }),
        method: 'PUT',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <Link className="text-sm text-ink-muted hover:text-accent" to="/">
          ← Garage
        </Link>
        <h2 className="mt-1 text-2xl font-semibold">Settings</h2>
        <p className="text-sm text-ink-muted">
          Distance unit and appearance. App token is env-only.
        </p>
      </div>

      <label className="block text-sm">
        Display unit
        <select
          className="mt-1 w-full rounded-md border border-line bg-input px-3 py-2"
          onChange={e => saveMutation.mutate(e.target.value as DisplayUnit)}
          value={unit}
        >
          <option value="km">Kilometers</option>
          <option value="mi">Miles</option>
        </select>
      </label>

      <ThemeToggle />

      <Button
        color="error"
        onClick={() => {
          setToken('')
          window.location.href = '/'
        }}
        variant="outlined"
      >
        Sign out
      </Button>
    </div>
  )
}
