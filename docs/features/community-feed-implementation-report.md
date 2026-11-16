# Resident Community Feed — Implementation Report

## Final Status: **PASS WITH WARNINGS**

The Resident Community Feed is fully implemented end-to-end (database, RLS, private
storage, atomic RPCs, Server Actions, resident UI, Backoffice moderation UI,
navigation, and automated tests) and verified against a real local Supabase
instance. Warnings relate to a pre-existing, unrelated test-environment issue and
the absence of an interactive browser walkthrough in this session (see
"Remaining Blockers").

## 1. Starting State

A prior session had already authored the database migration and the read-side of
the feature (API GET routes, repository, schemas, storage/validation helpers,
types). This session audited that work, found it correct, and completed the
feature:

- Added all missing **mutation** paths (create/edit/delete post, like/unlike,
  comment CRUD, report, moderate, dismiss report) as Next.js Server Actions,
  matching the codebase's existing convention (same pattern as
  `src/app/actions/activities.ts` / `complaints.ts`).
- Added the entire **resident UI** (feed, composer, comments, likes, reporting)
  and **Backoffice moderation UI** — neither existed before this session.
- Added navigation entries, TanStack Query hooks, formatters, and the full
  automated test suite.
- Applied the two migrations that were pending locally (`20261116002400` tenant
  identity/branding, `20261116002500` community feed) via
  `supabase migration up` — additive only, no reset, no edits to historical
  migrations.

## 2. Database Changes

Migration: `supabase/migrations/20261116002500_create_community_feed.sql` (already
present; audited, not modified).

**Tables** (all tenant-scoped via `tenant_id uuid references tenants(id)`):
- `community_posts` — author, caption, media/like/comment counters, moderation
  status, soft-delete (`deleted_at`).
- `community_post_media` — up to 4 images/post, tenant+post composite FK, strict
  storage-path format check.
- `community_post_likes` — unique `(post_id, member_id)` constraint prevents
  duplicate likes at the DB level.
- `community_post_comments` — supports one level of replies (`parent_comment_id`),
  soft-delete, moderation status.
- `community_post_reports` — post or comment target, reason category/detail,
  status (`pending` / `resolved_hidden` / `dismissed`), partial unique index
  blocking duplicate *pending* reports per reporter/target.

**Cross-tenant protection**: every FK is a composite `(tenant_id, id)` reference
into the parent table's `(tenant_id, id)` unique constraint, so a row can never
point at a parent in a different tenant.

**Indexes**: tenant-scoped chronological feed index (partial, published-only),
author index, moderation-status index, media-by-post index, two like indexes,
comment-by-post index (partial, published-only), report status index.

**RLS**: enabled on all 5 tables. `authenticated` is granted `SELECT` only — there
are **no** `INSERT`/`UPDATE`/`DELETE` grants, so every mutation must go through a
`SECURITY DEFINER` RPC that resolves the actor from `auth.uid()` server-side.
SELECT policies let residents see only `published`, non-deleted rows in their own
tenant; `ketua_rt`/`sekretaris`/`pengurus` additionally see `hidden` rows for
moderation.

**RPCs** (all `SECURITY DEFINER`, all re-derive the actor's `member_id` from
`auth.uid()` — the client-supplied `tenant_id` is checked against real
membership, never trusted as an identity claim):
`get_community_feed_authors`, `create_community_post`, `update_community_post`,
`soft_delete_community_post`, `toggle_community_post_like`,
`create_community_post_comment`, `update_community_post_comment`,
`soft_delete_community_post_comment`, `report_community_content`,
`moderate_community_post`, `moderate_community_comment`,
`dismiss_community_report`, `list_community_moderation_audit_logs`.

**Moderation authorization**: hard-coded to `ketua_rt`, `sekretaris`, `pengurus`
only, both in the RPCs (`has_tenant_role(...)` check) and in the TypeScript guard
`canModerateCommunityFeed()`. `bendahara` is explicitly excluded, matching the
spec.

**Notifications**: `create_community_post_comment` and
`moderate_community_post`/`moderate_community_comment` insert into the existing
`public.notifications` table (comment on your post, reply to your comment,
moderation action on your content), skip self-notification, and were exercised
successfully by the integration test.

**Audit trail**: every mutating RPC writes to the existing `public.audit_logs`
table; a dedicated RPC (`list_community_moderation_audit_logs`, staff-only) feeds
the Backoffice audit tab.

## 3. Storage Changes

Private bucket **`community-media`** (5 MiB limit, `image/jpeg|png|webp` only).
Paths are strictly `{tenant_id}/{member_id}/{uuid}.{ext}`, validated by both the
storage policies and a server-side regex (`src/lib/community-feed/storage.ts`).

- **Insert**: only into your own `tenant_id/member_id/...` segment, and only if
  you are an active member of that tenant.
- **Select**: readable by the uploader before the post is published (so the
  compose flow can preview), and by any member of the owning tenant once the
  image is attached to a published post (or by staff for hidden posts). Never
  readable cross-tenant.
- **Delete**: uploader may delete their own orphaned (not-yet-attached) upload;
  staff may delete media only after the parent post record is gone.
- Client-side file validation inspects binary magic bytes (JPEG/PNG/WebP), not
  just the declared `Content-Type`, rejecting spoofed files before upload.
- Media is never served from a public URL; the resident app reads it via the
  authenticated private proxy route
  `GET /api/community-feed/media/[mediaId]`, which re-checks tenant membership
  and post visibility before streaming the file.
- Orphaned uploads (post create/update failed after the image was already
  uploaded) are cleaned up via `DELETE /api/community-feed/upload`.

## 4. Backend — What Was Added This Session

- `src/app/actions/community-feed.ts` (**new**) — Server Actions for every
  mutation: `createCommunityPostAction`, `updateCommunityPostAction`,
  `softDeleteCommunityPostAction`, `toggleCommunityPostLikeAction`,
  `createCommunityPostCommentAction`, `updateCommunityPostCommentAction`,
  `softDeleteCommunityPostCommentAction`, `reportCommunityContentAction`,
  `moderateCommunityContentAction`, `dismissCommunityReportAction`. Each resolves
  the caller's tenant/role via `resolveScopedFeedContext()` (already written) and
  never trusts client-supplied identity.
- `src/lib/community-feed/hooks.ts` (**new**) — TanStack Query v5 hooks:
  `useInfiniteQuery` for the cursor-paginated feed and offset-paginated comments,
  an optimistic like/unlike mutation with cache rollback on failure, and
  mutation hooks for every action above, wired to the correct cache invalidation.
- `src/lib/community-feed/formatters.ts` (**new**) — Indonesian relative-time,
  file-size, and compact-count formatting (`formatCommunityTimeAgo`,
  `formatCommunityFileSize`, `formatCommunityCount`).
- `src/lib/community-feed/schemas.ts` (**edited**, additive) — exported the Zod
  `z.infer` input types the new Server Actions and hooks need.
- `src/lib/community-feed/query-keys.ts` (**edited**, additive) — added
  `getCommunityFeedMutationInvalidationKeys()`.

**Unchanged / audited as correct**: `constants.ts`, `types.ts`, `errors.ts`,
`storage.ts`, `repository.ts`, `queries.ts`, `http.ts`, and the existing read-only
API routes (`GET /api/community-feed`, `GET .../posts/[postId]/comments`,
`GET .../moderation`, `GET .../media/[mediaId]`, `POST`/`DELETE .../upload`).

## 5. Frontend — Resident UI (`/resident/feed`)

> **Deviation from the literal spec**: the task asked for the route
> `/warga/feed`. This codebase has no `/warga` prefix anywhere — every resident
> page lives under the existing `(resident)/resident/*` route group (e.g.
> `/resident/bills`, `/resident/complaints`). To honor "use existing ... navigation
> conventions" and "reuse existing architecture," the feature was implemented at
> **`/resident/feed`** instead.

New files under `src/components/community-feed/`:
`resident-community-feed-view.tsx`, `community-post-card.tsx`,
`community-comment-section.tsx`, `community-comment-item.tsx`,
`community-post-composer-dialog.tsx` (create + edit, multi-image
select/preview/remove, upload with orphan cleanup on failure),
`community-post-delete-dialog.tsx`, `community-report-dialog.tsx`,
`community-feed-skeletons.tsx`.

Implements every item in Phase 3/4/5 of the spec: chronological feed, avatar +
display name + staff badge, timestamp, multi-image grid, caption, like/unlike
(optimistic), comment count, 2-comment preview with "view all" expansion,
paginated comment thread, "load more posts," empty state, loading skeleton,
error state with retry, mobile-responsive layout, create/edit/delete own post,
multi-image upload (max 4, 5 MiB each, JPEG/PNG/WebP) with preview/remove before
publish, edit/delete own comments, and report post/comment with reason category.

**Navigation** (additive, nothing removed):
- `src/components/resident/resident-nav-config.ts` — added "Feed" item.
- `src/components/resident/resident-bottom-nav.tsx` — grid widened from 5→6
  columns to fit the new item.
- `src/components/resident/resident-dashboard-view.tsx` — added a "Feed
  Komunitas" quick-action tile.

## 6. Frontend — Backoffice Moderation UI (`/komunitas`)

- `src/app/(admin)/komunitas/page.tsx` (**new**), role-gated to
  `ketua_rt`/`sekretaris`/`pengurus` (redirects to `/no-access` otherwise, same
  pattern as other admin pages).
- `src/components/community-feed/admin-community-moderation-view.tsx` (**new**) —
  three tabs: **Laporan** (pending reports with hide/dismiss actions and a
  content preview), **Semua Postingan** (every post with hide/restore), and
  **Riwayat Moderasi** (audit trail).
- `community-moderate-hide-dialog.tsx`, `community-moderate-row-actions.tsx`
  (restore + dismiss buttons) (**new**).
- `src/components/layout/nav-config.ts` (**edited**) — added "Feed Komunitas" to
  the flat nav list and the "Informasi & Komunikasi" sidebar group (role-gated),
  plus route-title/breadcrumb entries for `/komunitas`.

## 7. Security Checklist (Phase 7)

| Requirement | How it's enforced |
|---|---|
| Tenant identity from trusted server context | `resolveScopedFeedContext()` derives tenant/role from the authenticated session's real memberships, never from client input |
| Never trust client-provided IDs | Every RPC re-resolves `member_id` from `auth.uid()`; client-supplied `tenant_id` is checked against real membership, not assumed |
| Tenant-scoped RLS on all new tables | Confirmed via automated DB-security test (see §9) |
| Storage policies enforced | Confirmed via automated DB-security test |
| Server-side mutation validation | Zod schemas (API/Action layer) **and** RPC-level checks (defense in depth) |
| No cross-tenant content access | Composite FKs + RLS + verified by test |
| Residents can't moderate others' posts | `canModerateCommunityFeed()` + RPC role check, `bendahara` explicitly excluded |
| No private resident data exposed | Author lookup RPC returns only display name + staff badge (zero PII) |
| Oversized/abusive upload protection | 5 MiB bucket limit, MIME allow-list, magic-byte verification, 4-image cap, caption/comment length caps |

## 8. Build & Static Checks

```
npm run typecheck   → PASS (tsc --noEmit, no errors)
npm run lint        → PASS (eslint, no errors)
npm run build       → PASS (next build succeeded; /resident/feed and /komunitas
                      both compiled as partial-prerender routes alongside all
                      other existing routes)
```

A smoke check against the already-running local dev server confirmed both new
routes respond `307` (auth redirect) with no server error.

## 9. Automated Tests

### New: `tests/community-feed/`

- **`community-feed.unit.test.mjs`** — 11/11 pass. Pure-function coverage: the
  moderation role matrix, every Zod schema's validation boundaries (empty
  post, caption length, media count/size/MIME, comment length, report
  categories, moderation reason requirement), storage path scoping helpers,
  binary magic-byte MIME detection (including rejecting a PDF disguised as a
  PNG), Postgres-error-to-action-result mapping, formatters, and query-key
  invalidation shape.
- **`community-feed-db-security.test.mjs`** — **1/1 pass, run against the real
  local Supabase instance** (not mocked): direct-DML denial, tenant isolation
  (cross-tenant `SELECT` returns 0 rows), `create_community_post` validation
  and ownership checks, author-only edit/delete, like toggle + duplicate-like
  prevention (both RPC idempotency and the DB unique constraint) + cross-tenant
  rejection, comment create/reply/author-only edit/delete, reporting (no
  self-report, duplicate-pending-report rejection, staff-only report
  visibility), the full moderation permission matrix (`ketua_rt`/`sekretaris`/
  `pengurus` allowed; `bendahara`/`warga`/other-tenant/`super_admin` all denied
  with `42501`) including hide→restore visibility toggling and automatic report
  resolution, `dismiss_community_report` permission matrix, private
  `community-media` storage path scoping (cross-member upload denied,
  pre-publish orphan visible only to the uploader, published-post media visible
  tenant-wide but never cross-tenant), and audit-log completeness.
- `helpers/load-community-feed-modules.mjs` — TS→CJS transpile loader, matching
  the existing `tests/activities/helpers/...` convention exactly.

Run with:
```
node --test tests/community-feed/community-feed.unit.test.mjs
node --test tests/community-feed/community-feed-db-security.test.mjs
```
(The DB-security test requires Node 22+ for native `WebSocket` support in
`@supabase/realtime-js`, and the local Supabase stack running via `supabase
start`. Both were available in this session.)

### Updated existing tests

Four pre-existing bottom-nav tests hard-coded "exactly 5 slots." Adding the Feed
item deliberately changes that to 6, so these were updated to match (not
loosened, just re-baselined):
`tests/activities/activities-resident.ui.test.mjs`,
`tests/complaints/complaints.ui.test.mjs`,
`tests/letters/letters.ui.test.mjs`,
`tests/ronda/ronda.ui.test.mjs`. All 4 now pass.

### Full existing suite re-run

`node --test tests/**/*.test.mjs` (Node 22): **86 pass / 10 fail** before the
4 nav fixes above; **90 pass / 6 fail** after. The remaining 6 failures
(`Step 12.2`, `13.2`, `14.2`, `15.2`, `15.3`, `15.4` — ronda, complaints, letters,
and activities integration/SSR suites) are **pre-existing and unrelated to this
work**: each spawns its own `next start` test server and fails the very first
authenticated request with `401` instead of the expected `403`/`200`, before any
feature-specific logic runs. Verified:
- Reproducible in isolation (not test-order flakiness).
- None of the files touched in this session (`nav-config.ts`,
  `resident-nav-config.ts`, `resident-bottom-nav.tsx`,
  `resident-dashboard-view.tsx`, everything under `community-feed/`) touch auth,
  session, cookies, or middleware.
- Consistent with an environment/config issue (e.g. a Supabase key or session
  mismatch for the spawned test server) that predates this session.

This was **not fixed** — it's outside the scope of the Community Feed task and
touches shared auth infrastructure used by every feature. It's flagged here per
"report tests that could not be executed/passed," not silently ignored.

## 10. Remaining Blockers / Not Done

1. **Pre-existing, unrelated test-environment issue** (see §9) affecting
   activities/complaints/letters/ronda integration suites — needs separate
   investigation, not caused by and not fixed by this work.
2. **No interactive browser walkthrough** was performed in this session (no
   browser-automation tool was invoked). The feature was verified via: real
   Postgres/RLS/RPC integration test, unit tests, `tsc`/`eslint`/`next build`,
   and an HTTP smoke check against the live dev server. A manual click-through
   (create post with photos, like, comment, report, and the Backoffice
   moderation flow) is recommended before shipping.
3. **Route path deviates from the literal spec** (`/resident/feed` instead of
   `/warga/feed`) — see §5 rationale.

## 11. Changed Files

**Database**
- `supabase/migrations/20261116002500_create_community_feed.sql` (pre-existing,
  audited)

**Backend (new)**
- `src/app/actions/community-feed.ts`
- `src/lib/community-feed/hooks.ts`
- `src/lib/community-feed/formatters.ts`

**Backend (edited, additive only)**
- `src/lib/community-feed/schemas.ts`
- `src/lib/community-feed/query-keys.ts`

**Backend (pre-existing, audited only — not modified)**
- `src/lib/community-feed/{constants,types,errors,storage,repository,queries,http}.ts`
- `src/app/api/community-feed/{route.ts, upload/route.ts, moderation/route.ts, media/[mediaId]/route.ts, posts/[postId]/comments/route.ts}`

**Frontend — resident (new)**
- `src/app/(resident)/resident/feed/page.tsx`
- `src/components/community-feed/{resident-community-feed-view,community-post-card,community-comment-section,community-comment-item,community-post-composer-dialog,community-post-delete-dialog,community-report-dialog,community-feed-skeletons}.tsx`

**Frontend — admin (new)**
- `src/app/(admin)/komunitas/page.tsx`
- `src/components/community-feed/{admin-community-moderation-view,community-moderate-hide-dialog,community-moderate-row-actions}.tsx`

**Navigation (edited, additive only)**
- `src/components/resident/resident-nav-config.ts`
- `src/components/resident/resident-bottom-nav.tsx`
- `src/components/resident/resident-dashboard-view.tsx`
- `src/components/layout/nav-config.ts`

**Tests (new)**
- `tests/community-feed/community-feed.unit.test.mjs`
- `tests/community-feed/community-feed-db-security.test.mjs`
- `tests/community-feed/helpers/load-community-feed-modules.mjs`

**Tests (edited — slot-count re-baseline only)**
- `tests/activities/activities-resident.ui.test.mjs`
- `tests/complaints/complaints.ui.test.mjs`
- `tests/letters/letters.ui.test.mjs`
- `tests/ronda/ronda.ui.test.mjs`
