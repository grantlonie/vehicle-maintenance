import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ScheduleInput } from '@vehicles/shared'
import { AlertDialog } from '../components/AlertDialog'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { PlusIcon } from '../components/icons'
import { ScheduleForm, useCreateSchedule } from '../components/ScheduleForm'
import { ScheduleListItem } from '../components/ScheduleListItem'
import { api } from '../lib/api'
import { logPageState } from '../lib/logEntryFlow'
import { rankSchedules } from '../lib/schedules'
import { useDisplayUnit } from '../lib/settings'
import type { DueItem, Schedule, Vehicle } from '../lib/types'

export function VehicleSchedulesPage() {
  const unit = useDisplayUnit()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [addSchedule, setAddSchedule] = useState(false)
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null)
  const [confirmDeleteSchedule, setConfirmDeleteSchedule] = useState(false)

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
      setConfirmDeleteSchedule(false)
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

  function handleLogSchedule(scheduleId: string) {
    navigate(`/vehicles/${id}/log`, { state: logPageState({ scheduleId }) })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link className="text-sm text-ink-muted hover:text-accent" to={`/vehicles/${id}`}>
            ← {vehicle.name}
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">Schedules</h2>
        </div>
        <Button leftIcon={<PlusIcon />} onClick={() => setAddSchedule(true)}>
          Add schedule
        </Button>
      </div>

      <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
        <ul className="divide-y divide-line">
          {rankedSchedules.map(schedule => (
            <ScheduleListItem
              due={dueBySchedule.get(schedule.id)}
              key={schedule.id}
              onEdit={() => setEditSchedule(schedule)}
              onLog={() => handleLogSchedule(schedule.id)}
              schedule={schedule}
              unit={unit}
            />
          ))}
          {rankedSchedules.length === 0 ? (
            <li className="py-2 text-sm text-ink-muted">No schedules yet.</li>
          ) : null}
        </ul>
      </section>

      {addSchedule ? (
        <Dialog onClose={() => setAddSchedule(false)} title="Add schedule">
          <ScheduleForm
            allowKm={vehicle.trackOdometer}
            onCancel={() => setAddSchedule(false)}
            onSubmit={values => {
              createSchedule.mutate(values, { onSuccess: () => setAddSchedule(false) })
            }}
            pending={createSchedule.isPending}
          />
        </Dialog>
      ) : null}

      {editSchedule ? (
        <Dialog onClose={() => setEditSchedule(null)} title="Edit schedule">
          <ScheduleForm
            allowKm={vehicle.trackOdometer}
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
          <Button
            className="mt-3"
            color="error"
            onClick={() => setConfirmDeleteSchedule(true)}
            variant="text"
          >
            Delete schedule
          </Button>
        </Dialog>
      ) : null}

      <AlertDialog
        onClose={() => setConfirmDeleteSchedule(false)}
        onConfirm={() => {
          if (editSchedule) deleteSchedule.mutate(editSchedule.id)
        }}
        open={confirmDeleteSchedule}
        pending={deleteSchedule.isPending}
        title="Delete this schedule?"
      >
        <p className="text-sm text-ink-muted">This cannot be undone.</p>
      </AlertDialog>
    </div>
  )
}
