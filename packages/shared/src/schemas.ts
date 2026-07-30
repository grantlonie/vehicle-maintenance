import { z } from 'zod'

export const displayUnitSchema = z.enum(['km', 'mi'])
export const seasonSchema = z.enum(['spring', 'summer', 'fall', 'winter'])
export const activePeriodSchema = z.enum(['year_round', 'seasonal'])
export const frequencyModeSchema = z.enum(['interval', 'once_per_season'])
export const logKindSchema = z.enum(['service', 'repair'])
export const performedBySchema = z.enum(['self', 'shop'])
export const currencySchema = z.enum(['USD', 'CAD'])
export const dueStatusSchema = z.enum(['ok', 'soon', 'overdue', 'inactive', 'never'])

export const settingsSchema = z.object({
  defaultDisplayUnit: displayUnitSchema,
})

export const vehicleCreateSchema = z.object({
  displayUnit: displayUnitSchema.optional(),
  make: z.string().min(1),
  model: z.string().min(1),
  name: z.string().min(1),
  odometer: z.number().nonnegative(),
  odometerUnit: displayUnitSchema,
  vin: z.string().optional().nullable(),
  year: z.number().int().min(1900).max(2100),
})

export const vehicleUpdateSchema = z.object({
  displayUnit: displayUnitSchema.optional(),
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  vin: z.string().optional().nullable(),
  year: z.number().int().min(1900).max(2100).optional(),
})

export const odometerReadingSchema = z.object({
  odometer: z.number().nonnegative(),
  odometerUnit: displayUnitSchema,
  recordedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

export const scheduleInputSchema = z
  .object({
    activePeriod: activePeriodSchema,
    frequencyMode: frequencyModeSchema,
    intervalKm: z.number().positive().nullable().optional(),
    intervalMonths: z.number().int().positive().nullable().optional(),
    name: z.string().min(1),
    notes: z.string().nullable().optional(),
    seasons: z.array(seasonSchema).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.activePeriod === 'seasonal' && (!value.seasons || value.seasons.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        message: 'seasons is required when activePeriod is seasonal',
        path: ['seasons'],
      })
    }
    if (value.frequencyMode === 'interval') {
      const hasKm = value.intervalKm != null && value.intervalKm > 0
      const hasMonths = value.intervalMonths != null && value.intervalMonths > 0
      if (!hasKm && !hasMonths) {
        ctx.addIssue({
          code: 'custom',
          message: 'interval schedules need intervalKm and/or intervalMonths',
          path: ['intervalKm'],
        })
      }
    }
    if (value.frequencyMode === 'once_per_season' && value.activePeriod !== 'seasonal') {
      ctx.addIssue({
        code: 'custom',
        message: 'once_per_season requires a seasonal active period',
        path: ['frequencyMode'],
      })
    }
  })

export const logInputSchema = z
  .object({
    costEnteredCents: z.number().int().nonnegative().nullable().optional(),
    costEnteredCurrency: currencySchema.nullable().optional(),
    costUsdCents: z.number().int().nonnegative().nullable().optional(),
    fxFetchedAt: z.string().datetime().nullable().optional(),
    fxRateToUsd: z.number().positive().nullable().optional(),
    kind: logKindSchema,
    notes: z.string().nullable().optional(),
    odometer: z.number().nonnegative(),
    odometerUnit: displayUnitSchema,
    performedBy: performedBySchema,
    performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduleId: z.string().uuid().nullable().optional(),
    shopName: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.performedBy === 'shop' && !value.shopName?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'shopName is required when performedBy is shop',
        path: ['shopName'],
      })
    }
    if (value.kind === 'repair' && value.scheduleId) {
      ctx.addIssue({
        code: 'custom',
        message: 'repairs cannot link to a schedule',
        path: ['scheduleId'],
      })
    }
    if (value.costEnteredCurrency === 'CAD') {
      if (value.fxRateToUsd == null) {
        ctx.addIssue({
          code: 'custom',
          message: 'fxRateToUsd required for CAD entry',
          path: ['fxRateToUsd'],
        })
      }
      if (value.costEnteredCents == null) {
        ctx.addIssue({
          code: 'custom',
          message: 'costEnteredCents required for CAD entry',
          path: ['costEnteredCents'],
        })
      }
    }
  })

export const copySchedulesSchema = z.object({
  sourceVehicleId: z.string().uuid(),
})

export const confidenceLevelSchema = z.enum(['high', 'medium', 'low'])

export const receiptFieldConfidenceSchema = z.object({
  cost: confidenceLevelSchema,
  kind: confidenceLevelSchema,
  notes: confidenceLevelSchema,
  odometer: confidenceLevelSchema,
  performedBy: confidenceLevelSchema,
  performedOn: confidenceLevelSchema,
  schedule: confidenceLevelSchema,
  shopName: confidenceLevelSchema,
})

export const odometerCandidateSchema = z.object({
  rank: z.number().int().positive(),
  source: z.string().nullable(),
  unit: displayUnitSchema.nullable(),
  value: z.number().nonnegative(),
})

export const receiptOcrPreviewSchema = z.object({
  confidence: receiptFieldConfidenceSchema,
  costEnteredCents: z.number().int().nonnegative().nullable(),
  costEnteredCurrency: currencySchema.nullable(),
  kind: logKindSchema.nullable(),
  notes: z.string().nullable(),
  odometer: z.number().nonnegative().nullable(),
  odometerCandidates: z.array(odometerCandidateSchema),
  odometerUnit: displayUnitSchema.nullable(),
  performedBy: performedBySchema.nullable(),
  performedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  scheduleId: z.string().uuid().nullable(),
  shopName: z.string().nullable(),
})

export type VehicleCreate = z.infer<typeof vehicleCreateSchema>
export type VehicleUpdate = z.infer<typeof vehicleUpdateSchema>
export type ScheduleInput = z.infer<typeof scheduleInputSchema>
export type LogInput = z.infer<typeof logInputSchema>
export type CopySchedules = z.infer<typeof copySchedulesSchema>
export type Settings = z.infer<typeof settingsSchema>
export type ConfidenceLevel = z.infer<typeof confidenceLevelSchema>
export type ReceiptFieldConfidence = z.infer<typeof receiptFieldConfidenceSchema>
export type OdometerCandidate = z.infer<typeof odometerCandidateSchema>
export type ReceiptOcrPreview = z.infer<typeof receiptOcrPreviewSchema>
