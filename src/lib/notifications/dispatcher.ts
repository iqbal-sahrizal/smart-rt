import { buildPushNavigationPayload } from "@/lib/notifications/push-payload"
import type { NotificationScope } from "@/lib/notifications/types"

export interface OutboxRow {
  id: string
  tenant_id: string
  recipient_user_id: string
  notification_id: string | null
  event_type: string
  reference_type: string | null
  reference_id: string | null
  target_scope?: NotificationScope
  title: string
  body: string
  idempotency_key: string
  status: "pending" | "processing" | "sent" | "failed" | "dead"
  attempt_count: number
  max_attempts: number
  next_attempt_at: string
  last_error: string | null
  claimed_at: string | null
  locked_at?: string | null
  lease_expires_at?: string | null
  claim_token?: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export interface DispatcherDependencies {
  supabaseAdmin: {
    rpc: (
      name: string,
      params?: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  }
  fetchImpl?: typeof fetch
  fcmFunctionUrl: string
  fcmFunctionSecret: string
  batchLimit?: number
  leaseSeconds?: number
}

export interface DispatcherResult {
  claimedCount: number
  sentCount: number
  failedCount: number
  groupsProcessed: number
  errors: Array<{ outboxId?: string; error: string }>
}

interface OutboxGroup {
  tenantId: string
  targetScope: NotificationScope
  referenceType: string | null
  referenceId: string | null
  title: string
  body: string
  recipientUserIds: string[]
  items: Array<{ outboxId: string; claimToken: string | null }>
}

/**
 * Groups claimed outbox rows by (tenant_id, target_scope, reference_type, reference_id, title, body)
 * so identical broadcasts can be sent in a single FCM HTTP v1 dispatch call while
 * preserving tenant boundaries and role-validated navigation scopes.
 */
export function groupOutboxRows(rows: OutboxRow[]): OutboxGroup[] {
  const groupsMap = new Map<string, OutboxGroup>()

  for (const row of rows) {
    const scope: NotificationScope =
      row.target_scope === "admin" ? "admin" : "resident"

    const key = [
      row.tenant_id,
      scope,
      row.reference_type ?? "",
      row.reference_id ?? "",
      row.title,
      row.body,
    ].join("::")

    const item = {
      outboxId: row.id,
      claimToken: row.claim_token ?? null,
    }

    const existing = groupsMap.get(key)
    if (existing) {
      if (!existing.recipientUserIds.includes(row.recipient_user_id)) {
        existing.recipientUserIds.push(row.recipient_user_id)
      }
      existing.items.push(item)
    } else {
      groupsMap.set(key, {
        tenantId: row.tenant_id,
        targetScope: scope,
        referenceType: row.reference_type,
        referenceId: row.reference_id,
        title: row.title,
        body: row.body,
        recipientUserIds: [row.recipient_user_id],
        items: [item],
      })
    }
  }

  return Array.from(groupsMap.values())
}

/**
 * Central Notification Engine — Outbox Processor
 *
 * Claims pending/failed/expired-lease outbox rows, batches identical payloads,
 * calls the existing send-fcm-notification Supabase Edge Function,
 * and updates outbox status with claim-token fencing and exponential backoff.
 */
export async function processNotificationOutbox(
  deps: DispatcherDependencies
): Promise<DispatcherResult> {
  const fetchFn = deps.fetchImpl ?? fetch
  const batchLimit = Math.max(1, Math.min(deps.batchLimit ?? 20, 200))
  const leaseSeconds = Math.max(10, Math.min(deps.leaseSeconds ?? 120, 3600))

  const { data, error } = await deps.supabaseAdmin.rpc(
    "claim_pending_notification_outbox_batch",
    { p_limit: batchLimit, p_lease_seconds: leaseSeconds }
  )

  if (error) {
    return {
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      groupsProcessed: 0,
      errors: [{ error: `Failed to claim outbox batch: ${error.message}` }],
    }
  }

  const rows = (data ?? []) as OutboxRow[]
  if (rows.length === 0) {
    return {
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      groupsProcessed: 0,
      errors: [],
    }
  }

  const groups = groupOutboxRows(rows)
  let sentCount = 0
  let failedCount = 0
  const errors: Array<{ outboxId?: string; error: string }> = []

  for (const group of groups) {
    const nav = buildPushNavigationPayload(
      group.referenceType,
      group.referenceId,
      group.targetScope
    )
    const dataPayload = nav ? { path: nav.path } : undefined

    let isSuccess = false
    let groupError: string | null = null

    try {
      const response = await fetchFn(deps.fcmFunctionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deps.fcmFunctionSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenant_id: group.tenantId,
          recipient_user_ids: group.recipientUserIds,
          title: group.title,
          body: group.body,
          data: dataPayload,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        groupError = `FCM Edge Function returned HTTP ${response.status}: ${errorText}`
      } else {
        const result = (await response.json()) as {
          ok?: boolean
          error?: string
        }
        if (result.ok === false) {
          groupError =
            result.error ?? "FCM Edge Function reported dispatch failure"
        } else {
          isSuccess = true
        }
      }
    } catch (err) {
      groupError = `Network error calling FCM Edge Function: ${err instanceof Error ? err.message : String(err)}`
    }

    for (const item of group.items) {
      try {
        await deps.supabaseAdmin.rpc("record_notification_outbox_result", {
          p_outbox_id: item.outboxId,
          p_success: isSuccess,
          p_error: groupError,
          p_claim_token: item.claimToken,
        })
      } catch (recordErr) {
        errors.push({
          outboxId: item.outboxId,
          error: `Failed to record outbox result: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
        })
      }

      if (isSuccess) {
        sentCount += 1
      } else {
        failedCount += 1
        if (groupError) {
          errors.push({ outboxId: item.outboxId, error: groupError })
        }
      }
    }
  }

  return {
    claimedCount: rows.length,
    sentCount,
    failedCount,
    groupsProcessed: groups.length,
    errors,
  }
}
