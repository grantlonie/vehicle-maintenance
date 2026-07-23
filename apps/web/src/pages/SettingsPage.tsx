import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
    },
  })

  const unit = settingsQuery.data?.defaultDisplayUnit ?? 'km'

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="text-sm text-ink-muted">Defaults for new vehicles. App token is env-only.</p>
      </div>

      <label className="block text-sm">
        Default display unit
        <select
          className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2"
          onChange={e => saveMutation.mutate(e.target.value as 'km' | 'mi')}
          value={unit}
        >
          <option value="km">Kilometers</option>
          <option value="mi">Miles</option>
        </select>
      </label>

      <button
        className="rounded-md border border-line px-3 py-2 text-sm text-overdue"
        onClick={() => {
          setToken('')
          window.location.href = '/'
        }}
        type="button"
      >
        Sign out
      </button>
    </div>
  )
}
