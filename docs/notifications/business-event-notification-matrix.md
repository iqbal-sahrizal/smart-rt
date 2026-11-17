# Smart RT — Business Event Notification Matrix (Phase 1 Audit)

**Date:** 2026-11-17
**Method:** Direct source audit (migrations, Server Actions, repository modules). Nothing in this matrix is assumed — every row is backed by an exact file/function/table reference found in source. Where no notification-worthy event exists, that is stated explicitly with the reason, per the audit instruction not to invent events.

---

## 1. Foundational facts that shape every row below

- **In-app notifications (`public.notifications`) can only be inserted by a `SECURITY DEFINER` function.** There is no `INSERT` RLS policy for the `authenticated` role on this table (confirmed in `20261113001100_enable_rls_and_policies.sql` and `20261113001200_harden_rls_policies_and_insert_guards.sql` — only `SELECT`/`UPDATE` policies exist). Every existing notification-creating function is `SECURITY DEFINER`.
- **The only existing precedent** is 4 hand-written `INSERT INTO public.notifications` blocks inside Community Feed RPCs (`create_community_post_comment`, `moderate_community_post`, `moderate_community_comment` — all in `supabase/migrations/20261116002500_create_community_feed.sql`, lines 1342/1373/1810/1996). No shared/generic notification-creation helper exists anywhere (confirmed via repo-wide grep for `create_notification`/`insert_notification`/`notify_`).
- **No push dispatch is wired to anything yet** — these 4 existing events are in-app-bell-only.
- **No pg_cron, pg_net, or Vault usage exists anywhere** in the migrations — any scheduled dispatcher is new infrastructure, not an extension of something existing.
- **No existing multi-recipient/broadcast resolver** exists in `src/lib/` — `resolveScopedNotificationContext` only resolves the *current caller's own* read scope, not "all residents in tenant X" or "all staff with role Y".
- **Recipient-resolution join pattern** (used consistently below): `public.tenant_members` is the only table with `user_id` + `status`. A business row almost never stores `user_id` directly — it stores `resident_id` or `*_member_id`, which must be joined through `tenant_members` (`resident_id` → `tenant_members.resident_id`, unique per tenant; or `*_member_id` → `tenant_members.id` directly) **and filtered `status = 'active'`** before a push token lookup is meaningful. A bill addressed to a `resident_id` with no matching active `tenant_members` row (e.g. a child with no login) has **no valid recipient** — this must resolve to "no-op", not an error.
- **Deep-link mapping status**: `resolveNotificationDestination()` (`src/lib/notifications/types.ts`) already covers `announcements`, `bills`, `payments`, `households`, `residents` for resident scope. It has **no case** for complaints, letters, activities, ronda, or any `community_*` type — these must be added (Phase 5).

---

## 2. Matrix

| # | Feature / Event | Trigger file : function | Table / RPC | Success condition | Recipient(s) | Tenant scope | Title/body basis | Deep link (reference_type / id) | In-app today? | Push today? | Idempotency/retry today? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Community** — comment on post | `20261116002500...sql` : `create_community_post_comment` | `community_post_comments` (RPC, already `SECURITY DEFINER`) | Comment insert succeeds | Post author (via `tenant_members`, self-notify guarded) | `p_tenant_id`, server-resolved | `"Komentar baru pada postingan Anda"` + preview | `community_post` / `post_id` | **Yes** | No | No (single hand-written INSERT, no retry concept) |
| 2 | **Community** — reply to comment | same function | same | Reply insert succeeds | Parent-comment author (guarded vs. post-author duplicate) | same | `"Balasan baru pada komentar Anda"` | `community_post` / `post_id` | **Yes** | No | No |
| 3 | **Community** — post hidden/restored | `moderate_community_post` | same migration | Moderation action succeeds | Post author | same | `"Postingan Anda disembunyikan/dipulihkan..."` | `community_post` / `post_id` | **Yes** | No | No |
| 4 | **Community** — comment hidden/restored | `moderate_community_comment` | same migration | Moderation action succeeds | Comment author | same | same pattern | `community_post` / `post_id` (parent post) | **Yes** | No | No |
| 5 | **Announcements** — published | `src/app/actions/announcements.ts` : `createAnnouncementAction`/`updateAnnouncementAction` | `public.announcements` + `public.announcement_recipients` (**plain `.from()` insert, not RPC**) | `status` is/becomes `'published'` | Residents matched by `target_type` (`all` / role-filtered / household-filtered), resolved server-side via `verifyRecipientTargets`/`buildRecipientInsertRows` | `requireAdminContext().tenant.tenantId` | Announcement title/body | `announcements` / announcement id — **mapping already exists** | No | No | No |
| 6 | **Bills** — issued to resident/household | `src/app/actions/finance.ts` : `createBillAction`, `generateBillsAction` (bulk) | `public.bills` (**plain insert**, no RPC) | Row inserted with a resident/household target | The specific `bills.resident_id`'s tenant_member, **or** all active residents of `bills.household_id` if `resident_id IS NULL` | `requireAdminContext()` | Bill period, amount, due date | `bills` / bill id — **mapping already exists** | No | No | No |
| 7 | **Payments** — verified | `finance.ts`:`verifyPaymentAction` → `verify_payment` RPC | `public.payments`/`public.bills` (RPC, `SECURITY DEFINER`, confirmed) | RPC returns successfully; `payments.status → 'verified'`, `bills.status` recomputed | The bill's resident (via `payments.bill_id → bills.resident_id → tenant_members`) | `v_pay.tenant_id` (resolved inside the RPC from the locked payment row) | New bill status (paid/partial), amount | `payments` / payment id — **mapping already exists** | No | No | No |
| 8 | **Payments** — rejected | `finance.ts`:`rejectPaymentAction` → `reject_payment` RPC | same tables (RPC, `SECURITY DEFINER`, confirmed) | RPC returns successfully | Same resident | same | Rejection reason | `payments` / payment id | No | No | No |
| 9 | **Payments** — refunded | `finance.ts`:`refundPaymentAction` → `refund_payment` RPC | same (RPC, `SECURITY DEFINER`, confirmed by function listing — body not fully re-read, signature confirmed) | RPC returns successfully | Same resident | same | Refund amount | `payments` / payment id | No | No | No |
| 10 | **Letters** — reviewed (approved/rejected) | `src/app/actions/letters.ts`:`reviewLetterRequestAction` → `review_letter_request` RPC | `public.letter_requests` (RPC, `SECURITY DEFINER`, confirmed) | RPC returns successfully; `status → approved\|rejected` | Requester, via `letter_requests.resident_id → tenant_members` (**not** `requested_by_member_id`, which is who filed it — if different from the resident the letter is *for*, the resident is still the right notify target; confirmed both columns exist, resident_id is the canonical subject) | `requireScopedContext("admin")` resolved tenant | Letter type, decision, admin notes | **gap — not in `resolveNotificationDestination` yet** | No | No | No |
| 11 | **Letters** — issued (PDF ready) | `letters.ts`:`issueLetterAction` → `issue_letter` RPC | same (RPC, `SECURITY DEFINER`, confirmed) | RPC returns a letter number successfully; `status → issued`-equivalent (confirmed: issuance requires prior `status = 'approved'`) | Same requester resolution as #10 | same | Letter number | **gap** | No | No | No |
| 12 | **Complaints** — reply posted | `src/app/actions/complaints.ts`:`createComplaintReplyAction` → `createComplaintReplyWithClient` (**plain `.from("complaint_replies").insert()`, not RPC**) | `public.complaint_replies` | Reply insert succeeds | **Direction-aware**: if `scope === "admin"` replied → notify reporter (`complaints.reporter_member_id → tenant_members`); if `scope === "resident"` replied → notify active staff (`ketua_rt`/`sekretaris`/`pengurus`) in that tenant — **this direction is a genuinely new fan-out shape, not covered by any existing single-recipient pattern** | `tenant.tenantId` from scoped context | Reply author label + message preview | **gap** | No | No | No |
| 13 | **Complaints** — status changed | `complaints.ts`:`transitionComplaintStatusAction` → `transition_complaint_status` RPC | `public.complaints` (RPC, `SECURITY DEFINER`, confirmed — allowed transitions: `open→in_progress`, `*→resolved`, `*→rejected`; no reopen) | RPC returns successfully | Reporter (`complaints.reporter_member_id → tenant_members`) | `v_c.tenant_id` resolved inside RPC | New status, reason | **gap** | No | No | No |
| 14 | **Activities** — created/published | `src/lib/activities/repository.ts` → `create_activity` RPC (`20261116002300_activities_security_gap_closure.sql`, confirmed `SECURITY DEFINER`) | `public.activities` | RPC returns an activity id successfully (activities have **no separate draft/publish state** — `scheduled` is the initial, immediately-visible status) | **All active residents in tenant** — genuinely new broadcast shape, no existing precedent for "all residents" fan-out | `p_tenant_id` param, re-validated by `has_tenant_role` inside the RPC | Activity title, date/location | **gap** | No | No | No |
| 15 | **Activities** — cancelled | `activities.ts`:`transitionActivityStatusAction` → `transition_activity_status` RPC (confirmed `SECURITY DEFINER`) | `public.activities`/`activity_participants` | `status → 'cancelled'` specifically (not `ongoing`/`completed` — those are not notification-worthy per "avoid notifying on internal changes") | Participants with `rsvp_status IN ('invited','attending')` (not already `absent`) | `v_act.tenant_id` inside RPC | Cancellation notice | **gap** | No | No | No |
| 16 | **Ronda** — schedule published | `20261115002000_create_ronda_schedule.sql` → `upsert_ronda_schedule_with_roster` (confirmed `SECURITY DEFINER`) | `public.ronda_schedules` + roster | RPC returns successfully for a new/updated schedule | Roster members for that schedule | tenant scope resolved inside RPC | Shift date/time | **gap** | No | No | No |

---

## 3. Confirmed NOT notification-worthy (explicit, with reasoning — not assumed)

| Feature | Reason no event is modeled |
|---|---|
| **Dues (Iuran templates/rates)** | `src/lib/finance/types.ts` (`DuesSummary`, `DuesTargetHouseholdOption`) confirms Dues are admin-only recurring-charge *templates*; they generate individual **Bills** (row #6 above) via `generateBillsAction`, which is the actual resident-facing artifact. A "dues created" event has no direct resident recipient. |
| **Cash transactions / categories** | `public.cash_transactions`/`cash_categories` have no resident/household attribution column — purely internal treasury bookkeeping (confirmed by schema and by `verify_payment`'s own cash-transaction insert, which has no recipient concept). |
| **Resident invitations** | The invited person has no `auth.users` row and no `tenant_members` row until `redeemInvitationAction` succeeds — there is no valid push/in-app target to notify *before* redemption, and no admin-facing "invitation redeemed" event exists in the required-minimum list. |
| **Residents/Household CRUD** | `src/app/actions/residents.ts` — admin-only maintenance operations (`canManageResidents` gated), not resident-facing status transitions. |
| **Tenant settings / branding** | `src/app/actions/tenant-settings.ts` — admin-only identity/logo configuration, never resident-facing. |
| **Letter types, cash categories (CRUD)** | Admin configuration tables, not business events a resident experiences. |
| **Activity `ongoing`/`completed` transitions, RSVP self-registration (`register_for_activity`)** | Internal/self-initiated state changes with no new information for *other* residents to receive. |

---

## 4. Flagged as optional / lower priority (explicit scoping decision, not silently dropped)

| Feature | Why it's optional | Decision |
|---|---|---|
| **Activity attendance marking** (`record_activity_attendance`, admin marks a resident attended/absent after the fact) | Debatable value — could read as surveillance-ish or just noisy; not in the task's example list. | Not wired in Phase 3 by default; flagged here so the operator can request it explicitly. |
| **Ronda attendance confirmation** (`record_ronda_attendance`) | Same reasoning. | Same — flagged, not wired by default. |

---

## 5. Summary counts

- **16 concrete events identified** across 8 domains / feature areas (Community Feed ×4, Announcements ×1, Bills ×1, Payments ×3, Letters ×2, Complaints ×2, Activities ×2, Ronda ×1 — or 7 if Bills + Payments are grouped as Finance).
- **4 already have in-app notifications** (all Community Feed); **0 have push** connected.
- **12 events have zero notification coverage today** (in-app or push) across 7 domains — this is the scope wired into `notification_outbox` in Phase 2/3 (`20261117002700_create_notification_outbox_engine.sql`). Community Feed's 4 pre-existing events remain in-app-only in `20261116002500_create_community_feed.sql`.
- **9 of 16 events already sit inside a `SECURITY DEFINER` RPC** — the cheapest, safest, most architecture-consistent extension point (append to the existing function body via `CREATE OR REPLACE FUNCTION`, same transaction, same pattern as Community Feed).
- **3 of 16 events currently use a plain, non-RPC insert** (Bills, Announcements, Complaint replies) and need a small, purpose-built wrapper `SECURITY DEFINER` RPC each, called immediately after the existing insert succeeds — without touching or refactoring the existing insert logic itself.
- **2 events require genuinely new recipient-resolution shapes** not seen anywhere in the existing codebase: broadcast-to-all-active-residents (Activities created) and direction-aware reply routing (Complaints reply). These are called out explicitly in the architecture doc as new, not duplicated, logic.
