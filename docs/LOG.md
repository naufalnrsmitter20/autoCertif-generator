# AutoCertif — Project Log

## Current State
**Phase:** Phase 1 — Database Domain Foundation Completed  
**Status:** READY FOR PHASE 2 — ADMIN Authentication

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
  - All canonical verification gates executed.

## Verification Gate Results
- `PASS` — `bun run prisma -v` (Prisma CLI 7.10.0, `@prisma/client` 7.10.0)
- `PASS` — `bun run prisma validate` (Schema syntax, models, enums, composite relations valid)
- `PASS` — `bun run prisma migrate status` ("1 migration found in prisma/migrations, Database schema is up to date!")
- `PASS` — `bun run prisma generate` (Generated Prisma Client 7.10.0 to `generated/prisma`)
- `PASS` — Runtime DB connectivity test (`prisma.user.findMany()` executed cleanly against Supabase pooler, 0 users)
- `PASS` — `bun run typecheck` (`tsc --noEmit` exited with code 0)
- `PASS` — `bun run lint` (`eslint` exited with code 0)
- `PASS` — `bun run build` (`next build` exited with code 0, production build & static pages generated cleanly)
- `NOT VERIFIED` — `bun run test` (`vitest run` exited with code 1: "No test files found"; test runner wired, no placeholder tests added per harness policy; unit tests start in feature slices)
- `NOT VERIFIED` — `bun run test:e2e` (`playwright test` exited with code 1: "Error: No tests found"; E2E runner wired, no placeholder tests added per harness policy; E2E tests start with core flows)

## Stack & Baseline Findings
- **Runtime / Package Manager**: Bun v1.4.2 active (`bun.lock` present).
- **Application Framework**: Next.js 16.3.6 (Turbopack, App Router) + React 19.2.8 + Tailwind CSS v4. Production build passes cleanly.
- **TypeScript**: TypeScript v5 with strict mode configured in `tsconfig.json`. Typecheck passes with 0 errors.
- **Linter**: ESLint 9 flat configuration. Agent tooling directories (`.agents/**`, `.claude/**`, `.cursor/**`, `.devin/**`) excluded via `globalIgnores`.
- **Database / Prisma Setup**:
  - Prisma ORM: `7.10.0`
  - Client: `@prisma/client@7.10.0` generated to `generated/prisma`
  - Driver Adapter: `@prisma/adapter-pg@7.10.0` with `pg@8.23.0`
  - CLI Datasource: `DIRECT_URL` (direct Supabase PostgreSQL connection on port 5432) configured via `prisma.config.ts`
  - Runtime Datasource: `DATABASE_URL` (transaction-pooled Supabase connection on port 6543) via `pg.Pool` in `lib/prisma.ts`
  - Applied Migration: `prisma/migrations/20260925154353_init_domain_foundation/migration.sql`
- **Domain Invariants Enforced**:
  - `User`: Single ADMIN identity foundation (`role: UserRole.ADMIN`), no soft delete.
  - `CertificateTemplate`: File types (`PDF`, `PNG`, `JPG`), dimensions, name placement, font asset reference, `deletedAt`.
  - `CertificateBatch`: Lifecycle (`DRAFT`, `READY`, `GENERATING`, `GENERATED`, `PUBLISHED`, `FAILED`), optional template reference (`onDelete: SetNull`), `deletedAt`.
  - `Participant`: Allows duplicate names (no unique constraint on `name`), composite uniqueness `@@unique([id, batchId])`, `batchId` index, `deletedAt`.
  - `Certificate`: One certificate per participant enforced by `participantId @unique`, composite foreign key `[participantId, batchId]` referencing `Participant([id, batchId])` with `onDelete: Restrict` preventing cross-batch contamination, `batchId` and `status` indexes, `deletedAt`.
- **Future Integrations (Unimplemented in Phase 1)**:
  - Phase 2 — Authentication (Auth.js / NextAuth)
  - Phase 4 — Object Storage (Supabase Storage)
  - Phase 9 — Background Jobs (Inngest)

## Next Action
Proceed to **Phase 2 — ADMIN Authentication**:
1. Design minimal Auth.js configuration for single ADMIN identity.
2. Implement password hashing / credentials provider strategy.
3. Protect `/admin` routes with server-side session checks.
4. Add admin login page and logout flow.
5. Create seed/provisioning script for single ADMIN account.

## Open Issues
None for Phase 1.

## History

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
