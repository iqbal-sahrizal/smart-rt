import "server-only"

import type { RoleCode } from "@/lib/auth/types"
import type {
  AnnouncementRecipientSummary,
  AnnouncementStatus,
  AnnouncementSummary,
  AnnouncementTargetType,
  HouseholdTargetOption,
  ResidentAnnouncementItem,
  RoleOption,
} from "@/lib/announcements/types"
import { isValidUuid } from "@/lib/residents/schemas"
import { createClient } from "@/lib/supabase/server"

interface RawAnnouncementRow {
  id: string
  tenant_id: string
  author_id: string
  title: string
  content: string
  attachment_path: string | null
  status: AnnouncementStatus
  target_type: AnnouncementTargetType
  published_at: string | null
  created_at: string
  updated_at: string
}

interface RawRecipientRow {
  id: string
  role_id: string | null
  household_id: string | null
}

function mapAnnouncement(row: RawAnnouncementRow): AnnouncementSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    authorId: row.author_id,
    title: row.title,
    content: row.content,
    attachmentPath: row.attachment_path,
    status: row.status,
    targetType: row.target_type,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function sanitizeSearchTerm(input: string | undefined): string {
  if (!input) return ""
  return input
    .trim()
    .replace(/[,()%*\\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
}

const VALID_STATUSES = new Set<AnnouncementStatus>([
  "draft",
  "published",
  "archived",
])

const VALID_TARGET_TYPES = new Set<AnnouncementTargetType>([
  "all",
  "role",
  "household",
])

export interface AdminAnnouncementsDirectoryParams {
  tenantId: string
  search?: string
  status?: string
  targetType?: string
  page?: number
  pageSize?: number
}

export interface AdminAnnouncementsDirectoryResult {
  items: AnnouncementSummary[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  error: string | null
}

export async function getAdminAnnouncementsDirectory({
  tenantId,
  search,
  status,
  targetType,
  page = 1,
  pageSize = 10,
}: AdminAnnouncementsDirectoryParams): Promise<AdminAnnouncementsDirectoryResult> {
  const supabase = await createClient()
  const cleanSearch = sanitizeSearchTerm(search)
  const validStatus =
    status && VALID_STATUSES.has(status as AnnouncementStatus)
      ? (status as AnnouncementStatus)
      : null
  const validTargetType =
    targetType && VALID_TARGET_TYPES.has(targetType as AnnouncementTargetType)
      ? (targetType as AnnouncementTargetType)
      : null
  const safePageSize = Math.min(Math.max(pageSize, 1), 50)
  const requestedPage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1

  let query = supabase
    .from("announcements")
    .select(
      "id, tenant_id, author_id, title, content, attachment_path, status, target_type, published_at, created_at, updated_at",
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)

  if (validStatus) {
    query = query.eq("status", validStatus)
  }

  if (validTargetType) {
    query = query.eq("target_type", validTargetType)
  }

  if (cleanSearch) {
    query = query.or(
      `title.ilike.%${cleanSearch}%,content.ilike.%${cleanSearch}%`
    )
  }

  const from = (requestedPage - 1) * safePageSize
  const to = from + safePageSize - 1

  const { data, count, error } = await query
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: safePageSize,
      totalPages: 1,
      error: "Gagal memuat daftar pengumuman.",
    }
  }

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const currentPage = Math.min(requestedPage, totalPages)

  let rows = (data ?? []) as RawAnnouncementRow[]
  if (requestedPage > totalPages && totalCount > 0) {
    const correctedFrom = (currentPage - 1) * safePageSize
    const correctedTo = correctedFrom + safePageSize - 1
    let retryQuery = supabase
      .from("announcements")
      .select(
        "id, tenant_id, author_id, title, content, attachment_path, status, target_type, published_at, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)

    if (validStatus) retryQuery = retryQuery.eq("status", validStatus)
    if (validTargetType) {
      retryQuery = retryQuery.eq("target_type", validTargetType)
    }
    if (cleanSearch) {
      retryQuery = retryQuery.or(
        `title.ilike.%${cleanSearch}%,content.ilike.%${cleanSearch}%`
      )
    }

    const retryRes = await retryQuery
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .range(correctedFrom, correctedTo)

    rows = (retryRes.data ?? []) as RawAnnouncementRow[]
  }

  return {
    items: rows.map(mapAnnouncement),
    totalCount,
    page: currentPage,
    pageSize: safePageSize,
    totalPages,
    error: null,
  }
}

export interface AdminAnnouncementDetailResult {
  announcement: AnnouncementSummary
  recipients: AnnouncementRecipientSummary[]
}

export async function getAdminAnnouncementDetail({
  tenantId,
  announcementId,
}: {
  tenantId: string
  announcementId: string
}): Promise<AdminAnnouncementDetailResult | null> {
  if (!isValidUuid(announcementId)) {
    return null
  }

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from("announcements")
    .select(
      "id, tenant_id, author_id, title, content, attachment_path, status, target_type, published_at, created_at, updated_at"
    )
    .eq("tenant_id", tenantId)
    .eq("id", announcementId)
    .is("deleted_at", null)
    .maybeSingle()

  if (error || !row) {
    return null
  }

  const announcement = mapAnnouncement(row as RawAnnouncementRow)

  const { data: recipientRows } = await supabase
    .from("announcement_recipients")
    .select("id, role_id, household_id")
    .eq("tenant_id", tenantId)
    .eq("announcement_id", announcement.id)
    .order("created_at", { ascending: true })

  const rawRecipients = (recipientRows ?? []) as RawRecipientRow[]
  if (rawRecipients.length === 0) {
    return { announcement, recipients: [] }
  }

  const roleIds = rawRecipients
    .map((r) => r.role_id)
    .filter((id): id is string => Boolean(id))
  const householdIds = rawRecipients
    .map((r) => r.household_id)
    .filter((id): id is string => Boolean(id))

  const [rolesRes, householdsRes] = await Promise.all([
    roleIds.length > 0
      ? supabase.from("roles").select("id, code, name").in("id", roleIds)
      : Promise.resolve({ data: [] }),
    householdIds.length > 0
      ? supabase
          .from("households")
          .select("id, block_unit, address")
          .eq("tenant_id", tenantId)
          .in("id", householdIds)
      : Promise.resolve({ data: [] }),
  ])

  const roleMap = new Map(
    ((rolesRes.data ?? []) as Array<{ id: string; code: string; name: string }>).map(
      (role) => [role.id, role]
    )
  )
  const householdMap = new Map(
    (
      (householdsRes.data ?? []) as Array<{
        id: string
        block_unit: string | null
        address: string
      }>
    ).map((h) => [
      h.id,
      h.block_unit ? `${h.block_unit} — ${h.address}` : h.address,
    ])
  )

  const recipients: AnnouncementRecipientSummary[] = rawRecipients.map((r) => {
    const role = r.role_id ? roleMap.get(r.role_id) : undefined
    const householdLabel = r.household_id
      ? householdMap.get(r.household_id) ?? "Kartu Keluarga"
      : null

    return {
      id: r.id,
      roleId: r.role_id,
      roleCode: role?.code ?? null,
      roleName: role?.name ?? null,
      householdId: r.household_id,
      householdLabel,
    }
  })

  return { announcement, recipients }
}

export async function getAnnouncementFormOptions(tenantId: string): Promise<{
  roles: RoleOption[]
  households: HouseholdTargetOption[]
}> {
  const supabase = await createClient()
  const [rolesRes, householdsRes] = await Promise.all([
    supabase.from("roles").select("id, code, name").order("name", { ascending: true }),
    supabase
      .from("households")
      .select("id, block_unit, address")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .eq("status", "active")
      .order("block_unit", { ascending: true, nullsFirst: false })
      .order("address", { ascending: true }),
  ])

  const roles: RoleOption[] = (
    (rolesRes.data ?? []) as Array<{ id: string; code: RoleCode; name: string }>
  ).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
  }))

  const households: HouseholdTargetOption[] = (
    (householdsRes.data ?? []) as Array<{
      id: string
      block_unit: string | null
      address: string
    }>
  ).map((h) => ({
    id: h.id,
    label: h.block_unit ? `${h.block_unit} — ${h.address}` : h.address,
  }))

  return { roles, households }
}

export interface ResidentAnnouncementsFeedResult {
  items: ResidentAnnouncementItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  error: string | null
}

export async function getResidentAnnouncementsFeed({
  tenantId,
  page = 1,
  pageSize = 10,
}: {
  tenantId: string
  page?: number
  pageSize?: number
}): Promise<ResidentAnnouncementsFeedResult> {
  const supabase = await createClient()
  const safePageSize = Math.min(Math.max(pageSize, 1), 30)
  const requestedPage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  const from = (requestedPage - 1) * safePageSize
  const to = from + safePageSize - 1

  // RLS announcements_select filters strictly to published, non-deleted
  // rows targeting 'all', the caller's household, or the caller's roles.
  const { data, count, error } = await supabase
    .from("announcements")
    .select("id, title, content, target_type, published_at, created_at", {
      count: "exact",
    })
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: safePageSize,
      totalPages: 1,
      error: "Gagal memuat pengumuman warga.",
    }
  }

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const currentPage = Math.min(requestedPage, totalPages)

  const items: ResidentAnnouncementItem[] = (
    (data ?? []) as Array<{
      id: string
      title: string
      content: string
      target_type: AnnouncementTargetType
      published_at: string | null
      created_at: string
    }>
  ).map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    targetType: row.target_type,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  }))

  return {
    items,
    totalCount,
    page: currentPage,
    pageSize: safePageSize,
    totalPages,
    error: null,
  }
}

export async function getResidentAnnouncementDetail({
  tenantId,
  announcementId,
}: {
  tenantId: string
  announcementId: string
}): Promise<ResidentAnnouncementItem | null> {
  if (!isValidUuid(announcementId)) {
    return null
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, content, target_type, published_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("id", announcementId)
    .eq("status", "published")
    .is("deleted_at", null)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  const row = data as {
    id: string
    title: string
    content: string
    target_type: AnnouncementTargetType
    published_at: string | null
    created_at: string
  }

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    targetType: row.target_type,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  }
}

export async function getRecentAdminAnnouncements(
  tenantId: string,
  limit = 4
): Promise<AnnouncementSummary[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("announcements")
    .select(
      "id, tenant_id, author_id, title, content, attachment_path, status, target_type, published_at, created_at, updated_at"
    )
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit)

  return ((data ?? []) as RawAnnouncementRow[]).map(mapAnnouncement)
}

export async function getRecentResidentAnnouncements(
  tenantId: string,
  limit = 3
): Promise<ResidentAnnouncementItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("announcements")
    .select("id, title, content, target_type, published_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit)

  return (
    (data ?? []) as Array<{
      id: string
      title: string
      content: string
      target_type: AnnouncementTargetType
      published_at: string | null
      created_at: string
    }>
  ).map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    targetType: row.target_type,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  }))
}
