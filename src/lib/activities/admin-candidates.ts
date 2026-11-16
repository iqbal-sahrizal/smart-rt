import "server-only"

import type { RoleCode } from "@/lib/auth/types"
import { ActivityServiceError } from "@/lib/activities/errors"
import {
  canManageActivities,
  canOperateActivities,
} from "@/lib/activities/types"
import { createClient } from "@/lib/supabase/server"

export interface EligibleActivityResidentOption {
  residentId: string
  fullName: string
  householdLabel: string
}

export interface ActivityAuditHistoryItem {
  id: string
  action: string
  actionLabel: string
  summary: string
  createdAt: string
}

/**
 * Lists non-PII active residents on active households within the caller's tenant
 * for admin manual enrollment or operational walk-in attendance recording.
 * Never selects NIK, KK number, phone, or birth date.
 */
export async function listEligibleActivityResidents({
  tenantId,
  roles,
}: {
  tenantId: string
  roles: readonly RoleCode[]
}): Promise<EligibleActivityResidentOption[]> {
  if (!canOperateActivities(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Role Anda tidak memiliki akses daftar warga aktif untuk kegiatan."
    )
  }

  const supabase = await createClient()
  const [{ data: householdRows, error: hhErr }, { data: residentRows, error: resErr }] =
    await Promise.all([
      supabase
        .from("households")
        .select("id, block_unit, address")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase
        .from("residents")
        .select("id, full_name, household_id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .eq("residency_status", "aktif")
        .order("full_name", { ascending: true })
        .limit(500),
    ])

  if (hhErr || resErr) {
    throw new ActivityServiceError(
      500,
      "INTERNAL_ERROR",
      "Gagal memuat daftar warga aktif pada RT ini."
    )
  }

  const householdMap = new Map<string, string>()
  for (const row of (householdRows ?? []) as Array<{
    id: string
    block_unit: string | null
    address: string
  }>) {
    const label = row.block_unit?.trim() || row.address?.trim() || "Unit Warga"
    householdMap.set(row.id, label)
  }

  const options: EligibleActivityResidentOption[] = []
  for (const row of (residentRows ?? []) as Array<{
    id: string
    full_name: string
    household_id: string
  }>) {
    const householdLabel = householdMap.get(row.household_id)
    if (!householdLabel) continue
    options.push({
      residentId: row.id,
      fullName: row.full_name,
      householdLabel,
    })
  }

  return options
}

function formatAuditActionMeta(
  action: string,
  metadata: Record<string, unknown> | null
): { actionLabel: string; summary: string } {
  switch (action) {
    case "activity.created":
      return {
        actionLabel: "Kegiatan Dibuat",
        summary: "Jadwal kegiatan baru dipublikasikan.",
      }
    case "activity.updated": {
      const fields = Array.isArray(metadata?.changed_fields)
        ? metadata.changed_fields.filter((x): x is string => typeof x === "string")
        : []
      return {
        actionLabel: "Informasi Diperbarui",
        summary:
          fields.length > 0
            ? `Perubahan pada: ${fields.join(", ")}`
            : "Detail kegiatan diperbarui.",
      }
    }
    case "activity.status_changed": {
      const prev =
        typeof metadata?.previous_status === "string"
          ? metadata.previous_status
          : "-"
      const next =
        typeof metadata?.new_status === "string" ? metadata.new_status : "-"
      const reason =
        typeof metadata?.reason === "string" && metadata.reason.trim()
          ? ` — ${metadata.reason.trim()}`
          : ""
      return {
        actionLabel: "Status Diubah",
        summary: `${prev} -> ${next}${reason}`,
      }
    }
    case "activity.soft_deleted":
      return {
        actionLabel: "Kegiatan Diarsipkan",
        summary:
          typeof metadata?.reason === "string" && metadata.reason.trim()
            ? metadata.reason.trim()
            : "Kegiatan diarsipkan dari daftar aktif.",
      }
    case "activity.doc_attached":
      return {
        actionLabel: "Dokumentasi Dilampirkan",
        summary: "Berkas dokumentasi baru ditambahkan ke kegiatan.",
      }
    case "activity.doc_removed":
      return {
        actionLabel: "Dokumentasi Dihapus",
        summary: "Lampiran dokumentasi dijadwalkan untuk dihapus.",
      }
    case "activity.attendance_recorded": {
      const rsvp =
        typeof metadata?.rsvp_status === "string" ? metadata.rsvp_status : ""
      return {
        actionLabel: "Presensi Dicatat",
        summary: rsvp ? `Status peserta diperbarui menjadi ${rsvp}.` : "Presensi diperbarui.",
      }
    }
    default:
      return {
        actionLabel: action,
        summary: "Aktivitas tercatat pada log audit.",
      }
  }
}

/**
 * Loads non-PII activity audit history when the caller holds ketua_rt or
 * sekretaris role (matching audit_logs_select RLS). Returns [] for pengurus.
 */
export async function getAdminActivityHistory({
  tenantId,
  roles,
  activityId,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  activityId: string
}): Promise<ActivityAuditHistoryItem[]> {
  if (!canManageActivities(roles)) {
    return []
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "activities")
    .eq("entity_id", activityId)
    .order("created_at", { ascending: false })
    .limit(20)

  if (error || !data) {
    return []
  }

  return (
    data as Array<{
      id: string
      action: string
      metadata: Record<string, unknown> | null
      created_at: string
    }>
  ).map((row) => {
    const meta = formatAuditActionMeta(row.action, row.metadata)
    return {
      id: row.id,
      action: row.action,
      actionLabel: meta.actionLabel,
      summary: meta.summary,
      createdAt: row.created_at,
    }
  })
}

