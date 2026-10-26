import { useMutation } from '@tanstack/react-query'
import type { SellVehicle } from '@vehicles/shared'
import { useId, useState } from 'react'
import { api, uploadBillOfSaleFiles } from '../lib/api'
import { roundInput } from '../lib/format'
import { useDisplayUnit } from '../lib/settings'
import type { Vehicle } from '../lib/types'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { TransferFields, type TransferFieldValues } from './TransferFields'

interface SellVehicleDialogProps {
  onClose: () => void
  onSold: () => void
  vehicle: Vehicle
}

export function SellVehicleDialog({ onClose, onSold, vehicle }: SellVehicleDialogProps) {
  const formId = `sell-form-${useId()}`
  const unit = useDisplayUnit()
  const [values, setValues] = useState<TransferFieldValues>(() => ({
    date: new Date().toISOString().slice(0, 10),
    odometer: String(roundInput(vehicle.currentOdometerKm, unit)),
  }))
  const [files, setFiles] = useState<File[]>([])

  const sellMutation = useMutation({
    mutationFn: async () => {
      const body: SellVehicle = {
        odometerUnit: unit,
        soldOdometer: values.odometer ? Number(values.odometer) : null,
        soldOn: values.date,
      }
      await api(`/api/vehicles/${vehicle.id}/archive`, {
        body: JSON.stringify(body),
        method: 'POST',
      })
      await uploadBillOfSaleFiles(vehicle.id, 'sale', files)
    },
    onSuccess: onSold,
  })

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    sellMutation.mutate()
  }

  return (
    <Dialog
      backdrop={{ clickaway: !sellMutation.isPending }}
      footer={
        <div className="flex justify-end gap-2">
          <Button disabled={sellMutation.isPending} onClick={onClose} variant="text">
            Cancel
          </Button>
          <Button color="error" form={formId} loading={sellMutation.isPending} type="submit">
            Mark as sold
          </Button>
        </div>
      }
      onClose={sellMutation.isPending ? () => undefined : onClose}
      title="Sell vehicle"
    >
      <form className="space-y-4" id={formId} onSubmit={handleSubmit}>
        <p className="text-sm text-ink-muted">
          This vehicle will leave your garage. You can add it back from Sold vehicles.
        </p>
        <TransferFields
          dateLabel="Sold"
          dateRequired
          existingFiles={[]}
          files={files}
          onChange={setValues}
          onFilesChange={setFiles}
          onRemoveExistingFile={() => undefined}
          showOdometer={vehicle.trackOdometer}
          unit={unit}
          values={values}
        />
        {sellMutation.isError ? (
          <p className="text-sm text-overdue">{sellMutation.error.message}</p>
        ) : null}
      </form>
    </Dialog>
  )
}
