import assert from "node:assert/strict"
import test, { describe } from "node:test"

import { loadNotificationTestModules } from "./helpers/load-notification-modules.mjs"

describe("Central Notification Engine — Full Unit & Integration Test Suite", () => {
  const { notificationTypes, pushPayload, dispatcher, enqueueRpc } = loadNotificationTestModules()
  const { resolveNotificationDestination } = notificationTypes
  const { buildPushNavigationPayload } = pushPayload
  const { groupOutboxRows, processNotificationOutbox } = dispatcher
  const { invokeNotificationEnqueueRpc } = enqueueRpc

  const sampleUuid = "11111111-1111-4111-8111-111111111111"
  const tenant1 = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
  const tenant2 = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
  const user1 = "u1111111-1111-4111-8111-111111111111"
  const user2 = "u2222222-2222-4222-8222-222222222222"

  describe("1. Deep Link & Destination Mapping for All Business Events", () => {
    test("announcements: resident and admin scope", () => {
      assert.equal(
        resolveNotificationDestination("resident", "announcement", sampleUuid),
        `/resident/announcements/${sampleUuid}`
      )
      assert.equal(
        resolveNotificationDestination("resident", "announcement", null),
        "/resident/announcements"
      )
      assert.equal(
        resolveNotificationDestination("admin", "announcement", sampleUuid),
        `/announcements/${sampleUuid}`
      )
    })

    test("bills: resident and admin scope", () => {
      assert.equal(
        resolveNotificationDestination("resident", "bill", sampleUuid),
        `/resident/bills/${sampleUuid}`
      )
      assert.equal(
        resolveNotificationDestination("resident", "bills", null),
        "/resident/bills"
      )
      assert.equal(
        resolveNotificationDestination("admin", "bill", sampleUuid),
        `/bills/${sampleUuid}`
      )
    })

    test("payments: resident and admin scope", () => {
      assert.equal(
        resolveNotificationDestination("resident", "payment", sampleUuid),
        "/resident/bills"
      )
      assert.equal(
        resolveNotificationDestination("admin", "payment", sampleUuid),
        `/payments/${sampleUuid}`
      )
    })

    test("complaints: resident and admin scope", () => {
      assert.equal(
        resolveNotificationDestination("resident", "complaint", sampleUuid),
        `/resident/complaints/${sampleUuid}`
      )
      assert.equal(
        resolveNotificationDestination("resident", "complaints", null),
        "/resident/complaints"
      )
      assert.equal(
        resolveNotificationDestination("admin", "complaint", sampleUuid),
        `/pengaduan/${sampleUuid}`
      )
      assert.equal(
        resolveNotificationDestination("admin", "complaints", null),
        "/pengaduan"
      )
    })

    test("letters: resident and admin scope", () => {
      assert.equal(
        resolveNotificationDestination("resident", "letter_request", sampleUuid),
        `/resident/letters/${sampleUuid}`
      )
      assert.equal(
        resolveNotificationDestination("resident", "letter_requests", null),
        "/resident/letters"
      )
      assert.equal(
        resolveNotificationDestination("admin", "letter_request", sampleUuid),
        "/surat"
      )
    })

    test("activities: resident and admin scope", () => {
      assert.equal(
        resolveNotificationDestination("resident", "activity", sampleUuid),
        `/resident/activities/${sampleUuid}`
      )
      assert.equal(
        resolveNotificationDestination("resident", "activities", null),
        "/resident/activities"
      )
      assert.equal(
        resolveNotificationDestination("admin", "activity", sampleUuid),
        `/kegiatan/${sampleUuid}`
      )
    })

    test("ronda: resident and admin scope", () => {
      assert.equal(
        resolveNotificationDestination("resident", "ronda_schedule", sampleUuid),
        `/resident/ronda/${sampleUuid}`
      )
      assert.equal(
        resolveNotificationDestination("resident", "ronda_schedule", null),
        "/resident/ronda"
      )
      assert.equal(
        resolveNotificationDestination("admin", "ronda_schedule", sampleUuid),
        "/ronda"
      )
    })

    test("community feed: resident and admin scope", () => {
      assert.equal(
        resolveNotificationDestination("resident", "community_post", sampleUuid),
        "/resident/feed"
      )
      assert.equal(
        resolveNotificationDestination("admin", "community_post", sampleUuid),
        "/komunitas"
      )
    })

    test("buildPushNavigationPayload generates resident path by default and admin path for validated admin scope", () => {
      const residentPayload = buildPushNavigationPayload("complaint", sampleUuid)
      assert.deepEqual(residentPayload, { path: `/resident/complaints/${sampleUuid}` })

      const adminPayload = buildPushNavigationPayload("complaint", sampleUuid, "admin")
      assert.deepEqual(adminPayload, { path: `/pengaduan/${sampleUuid}` })
    })

    test("invalid or malformed UUID falls back gracefully to list route", () => {
      const payload = buildPushNavigationPayload("activity", "invalid-id-injection")
      assert.deepEqual(payload, { path: "/resident/activities" })
    })
  })

  describe("2. Outbox Batch Grouping & Tenant Isolation", () => {
    test("groups identical notifications across multiple recipients", () => {
      const rows = [
        {
          id: "outbox-1",
          tenant_id: tenant1,
          recipient_user_id: user1,
          event_type: "announcement.published",
          reference_type: "announcement",
          reference_id: sampleUuid,
          title: "Gotong Royong",
          body: "Hari Minggu kumpul",
        },
        {
          id: "outbox-2",
          tenant_id: tenant1,
          recipient_user_id: user2,
          event_type: "announcement.published",
          reference_type: "announcement",
          reference_id: sampleUuid,
          title: "Gotong Royong",
          body: "Hari Minggu kumpul",
        },
      ]

      const groups = groupOutboxRows(rows)
      assert.equal(groups.length, 1)
      assert.equal(groups[0].tenantId, tenant1)
      assert.deepEqual(groups[0].recipientUserIds, [user1, user2])
      assert.deepEqual(groups[0].items.map((i) => i.outboxId), ["outbox-1", "outbox-2"])
    })

    test("isolates resident and admin target_scope into separate groups", () => {
      const rows = [
        {
          id: "outbox-res",
          tenant_id: tenant1,
          recipient_user_id: user1,
          target_scope: "resident",
          event_type: "complaint.reply",
          reference_type: "complaint",
          reference_id: sampleUuid,
          title: "Balasan baru",
          body: "Isi",
        },
        {
          id: "outbox-adm",
          tenant_id: tenant1,
          recipient_user_id: user2,
          target_scope: "admin",
          event_type: "complaint.reply",
          reference_type: "complaint",
          reference_id: sampleUuid,
          title: "Balasan baru",
          body: "Isi",
        },
      ]

      const groups = groupOutboxRows(rows)
      assert.equal(groups.length, 2)
      assert.equal(groups[0].targetScope, "resident")
      assert.equal(groups[1].targetScope, "admin")
    })

    test("strictly isolates different tenants into separate groups", () => {
      const rows = [
        {
          id: "outbox-1",
          tenant_id: tenant1,
          recipient_user_id: user1,
          event_type: "announcement.published",
          reference_type: "announcement",
          reference_id: sampleUuid,
          title: "Gotong Royong",
          body: "Hari Minggu kumpul",
        },
        {
          id: "outbox-2",
          tenant_id: tenant2,
          recipient_user_id: user2,
          event_type: "announcement.published",
          reference_type: "announcement",
          reference_id: sampleUuid,
          title: "Gotong Royong",
          body: "Hari Minggu kumpul",
        },
      ]

      const groups = groupOutboxRows(rows)
      assert.equal(groups.length, 2)
      assert.notEqual(groups[0].tenantId, groups[1].tenantId)
    })

    test("separates different event types / titles into distinct groups", () => {
      const rows = [
        {
          id: "outbox-1",
          tenant_id: tenant1,
          recipient_user_id: user1,
          event_type: "bill.issued",
          reference_type: "bill",
          reference_id: sampleUuid,
          title: "Tagihan Iuran",
          body: "Tagihan periode Nov",
        },
        {
          id: "outbox-2",
          tenant_id: tenant1,
          recipient_user_id: user1,
          event_type: "payment.verified",
          reference_type: "bill",
          reference_id: sampleUuid,
          title: "Pembayaran Diverifikasi",
          body: "Pembayaran telah diverifikasi",
        },
      ]

      const groups = groupOutboxRows(rows)
      assert.equal(groups.length, 2)
    })
  })

  describe("3. Dispatcher Execution Pipeline", () => {
    test("returns empty result when no outbox rows are pending", async () => {
      const mockAdmin = {
        rpc: async (name) => {
          assert.equal(name, "claim_pending_notification_outbox_batch")
          return { data: [], error: null }
        },
      }

      const result = await processNotificationOutbox({
        supabaseAdmin: mockAdmin,
        fcmFunctionUrl: "https://example.supabase.co/functions/v1/send-fcm-notification",
        fcmFunctionSecret: "secret-123",
      })

      assert.equal(result.claimedCount, 0)
      assert.equal(result.sentCount, 0)
      assert.equal(result.failedCount, 0)
    })

    test("handles database claim error gracefully without throwing", async () => {
      const mockAdmin = {
        rpc: async () => ({
          data: null,
          error: { message: "connection refused" },
        }),
      }

      const result = await processNotificationOutbox({
        supabaseAdmin: mockAdmin,
        fcmFunctionUrl: "https://example.supabase.co/functions/v1/send-fcm-notification",
        fcmFunctionSecret: "secret-123",
      })

      assert.equal(result.claimedCount, 0)
      assert.equal(result.errors.length, 1)
      assert.match(result.errors[0].error, /Failed to claim outbox batch/)
    })

    test("dispatches batch successfully and marks outbox rows as sent", async () => {
      const recordedCalls = []
      const mockAdmin = {
        rpc: async (name, params) => {
          if (name === "claim_pending_notification_outbox_batch") {
            return {
              data: [
                {
                  id: "row-1",
                  tenant_id: tenant1,
                  recipient_user_id: user1,
                  event_type: "complaint.resolved",
                  reference_type: "complaint",
                  reference_id: sampleUuid,
                  title: "Pengaduan diselesaikan",
                  body: "Pengaduan Anda telah selesai",
                  idempotency_key: `complaint.resolved:${sampleUuid}:${user1}`,
                },
              ],
              error: null,
            }
          }
          if (name === "record_notification_outbox_result") {
            recordedCalls.push(params)
            return { data: null, error: null }
          }
          throw new Error(`Unexpected RPC: ${name}`)
        },
      }

      let fetchCalled = false
      const mockFetch = async (url, options) => {
        fetchCalled = true
        assert.equal(options.method, "POST")
        const payload = JSON.parse(options.body)
        assert.equal(payload.tenant_id, tenant1)
        assert.deepEqual(payload.recipient_user_ids, [user1])
        assert.equal(payload.data.path, `/resident/complaints/${sampleUuid}`)

        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            total_recipients: 1,
            total_tokens: 1,
            success_count: 1,
            failure_count: 0,
          }),
        }
      }

      const result = await processNotificationOutbox({
        supabaseAdmin: mockAdmin,
        fetchImpl: mockFetch,
        fcmFunctionUrl: "https://example.supabase.co/functions/v1/send-fcm-notification",
        fcmFunctionSecret: "secret-123",
      })

      assert.ok(fetchCalled)
      assert.equal(result.claimedCount, 1)
      assert.equal(result.sentCount, 1)
      assert.equal(result.failedCount, 0)
      assert.equal(recordedCalls.length, 1)
      assert.deepEqual(recordedCalls[0], {
        p_outbox_id: "row-1",
        p_success: true,
        p_error: null,
        p_claim_token: null,
      })
    })

    test("routes admin-scoped complaint reply to /pengaduan/:id and forwards claim_token", async () => {
      const recordedCalls = []
      const claimToken = "99999999-9999-4999-8999-999999999999"
      const mockAdmin = {
        rpc: async (name, params) => {
          if (name === "claim_pending_notification_outbox_batch") {
            return {
              data: [
                {
                  id: "row-admin-1",
                  tenant_id: tenant1,
                  recipient_user_id: user1,
                  target_scope: "admin",
                  claim_token: claimToken,
                  event_type: "complaint.reply",
                  reference_type: "complaint",
                  reference_id: sampleUuid,
                  title: "Balasan baru pada pengaduan warga",
                  body: "Warga membalas pengaduan.",
                  idempotency_key: `complaint.reply:r1:${user1}`,
                },
              ],
              error: null,
            }
          }
          if (name === "record_notification_outbox_result") {
            recordedCalls.push(params)
            return { data: null, error: null }
          }
          throw new Error(`Unexpected RPC: ${name}`)
        },
      }

      const mockFetch = async (_url, options) => {
        const payload = JSON.parse(options.body)
        assert.equal(payload.data.path, `/pengaduan/${sampleUuid}`)
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }

      const result = await processNotificationOutbox({
        supabaseAdmin: mockAdmin,
        fetchImpl: mockFetch,
        fcmFunctionUrl: "https://example.supabase.co/functions/v1/send-fcm-notification",
        fcmFunctionSecret: "secret-123",
      })

      assert.equal(result.sentCount, 1)
      assert.deepEqual(recordedCalls[0], {
        p_outbox_id: "row-admin-1",
        p_success: true,
        p_error: null,
        p_claim_token: claimToken,
      })
    })

    test("handles FCM 502/network failure and records failure for retry backoff", async () => {
      const recordedCalls = []
      const mockAdmin = {
        rpc: async (name, params) => {
          if (name === "claim_pending_notification_outbox_batch") {
            return {
              data: [
                {
                  id: "row-fail-1",
                  tenant_id: tenant1,
                  recipient_user_id: user1,
                  event_type: "bill.issued",
                  reference_type: "bill",
                  reference_id: sampleUuid,
                  title: "Tagihan baru",
                  body: "Tagihan terbit",
                  idempotency_key: `bill.issued:${sampleUuid}:${user1}`,
                },
              ],
              error: null,
            }
          }
          if (name === "record_notification_outbox_result") {
            recordedCalls.push(params)
            return { data: null, error: null }
          }
          throw new Error(`Unexpected RPC: ${name}`)
        },
      }

      const mockFetch = async () => ({
        ok: false,
        status: 502,
        text: async () => "Bad Gateway - upstream timeout",
      })

      const result = await processNotificationOutbox({
        supabaseAdmin: mockAdmin,
        fetchImpl: mockFetch,
        fcmFunctionUrl: "https://example.supabase.co/functions/v1/send-fcm-notification",
        fcmFunctionSecret: "secret-123",
      })

      assert.equal(result.claimedCount, 1)
      assert.equal(result.sentCount, 0)
      assert.equal(result.failedCount, 1)
      assert.equal(recordedCalls.length, 1)
      assert.equal(recordedCalls[0].p_outbox_id, "row-fail-1")
      assert.equal(recordedCalls[0].p_success, false)
      assert.match(recordedCalls[0].p_error, /HTTP 502/)
    })

    test("handles application-level dispatch error from Edge Function", async () => {
      const recordedCalls = []
      const mockAdmin = {
        rpc: async (name, params) => {
          if (name === "claim_pending_notification_outbox_batch") {
            return {
              data: [
                {
                  id: "row-app-fail",
                  tenant_id: tenant1,
                  recipient_user_id: user1,
                  event_type: "activity.created",
                  reference_type: "activity",
                  reference_id: sampleUuid,
                  title: "Kegiatan baru",
                  body: "Senam pagi",
                  idempotency_key: `activity.created:${sampleUuid}:${user1}`,
                },
              ],
              error: null,
            }
          }
          if (name === "record_notification_outbox_result") {
            recordedCalls.push(params)
            return { data: null, error: null }
          }
          throw new Error(`Unexpected RPC: ${name}`)
        },
      }

      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: false,
          error: "OAuth2 authentication failed with Google",
        }),
      })

      const result = await processNotificationOutbox({
        supabaseAdmin: mockAdmin,
        fetchImpl: mockFetch,
        fcmFunctionUrl: "https://example.supabase.co/functions/v1/send-fcm-notification",
        fcmFunctionSecret: "secret-123",
      })

      assert.equal(result.sentCount, 0)
      assert.equal(result.failedCount, 1)
      assert.equal(recordedCalls[0].p_success, false)
      assert.match(recordedCalls[0].p_error, /OAuth2 authentication failed/)
    })
  })

  describe("4. Shape B Enqueue RPC Error Detection", () => {
    test("detects { error } returned by supabase.rpc without throwing", async () => {
      const mockSupabase = {
        rpc: async () => ({
          data: null,
          error: { code: "42501", message: "Forbidden: requires staff role" },
        }),
      }

      const res = await invokeNotificationEnqueueRpc(
        mockSupabase,
        "notify_announcement_published",
        { p_announcement_id: sampleUuid }
      )
      assert.equal(res.ok, false)
      assert.equal(res.error, "Forbidden: requires staff role")
    })

    test("returns { ok: true, error: null } when Shape B RPC succeeds", async () => {
      const mockSupabase = {
        rpc: async () => ({ data: 3, error: null }),
      }

      const res = await invokeNotificationEnqueueRpc(
        mockSupabase,
        "notify_bill_issued",
        { p_bill_id: sampleUuid }
      )
      assert.deepEqual(res, { ok: true, error: null })
    })
  })
})
