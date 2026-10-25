import { useQuery } from '@tanstack/react-query'
import type { DisplayUnit, Settings } from '@vehicles/shared'
import { api } from './api'

export function useSettingsQuery() {
  return useQuery({
    queryFn: () => api<Settings>('/api/settings'),
    queryKey: ['settings'],
  })
}

/** Global distance unit for display and entry; `App` waits for settings before rendering pages. */
export function useDisplayUnit(): DisplayUnit {
  return useSettingsQuery().data?.displayUnit ?? 'km'
}
