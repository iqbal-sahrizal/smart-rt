"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import {
  cancelLetterRequestAction,
  createLetterRequestAction,
  createLetterTypeAction,
  deleteLetterTypeAction,
  issueLetterAction,
  removeLetterSupportingDocAction,
  reviewLetterRequestAction,
  updateLetterTypeAction,
  uploadLetterSupportingDocAction,
} from "@/app/actions/letters"
import {
  buildLetterFilterQueryString,
  getLetterMutationInvalidationKeys,
  lettersQueryKeys,
} from "@/lib/letters/query-keys"
import type {
  CancelLetterRequestInput,
  CreateLetterRequestInput,
  CreateLetterTypeInput,
  DeleteLetterTypeInput,
  IssueLetterResult,
  LetterActionResult,
  LetterListFilters,
  LetterPageResult,
  LetterRequest,
  LetterRequestDetail,
  LetterRequestStatus,
  LetterType,
  RemoveLetterAttachmentResult,
  RemoveLetterSupportingDocInput,
  ReviewLetterRequestInput,
  UpdateLetterTypeInput,
  UploadLetterAttachmentResult,
} from "@/lib/letters/types"

export {
  buildLetterFilterQueryString,
  getLetterMutationInvalidationKeys,
  lettersQueryKeys,
}

async function fetchLetterJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null
    throw new Error(body?.error ?? "Gagal memuat data surat.")
  }

  return (await res.json()) as T
}

function unwrapLetterAction<T>(result: LetterActionResult<T>): T {
  if (!result.ok || result.data === null) {
    throw new Error(result.error ?? "Operasi surat gagal diproses.")
  }
  return result.data
}

export function useAdminLetterRequests({
  tenantId,
  actorKey,
  filters,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  filters?: LetterListFilters
  initialData?: LetterPageResult
  enabled?: boolean
}) {
  const qs = buildLetterFilterQueryString(filters)
  return useQuery<LetterPageResult, Error>({
    queryKey: lettersQueryKeys.list("admin", tenantId, actorKey, filters),
    queryFn: () =>
      fetchLetterJson<LetterPageResult>(`/api/letters${qs ? `?${qs}` : ""}`),
    initialData,
    placeholderData: keepPreviousData,
    enabled: Boolean(tenantId && actorKey) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useAdminLetterRequestDetail({
  tenantId,
  actorKey,
  requestId,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  requestId: string
  initialData?: LetterRequestDetail
  enabled?: boolean
}) {
  return useQuery<LetterRequestDetail, Error>({
    queryKey: lettersQueryKeys.detail("admin", tenantId, actorKey, requestId),
    queryFn: () =>
      fetchLetterJson<LetterRequestDetail>(
        `/api/letters/${encodeURIComponent(requestId)}`
      ),
    initialData,
    enabled: Boolean(tenantId && actorKey && requestId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useAdminLetterTypes({
  tenantId,
  actorKey,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  initialData?: { items: LetterType[]; canManage: boolean }
  enabled?: boolean
}) {
  return useQuery<{ items: LetterType[]; canManage: boolean }, Error>({
    queryKey: lettersQueryKeys.types("admin", tenantId, actorKey),
    queryFn: () =>
      fetchLetterJson<{ items: LetterType[]; canManage: boolean }>(
        "/api/letters/types"
      ),
    initialData,
    enabled: Boolean(tenantId && actorKey) && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useResidentLetterRequests({
  tenantId,
  actorKey,
  filters,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  filters?: LetterListFilters
  initialData?: LetterPageResult
  enabled?: boolean
}) {
  const qs = buildLetterFilterQueryString(filters)
  return useQuery<LetterPageResult, Error>({
    queryKey: lettersQueryKeys.list("resident", tenantId, actorKey, filters),
    queryFn: () =>
      fetchLetterJson<LetterPageResult>(
        `/api/resident/letters${qs ? `?${qs}` : ""}`
      ),
    initialData,
    placeholderData: keepPreviousData,
    enabled: Boolean(tenantId && actorKey) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useResidentLetterRequestDetail({
  tenantId,
  actorKey,
  requestId,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  requestId: string
  initialData?: LetterRequestDetail
  enabled?: boolean
}) {
  return useQuery<LetterRequestDetail, Error>({
    queryKey: lettersQueryKeys.detail("resident", tenantId, actorKey, requestId),
    queryFn: () =>
      fetchLetterJson<LetterRequestDetail>(
        `/api/resident/letters/${encodeURIComponent(requestId)}`
      ),
    initialData,
    enabled: Boolean(tenantId && actorKey && requestId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useResidentActiveLetterTypes({
  tenantId,
  actorKey,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  initialData?: { items: LetterType[] }
  enabled?: boolean
}) {
  return useQuery<{ items: LetterType[] }, Error>({
    queryKey: lettersQueryKeys.types("resident", tenantId, actorKey),
    queryFn: () =>
      fetchLetterJson<{ items: LetterType[] }>("/api/resident/letters/types"),
    initialData,
    enabled: Boolean(tenantId && actorKey) && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

function useInvalidateLetters(tenantId: string) {
  const queryClient = useQueryClient()
  return async (requestId?: string, includeTypes = false) => {
    const keys = getLetterMutationInvalidationKeys({
      tenantId,
      requestId,
      includeTypes,
    })
    await Promise.all(
      keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
    )
  }
}

export function useCreateLetterRequestMutation(tenantId: string) {
  const invalidate = useInvalidateLetters(tenantId)
  return useMutation<LetterRequest, Error, CreateLetterRequestInput>({
    mutationFn: async (input) =>
      unwrapLetterAction(await createLetterRequestAction(input)),
    onSuccess: async (data) => {
      await invalidate(data.id)
    },
  })
}

export function useUploadLetterSupportingDocMutation(tenantId: string) {
  const invalidate = useInvalidateLetters(tenantId)
  return useMutation<UploadLetterAttachmentResult, Error, FormData>({
    mutationFn: async (formData) =>
      unwrapLetterAction(await uploadLetterSupportingDocAction(formData)),
    onSuccess: async (data) => {
      await invalidate(data.requestId)
    },
  })
}

export function useRemoveLetterSupportingDocMutation(tenantId: string) {
  const invalidate = useInvalidateLetters(tenantId)
  return useMutation<
    RemoveLetterAttachmentResult,
    Error,
    RemoveLetterSupportingDocInput
  >({
    mutationFn: async (input) =>
      unwrapLetterAction(await removeLetterSupportingDocAction(input)),
    onSuccess: async (data) => {
      await invalidate(data.requestId)
    },
  })
}

export function useCancelLetterRequestMutation(tenantId: string) {
  const invalidate = useInvalidateLetters(tenantId)
  return useMutation<
    { requestId: string; status: "cancelled" },
    Error,
    CancelLetterRequestInput
  >({
    mutationFn: async (input) =>
      unwrapLetterAction(await cancelLetterRequestAction(input)),
    onSuccess: async (data) => {
      await invalidate(data.requestId)
    },
  })
}

export function useReviewLetterRequestMutation(tenantId: string) {
  const invalidate = useInvalidateLetters(tenantId)
  return useMutation<
    { requestId: string; status: LetterRequestStatus },
    Error,
    ReviewLetterRequestInput
  >({
    mutationFn: async (input) =>
      unwrapLetterAction(await reviewLetterRequestAction(input)),
    onSuccess: async (data) => {
      await invalidate(data.requestId)
    },
  })
}

export function useIssueLetterMutation(tenantId: string) {
  const invalidate = useInvalidateLetters(tenantId)
  return useMutation<IssueLetterResult, Error, FormData>({
    mutationFn: async (formData) =>
      unwrapLetterAction(await issueLetterAction(formData)),
    onSuccess: async (data) => {
      await invalidate(data.requestId)
    },
  })
}

export function useCreateLetterTypeMutation(tenantId: string) {
  const invalidate = useInvalidateLetters(tenantId)
  return useMutation<LetterType, Error, CreateLetterTypeInput>({
    mutationFn: async (input) =>
      unwrapLetterAction(await createLetterTypeAction(input)),
    onSuccess: async () => {
      await invalidate(undefined, true)
    },
  })
}

export function useUpdateLetterTypeMutation(tenantId: string) {
  const invalidate = useInvalidateLetters(tenantId)
  return useMutation<LetterType, Error, UpdateLetterTypeInput>({
    mutationFn: async (input) =>
      unwrapLetterAction(await updateLetterTypeAction(input)),
    onSuccess: async () => {
      await invalidate(undefined, true)
    },
  })
}

export function useDeleteLetterTypeMutation(tenantId: string) {
  const invalidate = useInvalidateLetters(tenantId)
  return useMutation<
    { letterTypeId: string; deleted: true },
    Error,
    DeleteLetterTypeInput
  >({
    mutationFn: async (input) =>
      unwrapLetterAction(await deleteLetterTypeAction(input)),
    onSuccess: async () => {
      await invalidate(undefined, true)
    },
  })
}

