"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import {
  deleteRondaScheduleAction,
  recordRondaAttendanceAction,
  upsertRondaScheduleAction,
} from "@/app/actions/ronda"
import {
  buildRondaFilterQueryString,
  getRondaMutationInvalidationKeys,
  rondaQueryKeys,
} from "@/lib/ronda/query-keys"
import type {
  DeleteRondaScheduleResult,
  RecordRondaAttendanceResult,
  RondaAttendanceAdminRecord,
  RondaAttendanceFilterParams,
  RondaAttendanceInput,
  RondaMyAttendanceRecord,
  RondaResidentCandidate,
  RondaScheduleFilters,
  RondaScheduleInput,
  RondaSchedulePageResult,
  RondaScheduleWithRoster,
  UpsertRondaScheduleResult,
} from "@/lib/ronda/types"

export {
  buildRondaFilterQueryString,
  getRondaMutationInvalidationKeys,
  rondaQueryKeys,
}

async function fetchRondaJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null
    throw new Error(body?.error ?? "Gagal memuat data jadwal ronda.")
  }

  return (await res.json()) as T
}

export function useAdminRondaSchedules({
  tenantId,
  filters,
  initialData,
  enabled = true,
}: {
  tenantId: string
  filters?: RondaScheduleFilters
  initialData?: RondaSchedulePageResult
  enabled?: boolean
}) {
  const qs = buildRondaFilterQueryString(filters)
  return useQuery<RondaSchedulePageResult, Error>({
    queryKey: rondaQueryKeys.list("admin", tenantId, filters),
    queryFn: () =>
      fetchRondaJson<RondaSchedulePageResult>(
        `/api/ronda${qs ? `?${qs}` : ""}`
      ),
    initialData,
    placeholderData: keepPreviousData,
    enabled: Boolean(tenantId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useAdminRondaScheduleDetail({
  tenantId,
  scheduleId,
  initialData,
  enabled = true,
}: {
  tenantId: string
  scheduleId: string
  initialData?: RondaScheduleWithRoster
  enabled?: boolean
}) {
  return useQuery<RondaScheduleWithRoster, Error>({
    queryKey: rondaQueryKeys.detail("admin", tenantId, scheduleId),
    queryFn: () =>
      fetchRondaJson<RondaScheduleWithRoster>(
        `/api/ronda/${encodeURIComponent(scheduleId)}`
      ),
    initialData,
    enabled: Boolean(tenantId && scheduleId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useRondaResidentCandidates({
  tenantId,
  search,
  initialData,
  enabled = true,
}: {
  tenantId: string
  search?: string
  initialData?: RondaResidentCandidate[]
  enabled?: boolean
}) {
  const trimmed = search?.trim() ?? ""
  const qs = trimmed ? `?search=${encodeURIComponent(trimmed)}` : ""

  return useQuery<RondaResidentCandidate[], Error>({
    queryKey: rondaQueryKeys.candidates(tenantId, trimmed),
    queryFn: async () => {
      const res = await fetchRondaJson<{ items: RondaResidentCandidate[] }>(
        `/api/ronda/candidates${qs}`
      )
      return res.items
    },
    initialData,
    enabled: Boolean(tenantId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  })
}

export function useAdminRondaAttendance({
  tenantId,
  params,
  initialData,
  enabled = true,
}: {
  tenantId: string
  params?: RondaAttendanceFilterParams
  initialData?: RondaAttendanceAdminRecord[]
  enabled?: boolean
}) {
  const sp = new URLSearchParams()
  if (params?.scheduleId) sp.set("scheduleId", params.scheduleId)
  if (params?.fromDate) sp.set("fromDate", params.fromDate)
  if (params?.toDate) sp.set("toDate", params.toDate)
  const qs = sp.toString()

  return useQuery<RondaAttendanceAdminRecord[], Error>({
    queryKey: rondaQueryKeys.adminAttendance(tenantId, params),
    queryFn: async () => {
      const res = await fetchRondaJson<{ items: RondaAttendanceAdminRecord[] }>(
        `/api/ronda/attendance${qs ? `?${qs}` : ""}`
      )
      return res.items
    },
    initialData,
    enabled: Boolean(tenantId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useResidentRondaSchedules({
  tenantId,
  filters,
  initialData,
  enabled = true,
}: {
  tenantId: string
  filters?: RondaScheduleFilters
  initialData?: RondaSchedulePageResult
  enabled?: boolean
}) {
  const qs = buildRondaFilterQueryString(filters)
  return useQuery<RondaSchedulePageResult, Error>({
    queryKey: rondaQueryKeys.list("resident", tenantId, filters),
    queryFn: () =>
      fetchRondaJson<RondaSchedulePageResult>(
        `/api/resident/ronda${qs ? `?${qs}` : ""}`
      ),
    initialData,
    placeholderData: keepPreviousData,
    enabled: Boolean(tenantId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useResidentRondaScheduleDetail({
  tenantId,
  scheduleId,
  initialData,
  enabled = true,
}: {
  tenantId: string
  scheduleId: string
  initialData?: RondaScheduleWithRoster
  enabled?: boolean
}) {
  return useQuery<RondaScheduleWithRoster, Error>({
    queryKey: rondaQueryKeys.detail("resident", tenantId, scheduleId),
    queryFn: () =>
      fetchRondaJson<RondaScheduleWithRoster>(
        `/api/resident/ronda/${encodeURIComponent(scheduleId)}`
      ),
    initialData,
    enabled: Boolean(tenantId && scheduleId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useMyRondaAttendance({
  tenantId,
  scheduleId,
  initialData,
  enabled = true,
}: {
  tenantId: string
  scheduleId: string
  initialData?: RondaMyAttendanceRecord | null
  enabled?: boolean
}) {
  return useQuery<RondaMyAttendanceRecord | null, Error>({
    queryKey: rondaQueryKeys.myAttendance(tenantId, scheduleId),
    queryFn: async () => {
      const res = await fetchRondaJson<RondaScheduleWithRoster>(
        `/api/resident/ronda/${encodeURIComponent(scheduleId)}`
      )
      return res.myAttendance
    },
    initialData,
    enabled: Boolean(tenantId && scheduleId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useUpsertRondaScheduleMutation({
  tenantId,
}: {
  tenantId: string
}) {
  const queryClient = useQueryClient()

  return useMutation<UpsertRondaScheduleResult, Error, RondaScheduleInput>({
    mutationFn: async (input) => {
      const res = await upsertRondaScheduleAction(input)
      if (!res.ok || !res.data) {
        throw new Error(res.error ?? "Gagal menyimpan jadwal ronda.")
      }
      return res.data
    },
    onSuccess: async (data) => {
      const keys = getRondaMutationInvalidationKeys({
        tenantId,
        scheduleId: data.id,
        kind: "upsert",
      })
      await Promise.all(
        keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
      )
    },
  })
}

export function useDeleteRondaScheduleMutation({
  tenantId,
}: {
  tenantId: string
}) {
  const queryClient = useQueryClient()

  return useMutation<DeleteRondaScheduleResult, Error, string>({
    mutationFn: async (scheduleId) => {
      const res = await deleteRondaScheduleAction({ scheduleId })
      if (!res.ok || !res.data) {
        throw new Error(res.error ?? "Gagal menghapus jadwal ronda.")
      }
      return res.data
    },
    onSuccess: async (data) => {
      const keys = getRondaMutationInvalidationKeys({
        tenantId,
        scheduleId: data.id,
        kind: "delete",
      })
      await Promise.all(
        keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
      )
    },
  })
}

export function useRecordRondaAttendanceMutation({
  tenantId,
}: {
  tenantId: string
}) {
  const queryClient = useQueryClient()

  return useMutation<
    RecordRondaAttendanceResult,
    Error,
    RondaAttendanceInput
  >({
    mutationFn: async (input) => {
      const res = await recordRondaAttendanceAction(input)
      if (!res.ok || !res.data) {
        throw new Error(res.error ?? "Gagal menyimpan status kehadiran ronda.")
      }
      return res.data
    },
    onSuccess: async (data) => {
      const keys = getRondaMutationInvalidationKeys({
        tenantId,
        scheduleId: data.scheduleId,
        kind: "attendance",
      })
      await Promise.all(
        keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
      )
    },
  })
}
