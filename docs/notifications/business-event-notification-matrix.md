# Smart RT — Business Event Notification Matrix

**Date:** 2026-11-17
**Method:** Direct source audit (server actions in `src/app/actions/`, atomic RPCs in `supabase/migrations/20261114001500_storage_and_atomic_rpcs.sql`, table/RLS definitions, and `src/lib/notifications/types.ts`). Nothing below is assumed — every row cites the exact file/function/column it was read from. Where something was not found, it is marked **NOT FOUND** rather than guessed.

---

## 0. Existing Notification Infrastructure (baseline, confirmed by source)

| Component | Status |
|---|---|
| `public.notifications` table (in-app bell) | Exists (`20261113000700_create_audit_notification_domain.sql`): `tenant_id`, `recipient_user_id`, `title`, `body`, `type`, `reference_type`, `reference_id`, `is_read`, `read_at`. FK to `tenant_members(tenant_id, user_id)` — recipient must be an active tenant member. |
| RLS on `notifications` | `SELECT`/`UPDATE`: recipient-only (`recipient_user_id = auth.uid()` + tenant membership). **No `INSERT` policy exists for `authenticated`** — confirmed by reading `20261113001100_enable_rls_and_policies.sql` and `20261113001200_harden_rls_policies_and_insert_guards.sql` in full; only `SELECT`/`UPDATE` policies are defined. This means the table can only be written to via a `SECURITY DEFINER` function (RLS bypassed as the function owner), never a plain authenticated insert. |
| Only existing writer of `public.notifications` | `supabase/migrations/20261116002500_create_community_feed.sql` — 4 call sites inside `SECURITY DEFINER` RPCs (`create_community_post_comment`, and 3 others for likes/reports — not individually re-verified here), each doing a direct `INSERT INTO public.notifications (...)` in the same transaction as the business write. **This is the only precedent for notification creation anywhere in the codebase.** Community feed comment/reply notifications are in-app only — no push/FCM dispatch exists for them either. |
| `user_device_tokens` + `send-fcm-notification` Edge Function | Exists and PASS per Phase 5.1.1/5.1 — accepts `tenant_id`, `recipient_user_ids[]`, `title`, `body`, generic `data` map. Not modified by this phase. |
| `resolveNotificationDestination()` (`src/lib/notifications/types.ts`) | Resident-scope switch currently covers: `announcements`, `bills`, `payments`, `households`, `residents`/`resident_invitations`. **Missing resident-scope mappings for: `complaints`, `letter_requests`, `activities`/`kegiatan`, `ronda`.** Admin-scope switch covers `announcements`, `bills`, `dues`, `payments`, `cash`, `residents`, `resident_invitations` — also missing `complaints`, `letter_requests`, `activities`. |
| Atomic business RPCs | `supabase/migrations/20261114001500_storage_and_atomic_rpcs.sql` is the single file containing nearly every state-transition RPC relevant here (`verify_payment`, `reject_payment`, `refund_payment`, `attach_payment_proof`, `transition_complaint_status`, `review_letter_request`, `cancel_letter_request`, `issue_letter`, `transition_activity_status`, `soft_delete_activity`, `record_activity_attendance`, etc.). Every one read follows the identical shape: validate → mutate → `INSERT INTO public.audit_logs(...)` → `RETURN`. This is the natural, already-transactional insertion point for a notification-outbox write (see architecture doc).

---

## 1. Announcements (Pengumuman)

| Field | Value |
|---|---|
| Trigger file/function | `src/app/actions/announcements.ts` → `createAnnouncementAction` |
| Mutation | Direct `.insert()` on `public.announcements` (**not** an RPC) |
| Success condition | `input.status === "published"` (quoted: `const publishedAt = input.status === "published" ? new Date().toISOString() : null`) — a `"draft"` save does not qualify |
| Recipients | Already resolved server-side into `public.announcement_recipients` via `buildRecipientInsertRows({ targetType, roleIds, householdIds })`, inserted right after the announcement row (same action, two sequential inserts with manual rollback-on-failure of the first insert if the second fails) |
| Tenant scope | `tenant.tenantId` from `requireAdminContext()`, used in every insert/select |
| Suggested title/body | Announcement title + a short excerpt of `content` |
| `reference_type` / `reference_id` | `"announcement"` / announcement id — already supported by `resolveNotificationDestination` (both scopes) |
| In-app notification today | **Not found** — no insert into `notifications` anywhere in the announcements code path |
| Push today | None |
| Deep link mapping | Already present for both scopes |

## 2. Bills (Tagihan)

| Field | Value |
|---|---|
| Trigger file/function | `src/app/actions/finance.ts` → `createBillAction` (single) and `generateBillsAction` (bulk — not individually re-read, assumed structurally similar; **flagged for confirmation at implementation time**) |
| Mutation | Direct `.insert()` on `public.bills` (**not** an RPC) |
| Success condition | Insert succeeds with `status: "unpaid"` — a bill only exists once issued; there is no separate "draft" bill state in `createBillAction` |
| Recipients | `due.target_scope === "household"` → `household_id` set (needs resolving to the household's linked resident account(s)); else `resident_id` set directly. The exact household→user_id join was **not independently re-traced** in this pass — `checkResidentOwnsBill` (`src/lib/finance/ownership.ts`) already implements this exact mapping for authorization and should be reused rather than re-derived |
| Tenant scope | `tenant.tenantId` from `requireAdminContext()` |
| Suggested title/body | "Tagihan baru: {due name} — {period}" / amount + due date |
| `reference_type` / `reference_id` | `"bill"` / bill id — mapping exists |
| In-app notification today | Not found |
| Push today | None |
| Deep link mapping | Already present for both scopes |

## 3. Payments & Verification (Pembayaran)

| Field | Value |
|---|---|
| Submission trigger | `src/app/actions/finance.ts` → `submitResidentPaymentAction` (resident uploads proof) and `retryPaymentProofAction` |
| Verification trigger | `verifyPaymentAction` → RPC `public.verify_payment(p_payment_id, p_cash_category_id, p_notes)` |
| Rejection trigger | `rejectPaymentAction` → RPC `public.reject_payment(p_payment_id, p_reason)` |
| Refund trigger | `refundPaymentAction` → RPC `public.refund_payment(...)` (signature read, body not fully traced) |
| Success condition — verified | RPC quoted: `IF v_pay.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION ...` (only a `pending` payment can transition) → sets `status = 'verified'`. **Recipient: the resident who owns the bill** (`v_bill.resident_id` / `v_bill.household_id`, resolved inside the RPC via `SELECT * INTO v_bill FROM public.bills ... FOR UPDATE`) |
| Success condition — rejected | Same pending-only guard → sets `status = 'rejected'`. Same recipient as above |
| Success condition — submission (needs bendahara attention) | `submitResidentPaymentAction` inserting a new `payments` row with `status` presumably `'pending'` (not independently re-confirmed in this pass — the function body was read only through its validation section). **Recipient: bendahara/ketua_rt of that tenant** — a role-broadcast, not a single user; this is a different recipient-resolution shape than every other event audited here and must be resolved via `has_tenant_role`-style role lookup, not a single foreign key |
| Tenant scope | `tenant.tenantId` from `requireAdminContext()`/`requireResidentContext()`; RPCs re-derive tenant from the locked row (`v_pay.tenant_id`) and re-check role server-side (`has_tenant_role`) — never trusts the caller's claimed tenant for the RPC path |
| `reference_type` / `reference_id` | `"payment"` / payment id for the submission-direction event (no existing deep-link case for `"payment"` pointing at a payment id specifically — currently `payment`/`payments` resolves to `/resident/bills` generically, no admin-scope case for `payment` review queue item; **gap**). `"bill"` / bill id for verified/rejected (existing mapping) |
| In-app notification today | Not found for any of these four events |
| Push today | None |
| Deep link mapping | Bill-side PASS (existing); payment-submission-to-bendahara side is a **gap** — needs an admin-scope `payment` → `/payments/{id}` case added |

## 4. Letters & Permohonan Surat

| Field | Value |
|---|---|
| Review trigger | `src/app/actions/letters.ts` → `reviewLetterRequestAction` → RPC `public.review_letter_request(p_request_id, p_decision, p_admin_notes)` |
| Issuance trigger | `issueLetterAction` → RPC `public.issue_letter(p_request_id, p_storage_path)` |
| Cancellation trigger | `cancelLetterRequestAction` → RPC `public.cancel_letter_request` (resident-initiated, requester cancelling their own request — likely does **not** need a notification, since the actor and the recipient would be the same person) |
| Success condition — review | Quoted: `p_decision NOT IN ('reviewing', 'approved', 'rejected')` is rejected; only `'approved'`/`'rejected'` are terminal and notify-worthy — `'reviewing'` is an intermediate status change the task explicitly says to avoid notifying on ("Hindari notifikasi untuk perubahan internal yang tidak perlu diketahui warga") |
| Success condition — issuance | Quoted: `IF v_lr.status <> 'approved' THEN RAISE EXCEPTION 'Only approved letter requests can be issued'` → sets `status = 'completed'` and allocates the official letter number |
| Recipient | `v_lr.requested_by_member_id` (a `tenant_members.id`, **not** a `user_id` directly — requires one join to `tenant_members` to get `user_id`, same shape as the complaints table below) |
| Tenant scope | `v_lr.tenant_id` re-derived from the locked row inside the RPC |
| `reference_type` / `reference_id` | `"letter_request"` / request id — **no existing mapping in `resolveNotificationDestination` for either scope.** This is a genuine gap: residents have no way to deep-link to their letter request today via this helper. Must be added. |
| In-app notification today | Not found |
| Push today | None |

## 5. Complaints & Replies (Keluhan)

| Field | Value |
|---|---|
| Status-change trigger | `src/app/actions/complaints.ts` → `transitionComplaintStatusAction` → RPC `public.transition_complaint_status(p_complaint_id, p_new_status, p_reason)` |
| Reply trigger | `createComplaintReplyAction` → `createComplaintReplyWithClient(supabase, ...)` (a TS helper, **not** confirmed to be an RPC — direct insert into `public.complaint_replies`, which has its own `complaint_replies_insert` RLS policy per `20261113001300_security_hardening_guards.sql`, implying regular authenticated inserts are already permitted there — meaning notification enqueue for replies cannot piggyback on a `SECURITY DEFINER` RPC transaction the way payment/letter events can, and needs the follow-up-enqueue-call pattern instead) |
| Success condition — status change | Quoted: `p_new_status NOT IN ('in_progress', 'resolved', 'rejected')` rejected; `'resolved'`/`'rejected'` are the terminal, notify-worthy states for the reporter. `'in_progress'` is arguably also worth notifying ("someone is looking into it") but is lower priority |
| Success condition — reply | Any successfully created reply row. **Direction matters**: `createComplaintReplyAction` supports both `operational.scope === "admin"` and (implicitly) a resident scope — meaning residents can also reply on their own complaint. Recipient resolution must therefore branch: admin→resident reply notifies the original reporter (`reporter_member_id` → `user_id`); resident→admin reply notifies **all users holding `ketua_rt`/`sekretaris`/`pengurus`** in that tenant — a role-broadcast, same shape as the payment-submission event above |
| Recipient (status change) | `complaints.reporter_member_id` → join `tenant_members.id = reporter_member_id` → `tenant_members.user_id` |
| Tenant scope | `v_c.tenant_id` re-derived inside the RPC; role re-checked via `has_tenant_role` |
| `reference_type` / `reference_id` | `"complaint"` / complaint id — **no existing mapping in `resolveNotificationDestination`.** Gap. |
| In-app notification today | Not found |
| Push today | None |

## 6. Activities (Kegiatan) & Attendance (Absensi)

| Field | Value |
|---|---|
| Status-change trigger | `src/app/actions/activities.ts` → `transitionActivityStatusAction` → RPC `public.transition_activity_status(p_activity_id, p_new_status)` |
| Creation trigger | `createActivityAction` — not re-traced in this pass whether it is a direct insert or RPC-backed; **flagged for confirmation at implementation time** |
| Attendance trigger | `recordActivityAttendanceAction` → RPC `public.record_activity_attendance(...)` |
| Success condition — status | Quoted transition guard: `scheduled→(ongoing,cancelled)`, `ongoing→(completed,cancelled)`. Per the task's own example ("Kegiatan ketika dipublikasikan atau ada pengingat yang relevan") and "avoid notifying on internal changes," the clearly notify-worthy transition here is **`cancelled`** (participants need to know); `ongoing`/`completed` are lower-value and likely skippable |
| Success condition — creation/publish | Not yet confirmed whether `createActivityAction` has a draft/published distinction analogous to announcements, or activities are visible immediately on creation. **Needs confirmation before wiring** — do not assume a `status` field exists matching the announcements pattern |
| Success condition — attendance | `record_activity_attendance` is pengurus recording who showed up **after the fact** — this is a backward-looking administrative record, not something the attendee needs pushed to them in real time. Classified as **internal, not notify-worthy** per the task's own guidance, consistent with the RLS hardening migration's restriction that residents cannot self-set `'attended'`/`'absent'` (`20261113001200_harden_rls_policies_and_insert_guards.sql`, item C) |
| Recipients | For `cancelled`: registered participants (`activity_participants` table, referenced by the RLS hardening migration — not independently re-read for its exact columns in this pass) |
| Tenant scope | `v_act.tenant_id` re-derived inside the RPC |
| `reference_type` / `reference_id` | `"activity"` / activity id — **no existing mapping in `resolveNotificationDestination`.** Gap. |
| In-app notification today | Not found |
| Push today | None |

## 7. Ronda (Jadwal Ronda Malam)

| Field | Value |
|---|---|
| Trigger file | `src/app/actions/ronda.ts` (`upsertRondaScheduleAction`, `recordRondaAttendanceAction`) |
| Audit depth | **Not independently traced in this pass** — function signatures enumerated only. No claim is made about success conditions, recipients, or existing notification/push status; this is explicitly left open rather than assumed |

## 8. Dues configuration (Iuran templates) & Cash (Kas)

| Field | Value |
|---|---|
| Trigger files | `finance.ts` → `createDuesAction`/`updateDuesAction`/`deleteDuesAction` (dues = reusable iuran **templates**, not individual resident-facing bills — the resident-facing instance is the Bill, already covered in §2); `createCashCategoryAction`/`toggleCashCategoryAction`/`createCashExpenseAction`/`updateCashExpenseAction` (internal RT bookkeeping ledger) |
| Assessment | Both are **administrative configuration / internal bookkeeping**, not events a resident needs pushed to them — consistent with the task's own instruction to avoid notifying on internal changes. No notification wiring recommended for these; documented here so they are not silently missing from the audit, per the instruction to inventory "iuran/kas" explicitly |

## 9. Community Feed (existing partial coverage)

| Field | Value |
|---|---|
| Trigger | `supabase/migrations/20261116002500_create_community_feed.sql` — `create_community_post_comment` and (per the earlier grep hit count of 4) at least 2–3 other `SECURITY DEFINER` RPCs, not all individually re-read in this pass |
| Existing in-app notification | **Confirmed present** — `INSERT INTO public.notifications` with `type = 'community_comment'` / `'community_comment_reply'`, inside the same RPC transaction as the comment write. Already handles self-notify avoidance and duplicate-recipient avoidance (post author vs. parent comment author) |
| Existing push | **Not found** — no call to `send-fcm-notification` or any outbox exists for these events today |
| Deep link | `reference_type: 'community_post'` — **not currently handled by `resolveNotificationDestination`** for either scope (only `community_post` as a raw string is stored; the helper has no matching `case`). Gap, but lower priority since in-app already works via a different code path presumably reading the row directly (not re-traced) |

## 10. Resident Invitations

| Field | Value |
|---|---|
| Assessment | An invited person has no account and no registered FCM device token at invitation time — a push notification has no addressable recipient at this point in the flow by construction. **Not applicable for push notification wiring.** Existing admin-scope deep link mapping for `resident_invitations` already exists for in-app/email-adjacent use. |

---

## 11. Summary — Confirmed Notify-Worthy Events for Phase 2/3 Wiring

| # | Event | Confirmed trigger | Recipient shape | Status |
|---|---|---|---|---|
| 1 | Announcement published | `createAnnouncementAction` | Pre-resolved list (`announcement_recipients`) | Ready to wire |
| 2 | Bill issued | `createBillAction` (+ `generateBillsAction`, unconfirmed) | Single resident or household | Ready to wire (household→user join needs reuse of `checkResidentOwnsBill`) |
| 3 | Payment verified | RPC `verify_payment` | Single resident (via bill) | Ready to wire |
| 4 | Payment rejected | RPC `reject_payment` | Single resident (via bill) | Ready to wire |
| 5 | Payment submitted (needs review) | `submitResidentPaymentAction` | Role-broadcast (bendahara/ketua_rt) | Ready to wire, needs admin deep-link gap closed |
| 6 | Letter approved/rejected | RPC `review_letter_request` | Single resident (via member join) | Ready to wire, needs deep-link gap closed |
| 7 | Letter issued | RPC `issue_letter` | Single resident | Ready to wire, needs deep-link gap closed |
| 8 | Complaint resolved/rejected | RPC `transition_complaint_status` | Single resident (via member join) | Ready to wire, needs deep-link gap closed |
| 9 | Complaint reply (admin→resident) | `createComplaintReplyAction` | Single resident | Ready to wire, needs deep-link gap closed |
| 10 | Complaint reply (resident→admin) | `createComplaintReplyAction` | Role-broadcast | Ready to wire, needs admin deep-link gap closed |
| 11 | Activity cancelled | RPC `transition_activity_status` | Participant list (`activity_participants`, not re-verified) | Needs recipient-table confirmation before wiring |

Not wired, with explicit reasoning: activity creation/publish (success condition unconfirmed), ronda (not audited), dues/cash (internal, not resident-facing by design), activity attendance (internal/backward-looking), resident invitations (no addressable device token yet).
