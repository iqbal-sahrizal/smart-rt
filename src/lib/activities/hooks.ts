"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import {
  addActivityParticipantAction,
  cancelActivityRegistrationAction,
  createActivityAction,
  recordActivityAttendanceAction,
  registerForActivityAction,
  removeActivityDocAction,
  removeActivityParticipantAction,
  softDeleteActivityAction,
  transitionActivityStatusAction,
  updateActivityAction,
  uploadActivityDocAction,
} from "@/app/actions/activities"
import {
  activitiesQueryKeys,
  buildActivityFilterQueryString,
  buildActivityParticipantsQueryString,
  getActivityMutationInvalidationKeys,
} from "@/lib/activities/query-keys"
import type {
  ActivityActionResult,
  ActivityDetail,
  ActivityListFilters,
  ActivityPageResult,
  ActivityParticipant,
  ActivityParticipantsFilters,
  ActivityParticipantsPageResult,
  AddActivityParticipantInput,
  CancelActivityRegistrationInput,
  CancelActivityRegistrationResult,
  CreateActivityInput,
  RecordActivityAttendanceInput,
  RegisterActivityResult,
  RegisterForActivityInput,
  RemoveActivityDocInput,
  RemoveActivityDocResult,
  RemoveActivityParticipantInput,
  RemoveActivityParticipantResult,
  ResidentActivityDetail,
  ResidentActivityHistoryPageResult,
  ResidentActivityPageResult,
  ResidentActivityRegistrationDetail,
  SoftDeleteActivityInput,
  TransitionActivityStatusInput,
  UpdateActivityInput,
  UploadActivityDocResult,
} from "@/lib/activities/types"

export {
  activitiesQueryKeys,
  buildActivityFilterQueryString,
  buildActivityParticipantsQueryString,
  getActivityMutationInvalidationKeys,
}

async function fetchActivityJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null
    throw new Error(body?.error ?? "Gagal memuat data kegiatan warga.")
  }

  return (await res.json()) as T
}

function unwrapActivityAction<T>(result: ActivityActionResult<T>): T {
  if (!result.ok || result.data === null) {
    throw new Error(result.error ?? "Operasi kegiatan gagal diproses.")
  }
  return result.data
}

export function useAdminActivities({
  tenantId,
  actorKey,
  filters,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  filters?: ActivityListFilters
  initialData?: ActivityPageResult
  enabled?: boolean
}) {
  const qs = buildActivityFilterQueryString(filters)
  return useQuery<ActivityPageResult, Error>({
    queryKey: activitiesQueryKeys.list("admin", tenantId, actorKey, filters),
    queryFn: () =>
      fetchActivityJson<ActivityPageResult>(
        `/api/activities${qs ? `?${qs}` : ""}`
      ),
    initialData,
    placeholderData: keepPreviousData,
    enabled: Boolean(tenantId && actorKey) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useAdminActivityDetail({
  tenantId,
  actorKey,
  activityId,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  activityId: string
  initialData?: ActivityDetail
  enabled?: boolean
}) {
  return useQuery<ActivityDetail, Error>({
    queryKey: activitiesQueryKeys.detail(
      "admin",
      tenantId,
      actorKey,
      activityId
    ),
    queryFn: () =>
      fetchActivityJson<ActivityDetail>(
        `/api/activities/${encodeURIComponent(activityId)}`
      ),
    initialData,
    enabled: Boolean(tenantId && actorKey && activityId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useAdminActivityParticipants({
  tenantId,
  actorKey,
  activityId,
  filters,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  activityId: string
  filters?: ActivityParticipantsFilters
  initialData?: ActivityParticipantsPageResult
  enabled?: boolean
}) {
  const qs = buildActivityParticipantsQueryString(filters)
  return useQuery<ActivityParticipantsPageResult, Error>({
    queryKey: activitiesQueryKeys.participants(
      tenantId,
      actorKey,
      activityId,
      filters
    ),
    queryFn: () =>
      fetchActivityJson<ActivityParticipantsPageResult>(
        `/api/activities/${encodeURIComponent(activityId)}/participants${qs ? `?${qs}` : ""}`
      ),
    initialData,
    placeholderData: keepPreviousData,
    enabled: Boolean(tenantId && actorKey && activityId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useResidentActivities({
  tenantId,
  actorKey,
  filters,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  filters?: ActivityListFilters
  initialData?: ResidentActivityPageResult
  enabled?: boolean
}) {
  const qs = buildActivityFilterQueryString(filters)
  return useQuery<ResidentActivityPageResult, Error>({
    queryKey: activitiesQueryKeys.list("resident", tenantId, actorKey, filters),
    queryFn: () =>
      fetchActivityJson<ResidentActivityPageResult>(
        `/api/resident/activities${qs ? `?${qs}` : ""}`
      ),
    initialData,
    placeholderData: keepPreviousData,
    enabled: Boolean(tenantId && actorKey) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useResidentActivityDetail({
  tenantId,
  actorKey,
  activityId,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  activityId: string
  initialData?: ResidentActivityDetail
  enabled?: boolean
}) {
  return useQuery<ResidentActivityDetail, Error>({
    queryKey: activitiesQueryKeys.detail(
      "resident",
      tenantId,
      actorKey,
      activityId
    ),
    queryFn: () =>
      fetchActivityJson<ResidentActivityDetail>(
        `/api/resident/activities/${encodeURIComponent(activityId)}`
      ),
    initialData,
    enabled: Boolean(tenantId && actorKey && activityId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useResidentActivityRegistration({
  tenantId,
  actorKey,
  activityId,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  activityId: string
  initialData?: ResidentActivityRegistrationDetail
  enabled?: boolean
}) {
  return useQuery<ResidentActivityRegistrationDetail, Error>({
    queryKey: activitiesQueryKeys.registration(tenantId, actorKey, activityId),
    queryFn: () =>
      fetchActivityJson<ResidentActivityRegistrationDetail>(
        `/api/resident/activities/${encodeURIComponent(activityId)}/registration`
      ),
    initialData,
    enabled: Boolean(tenantId && actorKey && activityId) && enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useResidentActivityHistory({
  tenantId,
  actorKey,
  page = 1,
  pageSize = 10,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  page?: number
  pageSize?: number
  initialData?: ResidentActivityHistoryPageResult
  enabled?: boolean
}) {
  return useQuery<ResidentActivityHistoryPageResult, Error>({
    queryKey: activitiesQueryKeys.history(tenantId, actorKey, page, pageSize),
    queryFn: () =>
      fetchActivityJson<ResidentActivityHistoryPageResult>(
        `/api/resident/activities?view=history&page=${page}&pageSize=${pageSize}`
      ),
    initialData,
    placeholderData: keepPreviousData,
    enabled: Boolean(tenantId && actorKey) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

function useInvalidateActivityTenant(tenantId: string) {
  const queryClient = useQueryClient()
  return async (activityId?: string) => {
    const keys = getActivityMutationInvalidationKeys({
      tenantId,
      activityId,
    })
    await Promise.all(
      keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
    )
  }
}

export function useCreateActivityMutation(tenantId: string) {
  const invalidate = useInvalidateActivityTenant(tenantId)
  return useMutation<ActivityDetail, Error, CreateActivityInput>({
    mutationFn: async (input) =>
      unwrapActivityAction(await createActivityAction(input)),
    onSuccess: async (detail) => {
      await invalidate(detail.activity.id)
    },
  })
}

export function useUpdateActivityMutation(tenantId: string) {
  const invalidate = useInvalidateActivityTenant(tenantId)
  return useMutation<ActivityDetail, Error, UpdateActivityInput>({
    mutationFn: async (input) =>
      unwrapActivityAction(await updateActivityAction(input)),
    onSuccess: async (detail) => {
      await invalidate(detail.activity.id)
    },
  })
}

export function useTransitionActivityStatusMutation(tenantId: string) {
  const invalidate = useInvalidateActivityTenant(tenantId)
  return useMutation<ActivityDetail, Error, TransitionActivityStatusInput>({
    mutationFn: async (input) =>
      unwrapActivityAction(await transitionActivityStatusAction(input)),
    onSuccess: async (detail) => {
      await invalidate(detail.activity.id)
    },
  })
}

export function useSoftDeleteActivityMutation(tenantId: string) {
  const invalidate = useInvalidateActivityTenant(tenantId)
  return useMutation<
    { activityId: string; deleted: true },
    Error,
    SoftDeleteActivityInput
  >({
    mutationFn: async (input) =>
      unwrapActivityAction(await softDeleteActivityAction(input)),
    onSuccess: async (res) => {
      await invalidate(res.activityId)
    },
  })
}

export function useAddActivityParticipantMutation(tenantId: string) {
  const invalidate = useInvalidateActivityTenant(tenantId)
  return useMutation<ActivityParticipant, Error, AddActivityParticipantInput>({
    mutationFn: async (input) =>
      unwrapActivityAction(await addActivityParticipantAction(input)),
    onSuccess: async (participant) => {
      await invalidate(participant.activityId)
    },
  })
}

export function useRemoveActivityParticipantMutation(tenantId: string) {
  const invalidate = useInvalidateActivityTenant(tenantId)
  return useMutation<
    RemoveActivityParticipantResult,
    Error,
    RemoveActivityParticipantInput
  >({
    mutationFn: async (input) =>
      unwrapActivityAction(await removeActivityParticipantAction(input)),
    onSuccess: async (res) => {
      await invalidate(res.activityId)
    },
  })
}

export function useRecordActivityAttendanceMutation(tenantId: string) {
  const invalidate = useInvalidateActivityTenant(tenantId)
  return useMutation<
    ActivityParticipant,
    Error,
    RecordActivityAttendanceInput
  >({
    mutationFn: async (input) =>
      unwrapActivityAction(await recordActivityAttendanceAction(input)),
    onSuccess: async (participant) => {
      await invalidate(participant.activityId)
    },
  })
}

export function useUploadActivityDocMutation(tenantId: string) {
  const invalidate = useInvalidateActivityTenant(tenantId)
  return useMutation<UploadActivityDocResult, Error, FormData>({
    mutationFn: async (formData) =>
      unwrapActivityAction(await uploadActivityDocAction(formData)),
    onSuccess: async (res) => {
      await invalidate(res.activityId)
    },
  })
}

export function useRemoveActivityDocMutation(tenantId: string) {
  const invalidate = useInvalidateActivityTenant(tenantId)
  return useMutation<RemoveActivityDocResult, Error, RemoveActivityDocInput>({
    mutationFn: async (input) =>
      unwrapActivityAction(await removeActivityDocAction(input)),
    onSuccess: async (res) => {
      await invalidate(res.activityId)
    },
  })
}

export function useRegisterForActivityMutation(tenantId: string) {
  const invalidate = useInvalidateActivityTenant(tenantId)
  return useMutation<RegisterActivityResult, Error, RegisterForActivityInput>({
    mutationFn: async (input) =>
      unwrapActivityAction(await registerForActivityAction(input)),
    onSuccess: async (res) => {
      await invalidate(res.activityId)
    },
  })
}

export function useCancelActivityRegistrationMutation(tenantId: string) {
  const invalidate = useInvalidateActivityTenant(tenantId)
  return useMutation<
    CancelActivityRegistrationResult,
    Error,
    CancelActivityRegistrationInput
  >({
    mutationFn: async (input) =>
      unwrapActivityAction(await cancelActivityRegistrationAction(input)),
    onSuccess: async (res) => {
      await invalidate(res.activityId)
    },
  })
}

