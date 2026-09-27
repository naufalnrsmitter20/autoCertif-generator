# AutoCertif — Project Log

## Current State
**Phase:** Phase 13 — Public Certificate Preview & Download  
**Status:** PHASE 13 COMPLETE & ACCEPTED — ALL CANONICAL GATES, 37 TEST FILES (396 TESTS), LIVE STORAGE & POSTGRESQL INTEGRATION, PLAYWRIGHT E2E, AND TURBOPACK PRODUCTION BUILD PASSED

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
- Phase 5 Name Position Editor established:
  - Installed `pdfjs-dist@6.3.289` for deterministic client-side PDF canvas rendering without CDN dependencies.
  - Created automated build and postinstall worker copy script `scripts/copy-pdf-worker.ts` copying identical worker version to `public/pdf.worker.min.mjs`.
  - Added SMK Telkom Malang brand theme tokens to `app/globals.css` applied strictly to outer UI surfaces without modifying certificate template media.
  - Implemented strictly spatial `NamePlacement` contract and validation in `lib/coordinates.ts`:
    - Top-left origin $(0, 0)$, normalized center anchor $(xRatio, yRatio)$.
    - Validation bounds: $0.1 \le maxWidthRatio \le 1.0$, $xRatio \in [\frac{maxWidthRatio}{2}, 1 - \frac{maxWidthRatio}{2}]$, and $yRatio \in [0.0, 1.0]$. Fixed invariant `alignment: "center"`.
    - Pure coordinate conversion helpers: `recomputeXBounds`, `clampPlacement`, `toNormalizedPlacement`, `toPixelPlacement`.
  - Implemented `updateTemplatePlacement` in `lib/templates.ts` with atomic transaction and optimistic concurrency guard: verifying batch `DRAFT` status, un-deleted state, and exact matching `batch.templateId === submittedTemplateId`, raising `StaleTemplateConflictError` (HTTP 409) if concurrent replacement occurred.
  - Updated `getActiveBatchById` in `lib/batches.ts` to include `namePlacement: true`.
  - Implemented authenticated REST API route at `app/api/admin/batches/[batchId]/template/position/route.ts` with Zod input validation, proper 401/404/400/409 error mapping.
  - Implemented full visual position editor page at `app/admin/batches/[batchId]/position/page.tsx` and interactive client editor in `app/admin/batches/[batchId]/position/position-editor-client.tsx`:
    - Mozilla PDF.js canvas renderer using local worker for PDF templates; responsive image element for PNG/JPG templates.
    - Pointer capture drag & drop with normalized center anchoring and live bounds clamping.
    - Keyboard positioning with Arrow keys (1% step) and Shift+Arrow (5% step).
    - Maximum width slider ($10\% - 100\%$) with immediate horizontal re-clamping.
    - Live coordinate readouts ($X$, $Y$, $Width$ in percentages).
    - Reset and Save buttons with pending feedback, success notifications, and 409 conflict dialog.
  - Updated `TemplateSection` (`app/admin/batches/[batchId]/template-section.tsx`) with "Configure Name Position" / "Edit Name Position" link and placement status badges.
  - Zero database migrations required; batch status remains `DRAFT`.
  - Font asset configuration cleanly recorded as Phase 7 prerequisite; dynamic font fitting deferred to Phase 8.
  - Created comprehensive unit tests:
    - `tests/unit/coordinates.test.ts` (15 tests: normalization, ratio bounds, $x$-clamping on width expansion, roundtrip conversion).
    - `tests/unit/template-placement-service.test.ts` (7 tests: admin authorization, draft requirement, atomic concurrency/stale check, coordinate saving).
    - Updated `tests/unit/batch-service.test.ts` (8 tests: namePlacement inclusion).
  - Created comprehensive Playwright E2E spec in `tests/e2e/position-editor.spec.ts`:
    - PDF full flow: template upload, position editor navigation, PDF.js canvas verification, pointer drag, width slider, keyboard adjustments, coordinate readout, persistence, page reload verification, mobile viewport responsiveness, and concurrent stale-template conflict rejection.
    - PNG smoke test: image template preview, placement adjustment, and persistence.
  - Executed all 8 canonical verification gates.
- Phase 6 CSV Import & Participant CRUD established:
  - Reused installed `papaparse` (5.5.3) and `@types/papaparse` (5.5.2) with Bun.
  - Implemented canonical name normalization function `normalizeParticipantName` and duplicate comparison key `duplicateKey` in `lib/participants/normalize.ts`:
    - Trims surrounding whitespace, collapses consecutive internal spaces, preserves legitimate case, accents, and punctuation.
    - Reused identically across CSV import preview, server confirmation, manual add, manual edit, and duplicate warning detection.
  - Implemented client-side CSV parser `parseCsvString` and `parseCsvFile` in `lib/participants/csv-parse.ts`:
    - Operates entirely in browser memory; raw CSV files are never persisted or uploaded to storage or DB blobs.
    - Strips UTF-8 BOM, requires exact `"name"` header, rejects unexpected extra columns with actionable error messages.
    - Deterministic 1-based data row numbering (Row 2 for first data row following header).
    - Classifies empty rows as errors, detects duplicate normalized names (within file and against DB) as non-blocking WARNINGS.
  - Implemented participant domain service in `lib/participants/service.ts`:
    - `getActiveParticipants`: fetches active participants ordered by `createdAt` ascending.
    - `importParticipants`: atomic Prisma `$transaction` bulk-creating normalized participants, server-revalidating every row.
    - `addParticipant`: validates and adds single participant.
    - `editParticipant`: validates and updates participant name.
    - `softDeleteParticipant`: sets `deletedAt = new Date()`.
    - Safety guard: operations require batch status `DRAFT`; safely halts with error if an active `Certificate` unexpectedly exists on the participant.
    - Product boundary preserved: importing participants does not alter batch lifecycle status (`DRAFT` remains `DRAFT`).
  - Implemented authenticated Server Actions in `app/admin/batches/[batchId]/participants/actions.ts` with `requireAdmin()`.
  - Built desktop-first, accessible, responsive participant management interface at `/admin/batches/[batchId]/participants`:
    - `CsvImportSection`: file picker, validation summary, preview table with warning/error badges, confirmation button.
    - `AddParticipantForm`: inline manual addition form with instant feedback.
    - `ParticipantTable`: active list, inline name editing, soft-delete confirmation dialog.
    - Cohesive SMK Telkom Malang brand styling (`bg-telkom-red`, `hover:bg-telkom-red-dark`, `text-charcoal`).
  - Created comprehensive unit tests:
    - `tests/unit/participant-normalize.test.ts` (15 tests: whitespace collapse, casing, accents, punctuation, validation).
    - `tests/unit/participant-csv-parse.test.ts` (23 tests: BOM handling, headers, extra columns, empty rows, duplicate detection).
    - `tests/unit/participant-service.test.ts` (31 tests: authorization, draft requirement, unexpected certificate guard, CRUD operations, transactions).
  - Created comprehensive Playwright E2E spec in `tests/e2e/participants.spec.ts`:
    - Complete flow: login, create batch, import CSV with duplicates, manual add, inline edit, soft-delete, persistence verification across page reload.
    - Responsive viewport verification: desktop and small mobile (375x667) with 0 horizontal overflow.
  - Executed all canonical verification gates.
- Phase 7 Single Certificate Engine established:
  - Installed `@pdf-lib/fontkit@1.1.1` as a standard dependency; verified clean Next.js 16 / Turbopack build without needing `serverExternalPackages` externalization.
  - Bundled static permissively licensed TrueType test font at `tests/fixtures/fonts/test-font.ttf` with full license notice (`tests/fixtures/fonts/LICENSE.txt`) explicitly labeled TEST-ONLY. Production font asset remains explicitly NOT CONFIGURED.
  - Implemented typed domain errors in `lib/rendering/errors.ts`:
    - `CertificateRenderError` (base error)
    - `FontNotConfiguredError`
    - `FontUnsupportedGlyphError` (carries unsupported character and full 32-bit Unicode code point)
    - `InvalidNamePlacementError`
    - `InvalidRenderStyleError`
    - `NameDoesNotFitError` (carries name, measured textWidth, maxWidth, fontSize)
    - `UnsupportedTemplateGeometryError`
    - `TemplateRenderError`
  - Implemented pure geometric transformations in `lib/rendering/geometry.ts`:
    - Normalized Top-Left $(xRatio, yRatio)$ to PDF Bottom-Left page space ($\text{centerX} = xRatio \times W$, $\text{centerYFromBottom} = (1 - yRatio) \times H$, $\text{maxWidth} = maxWidthRatio \times W$).
    - Typographic box centering baseline formula:
      $$\text{baselineY} = (1 - yRatio) \times H - \frac{ascent - descent}{2}$$
    - Horizontal start position: $\text{startX} = \text{centerX} - \frac{\text{textWidth}}{2}$.
    - Image DPI policy: valid source density $\ge 72$ and $\le 1200$ used directly; missing density defaults to 300 DPI technical fallback; effective points calculated as $(pixels \times 72) / dpi$; source metadata never overwritten.
    - Strict PDF geometry validation: zero rotation, matching CropBox/MediaBox with origin (0, 0), and UserUnit 1.0.
    - Image EXIF orientation validation: orientations $2..8$ rejected.
    - Explicit required style validation: `fontSize > 0`, `textColor` with RGB channels in $[0.0, 1.0]$.
  - Implemented font utilities in `lib/rendering/font.ts`:
    - Fontkit registration on `PDFDocument`.
    - Custom font embedding.
    - Full 32-bit Unicode code point glyph validation against `font.getCharacterSet()`.
    - Text width and typographic box metric measurement.
  - Implemented core rendering primitive `renderSingleCertificate` in `lib/rendering/engine.ts`:
    - PDF template branch (in-place artwork overlay, non-mutating source).
    - PNG and JPG image template branch (embedded edge-to-edge into newly created single-page PDF).
    - Pre-fitting single-line gate: throws `NameDoesNotFitError` when textWidth > maxWidth (zero auto-fitting, zero clipping).
    - Pure in-memory execution returning `Uint8Array` PDF bytes; zero Supabase storage upload; zero database record mutations.
  - Created barrel export in `lib/rendering/index.ts`.
  - Added comprehensive unit tests (42 new unit tests across 3 new test files, total 197 tests, all passing):
    - `tests/unit/rendering-geometry.test.ts` (20 tests)
    - `tests/unit/rendering-font.test.ts` (8 tests)
    - `tests/unit/rendering-engine.test.ts` (14 tests)
  - Executed Playwright E2E suite: all 12 tests passed across auth, batch-crud, participants, position-editor, and template-upload.
  - Executed all 8 canonical verification gates: all PASS.
- **Phase 9 — Bulk Generation & Inngest Background Orchestration established**:
  - Implemented dual generation identity (`CertificateBatch.currentGenerationKey` and `Certificate.generationKey`) protecting batch-level state transitions (`DRAFT -> GENERATING -> GENERATED`).
  - Generated and applied migration `20260926145009_add_generation_keys` to Supabase PostgreSQL.
  - Setup private Supabase Storage bucket `generated-certificates` with `uploadGeneratedCertificate` using path `certificates/{batchId}/{participantId}/{generationKey}.pdf` and `{ upsert: true }` retry semantics.
  - Built strict font configuration validation (`fontConfigSchema` via Zod) and controlled font registry (`resolveFontBytes`), enforcing production font NOT CONFIGURED invariant.
  - Implemented comprehensive preflight guards (`executeGenerationPreflight`) validating batch eligibility, template presence, geometry (PDF single-page, image EXIF orientation), font registry, fontConfig, active participants (>0), and normalized names.
  - Built atomic initialization transaction (`initializeGeneration`) with optimistic snapshot revalidation preventing stale mutations.
  - Implemented reusable, race-safe batch finalization helper (`checkAndFinalizeBatch`) enforcing dual generationKey match and conditional transition to `GENERATED` when all participant certificates reach terminal state.
  - Created Inngest background orchestration (`autocertif` client):
    - `generate-batch`: orchestrator function with retry 3, fan-out event ID deduplication (`gen-part-${cert.id}-${generationKey}`), and `onFailure` setting batch to `FAILED`.
    - `generate-participant`: worker function with concurrency 5, retry 3, atomic claim (`PENDING -> GENERATING`), in-memory PDF rendering & storage upload, explicit domain failure branching (`isParticipantDomainError`), `onFailure` retry exhaustion handler, and finalization check.
    - Native Next.js App Router Inngest route handler at `/api/inngest`.
  - Implemented authenticated API route (`/api/admin/batches/[batchId]/generation`) supporting initial trigger and narrow infrastructure recovery (`action: "resume"`).
  - Built desktop-first `GenerationSection` component with prerequisites checklist, trigger button, polling interval (3s), and resume button.
  - Created comprehensive unit test suite: 21 test files, 267 tests passing (including preflight, font-config, font-registry, initialization, finalization).
  - Created live Playwright E2E suite (`tests/e2e/generation.spec.ts`) validating prerequisites blocking and font guard preflight rejection against real database.

## Verification Gate Results
- `PASS` — `bun run prisma validate` (Prisma schema valid)
- `PASS` — `bun run prisma generate` (Generated Prisma Client 7.10.0 to `generated/prisma`)
- `PASS` — `bun run prisma migrate status` ("4 migrations found in prisma/migrations, Database schema is up to date!")
- `PASS` — `bun run typecheck` (`tsc --noEmit` exited with code 0)
- `PASS` — `bun run lint` (`eslint` exited with code 0, 0 errors, 1 pre-existing warning in verify script)
- `PASS` — `bun run test` (`vitest run` exited with code 0: 37 test files passed, 396 unit/integration tests passed)
- `PASS` — `bun run test:e2e tests/e2e/public-certificate.spec.ts` (`playwright test` exited with code 0: 2 passed)
- `PASS` — `bun run test:e2e tests/e2e/public-search.spec.ts` (`playwright test` exited with code 0: 2 passed)
- `PASS` — `bun run build` (`bun scripts/copy-pdf-worker.ts && next build` Turbopack exited with code 0, dynamic `/certificates/[certificateId]` and `/certificates/[certificateId]/download` compiled cleanly)

## Stack & Baseline Findings
- **Runtime / Package Manager**: Bun v1.4.2 active (`bun.lock` present).
- **Application Framework**: Next.js 16.3.6 (Turbopack, App Router) + React 19.2.8 + Tailwind CSS v4. Production build passes cleanly with `serverExternalPackages: ["sharp", "pdf-lib"]`.
- **Background Orchestration**: Inngest SDK (`inngest@^3.49.2`) with route handler at `app/api/inngest/route.ts`.
- **PDF Composition & Font Embedding**: `pdf-lib@1.17.1` + `@pdf-lib/fontkit@1.1.1` (deterministic server-side custom font embedding).
- **Authentication**: NextAuth 4.24.15 (Credentials provider, JWT session strategy, App Router native route handler, `proxy.ts` with `getToken`).
- **Canonical Secret**: `AUTH_SECRET` configured for both NextAuth and Proxy token inspection.
- **Password Hashing**: `bcryptjs` with work factor 12, 12-char minimum length enforcement, and 72-byte max boundary check.
- **Authorization Guard**: `requireAdmin()` primitive in `lib/auth/guard.ts`.
- **CSV Parsing**: Papa Parse 5.5.3 (client-side in-memory parsing, zero raw CSV persistence).
- **Storage Integration**: `@supabase/supabase-js@2.117.2` for signed upload URL generation and private bucket asset management (`certificate-templates` and `generated-certificates` buckets).
- **Database / Prisma Setup**:
  - Prisma ORM: `7.10.0`
  - Applied Migrations:
    1. `20260925154353_init_domain_foundation`
    2. `20260925224810_add_user_password_hash`
    3. `20260926145009_add_generation_keys`
    4. `20260927033422_add_publication_snapshots`
  - Database schema is fully up to date.
- **Public Certificate Delivery Architecture**:
  - `generated-certificates` remains strictly private (`public: false`).
  - Signed URL TTL: 300 seconds (5 minutes).
  - Browser fetches directly from Supabase Storage; zero PDF bytes proxied through Vercel Functions.
  - Published snapshot isolation: `publishedName` and `publishedFilePath` are authoritative.
  - Double-check eligibility pattern on signing: prevents leaking signed URLs if unpublish occurred during signing.

## Next Action
1. Await project owner sign-off on Phase 13.
2. Proceed to **Phase 14 — Full E2E + Regression** according to `docs/PRD.md` and `docs/FSD.md`. Revisit full-suite Playwright multi-file harness stability comprehensively.

## Open Issues
- **Production Font Asset Debt**: Real-template visual acceptance remains blocked until an approved production font asset and configuration are provisioned. (Test-only font is strictly isolated to test fixtures).

## History

### 2026-09-27 — Phase 13 Public Certificate Preview & Download
- Implemented Phase 13 adhering strictly to all approved mandatory user specifications and corrections:
  1. **Public Certificate Domain & Eligibility Primitives**:
     - Implemented `lib/public-certificates/types.ts`, `lib/public-certificates/filename.ts`, `lib/public-certificates/service.ts`, and `lib/public-certificates/index.ts`.
     - Authoritative visibility gate: `Certificate.id == requestedId`, `Certificate.deletedAt == null`, `Certificate.publishedName != null`, `Certificate.publishedFilePath != null`, `Participant.deletedAt == null`, `CertificateBatch.deletedAt == null`, `CertificateBatch.publishedAt != null`.
     - Decoupled from operational status: does **NOT** require `batch.status == PUBLISHED` (handles published replacement generation in `GENERATING` or `FAILED` states); does **NOT** require `Certificate.status == GENERATED` or `isStale == false`.
     - Snapshot authority: exclusively queries and delivers `Certificate.publishedName` and `Certificate.publishedFilePath` (never mutable `Participant.name` or `generatedFilePath`).
     - Added `withPrismaRetry` to guard against intermittent Supabase connection pooler DNS latency (`EAI_AGAIN`) on Windows.
  2. **Storage Architecture & Path Privacy Contract**:
     - `generated-certificates` bucket remains strictly private (`public: false`).
     - Extended `lib/storage/server.ts` with `createCertificateSignedReadUrl(path, 300, filename)` issuing short-lived signed URLs (TTL: 300 seconds / 5 minutes).
     - Browser fetches and downloads PDF directly from Supabase Storage; zero PDF bytes are proxied through Next.js / Vercel Serverless Functions, preventing `FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE` crashes on certificates up to 20 MB.
     - Storage-path privacy contract locked: `publishedFilePath` is server-only application/database data; bare object paths and service keys are never leaked as application data.
  3. **Signing Concurrency & Double-Check Eligibility**:
     - Implemented `verifyPublishedCertificateSnapshot` lightweight recheck called immediately after storage signing.
     - If batch unpublish or snapshot cutover occurs during signing, the newly generated signed URL is discarded. The detail page triggers `notFound()` and the download route returns HTTP 404.
  4. **Public Detail & Download Routes**:
     - Search results in `app/page.tsx` now provide direct "View Certificate" navigation to `/certificates/[certificateId]`.
     - Detail page (`app/certificates/[certificateId]/page.tsx`): dynamic Server Component rendering dominant native `<iframe>` PDF preview (`referrerPolicy="no-referrer"`), prominent participant name header, download button, and "Open PDF in New Tab" fallback.
     - Public 404 (`not-found.tsx`) and error boundary (`error.tsx`) handle unavailable certificates and storage infrastructure errors cleanly.
     - Download route handler (`app/certificates/[certificateId]/download/route.ts`): dynamic route with real-time double-check eligibility, sanitized filename (`certificate-[slug].pdf`), explicit HTTP 404 response on unavailable records, 302 redirect on success, and `Cache-Control: no-store` on all responses.
  5. **Comprehensive Verification**:
     - `tests/unit/download-filename.test.ts` (6 tests: casing, hyphenation, diacritic stripping, transliteration, path traversal prevention, truncation, fallbacks).
     - `tests/unit/public-certificate-service.test.ts` (12 tests: all eligibility matrix scenarios A-Q against live Supabase PostgreSQL).
     - `tests/unit/public-certificate-race.test.ts` (4 tests: in-flight unpublish and snapshot mutations during signing).
     - `tests/unit/phase13-public-delivery-live.test.ts` (4 tests: live Supabase Storage integration verifying PDF magic bytes, Content-Type, Content-Disposition, and unpublish cutoff).
     - `tests/e2e/public-certificate.spec.ts` (2 tests: unauthenticated search-to-detail-to-download flow, iframe preview, download redirect, unpublish revocation, mobile/desktop viewports).
     - `tests/e2e/public-search.spec.ts` (2 tests: Phase 12 regression verification).
     - All 37 unit/integration test files (396 tests) passed with 100% pass rate.
     - Full Next.js Turbopack production build succeeded with 0 errors.
  6. **Strict Scope & Deferred Debt**:
     - Zero database migrations introduced.
     - Zero new dependencies added.
     - Full Playwright multi-file suite harness stability remains tracked and deferred to Phase 14 (Full E2E + Regression).

### 2026-09-27 — Phase 12 Public Certificate Search
- Implemented Phase 12 adhering strictly to all approved mandatory user specifications and guardrails:
  1. **Public Search Domain & Normalization Layer**:
     - Implemented `lib/search/types.ts`, `lib/search/normalize.ts`, `lib/search/service.ts`, and `lib/search/index.ts`.
     - Strict search field targeting: queries exclusively against `Certificate.publishedName` — never `Participant.name` (preserving live snapshot immutability during in-progress published participant edits).
     - Authoritative visibility gate: `batch.publishedAt != null`, `batch.deletedAt == null`, `participant.deletedAt == null`, `certificate.deletedAt == null`, `publishedName != null`, `publishedFilePath != null`.
     - Operational status decoupling: does **NOT** require `batch.status == PUBLISHED` (handles published replacement generation where batch status is `GENERATING` or failure where batch status is `FAILED`); does **NOT** require `Certificate.status == GENERATED` or `isStale == false`.
     - Immediate unpublish kill-switch: clearing `batch.publishedAt` instantly removes batch certificates from public search even when snapshots exist.
     - Wildcard safety: literal escaping of `%`, `_`, and `\` via `escapeLikePattern` ensures PostgreSQL `ILIKE` behaves as strict literal substring search.
     - Zero hard result truncation: removed `take: 100` cap. Duplicate names and matches across multiple published batches return all matching certificates.
     - Deterministic ordering: `publishedName: "asc", id: "asc"`.
     - Strict Public DTO: serialized response contains strictly `{ certificateId: string, publishedName: string }`. Zero exposure of storage paths, internal batch/participant IDs, error messages, or soft deletion flags.
  2. **Public Search UI**:
     - Implemented App Router root route `/` in `app/page.tsx` as a dynamic Server Component (`export const dynamic = "force-dynamic"`).
     - Created accessible client search form in `app/search-form.tsx` using `GET` submission to `/` with query parameter `q`. Handles empty state, loading state, invalid length state (>1000 chars technical transport guard), no results state, and results list.
     - Visual styling adheres strictly to SMK Telkom Malang tokens (`--telkom-red`, `--charcoal`, `--neutral-gray`) and responsive guidelines with zero horizontal overflow on mobile viewports.
     - Strict Phase 12 boundary preserved: zero certificate preview (canvas/iframe) or certificate download (direct/presigned) implemented. Pure search-only.
  3. **Comprehensive Verification**:
     - `tests/unit/public-search-normalize.test.ts` (10 tests: trimming, non-string, bounds, and wildcard escaping).
     - `tests/unit/public-search-service.test.ts` (17 tests: all publication snapshot contracts A through Q against live Supabase PostgreSQL).
     - `tests/unit/public-search-completeness.test.ts` (1 test: seeded 105 matching certificates across multiple published batches to verify zero hard truncation).
     - `tests/unit/public-search-leak.test.ts` (1 test: verified strict non-disclosure of private paths and internal fields).
     - `tests/e2e/public-search.spec.ts` (2 tests: unauthenticated search, duplicates, replacement in-progress, and responsive viewport verification).
     - `bun run typecheck`: PASS (0 errors).
     - `bun run lint`: PASS (0 errors, 1 pre-existing warning).
     - `bun run test`: PASS across all 33 test files (370 tests, 0 failures).
     - `bun run test:e2e tests/e2e/public-search.spec.ts`: PASS (2 passed).
     - `bun run build`: PASS (Next.js production build succeeded with Turbopack, dynamic `/` route generated cleanly).

### 2026-09-27 — Phase 11 Safe Published Update + Batch Publish / Unpublish
- Implemented Phase 11 adhering strictly to all 6 approved mandatory user guardrails:
  1. **Publication Snapshot Migration**:
     - Added `publishedName String?` and `publishedFilePath String?` to `Certificate` model in `prisma/schema.prisma`.
     - Intentionally omitted `@@index([publishedName])` in Phase 11, deferring search index optimization to Phase 12.
     - Generated and applied migration `20260927033422_add_publication_snapshots` to Supabase PostgreSQL without data loss.
  2. **Republish Snapshot Rebuilding**:
     - Inside the publish transaction, recomputed current certificate eligibility (`status == GENERATED`, `generatedFilePath != null`, `generatedAt != null`, `isStale == false`).
     - Cleared publication snapshot fields for active certificates that are not currently eligible (preventing FAILED or stale certificates from resurrecting old snapshots).
     - Set `publishedName = participant.name` and `publishedFilePath = generatedFilePath` for all currently eligible certificates.
     - Atomically updated `batch.publishedAt = new Date()` and `batch.status = PUBLISHED`.
  3. **Unpublish vs Replacement Race Safety**:
     - Unpublish operates as an immediate visibility kill-switch: inside a transaction, sets `batch.publishedAt = null`, `batch.status = GENERATED`. Deletes zero objects from Supabase Storage.
     - In worker finalization (`lib/inngest/functions/generate-participant.ts`), atomic cutover of publication snapshots only occurs if `batch.publishedAt != null`. If ADMIN unpublishes while generation is running, the worker updates the normal generated state/path and clears `isStale`, but does NOT recreate publication snapshots or set `publishedAt`.
     - Publication-aware batch finalization (`checkAndFinalizeBatch`) returns `PUBLISHED` if `batch.publishedAt != null`, else `GENERATED`.
     - Added dedicated race integration test in `tests/unit/unpublish-race.test.ts`.
  4. **Narrow Published Participant Mutation**:
     - Preserved Phase 6 DRAFT CRUD guards intact.
     - Added dedicated `editPublishedParticipantName` endpoint and service operation with optimistic concurrency control (CAS) on `expectedCurrentGenerationKey`.
     - Validates batch publication (`publishedAt != null`), participant/certificate active status, name normalization, and initializes safe replacement by allocating a fresh `generationKey`, setting certificate to `PENDING` with `isStale = true`, and preserving existing `publishedName` and `publishedFilePath` live until worker success.
  5. **Decoupled Eligibility**:
     - Verified preflight and publish eligibility require `status == GENERATED`, `generatedFilePath != null`, `generatedAt != null`, and `isStale == false` without requiring `generationKey == batch.currentGenerationKey`, ensuring individually regenerated certificates from Phase 10 retain valid publish eligibility.
  6. **Admin UI Integration**:
     - Created `PublishConfirmDialog` with live preflight summary (eligible count, total participants, non-blocking failure warnings) and confirmation CAS.
     - Created `UnpublishConfirmDialog` confirming immediate unpublish kill-switch with clear reassurance of non-deletion of storage files.
     - Created `EditPublishedParticipantDialog` in generation management allowing inline published name updates with instant background replacement triggering.
     - Added Published badge, timestamp, and action buttons in batch detail and generation management headers.
  7. **Strict Boundaries Preserved**:
     - Zero Phase 12 public search endpoints or pages implemented.
     - Zero Phase 13 public certificate download routes created.
     - `generated-certificates` bucket remains strictly private.
     - Production font asset remains tracked as NOT CONFIGURED debt.
- Comprehensive Verification:
  - `bun run typecheck`: PASS (0 errors).
  - `bun run lint`: PASS (0 errors, 1 pre-existing warning).
  - `bun run test`: PASS across all 29 test files (341 tests, 0 failures), including:
    - `tests/unit/publication-service.test.ts` (16 tests)
    - `tests/unit/published-edit.test.ts` (14 tests)
    - `tests/unit/unpublish-race.test.ts` (1 test)
    - `tests/unit/phase11-publication-live.test.ts` (6 tests against live Supabase PostgreSQL and Storage)
    - `tests/unit/generation-finalization.test.ts` (9 tests)
    - `tests/unit/generation-management.test.ts` (13 tests)
  - `bun run test:e2e tests/e2e/publication.spec.ts`: PASS (1 passed).
  - `bun run build`: PASS (Next.js production build succeeded with 0 errors).

### 2026-09-27 — Phase 10 Generation Management
- Implemented Phase 10 adhering strictly to all 7 approved mandatory user corrections:
  1. **Scoped FAILED Batch Recovery**: When a batch is FAILED, recovery derives its target set exclusively from unfinished certificates (`status in [PENDING, GENERATING]`) belonging to the failed operation (`generationKey == batch.currentGenerationKey`). Assigns a fresh recovery `generationKey` and resets only those certificates to `PENDING`. Leaves all terminal certificates (`GENERATED`, `FAILED`) from earlier completed operations untouched. If the failed operation has 0 unfinished certificates remaining, safely reconciles batch status directly to `GENERATED` without launching redundant workers.
  2. **Server-Side Action Semantics**: Preconditions enforced strictly on the server:
     - `retry-participant`: batch must be `GENERATED`, target Certificate must be `FAILED`.
     - `regenerate-participant`: batch must be `GENERATED`, target Certificate must be `GENERATED`.
     - `regenerate-batch`: batch must be `GENERATED`.
     - `recover-batch`: batch must be `FAILED`.
     - Normal participant retry/regenerate actions are rejected server-side while the batch is `FAILED`.
  3. **Stale Request / Optimistic Concurrency Control (CAS)**: Every generation-management action accepts `expectedCurrentGenerationKey`. Inside the database transaction, an atomic CAS compares against `batch.id`, expected status, `batch.currentGenerationKey == expectedCurrentGenerationKey`, and `batch.deletedAt == null`. Mismatches reject immediately with `ConcurrentGenerationConflictError` (HTTP 409).
  4. **Shared Rendering Prerequisites vs Operation Lifecycle**: Separated shared prerequisite checks (`validateRenderingPrerequisites` in `lib/generation/preflight.ts`) from operation-specific lifecycle authorization.
  5. **Worker Output Preservation**: Updated `lib/inngest/functions/generate-participant.ts` so `generatedFilePath` and `generatedAt` are never cleared on failure. During regeneration, certificates transition to `PENDING` with `isStale = true`; on failure, previous output paths and timestamps are preserved in DB and Supabase Storage; on success, the record atomically swaps to the new storage path and sets `isStale = false`. Old storage files are never deleted.
  6. **Clean Client/Server Decoupling**: Created `lib/generation/types.ts` and updated badges to import enums from browser-safe modules (`@/generated/prisma/enums`), preventing Node-specific modules (`node:module`, `sharp`, `PrismaClient`) from leaking into client bundles and resolving Turbopack browser chunking panics.
  7. **Generation Management UI**: Created `/admin/batches/[batchId]/generation` with summary metrics (Total, Generated, Failed, In Progress, Stale), Filter tabs (`ALL`, `FAILED`, `GENERATED`, `IN_PROGRESS`), responsive table with mobile-safe wrapping, contextual Retry/Regenerate buttons, Regenerate Whole Batch confirmation dialog, safe error presentation (sanitized against leaking filesystem paths or internal traces), and active polling while `GENERATING`.
  8. **Strict Boundaries Preserved**: Zero Prisma migrations. Concurrency limit 5 preserved. Production font remains NOT CONFIGURED. Zero Phase 11 publish/public functionality implemented.
- Comprehensive Verification:
  - `bun run typecheck`: PASS (0 errors).
  - `bun run lint`: PASS (0 errors, 1 pre-existing warning).
  - `bun run test`: PASS across all 25 test files (302 tests, 0 failures), including:
    - `tests/unit/generation-management.test.ts` (13 unit tests verifying all action contracts, optimistic concurrency CAS, and FAILED recovery scopes).
    - `tests/unit/phase10-generation-live.test.ts` (5 integration tests against live PostgreSQL and Supabase Storage verifying output preservation, stale flag handling, and scoped recovery).
    - `tests/unit/generate-participant-worker.test.ts` (10 worker retry/failure isolation tests).
  - `bun x playwright test tests/e2e/generation-management.spec.ts`: PASS (19.1s) verifying UI rendering, summary cards, filter tabs, safe failure messages, whole-batch confirmation dialog, and mobile layout without horizontal overflow.
  - `bun run build`: PASS (Turbopack production build succeeded in 7.8m; all static and dynamic endpoints generated cleanly).
- Implemented Phase 9 adhering strictly to all 12 mandatory user corrections.
- Schema & Migration:
  - Added nullable `currentGenerationKey String?` to `CertificateBatch` and `generationKey String?` to `Certificate` in `prisma/schema.prisma`.
  - Created and applied migration `20260926145009_add_generation_keys` to Supabase PostgreSQL.
- Storage Configuration:
  - Configured private bucket `generated-certificates` (20 MB limit, `application/pdf`).
  - Implemented `uploadGeneratedCertificate` with version-isolated path `certificates/{batchId}/{participantId}/{generationKey}.pdf` and `{ upsert: true }` allowing safe retries of the same attempt without overwriting other attempts.
- Typography & Controlled Font Registry:
  - Defined strict Zod schema `fontConfigSchema` in `lib/rendering/font-config.ts` enforcing `fontSize > 0`, `minFontSize <= fontSize`, valid RGB colors, and step size.
  - Implemented controlled font registry in `lib/rendering/font-registry.ts` with project-root path traversal guards and `/*turbopackIgnore: true*/`. Production fonts remain strictly NOT CONFIGURED.
- Comprehensive Preflight Guards:
  - Implemented `executeGenerationPreflight` in `lib/generation/preflight.ts` validating batch status (`DRAFT`), active template, spatial `namePlacement`, font registry identifier, `fontConfig`, source file storage accessibility, single-page PDF geometry / EXIF image orientation, active participants (>0), and name normalization.
  - Prevents fan-out and leaves batch `DRAFT` upon any shared deterministic failure.
- Atomic Initialization & Dual Generation Identity:
  - Implemented `initializeGeneration` in `lib/generation/initialize.ts` executing inside an atomic Prisma `$transaction`.
  - Revalidates preflight snapshot against concurrent DRAFT mutations before committing.
  - Assigns matching UUID v4 `generationKey` atomically to `CertificateBatch.currentGenerationKey` and all `Certificate.generationKey` rows in `PENDING` state while transitioning `DRAFT -> GENERATING`.
- Reusable Race-Safe Finalization Helper:
  - Implemented `checkAndFinalizeBatch` in `lib/generation/finalization.ts`.
  - Conditioned on both `batch.status == GENERATING` and `batch.currentGenerationKey == generationKey`.
  - Transitions batch to `GENERATED` when current-attempt pending/generating certificate count reaches 0. Supports all combinations (100% success, partial success, 100% fail).
- Inngest Background Processing:
  - Singleton Inngest client configured in `lib/inngest/client.ts`.
  - Orchestrator function `generate-batch` in `lib/inngest/functions/generate-batch.ts`: triggers on `generation.batch.requested`, validates dual identity guard, dispatches participant events with deterministic IDs (`gen-part-${cert.id}-${generationKey}`), max 3 retries, and `onFailure` setting batch to `FAILED`.
  - Worker function `generate-participant` in `lib/inngest/functions/generate-participant.ts`: concurrency limit 5, max 3 retries (4 total attempts), atomic transition `PENDING -> GENERATING`, renders certificate via `renderSingleCertificate`, uploads PDF, explicit domain failure branching (`isParticipantDomainError`), `onFailure` retry exhaustion handler setting certificate to `FAILED`, and calls `checkAndFinalizeBatch`.
  - App Router route handler at `app/api/inngest/route.ts`.
- Infrastructure Recovery & Admin UI:
  - Implemented `action: "resume"` in `app/api/admin/batches/[batchId]/generation/route.ts` allowing ADMIN recovery when dispatch fails between DB commit and Inngest send.
  - Created desktop-first `GenerationSection` in `app/admin/batches/[batchId]/generation-section.tsx` with prerequisites checklist, generation trigger, live polling, and resume button.
- Verification & Test Coverage:
  - Unit tests: 23 test files, 284 tests passing (100% pass rate, including 10 participant worker failure/retry tests in `generate-participant-worker.test.ts`).
  - Live architecture & Supabase Output Integration (`phase9-generation-live.test.ts`): verified real pipeline with test font fixture, Participant A (GENERATED) uploaded to private bucket, Participant B (FAILED) with safe error `NAME_DOES_NOT_FIT`, failure isolation, single-page PDF validity, and generation identity protection.
  - Full Playwright E2E regression: `bun run test:e2e` passing all 14 tests across all 6 spec files (`auth.spec.ts`, `batch-crud.spec.ts`, `generation.spec.ts`, `participants.spec.ts`, `position-editor.spec.ts`, `template-upload.spec.ts`).
  - Production build: Turbopack compilation succeeded with 0 errors.

### 2026-09-26 — Phase 8 Final Visual & Fitting Verification
- Executed visual & raster render verification across Scenarios A, B, C, D, E using `pdfjs-dist` and `@napi-rs/canvas`:
  - Scenario A: Single-line at default size (PDF template, 28pt) — rendered and verified horizontally and vertically centered.
  - Scenario B: Single-line after shrinking (PDF template, shrank from 36pt to 19pt) — verified within maxWidth without truncation or ellipsis.
  - Scenario C: Two-line wrapped name (PDF template, 20pt) — verified line 1 above line 2, centered composite block around anchor, no line overlap, no clipping.
  - Scenario D: PDF source template with artwork — verified borders and corner accents preserved intact in raster.
  - Scenario E: PNG source template with artwork (150 DPI) — verified exact aspect ratio preservation (no stretch/distortion), DPI conversion (576 x 384 pt), two-line wrap at 23pt.
- All 39 raster and layout invariant checks passed with 100% success. Visual PNG artifacts saved to `tests/fixtures/output/`.
  - `tests/fixtures/output/scenario_A_single_line_default.png`
  - `tests/fixtures/output/scenario_B_single_line_shrink.png`
  - `tests/fixtures/output/scenario_C_two_line_wrap.png`
  - `tests/fixtures/output/scenario_D_pdf_artwork.png`
  - `tests/fixtures/output/scenario_E_png_artwork.png`
- Confirmed passing test coverage for all 12 fitting edge cases in `tests/unit/rendering-fitting.test.ts`.
- Re-affirmed production font status: NOT CONFIGURED (test font strictly isolated to test fixtures).
- Re-affirmed strict phase boundaries: zero database mutations, zero storage uploads, zero Inngest jobs, zero bulk generation code introduced.

### 2026-09-26 — Phase 8 Name Auto-Fitting & Rendering Policy
- Implemented pure, deterministic name fitting module in `lib/rendering/fitting.ts`:
  - `generateCandidateFontSizes`: calculates strictly descending font size progression with index-based stepping to prevent floating-point accumulation drift; guarantees exact `minFontSize` evaluation once.
  - `splitIntoWords` and `generateCandidateSplits`: generates all $N - 1$ valid word-boundary splits for $N \ge 2$ words; concatenating returned split lines with a space reconstructs the exact normalized name.
  - Single-line fitting loop: evaluates candidate sizes in descending order; validates horizontal fit (`width <= maxWidth`) and vertical page safety (`top <= pageHeight`, `bottom >= 0`).
  - Authoritative two-line evaluation policy:
    - Evaluates every candidate split across candidate font sizes to find the largest candidate font size in $[minFontSize, defaultFontSize]$ where both lines fit $\le maxWidth$, vertical page bounds are safe, and typographic line boxes do not overlap (`topLineBaseline - descent >= bottomLineBaseline + ascent`).
    - Deterministic ranking criteria: (1) largest `fontSize`, (2) smallest `abs(line1Width - line2Width)`, (3) smallest `max(line1Width, line2Width)`, (4) earliest `splitIndex` (tie-break).
  - Strongly typed `NameLayoutPlan` (`single-line` vs `two-line`), exporting explicit line objects `{ text, width, startX, baselineY, ascent, descent }`.
- Enforced zero-slop failure invariants:
  - Preserved rules: no arbitrary character splitting, no hyphenation, no ellipsis, no silent clipping, maximum two lines.
  - Enhanced `NameDoesNotFitError` with specific `reason`: `SINGLE_WORD_OVERFLOW`, `TWO_LINE_OVERFLOW`, `VERTICAL_OVERFLOW`, `INSUFFICIENT_LINE_HEIGHT`.
- Updated `lib/rendering/geometry.ts`:
  - `RenderCertificateStyle`: explicitly requires `fontSize`, `minFontSize`, `lineHeightMultiplier`, `textColor`, and optional `stepSize` (default: 1.0 pt).
  - `validateRenderStyle`: strictly enforces `minFontSize <= fontSize`, finite bounds, and non-silent configuration.
  - Added vertical safety and two-line baseline helpers: `calculateTwoLineBaselines`, `checkTwoLineBoxesOverlap`, `checkVerticalPageSafety`.
- Updated `lib/rendering/engine.ts`:
  - Integrated `calculateNameLayout` into both PDF and PNG/JPG rendering branches.
  - Drawing logic cleanly iterates `layoutPlan.lines`.
  - Enriched `RenderCertificateResult` with `layoutPlan: NameLayoutPlan`, `textWidth`, `baselineY`.
- Updated `docs/FSD.md` Section 9 with Phase 8 algorithm, ranking rules, and vertical safety definition (no page-edge clipping and no metric box overlap).
- Added comprehensive unit tests in `tests/unit/rendering-fitting.test.ts` (23 tests) and integration tests in `tests/unit/rendering-engine.test.ts` (total 230 unit tests across 16 test files, all passing).
- Executed Playwright E2E suite: all 12 tests passed cleanly (including live Supabase Storage upload, PDF.js canvas, and position editor).
- Executed Turbopack production build: passed cleanly.
- Strict Phase 8 boundaries preserved: pure in-memory execution; zero database records created; zero storage uploads; zero Inngest jobs; zero Prisma migrations.

### 2026-09-26 — Phase 7 Single Certificate Engine
- Installed `@pdf-lib/fontkit@1.1.1` for custom TrueType and OpenType font embedding in `pdf-lib`. Next.js 16 and Turbopack compile cleanly without needing `serverExternalPackages` externalization.
- Bundled static permissively licensed TrueType test font at `tests/fixtures/fonts/test-font.ttf` (`LiberationSans-Regular.ttf`) accompanied by license notice (`tests/fixtures/fonts/LICENSE.txt`) explicitly labeled TEST-ONLY. Production font asset remains tracked as explicitly NOT CONFIGURED debt.
- Implemented typed domain errors in `lib/rendering/errors.ts`: `CertificateRenderError`, `FontNotConfiguredError`, `FontUnsupportedGlyphError`, `InvalidNamePlacementError`, `InvalidRenderStyleError`, `NameDoesNotFitError`, `UnsupportedTemplateGeometryError`, `TemplateRenderError`.
- Implemented pure geometric transformations and strict guardrails in `lib/rendering/geometry.ts`:
  - Normalized Top-Left $(xRatio, yRatio)$ to PDF Bottom-Left page center coordinates.
  - Centered typographic box baseline formula:
    $$\text{baselineY} = (1 - yRatio) \times H - \frac{ascent - descent}{2}$$
  - Horizontal centering: $\text{startX} = \text{centerX} - \frac{\text{textWidth}}{2}$.
  - Image DPI policy: valid source density $\ge 72$ and $\le 1200$ used directly; missing density defaults to 300 DPI technical fallback; effective points calculated as $(pixels \times 72) / dpi$; source metadata never overwritten.
  - Strict PDF geometry validation: single-page PDFs supported only when `rotation === 0`, `CropBox === MediaBox` with origin $(0, 0)$, and `UserUnit` absent or 1.0; throws `UnsupportedTemplateGeometryError` otherwise.
  - Image EXIF orientation validation: orientations $2..8$ rejected with `UnsupportedTemplateGeometryError`.
  - Required style validation: `fontSize > 0`, `textColor` with RGB channels in $[0.0, 1.0]$.
- Implemented font utilities in `lib/rendering/font.ts`:
  - `registerFontkit`: safe idempotent registration on PDFDocument.
  - `embedCustomFont`: embeds font bytes via fontkit.
  - `validateFontGlyphSupport`: validates full 32-bit Unicode code points against `font.getCharacterSet()`, throwing `FontUnsupportedGlyphError` with exact character and code point on unsupported glyphs.
  - `measureText`: extracts text width, total height, ascent, and descent.
- Implemented core rendering primitive `renderSingleCertificate` in `lib/rendering/engine.ts`:
  - Single PDF template branch: overlays participant name directly onto existing page artwork; source bytes remain immutable.
  - PNG and JPG image template branch: calculates physical page points and embeds image edge-to-edge into newly created PDF.
  - Pre-fitting single-line gate: throws `NameDoesNotFitError` when textWidth > maxWidth (zero auto-fitting, zero clipping).
  - Pure in-memory execution returning `Uint8Array` PDF bytes; zero Supabase storage upload; zero database record mutations.
- Created barrel export in `lib/rendering/index.ts`.
- Created 42 new unit tests across 3 new test files:
  - `tests/unit/rendering-geometry.test.ts` (20 tests)
  - `tests/unit/rendering-font.test.ts` (8 tests)
  - `tests/unit/rendering-engine.test.ts` (14 tests)
- Executed all 8 canonical verification gates: all PASS (15 test files, 197 unit tests, 12 Playwright E2E tests, production build).
- Strict Phase 7 boundaries preserved: no Supabase storage upload, no Certificate DB records, no Inngest jobs, no bulk generation, no Phase 8 auto-fitting.

### 2026-09-26 — Phase 6 CSV Import & Participant CRUD
- Reused existing `papaparse` (5.5.3) and `@types/papaparse` (5.5.2) without new dependencies.
- Implemented client-side memory-only CSV parsing via Papa Parse:
  - Raw CSV files are never uploaded to Supabase Storage, database blobs, or local filesystem.
  - Requires single `"name"` header; trims header whitespace and tolerates UTF-8 BOM.
  - Rejects unexpected extra columns with clear actionable error messages.
  - Pure normalization function collapses internal repeated spaces and trims outer whitespace while preserving valid characters, casing, accents, and punctuation.
  - Identifies duplicate normalized names within CSV and against batch DB as non-blocking warnings (names are not unique, duplicates remain fully importable).
  - Validation preview table renders row status, error messages, and duplicate warnings before ADMIN confirms persistence.
- Implemented robust server domain mutations and Next.js Server Actions:
  - `importParticipants`: atomic Prisma `$transaction` bulk-creating normalized participants, server-revalidating every row.
  - CRUD operations (`addParticipant`, `editParticipant`, `softDeleteParticipant` via `deletedAt = new Date()`).
  - Batch lifecycle invariant preserved: batch remains in `DRAFT` status; does not auto-advance to `READY`.
  - Phase 6 temporary safety boundary enforced: operations only permitted on `DRAFT` batches; mutations halt safely if an active `Certificate` unexpectedly exists on the participant (Phase 11 owns published certificate edits).
- Built clean, responsive, accessible UI at `/admin/batches/[batchId]/participants` adhering to SMK Telkom Malang brand design tokens (`bg-telkom-red`, `hover:bg-telkom-red-dark`, `text-charcoal`).
- Added comprehensive unit test suites:
  - `tests/unit/participant-normalize.test.ts` (15 tests)
  - `tests/unit/participant-csv-parse.test.ts` (23 tests)
  - `tests/unit/participant-service.test.ts` (31 tests)
- Added live Playwright E2E spec (`tests/e2e/participants.spec.ts`) covering CSV import with duplicates, manual addition, inline editing, soft-deletion, page-refresh persistence, and mobile/desktop responsive layout verification with zero horizontal overflow.
- Executed all 8 canonical verification gates (`prisma validate`, `prisma generate`, `prisma migrate status`, `typecheck`, `lint`, `test`, `test:e2e`, `build`), all passing cleanly.

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

### 2026-09-26 — Phase 5 Name Position Editor
- Installed `pdfjs-dist@6.3.289` for deterministic, client-side PDF canvas rendering in the browser.
- Applied official SMK Telkom Malang brand design tokens in `app/globals.css` (`--telkom-red: #e4262c`, `--telkom-red-dark: #b72024`, `--telkom-red-light: #fef2f2`, `--telkom-red-border: #fecaca`, `--charcoal: #201e1e`, `--neutral-gray: #707274`) as first-class Tailwind `@theme` tokens. Replaced all ad-hoc hex codes and rose colors across the position editor and template section with cohesive theme utility classes (`bg-telkom-red`, `hover:bg-telkom-red-dark`, `border-telkom-red`, `text-charcoal`, `text-neutral-gray`, `accent-telkom-red`). Added subtle Telkom Red brand dot and focus ring to the Admin layout header.
- Strengthened Prisma interactive transaction resiliency in `lib/templates.ts` (`maxWait: 10000`, `timeout: 20000`) for Supabase pooled connections over high-latency networks.
- Established canonical strictly spatial `NamePlacement` contract in `lib/coordinates.ts`:
  - Normalized Top-Left origin $(0, 0)$.
  - $(xRatio, yRatio)$ represents the normalized center anchor of the name field.
  - Validation bounds: $0 \le yRatio \le 1.0$, $0.1 \le maxWidthRatio \le 1.0$, and $xRatio \in [\frac{maxWidthRatio}{2}, 1 - \frac{maxWidthRatio}{2}]$.
  - Fixed invariant `alignment: "center"`.
  - Zero font sizing or fitting parameters inside `NamePlacement`.
  - Pure coordinate conversion helpers: `recomputeXBounds`, `clampPlacement`, `toNormalizedPlacement`, `toPixelPlacement`.
- Implemented atomic template placement update in `lib/templates.ts` (`updateTemplatePlacement`):
  - Enforced `requireAdmin()`.
  - Executed atomic Prisma interactive transaction verifying batch status is `DRAFT`, not soft-deleted, template is not soft-deleted, and `batch.templateId === submittedTemplateId`.
  - Throws `StaleTemplateConflictError` (HTTP 409) if concurrent replacement occurred.
- Updated `getActiveBatchById` in `lib/batches.ts` to include `namePlacement: true`.
- Created authenticated App Router API route at `app/api/admin/batches/[batchId]/template/position/route.ts` with Zod validation and structured HTTP error responses (401, 404, 400, 409, 500).
- Created visual Name Position Editor at `app/admin/batches/[batchId]/position/page.tsx` and interactive client editor in `app/admin/batches/[batchId]/position/position-editor-client.tsx`:
  - Supports both PDF (client-side PDF.js canvas) and PNG/JPG (responsive image) templates.
  - Pointer capture dragging with real-time center coordinate translation and bounds clamping.
  - Keyboard nudge support (Arrow keys: 1%, Shift+Arrow: 5%).
  - Maximum width slider ($10\% - 100\%$) with immediate horizontal re-clamping.
  - Live coordinate readout ($X$, $Y$, $Width$ in %).
  - Stale template conflict modal with reload prompt when HTTP 409 is returned.
  - Realistic sample name ("Naufal Nabil Ramadhan").
- Updated `TemplateSection` (`app/admin/batches/[batchId]/template-section.tsx`) to link to the editor and display current placement status.
- Recorded deterministic font asset configuration as Phase 7 prerequisite; deferred dynamic font fitting (shrink loop, 2-line wrap) to Phase 8.
- Preserved strict Phase 5 boundaries: zero database migrations, batch status remains `DRAFT`, no participant CRUD or CSV parsing.
- Added comprehensive unit tests:
  - `tests/unit/coordinates.test.ts` (15 tests).
  - `tests/unit/template-placement-service.test.ts` (7 tests).
  - `tests/unit/batch-service.test.ts` (updated to 8 tests).
- Added comprehensive Playwright E2E spec in `tests/e2e/position-editor.spec.ts`:
  - Full PDF flow (canvas rendering, drag, slider, keyboard, persistence, reload verification, mobile viewport responsiveness, stale-template concurrency conflict).
  - PNG smoke test (image preview, positioning, and persistence).
- All 8 canonical verification gates passed cleanly: `validate`, `generate`, `migrate status`, `typecheck`, `lint`, `test` (86 tests), `test:e2e` (10 tests), and `build`.

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
