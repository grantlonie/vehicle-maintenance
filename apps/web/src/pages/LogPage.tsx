import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LogEntryForm, type LogFormValues } from '../components/LogEntryForm'
import { api, getToken } from '../lib/api'
import type { Schedule, Vehicle } from '../lib/types'

export function LogPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)

  const vehicleQuery = useQuery({
    queryFn: () => api<Vehicle>(`/api/vehicles/${id}`),
    queryKey: ['vehicle', id],
  })
  const schedulesQuery = useQuery({
    queryFn: () => api<{ schedules: Schedule[] }>(`/api/vehicles/${id}/schedules`),
    queryKey: ['schedules', id],
  })

  const vehicle = vehicleQuery.data

  const saveMutation = useMutation({
    mutationFn: async (values: LogFormValues) => {
      const log = await api<{ id: string }>(`/api/vehicles/${id}/logs`, {
        body: JSON.stringify(values),
        method: 'POST',
      })

      if (files) {
        for (const file of Array.from(files)) {
          const formData = new FormData()
          formData.append('file', file)
          const response = await fetch(`/api/logs/${log.id}/attachments`, {
            body: formData,
            headers: { Authorization: `Bearer ${getToken()}` },
            method: 'POST',
          })
          if (!response.ok) throw new Error('Attachment upload failed')
        }
      }

      return log
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['logs', id] })
      await queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
      navigate(`/vehicles/${id}`)
    },
  })

  if (!vehicle) return <p className="text-ink-muted">Loading…</p>

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link className="text-sm text-ink-muted hover:text-accent" to={`/vehicles/${id}`}>
          ← {vehicle.name}
        </Link>
        <h2 className="mt-2 text-2xl font-semibold">Log entry</h2>
      </div>

      <div className="rounded-xl border border-line bg-panel p-4">
        <LogEntryForm
          onClose={() => navigate(`/vehicles/${id}`)}
          onSubmit={values => {
            setError('')
            saveMutation.mutate(values, {
              onError: err => setError(err instanceof Error ? err.message : 'Save failed'),
            })
          }}
          pending={saveMutation.isPending}
          schedules={schedulesQuery.data?.schedules ?? []}
          vehicle={vehicle}
        />
        <label className="mt-4 block text-sm">
          Attachments
          <input
            className="mt-1 block w-full text-sm"
            multiple
            onChange={e => setFiles(e.target.files)}
            type="file"
          />
        </label>
        {error ? <p className="mt-2 text-sm text-overdue">{error}</p> : null}
      </div>
    </div>
  )
}
