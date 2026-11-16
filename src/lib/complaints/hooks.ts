"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import {
  createComplaintAction,
  createComplaintReplyAction,
  deleteComplaintPhotoAction,
  softDeleteComplaintAction,
  transitionComplaintStatusAction,
  updateComplaintAction,
  uploadComplaintPhotoAction,
} from "@/app/actions/complaints"
import {
  buildComplaintFilterQueryString,
  complaintsQueryKeys,
  getComplaintMutationInvalidationKeys,
} from "@/lib/complaints/query-keys"
import type {
  Complaint,
  ComplaintActionResult,
  ComplaintDetail,
  ComplaintListFilters,
  ComplaintPageResult,
  ComplaintReply,
  ComplaintStatus,
  CreateComplaintInput,
  CreateComplaintReplyInput,
  DeleteComplaintPhotoInput,
  DeleteComplaintPhotoResult,
  SoftDeleteComplaintInput,
  TransitionComplaintStatusInput,
  UpdateComplaintInput,
  UploadComplaintPhotoResult,
} from "@/lib/complaints/types"

export {
  buildComplaintFilterQueryString,
  complaintsQueryKeys,
  getComplaintMutationInvalidationKeys,
}

async function fetchComplaintJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null
    throw new Error(body?.error ?? "Gagal memuat data pengaduan.")
  }

  return (await res.json()) as T
}

function unwrapComplaintAction<T>(result: ComplaintActionResult<T>): T {
  if (!result.ok || result.data === null) {
    throw new Error(result.error ?? "Operasi pengaduan gagal diproses.")
  }
  return result.data
}

export function useAdminComplaints({
  tenantId,
  actorKey,
  filters,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  filters?: ComplaintListFilters
  initialData?: ComplaintPageResult
  enabled?: boolean
}) {
  const qs = buildComplaintFilterQueryString(filters)
  return useQuery<ComplaintPageResult, Error>({
    queryKey: complaintsQueryKeys.list("admin", tenantId, actorKey, filters),
    queryFn: () =>
      fetchComplaintJson<ComplaintPageResult>(
        `/api/complaints${qs ? `?${qs}` : ""}`
      ),
    initialData,
    placeholderData: keepPreviousData,
    enabled: Boolean(tenantId && actorKey) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useAdminComplaintDetail({
  tenantId,
  actorKey,
  complaintId,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  complaintId: string
  initialData?: ComplaintDetail
  enabled?: boolean
}) {
  return useQuery<ComplaintDetail, Error>({
    queryKey: complaintsQueryKeys.detail("admin", tenantId, actorKey, complaintId),
    queryFn: () =>
      fetchComplaintJson<ComplaintDetail>(
        `/api/complaints/${encodeURIComponent(complaintId)}`
      ),
    initialData,
    enabled: Boolean(tenantId && actorKey && complaintId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useResidentComplaints({
  tenantId,
  actorKey,
  filters,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  filters?: ComplaintListFilters
  initialData?: ComplaintPageResult
  enabled?: boolean
}) {
  const qs = buildComplaintFilterQueryString(filters)
  return useQuery<ComplaintPageResult, Error>({
    queryKey: complaintsQueryKeys.list("resident", tenantId, actorKey, filters),
    queryFn: () =>
      fetchComplaintJson<ComplaintPageResult>(
        `/api/resident/complaints${qs ? `?${qs}` : ""}`
      ),
    initialData,
    placeholderData: keepPreviousData,
    enabled: Boolean(tenantId && actorKey) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useResidentComplaintDetail({
  tenantId,
  actorKey,
  complaintId,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  complaintId: string
  initialData?: ComplaintDetail
  enabled?: boolean
}) {
  return useQuery<ComplaintDetail, Error>({
    queryKey: complaintsQueryKeys.detail(
      "resident",
      tenantId,
      actorKey,
      complaintId
    ),
    queryFn: () =>
      fetchComplaintJson<ComplaintDetail>(
        `/api/resident/complaints/${encodeURIComponent(complaintId)}`
      ),
    initialData,
    enabled: Boolean(tenantId && actorKey && complaintId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

function useInvalidateComplaints(tenantId: string) {
  const queryClient = useQueryClient()
  return async (complaintId?: string) => {
    const keys = getComplaintMutationInvalidationKeys({
      tenantId,
      complaintId,
    })
    await Promise.all(
      keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
    )
  }
}

export function useCreateComplaintMutation(tenantId: string) {
  const invalidate = useInvalidateComplaints(tenantId)
  return useMutation<Complaint, Error, CreateComplaintInput>({
    mutationFn: async (input) =>
      unwrapComplaintAction(await createComplaintAction(input)),
    onSuccess: async (data) => {
      await invalidate(data.id)
    },
  })
}

export function useUpdateComplaintMutation(tenantId: string) {
  const invalidate = useInvalidateComplaints(tenantId)
  return useMutation<Complaint, Error, UpdateComplaintInput>({
    mutationFn: async (input) =>
      unwrapComplaintAction(await updateComplaintAction(input)),
    onSuccess: async (data) => {
      await invalidate(data.id)
    },
  })
}

export function useCreateComplaintReplyMutation(tenantId: string) {
  const invalidate = useInvalidateComplaints(tenantId)
  return useMutation<ComplaintReply, Error, CreateComplaintReplyInput>({
    mutationFn: async (input) =>
      unwrapComplaintAction(await createComplaintReplyAction(input)),
    onSuccess: async (data) => {
      await invalidate(data.complaintId)
    },
  })
}

export function useTransitionComplaintStatusMutation(tenantId: string) {
  const invalidate = useInvalidateComplaints(tenantId)
  return useMutation<
    { complaintId: string; newStatus: ComplaintStatus },
    Error,
    TransitionComplaintStatusInput
  >({
    mutationFn: async (input) =>
      unwrapComplaintAction(await transitionComplaintStatusAction(input)),
    onSuccess: async (data) => {
      await invalidate(data.complaintId)
    },
  })
}

export function useSoftDeleteComplaintMutation(tenantId: string) {
  const invalidate = useInvalidateComplaints(tenantId)
  return useMutation<
    { complaintId: string; deleted: true },
    Error,
    SoftDeleteComplaintInput
  >({
    mutationFn: async (input) =>
      unwrapComplaintAction(await softDeleteComplaintAction(input)),
    onSuccess: async (data) => {
      await invalidate(data.complaintId)
    },
  })
}

export function useUploadComplaintPhotoMutation(tenantId: string) {
  const invalidate = useInvalidateComplaints(tenantId)
  return useMutation<UploadComplaintPhotoResult, Error, FormData>({
    mutationFn: async (formData) =>
      unwrapComplaintAction(await uploadComplaintPhotoAction(formData)),
    onSuccess: async (data) => {
      await invalidate(data.complaintId)
    },
  })
}

export function useDeleteComplaintPhotoMutation(tenantId: string) {
  const invalidate = useInvalidateComplaints(tenantId)
  return useMutation<
    DeleteComplaintPhotoResult,
    Error,
    DeleteComplaintPhotoInput
  >({
    mutationFn: async (input) =>
      unwrapComplaintAction(await deleteComplaintPhotoAction(input)),
    onSuccess: async (_data, variables) => {
      await invalidate(variables.complaintId)
    },
  })
}

