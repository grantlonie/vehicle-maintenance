import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { api, setToken } from '../lib/api'

export function SettingsPage() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryFn: () => api<{ defaultDisplayUnit: 'km' | 'mi' }>('/api/settings'),
    queryKey: ['settings'],
  })

  const saveMutation = useMutation({
    mutationFn: (defaultDisplayUnit: 'km' | 'mi') =>
      api('/api/settings', {
        body: JSON.stringify({ defaultDisplayUnit }),
        method: 'PUT',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      await queryClient.invalidateQueries({ queryKey: ['vehicle'] })
    },
  })

  const unit = settingsQuery.data?.defaultDisplayUnit ?? 'km'

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <Link className="text-sm text-ink-muted hover:text-accent" to="/">
          ← Garage
        </Link>
        <h2 className="mt-1 text-2xl font-semibold">Settings</h2>
        <p className="text-sm text-ink-muted">
          Display unit for all vehicles (and new ones). App token is env-only.
        </p>
      </div>

      <label className="block text-sm">
        Display unit
        <select
          className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2"
          onChange={e => saveMutation.mutate(e.target.value as 'km' | 'mi')}
          value={unit}
        >
          <option value="km">Kilometers</option>
          <option value="mi">Miles</option>
        </select>
      </label>

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
