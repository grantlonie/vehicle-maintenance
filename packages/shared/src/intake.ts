import { z } from 'zod'
import {
  currencySchema,
  displayUnitSchema,
  logKindSchema,
  performedBySchema,
  scheduleInputSchema,
  vehicleCreateSchema,
  vehicleTypeSchema,
} from './schemas'

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const UNRECORDED_SHOP_NAME = 'Not recorded'

export const vinDecodeSchema = z.object({
  bodyClass: z.string().nullable(),
  displacementL: z.string().nullable(),
  driveType: z.string().nullable(),
  engineCylinders: z.string().nullable(),
  engineModel: z.string().nullable(),
  fuelType: z.string().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  transmission: z.string().nullable(),
  trim: z.string().nullable(),
  year: z.number().int().nullable(),
})

export const scheduleDraftSchema = z.object({
  key: z.string().min(1),
  schedule: scheduleInputSchema,
})

export const historyDraftSchema = z.object({
  costEnteredCents: z.number().int().nonnegative().nullable(),
  costEnteredCurrency: currencySchema.nullable(),
  documentIndex: z.number().int().nonnegative(),
  key: z.string().min(1),
  kind: logKindSchema,
  notes: z.string(),
  odometer: z.number().nonnegative().nullable(),
  odometerUnit: displayUnitSchema,
  performedBy: performedBySchema,
  performedOn: isoDateSchema.nullable(),
  possibleDuplicate: z.boolean(),
  /** Why the row was not imported by default (recommendation, missing date, ...). */
  reason: z.string().nullable(),
  scheduleKey: z.string().nullable(),
  shopName: z.string().nullable(),
})

/** Purchase details read from a bill of sale / purchase agreement. */
export const billOfSaleDetailsSchema = z.object({
  odometer: z.number().nonnegative().nullable(),
  odometerUnit: displayUnitSchema,
  purchasedOn: isoDateSchema.nullable(),
})

export const intakeDocumentSchema = z.object({
  /** Set when the document is a bill of sale; it then contributes no history rows. */
  billOfSale: billOfSaleDetailsSchema.nullable(),
  error: z.string().nullable(),
  filename: z.string(),
  index: z.number().int().nonnegative(),
})

export const intakePreviewSchema = z.object({
  documents: z.array(intakeDocumentSchema),
  history: z.array(historyDraftSchema),
  scheduleError: z.string().nullable(),
  schedules: z.array(scheduleDraftSchema),
  skipped: z.array(historyDraftSchema),
  vinDecode: vinDecodeSchema.nullable(),
})

export const intakePreviewRequestSchema = z.object({
  /** Vehicle whose schedules a new vehicle will copy; history rows match against those. */
  copyFromVehicleId: z.string().uuid().nullable().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  suggestSchedules: z.boolean(),
  vehicleType: vehicleTypeSchema.optional(),
  /** Existing vehicle whose schedules history rows should match against. */
  vehicleId: z.string().uuid().nullable().optional(),
  vin: z.string().nullable().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
})

export const importLogSchema = z
  .object({
    costEnteredCents: z.number().int().nonnegative().nullable(),
    costEnteredCurrency: currencySchema.nullable(),
    documentIndex: z.number().int().nonnegative().nullable(),
    kind: logKindSchema,
    notes: z.string().nullable(),
    odometer: z.number().nonnegative(),
    odometerUnit: displayUnitSchema,
    performedBy: performedBySchema,
    performedOn: isoDateSchema,
    scheduleKey: z.string().nullable(),
    shopName: z.string().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'repair' && value.scheduleKey) {
      ctx.addIssue({
        code: 'custom',
        message: 'repairs cannot link to a schedule',
        path: ['scheduleKey'],
      })
    }
  })

export const vehicleIntakeSchema = z.object({
  /** Uploaded file at `documentIndex` is stored as the purchase bill of sale. */
  billOfSale: billOfSaleDetailsSchema
    .extend({ documentIndex: z.number().int().nonnegative() })
    .nullable()
    .optional(),
  /** When set, `logs[].scheduleKey` may reference the source vehicle's schedule ids. */
  copyFromVehicleId: z.string().uuid().nullable(),
  logs: z.array(importLogSchema),
  schedules: z.array(scheduleDraftSchema),
  vehicle: vehicleCreateSchema,
})

export const documentImportSchema = z.object({
  logs: z.array(importLogSchema),
})

export type BillOfSaleDetails = z.infer<typeof billOfSaleDetailsSchema>
export type VinDecode = z.infer<typeof vinDecodeSchema>
export type ScheduleDraft = z.infer<typeof scheduleDraftSchema>
export type HistoryDraft = z.infer<typeof historyDraftSchema>
export type IntakeDocument = z.infer<typeof intakeDocumentSchema>
export type IntakePreview = z.infer<typeof intakePreviewSchema>
export type IntakePreviewRequest = z.infer<typeof intakePreviewRequestSchema>
export type ImportLog = z.infer<typeof importLogSchema>
export type VehicleIntake = z.infer<typeof vehicleIntakeSchema>
export type DocumentImport = z.infer<typeof documentImportSchema>
