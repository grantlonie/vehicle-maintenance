import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ScheduleInput } from '@vehicles/shared'
import { ScheduleForm } from '../components/ScheduleForm'
import { api } from '../lib/api'
import type { Template } from '../lib/types'

export function TemplatesPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [items, setItems] = useState<ScheduleInput[]>([])

  const templatesQuery = useQuery({
    queryFn: () => api<{ templates: Template[] }>('/api/templates'),
    queryKey: ['templates'],
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api('/api/templates', {
        body: JSON.stringify({ items, name }),
        method: 'POST',
      }),
    onSuccess: async () => {
      setShowForm(false)
      setName('')
      setItems([])
      await queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/templates/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Templates</h2>
          <p className="text-sm text-ink-muted">Reusable schedule sets to apply to a vehicle.</p>
        </div>
        <button
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
          onClick={() => setShowForm(v => !v)}
          type="button"
        >
          {showForm ? 'Cancel' : 'New template'}
        </button>
      </div>

      {showForm ? (
        <div className="space-y-4 rounded-xl border border-line bg-panel p-4">
          <label className="block text-sm">
            Template name
            <input
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
              onChange={e => setName(e.target.value)}
              value={name}
            />
          </label>
          <ScheduleForm
            onSubmit={values => setItems(prev => [...prev, values])}
            submitLabel="Add schedule item"
          />
          {items.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {items.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  {item.name} · {item.activePeriod} · {item.frequencyMode}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            className="rounded-md bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
            disabled={!name || items.length === 0 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            type="button"
          >
            Save template
          </button>
        </div>
      ) : null}

      <ul className="space-y-3">
        {(templatesQuery.data?.templates ?? []).map(template => (
          <li
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-panel p-4"
            key={template.id}
          >
            <div>
              <p className="font-medium">{template.name}</p>
              <p className="text-sm text-ink-muted">{template.items.length} schedule(s)</p>
              <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                {template.items.map(item => (
                  <li key={item.name}>
                    {item.name} · {item.activePeriod}
                    {item.season ? `/${item.season}` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <button
              className="text-sm text-overdue"
              onClick={() => deleteMutation.mutate(template.id)}
              type="button"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
