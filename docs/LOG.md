# AutoCertif — Project Log

## Current State
**Phase:** Phase 4 — Template Upload & Storage  
**Status:** PHASE 4 COMPLETE & ACCEPTED — ALL CANONICAL GATES AND LIVE SUPABASE STORAGE E2E PASSED

## Confirmed Product Decisions
- Product: AutoCertif — `Certificate Generator` System
- Single organization
- Single ADMIN account
- Approximate batch size: 100 participants
- One certificate per participant per batch
- Single-page template
- Template formats: PDF, PNG, JPG
- Only dynamic certificate field in MVP: participant name
- CSV required field: `name`
- No generated certificate number/ID rendered by the system
- Duplicate names: warning only; ADMIN may proceed
- Participant CRUD after import: allowed
- Batch-level publish/unpublish
- Public search: name only, partial, case-insensitive
- Public download without login
- Oversized names: shrink, then wrap to maximum two lines
- Per-participant generation failure isolation
- Failed participant names must be shown to ADMIN
- Individual and whole-batch regeneration
- Published participant edit keeps previous successful file live until replacement succeeds
- Single ADMIN provisioned manually/seed/config
- No forgot-password flow in MVP
- Soft deletion
- Unpublished direct public route: not-found
- Admin UI: clean, functional, minimal, desktop-first
- Public UI: minimal, professional, responsive, search-centric
- Template editor: draggable participant-name field only
- Deployment stack: Vercel + Supabase PostgreSQL + Supabase Storage + Inngest
- Package manager/runtime command entrypoint: Bun
- Core E2E flow is required

## Font Decision
Product requirement is that the generated participant name follows the template's font appearance.

Engineering interpretation:
- do not assume arbitrary PDF embedded fonts can be automatically extracted/reused
- generation uses a deterministic font asset configured/available for the template
- if a template requires a custom font, the matching font asset must be available before generation

## Completed
- Project dependencies installed by project owner.
- `ui-ux-promax` skill installed by project owner.
- `anti-slop` skill installed by project owner.
- Product/system requirement clarification completed.
- Harness documents prepared:
  - `AGENTS.md`
  - `docs/PRD.md`
  - `docs/FSD.md`
  - `docs/LOG.md`
- Phase 0 repository baseline and verification gates completed.
- Phase 1 database domain foundation established:
  - Dependencies aligned to stable Prisma ORM 7 (`prisma@7.10.0`, `@prisma/client@7.10.0`, `@prisma/adapter-pg@7.10.0`, `pg@^8.23.0`, `@types/pg@^8.23.1`).
  - Prisma 7 configuration established in `prisma.config.ts` using `defineConfig` and `DIRECT_URL`.
  - Domain models and enums created in `prisma/schema.prisma` with explicit client generator output `../generated/prisma`.
  - Database safety preflight executed: target database confirmed empty, shadow-database diffing verified.
  - Initial migration `20260925154353_init_domain_foundation` created and applied to Supabase PostgreSQL without destructive actions.
  - Prisma Client generated to `generated/prisma`.
  - Reusable singleton runtime client implemented in `lib/prisma.ts` using `@prisma/adapter-pg` over `DATABASE_URL`.
  - End-to-end runtime database query verified.
- Phase 2 ADMIN authentication foundation established:
  - User model extended with `passwordHash String` in `prisma/schema.prisma`.
  - Preflight confirmed target `users` table had 0 rows.
  - Migration `20260925224810_add_user_password_hash` generated and applied to Supabase PostgreSQL.
  - Installed `bcryptjs@3.0.3` (bundled types); created `lib/password.ts` with 12-char minimum and 72-byte truncation protection.
  - Implemented NextAuth v4 Credentials provider in `lib/auth.ts` with JWT session strategy exposing `{ id, email, role: 'ADMIN' }`.
  - Type declarations augmented in `types/next-auth.d.ts`.
  - NextAuth route handler exposed at `app/api/auth/[...nextauth]/route.ts`.
  - Next.js 16 `proxy.ts` implemented at root for optimistic route UX protection (`/admin` -> `/login`).
  - Created deterministic server-side authorization guard `requireAdmin()` and `getAdminSession()` in `lib/auth/guard.ts`.
  - Implemented accessible, minimal login interface (`app/login/page.tsx`, `app/login/login-form.tsx`) and protected verification admin page (`app/admin/page.tsx`, `app/admin/logout-button.tsx`).
  - Created idempotent, conflict-safe provisioning script in `scripts/provision-admin.ts` (`bun run admin:provision`).
  - Configured Vitest (`vitest.config.mts`) and Playwright (`playwright.config.ts`).
  - Created unit tests (`tests/unit/password.test.ts`, `tests/unit/credentials-validation.test.ts`, `tests/unit/auth-guard.test.ts`) and Playwright E2E spec (`tests/e2e/auth.spec.ts`).
  - Executed all 8 canonical verification gates.
- Phase 3 ADMIN Shell + Batch CRUD established:
  - Inspected existing `CertificateBatch` domain model; confirmed zero schema migrations needed.
  - Created reusable admin layout in `app/admin/layout.tsx` featuring AutoCertif branding, Batches navigation, ADMIN identity, and LogoutButton, wrapped in server-side authorization guard.
  - Updated `app/admin/page.tsx` to redirect cleanly to `/admin/batches`.
  - Implemented deterministic UTC date formatter in `lib/date.ts` to ensure hydration-safe rendering.
  - Implemented reusable Zod validation schema in `lib/validations/batch.ts` enforcing whitespace trimming, 1-150 character bounds, blank name rejection, duplicate name allowance, and client field stripping.
  - Implemented core CertificateBatch query and mutation module in `lib/batches.ts` (`getActiveBatches`, `getActiveBatchById`, `createBatch`, `updateBatchName`, `softDeleteBatch`), enforcing `requireAdmin()` on every operation and soft-deletion via `deletedAt`.
  - Implemented secure Server Actions in `app/admin/batches/actions.ts` (`createBatchAction`, `updateBatchNameAction`, `deleteBatchAction`) with safe redirect dispatching outside try/catch.
  - Implemented BatchStatusBadge component in `components/batch-status-badge.tsx` cleanly representing `DRAFT`, `READY`, `GENERATING`, `GENERATED`, `PUBLISHED`, and `FAILED` lifecycle states.
  - Implemented Batches list page with active filtering (`deletedAt: null`), newest-first ordering, responsive table layout, and clear empty state in `app/admin/batches/page.tsx` and `app/admin/batches/loading.tsx`.
  - Implemented Create Batch page and form in `app/admin/batches/new/page.tsx` and `create-batch-form.tsx` with accessible validation feedback and pending states.
  - Implemented Batch Detail and Edit page in `app/admin/batches/[batchId]/page.tsx`, `edit-batch-form.tsx`, `delete-batch-dialog.tsx`, and `not-found.tsx` for missing/soft-deleted records.
  - Created comprehensive unit tests: `tests/unit/batch-validation.test.ts` (7 tests) and `tests/unit/batch-service.test.ts` (8 tests).
  - Created comprehensive Playwright E2E spec in `tests/e2e/batch-crud.spec.ts` validating complete lifecycle (create, view, edit name, soft-delete, not-found check) and responsive desktop/mobile viewports with 0 horizontal overflow.
  - Executed all 8 canonical verification gates.
- Phase 4 Template Upload & Storage established:
  - Installed `@supabase/supabase-js@2.117.2`; verified existing `pdf-lib` and `sharp` installations.
  - Zero database migrations required; confirmed all Phase 5 fields on `CertificateTemplate` are nullable in schema.
  - Established storage architecture separating server-only client (`lib/storage/server.ts`) and browser direct upload client (`lib/storage/client.ts`).
  - Configured technical maximum file size to 10 MB (10,485,760 bytes) and defined allowed MIME types (`application/pdf`, `image/png`, `image/jpeg`) in `lib/storage/constants.ts`.
  - Created idempotent setup and validation script in `scripts/setup-storage.ts` enforcing `public: false`, 10 MB limit, and exact MIME coverage.
  - Implemented authoritative byte validation in `lib/validations/template-file.ts`: single-page PDF enforcement via `pdf-lib`, image dimension & format decoding via `sharp`, format mismatch rejection, and path sanitization.
  - Implemented template domain service in `lib/templates.ts`:
    - `initiateTemplateUpload`: requires admin, validates DRAFT status, generates collision-resistant object path `templates/{batchId}/{uuid}.{ext}`, issues signed upload URL with `{ upsert: false }`.
    - `finalizeTemplateUpload`: requires admin, re-verifies DRAFT status, validates storage path namespace, authoritatively validates downloaded bytes, executes atomic Prisma transaction with optimistic concurrency check (`updateMany` on `status === 'DRAFT'` and `templateId === expectedTemplateId`), soft-deletes old template only if unreferenced by other active batches, and executes compensating cleanup on storage if byte validation or transaction fails.
    - `getTemplatePreviewSignedUrl`: generates 5-minute signed read URL for private template preview.
  - Exposed authenticated API route handlers in `app/api/admin/batches/[batchId]/template/{initiate,finalize,preview}/route.ts`.
  - Created accessible interactive client component `TemplateSection` in `app/admin/batches/[batchId]/template-section.tsx` with upload dropzone, direct storage upload, validation spinner, short-lived preview, and replacement confirmation modal. Integrated cleanly into `app/admin/batches/[batchId]/page.tsx`.
  - Configured `serverExternalPackages: ["sharp", "pdf-lib"]` in `next.config.ts`.
  - Added unit tests:
    - `tests/unit/template-validation.test.ts` (21 tests: PDF single-page/multi-page/corrupt, PNG, JPEG, format mismatch, path namespace, sanitization).
    - `tests/unit/template-service.test.ts` (14 tests: auth guards, DRAFT check, compensating cleanup, concurrency guard, multi-batch reference preservation, preview generation).
  - Added Playwright E2E spec in `tests/e2e/template-upload.spec.ts` testing batch detail template UI rendering, client validation, and graceful skipping when live storage credentials are not provided.
  - Updated `.env.example` with clear documentation for server-only (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`) and browser-safe (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) storage variables.

## Verification Gate Results
- `PASS` — `bun run storage:setup` (Verified live `certificate-templates` bucket: exists, public=false, file_size_limit=10485760, exact allowed MIME types)
- `PASS` — `bun run prisma validate` (Prisma schema valid)
- `PASS` — `bun run prisma generate` (Generated Prisma Client 7.10.0 to `generated/prisma`)
- `PASS` — `bun run prisma migrate status` ("2 migrations found in prisma/migrations, Database schema is up to date!")
- `PASS` — `bun run typecheck` (`tsc --noEmit` exited with code 0)
- `PASS` — `bun run lint` (`eslint` exited with code 0, 0 errors, 0 warnings)
- `PASS` — `bun run test` (`vitest run` exited with code 0: 7 test files passed, 64 tests passed)
- `PASS` — `bun run test:e2e` (`playwright test` exited with code 0: all 8 tests passed, 0 skipped, 0 failed across auth, batch-crud, and template-upload)
- `PASS` — `bun run build` (`next build` Turbopack exited with code 0, all routes generated cleanly)
- `PASS` — Live Supabase Storage E2E (`tests/e2e/template-upload.spec.ts:104` passed with real Supabase Storage private bucket)

## Stack & Baseline Findings
- **Runtime / Package Manager**: Bun v1.4.2 active (`bun.lock` present).
- **Application Framework**: Next.js 16.3.6 (Turbopack, App Router) + React 19.2.8 + Tailwind CSS v4. Production build passes cleanly with `serverExternalPackages: ["sharp", "pdf-lib"]`.
- **Authentication**: NextAuth 4.24.15 (Credentials provider, JWT session strategy, App Router native route handler, `proxy.ts` with `getToken`).
- **Canonical Secret**: `AUTH_SECRET` configured for both NextAuth and Proxy token inspection.
- **Password Hashing**: `bcryptjs` with work factor 12, 12-char minimum length enforcement, and 72-byte max boundary check.
- **Authorization Guard**: `requireAdmin()` primitive in `lib/auth/guard.ts`.
- **Storage Integration**: `@supabase/supabase-js@2.117.2` for signed upload URL generation and private bucket asset management.
- **Database / Prisma Setup**:
  - Prisma ORM: `7.10.0`
  - Applied Migrations:
    1. `20260925154353_init_domain_foundation`
    2. `20260925224810_add_user_password_hash`
  - Zero new migrations required for Phase 4.

## Next Action
1. Proceed to **Phase 5 — Name Position Editor** according to `docs/PRD.md` and `docs/FSD.md`.

## Open Issues
- None. Phase 4 is fully verified and accepted against live Supabase Storage and PostgreSQL infrastructure.

## History

### 2026-09-26 — Phase 4 Live Storage Verification Remediation & Full Acceptance
- Verified local live environment credentials for `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` without exposing secret values.
- Executed `bun run storage:setup`: verified private `certificate-templates` bucket with `public: false`, `file_size_limit: 10485760` (10 MB), and exact allowed MIME types (`application/pdf`, `image/png`, `image/jpeg`).
- Confirmed unauthenticated public HTTP requests to storage objects return 400 (access denied).
- Updated `tests/e2e/template-upload.spec.ts` with direct `pg` pool and `@supabase/supabase-js` verification, eliminating ESM/server-only module boundary issues in Node test runner.
- Resolved React 19 / ESLint `react-hooks/set-state-in-effect` rule in `TemplateSection` client component.
- Executed full live Phase 4 E2E test against real Supabase Storage:
  - ADMIN login and test-owned DRAFT batch creation.
  - Signed upload initiation and direct browser upload to Supabase Storage signed upload URL.
  - Server download, authoritative byte validation, metadata persistence, atomic assignment.
  - Verification that batch status remains DRAFT.
  - Secure signed private preview loading with valid `token` and correct Content-Type.
  - Rejection of invalid multi-page PDF candidate with actionable error banner and server compensating cleanup.
  - Verification that existing template remains intact after failed replacement.
  - Successful replacement with valid PNG image, soft-deletion of old DB template record, and storage preservation of previous valid file bytes.
  - Exact test-owned resource cleanup with zero broad bucket/database wiping.
- Executed all canonical gates: `storage:setup` (PASS), `typecheck` (PASS), `lint` (PASS), `test` (PASS, 64 tests), `test:e2e` (PASS, 8 tests), `build` (PASS). Phase 4 fully accepted.

### 2026-09-26 — Phase 4 Template Upload & Storage
- Implemented complete template-upload foundation without proxying file bytes through Vercel/Next.js request bodies.
- Established server storage client (`lib/storage/server.ts`) and client helper (`lib/storage/client.ts`).
- Created bucket constants: private `certificate-templates` bucket, 10 MB technical limit, PDF/PNG/JPEG MIME coverage.
- Implemented `scripts/setup-storage.ts` (`bun run storage:setup`) for idempotent bucket verification and mismatch detection.
- Built byte validation in `lib/validations/template-file.ts` with `pdf-lib` (single page required, dimension extraction) and `sharp` (format and dimension inspection).
- Built template service in `lib/templates.ts` enforcing `requireAdmin()`, DRAFT batch eligibility, unique non-overwrite storage paths (`{ upsert: false }`), optimistic concurrency checks, conditional soft-deletion of replaced templates, and compensating storage cleanup on failures.
- Exposed authenticated route handlers in `app/api/admin/batches/[batchId]/template/{initiate,finalize,preview}/route.ts`.
- Built `TemplateSection` component in `app/admin/batches/[batchId]/template-section.tsx` supporting dropzone, direct storage upload, progress indicator, signed preview (object/img), and replacement modal.
- Configured Next.js 16 Turbopack with `serverExternalPackages: ["sharp", "pdf-lib"]` in `next.config.ts`.
- Added 35 new unit tests (total: 64 tests across 7 test files, all passing).
- Added Playwright E2E spec in `tests/e2e/template-upload.spec.ts`.

### 2026-09-26 — Phase 3 ADMIN Shell + Batch CRUD
- Inspected existing `CertificateBatch` Prisma model and confirmed fields (`id`, `name`, `templateId`, `status`, `publishedAt`, `createdAt`, `updatedAt`, `deletedAt`); verified zero database migrations needed.
- Built reusable Admin shell layout in `app/admin/layout.tsx` with AutoCertif branding, Batches navigation link, authenticated ADMIN role and email badges, and `<LogoutButton />`. Server-side authorization enforced via `getAdminSession()`.
- Updated `app/admin/page.tsx` to automatically redirect to `/admin/batches`.
- Created `lib/date.ts` with deterministic UTC date formatter preventing hydration mismatches.
- Created `lib/validations/batch.ts` implementing `batchInputSchema` and `batchNameSchema` with whitespace trimming, 1-150 character bounds, blank-name rejection, and non-unique duplicate name allowance.
- Implemented `lib/batches.ts` defining `getActiveBatches`, `getActiveBatchById`, `createBatch`, `updateBatchName`, `softDeleteBatch`, and custom `BatchNotFoundError`. Enforced `requireAdmin()` on every entrypoint and soft-deletion via `deletedAt = new Date()`.
- Implemented `app/admin/batches/actions.ts` exposing Server Actions (`createBatchAction`, `updateBatchNameAction`, `deleteBatchAction`) with safe redirection handling.
- Implemented `components/batch-status-badge.tsx` rendering badges for `DRAFT`, `READY`, `GENERATING`, `GENERATED`, `PUBLISHED`, and `FAILED`.
- Implemented active Batches list page at `app/admin/batches/page.tsx` (and `loading.tsx`) with empty state guidance.
- Implemented Create Batch route at `app/admin/batches/new/page.tsx` and client form `create-batch-form.tsx`.
- Implemented Batch Detail and Edit route at `app/admin/batches/[batchId]/page.tsx`, `edit-batch-form.tsx`, `delete-batch-dialog.tsx`, and `not-found.tsx`.
- Created unit tests `tests/unit/batch-validation.test.ts` (7 tests) and `tests/unit/batch-service.test.ts` (8 tests).
- Created Playwright E2E spec `tests/e2e/batch-crud.spec.ts` (2 tests) verifying complete batch CRUD lifecycle and responsive desktop/mobile layouts without horizontal overflow.
- Executed all 8 canonical verification gates; all passed cleanly.

### 2026-09-26 — Phase 2 ADMIN Authentication
- Verified `User` table row count (0 rows) prior to schema changes.
- Extended `User` model in `prisma/schema.prisma` with `passwordHash String`.
- Generated and applied migration `20260925224810_add_user_password_hash` via `prisma migrate dev`.
- Added `bcryptjs@3.0.3` dependency (using bundled TypeScript declarations).
- Implemented `lib/password.ts` with minimum 12-character length requirement, maximum 72-byte limit to prevent bcrypt truncation vulnerabilities, and salt work factor 12.
- Created `lib/auth.ts` configuring NextAuth Credentials provider, Zod credentials validation pipeline (trimming and lowercasing email), user lookup, and JWT session callbacks.
- Configured single canonical `AUTH_SECRET` across `authOptions` and `proxy.ts`.
- Implemented `types/next-auth.d.ts` module augmentation for `User`, `Session`, and `JWT`.
- Exposed App Router route handler at `app/api/auth/[...nextauth]/route.ts`.
- Implemented Next.js 16 `proxy.ts` for optimistic route UX protection (`/admin` -> `/login?callbackUrl=...`, and authenticated redirect from `/login` -> `/admin`).
- Created server-side authorization primitive `requireAdmin()` and non-throwing `getAdminSession()` in `lib/auth/guard.ts`.
- Created accessible, clean login interface (`app/login/page.tsx` and `app/login/login-form.tsx`) with generic invalid-credentials feedback.
- Created protected admin proof-of-auth page (`app/admin/page.tsx`) with `<LogoutButton />` (`app/admin/logout-button.tsx`).
- Created idempotent, conflict-safe provisioning script `scripts/provision-admin.ts` (`bun run admin:provision`).
- Created `vitest.config.mts` and unit tests:
  - `tests/unit/password.test.ts` (6 tests: length, 72-byte truncation, hash/verify, distinct salts)
  - `tests/unit/credentials-validation.test.ts` (4 tests: email trimming/lowercasing, format validation, empty password rejection)
  - `tests/unit/auth-guard.test.ts` (4 tests: unauthenticated rejection, non-ADMIN rejection, ADMIN identity return)
- Created `playwright.config.ts` and E2E test spec `tests/e2e/auth.spec.ts`.
- Provisioned local ADMIN account via `bun run admin:provision` (`admin@autocertif.local`).
- Verified database holds exactly 1 ADMIN record with valid hash and no duplicates.
- Executed `bun run test:e2e`: all 4 tests passed with 0 skips, fully validating unauthenticated redirects, accessible form rendering, generic error responses, valid ADMIN login, session-based redirect from `/login` to `/admin`, and complete logout flow.
- Executed all 8 canonical verification gates: all passed cleanly.

### 2026-09-25 — Phase 1 Database Domain Foundation
- Resolved Prisma configuration: fixed `prisma.config.ts` to use `defineConfig` from `prisma/config` with `dotenv/config`.
- Installed `@prisma/adapter-pg@7.10.0` and `pg@^8.23.0`, added `@types/pg` devDependency.
- Created `prisma/schema.prisma` with 5 domain models (`User`, `CertificateTemplate`, `CertificateBatch`, `Participant`, `Certificate`) and 4 enums (`UserRole`, `TemplateFileType`, `BatchStatus`, `CertificateStatus`).
- Configured generator output to filesystem-relative `../generated/prisma`.
- Applied business invariants: non-unique participant names, 1:1 participant certificate uniqueness, composite `[participantId, batchId]` foreign key to prevent cross-batch contamination, non-destructive `onDelete: Restrict` / `SetNull`.
- Executed database safety preflight: confirmed target database was completely empty (`P4001`) and shadow-database diffing succeeded.
- Generated and applied initial migration `20260925154353_init_domain_foundation` to Supabase PostgreSQL without reset prompts or data loss.
- Created singleton runtime client in `lib/prisma.ts` with connection pooling over `DATABASE_URL`.
- Verified live database query over transaction pooler (`prisma.user.findMany()`).
- Updated `package.json` postinstall script to `prisma generate`.
- Executed all canonical gates: `prisma -v` (PASS), `prisma validate` (PASS), `prisma migrate status` (PASS), `prisma generate` (PASS), `typecheck` (PASS), `lint` (PASS), `build` (PASS), `test` (NOT VERIFIED), `test:e2e` (NOT VERIFIED).

### 2026-09-25 — Phase 0 Repository Baseline
- Audited repository against approved engineering stack and PRD/FSD specifications.
- Verified Bun 1.4.2 runtime and existing Next.js 16 / React 19 / Tailwind CSS v4 setup.
- Added canonical verification scripts (`typecheck`, `test`, `test:e2e`) to `package.json`.
- Added direct `vitest@5.0.1` devDependency via Bun matching `bun.lock` transitive resolution.
- Updated `eslint.config.mjs` to ignore agent tooling scripts (`.agents/**`, etc.).
- Created safe `.env.example` referencing repository-verified database keys (`DATABASE_URL`, `DIRECT_URL`, optional helper `DB_PASSWORD`) and comment placeholders for Phase 2 (Auth.js), Phase 4 (Supabase Storage), and Phase 9 (Inngest).
- Executed all 5 canonical gates: `typecheck` (PASS), `lint` (PASS), `build` (PASS), `test` (NOT VERIFIED - no test files), `test:e2e` (NOT VERIFIED - no test files).
- Preserved strict Phase 0 boundaries (no Phase 1+ product functionality implemented).

### 2026-09-25 — Harness Baseline
- Locked MVP scope after product clarification.
- Defined source-of-truth boundaries.
- Defined background generation and failure-isolation rules.
- Defined deterministic name fitting and two-line fallback.
- Defined published-certificate safe replacement behavior.
- Defined public name-search behavior.
- Defined mandatory core E2E coverage.
