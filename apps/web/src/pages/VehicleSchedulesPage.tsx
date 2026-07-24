import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ScheduleInput } from '@vehicles/shared'
import { Modal, PencilButton } from '../components/Modal'
import { ScheduleForm, useCreateSchedule } from '../components/ScheduleForm'
import { api } from '../lib/api'
import { distanceLabel, formatDate, statusClass, statusLabel } from '../lib/format'
import { describeSchedule, rankSchedules } from '../lib/schedules'
import type { DueItem, Schedule, Vehicle } from '../lib/types'

export function VehicleSchedulesPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [addSchedule, setAddSchedule] = useState(false)
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null)

  const vehicleQuery = useQuery({
    queryFn: () => api<Vehicle>(`/api/vehicles/${id}`),
    queryKey: ['vehicle', id],
  })
  const schedulesQuery = useQuery({
    queryFn: () => api<{ schedules: Schedule[] }>(`/api/vehicles/${id}/schedules`),
    queryKey: ['schedules', id],
  })
  const dueQuery = useQuery({
    queryFn: () => api<{ items: DueItem[] }>(`/api/due?vehicleId=${id}`),
    queryKey: ['due', id],
  })

  const createSchedule = useCreateSchedule(id)

  const updateSchedule = useMutation({
    mutationFn: ({ scheduleId, body }: { body: ScheduleInput; scheduleId: string }) =>
      api(`/api/schedules/${scheduleId}`, { body: JSON.stringify(body), method: 'PATCH' }),
    onSuccess: async () => {
      setEditSchedule(null)
      await queryClient.invalidateQueries({ queryKey: ['schedules', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
    },
  })

  const deleteSchedule = useMutation({
    mutationFn: (scheduleId: string) => api(`/api/schedules/${scheduleId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setEditSchedule(null)
      await queryClient.invalidateQueries({ queryKey: ['schedules', id] })
      await queryClient.invalidateQueries({ queryKey: ['due'] })
    },
  })

  const vehicle = vehicleQuery.data
  const dueBySchedule = useMemo(
    () => new Map((dueQuery.data?.items ?? []).map(d => [d.scheduleId, d])),
    [dueQuery.data?.items]
  )
  const rankedSchedules = useMemo(
    () => rankSchedules(schedulesQuery.data?.schedules ?? [], dueBySchedule),
    [dueBySchedule, schedulesQuery.data?.schedules]
  )

  if (!vehicle) return <p className="text-ink-muted">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link className="text-sm text-ink-muted hover:text-accent" to={`/vehicles/${id}`}>
            ← {vehicle.name}
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">Schedules</h2>
        </div>
        <button
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
          onClick={() => setAddSchedule(true)}
          type="button"
        >
          Add schedule
        </button>
      </div>

      <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
        <ul className="divide-y divide-line">
          {rankedSchedules.map(schedule => {
            const due = dueBySchedule.get(schedule.id)
            return (
              <li
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                key={schedule.id}
              >
                <div className="min-w-0">
                  <p className="font-medium">{schedule.name}</p>
                  <p className="text-sm text-ink-muted">
                    {describeSchedule(schedule, vehicle.displayUnit)}
                  </p>
                  {schedule.notes ? <p className="mt-1 text-sm text-ink-muted">{schedule.notes}</p> : null}
                  {due ? (
                    <p className={`mt-1 font-mono text-xs uppercase ${statusClass(due.status)}`}>
                      {statusLabel(due.status)}
                      {due.dueDate ? ` · ${formatDate(due.dueDate)}` : ''}
                      {due.dueOdometerKm != null
                        ? ` · ${distanceLabel(due.dueOdometerKm, vehicle.displayUnit)}`
                        : ''}
                    </p>
                  ) : null}
                </div>
                <PencilButton label="Edit schedule" onClick={() => setEditSchedule(schedule)} />
              </li>
            )
          })}
          {rankedSchedules.length === 0 ? (
            <li className="py-2 text-sm text-ink-muted">No schedules yet.</li>
          ) : null}
        </ul>
      </section>

      {addSchedule ? (
        <Modal onClose={() => setAddSchedule(false)} title="Add schedule">
          <ScheduleForm
            displayUnit={vehicle.displayUnit}
            onCancel={() => setAddSchedule(false)}
            onSubmit={values => {
              createSchedule.mutate(values, { onSuccess: () => setAddSchedule(false) })
            }}
            pending={createSchedule.isPending}
          />
        </Modal>
      ) : null}

      {editSchedule ? (
        <Modal onClose={() => setEditSchedule(null)} title="Edit schedule">
          <ScheduleForm
            displayUnit={vehicle.displayUnit}
            initial={{
              activePeriod: editSchedule.activePeriod as ScheduleInput['activePeriod'],
              frequencyMode: editSchedule.frequencyMode as ScheduleInput['frequencyMode'],
              intervalKm: editSchedule.intervalKm,
              intervalMonths: editSchedule.intervalMonths,
              name: editSchedule.name,
              notes: editSchedule.notes,
              seasons: editSchedule.seasons as ScheduleInput['seasons'],
            }}
            onCancel={() => setEditSchedule(null)}
            onSubmit={values =>
              updateSchedule.mutate({ body: values, scheduleId: editSchedule.id })
            }
            pending={updateSchedule.isPending}
            submitLabel="Save changes"
          />
          <button
            className="mt-3 text-sm text-overdue"
            onClick={() => {
              if (confirm('Delete this schedule?')) deleteSchedule.mutate(editSchedule.id)
            }}
            type="button"
          >
            Delete schedule
          </button>
        </Modal>
      ) : null}
    </div>
  )
}
