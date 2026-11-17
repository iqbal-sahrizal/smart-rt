import type { SupabaseClient } from "@supabase/supabase-js"

export type ShapeBNotificationRpcName =
  | "notify_announcement_published"
  | "notify_bill_issued"
  | "notify_complaint_reply"

/**
 * Invokes a Shape B notification-enqueue RPC and inspects the Supabase
 * `{ data, error }` response instead of relying on `try/catch` alone
 * (`supabase.rpc` resolves with `{ error }` rather than rejecting on DB errors).
 */
export async function invokeNotificationEnqueueRpc(
  supabase: Pick<SupabaseClient, "rpc">,
  rpcName: ShapeBNotificationRpcName,
  params: Record<string, string>
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const { error } = await supabase.rpc(rpcName, params)
    if (error) {
      console.error(
        `[NotificationEngine] ${rpcName} returned error (${error.code ?? "UNKNOWN"}): ${error.message}`
      )
      return { ok: false, error: error.message }
    }
    return { ok: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      `[NotificationEngine] ${rpcName} threw exception: ${message}`
    )
    return { ok: false, error: message }
  }
}

