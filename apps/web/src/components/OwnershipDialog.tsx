import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DisplayUnit, VehicleOwnership } from '@vehicles/shared'
import { isEqual } from 'lodash-es'
import { useId, useState } from 'react'
import { api, uploadBillOfSaleFiles } from '../lib/api'
import { roundInput } from '../lib/format'
import { useDisplayUnit } from '../lib/settings'
import type { BillOfSaleFile, Vehicle } from '../lib/types'
import { Button, DONE_SAVE_WIDTH } from './Button'
import { Dialog } from './Dialog'
import { TransferFields, type TransferFieldValues } from './TransferFields'

interface OwnershipDialogProps {
  onClose: () => void
  onSell: () => void
  vehicle: Vehicle
}

export function OwnershipDialog({ onClose, onSell, vehicle }: OwnershipDialogProps) {
  const filesQuery = useQuery({
    queryFn: () => api<{ files: BillOfSaleFile[] }>(`/api/vehicles/${vehicle.id}/bill-of-sale`),
    queryKey: ['bill-of-sale', vehicle.id],
  })

  if (!filesQuery.data) {
    return (
      <Dialog onClose={onClose} title="Ownership">
        <p className="text-sm text-ink-muted">Loading…</p>
      </Dialog>
    )
  }

  return (
    <OwnershipForm
      files={filesQuery.data.files}
      onClose={onClose}
      onSell={onSell}
      vehicle={vehicle}
    />
  )
}

interface OwnershipFormProps extends OwnershipDialogProps {
  files: BillOfSaleFile[]
}

interface OwnershipFieldState {
  purchase: TransferFieldValues
  sale: TransferFieldValues
}

function OwnershipForm({ files, onClose, onSell, vehicle }: OwnershipFormProps) {
  const formId = `ownership-form-${useId()}`
  const unit = useDisplayUnit()
  const queryClient = useQueryClient()
  const sold = Boolean(vehicle.archivedAt)

  const [baseline] = useState(() => toFieldState(vehicle, unit))
  const [values, setValues] = useState(baseline)
  const [keptFiles, setKeptFiles] = useState(files)
  const [purchaseFiles, setPurchaseFiles] = useState<File[]>([])
  const [saleFiles, setSaleFiles] = useState<File[]>([])

  const dirty =
    !isEqual(values, baseline) ||
    keptFiles.length !== files.length ||
    purchaseFiles.length > 0 ||
    saleFiles.length > 0

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: VehicleOwnership = {
        odometerUnit: unit,
        purchaseOdometer: optionalNumber(values.purchase.odometer),
        purchasedOn: values.purchase.date || null,
        soldOdometer: optionalNumber(values.sale.odometer),
        soldOn: values.sale.date || null,
      }
      await api(`/api/vehicles/${vehicle.id}/ownership`, {
        body: JSON.stringify(body),
        method: 'PUT',
      })
      const keptIds = new Set(keptFiles.map(f => f.id))
      for (const file of files.filter(f => !keptIds.has(f.id))) {
        await api(`/api/bill-of-sale/${file.id}`, { method: 'DELETE' })
      }
      await uploadBillOfSaleFiles(vehicle.id, 'purchase', purchaseFiles)
      await uploadBillOfSaleFiles(vehicle.id, 'sale', saleFiles)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vehicle', vehicle.id] })
      await queryClient.invalidateQueries({ queryKey: ['bill-of-sale', vehicle.id] })
      onClose()
    },
  })

  function handleRemoveFile(id: string) {
    setKeptFiles(prev => prev.filter(file => file.id !== id))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dirty) {
      onClose()
      return
    }
    saveMutation.mutate()
  }

  return (
    <Dialog
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {sold ? (
            <span />
          ) : (
            <Button color="error" onClick={onSell} variant="text">
              Sell vehicle
            </Button>
          )}
          <div className="flex items-center gap-2">
            {dirty ? (
              <Button onClick={onClose} variant="text">
                Cancel
              </Button>
            ) : null}
            <Button
              className={DONE_SAVE_WIDTH}
              form={dirty ? formId : undefined}
              loading={dirty && saveMutation.isPending}
              onClick={dirty ? undefined : onClose}
              type={dirty ? 'submit' : 'button'}
            >
              {dirty ? 'Save' : 'Done'}
            </Button>
          </div>
        </div>
      }
      onClose={onClose}
      title="Ownership"
    >
      <form className="space-y-6" id={formId} onSubmit={handleSubmit}>
        <TransferFields
          dateLabel="Purchased"
          existingFiles={keptFiles.filter(f => f.side === 'purchase')}
          files={purchaseFiles}
          onChange={purchase => setValues(prev => ({ ...prev, purchase }))}
          onFilesChange={setPurchaseFiles}
          onRemoveExistingFile={handleRemoveFile}
          showOdometer={vehicle.trackOdometer}
          title="Purchase"
          unit={unit}
          values={values.purchase}
        />
        {sold ? (
          <TransferFields
            dateLabel="Sold"
            existingFiles={keptFiles.filter(f => f.side === 'sale')}
            files={saleFiles}
            onChange={sale => setValues(prev => ({ ...prev, sale }))}
            onFilesChange={setSaleFiles}
            onRemoveExistingFile={handleRemoveFile}
            showOdometer={vehicle.trackOdometer}
            title="Sale"
            unit={unit}
            values={values.sale}
          />
        ) : null}
        {saveMutation.isError ? (
          <p className="text-sm text-overdue">{saveMutation.error.message}</p>
        ) : null}
      </form>
    </Dialog>
  )
}

function toFieldState(vehicle: Vehicle, unit: DisplayUnit): OwnershipFieldState {
  return {
    purchase: {
      date: vehicle.purchasedOn ?? '',
      odometer: odometerInput(vehicle.purchaseOdometerKm, unit),
    },
    sale: {
      date: vehicle.soldOn ?? '',
      odometer: odometerInput(vehicle.soldOdometerKm, unit),
    },
  }
}

function odometerInput(km: number | null, unit: DisplayUnit): string {
  return km != null ? String(roundInput(km, unit)) : ''
}

function optionalNumber(value: string): number | null {
  return value ? Number(value) : null
}
