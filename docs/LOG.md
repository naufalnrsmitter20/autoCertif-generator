# AutoCertif — Project Log

## Current State
**Phase:** Phase 0 — Repository Baseline Completed  
**Status:** READY FOR PHASE 1 — Database Domain Foundation

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

## Verification Gate Results
- `PASS` — `bun run typecheck` (`tsc --noEmit` exited with code 0)
- `PASS` — `bun run lint` (`eslint` exited with code 0, agent skill directories excluded)
- `PASS` — `bun run build` (`next build` exited with code 0, production build & static pages generated cleanly)
- `NOT VERIFIED` — `bun run test` (`vitest run` exited with code 1: "No test files found"; test runner wired, no placeholder tests added per harness policy; unit tests start in feature slices)
- `NOT VERIFIED` — `bun run test:e2e` (`playwright test` exited with code 1: "Error: No tests found"; E2E runner wired, no placeholder tests added per harness policy; E2E tests start with core flows)

## Stack & Baseline Findings
- **Runtime / Package Manager**: Bun v1.4.2 active (`bun.lock` present).
- **Application Framework**: Next.js 16.3.6 (Turbopack, App Router) + React 19.2.8 + Tailwind CSS v4. Production build passes cleanly.
- **TypeScript**: TypeScript v5 with strict mode configured in `tsconfig.json`. Typecheck passes with 0 errors.
- **Linter**: ESLint 9 flat configuration. Agent tooling directories (`.agents/**`, `.claude/**`, `.cursor/**`, `.devin/**`) added to `globalIgnores` so ESLint focuses strictly on application code.
- **Unit Testing Harness**: `vitest@5.0.1` explicitly declared as direct `devDependency` in `package.json` (aligned with `bun.lock` transitive resolution).
- **E2E Testing Harness**: `@playwright/test` v1.63.0 declared in `devDependencies`.
- **Database / Prisma**: Connection strings (`DATABASE_URL`, `DIRECT_URL`) verified in `.env`. `@prisma/client` ^7.10.0 and `prisma` ^8.0.0-rc.17 installed. Schema and migrations deferred to Phase 1.
- **Environment Template**: `.env.example` created with verified database variables (`DATABASE_URL`, `DIRECT_URL`, optional helper `DB_PASSWORD`), and commented roadmap placeholders for Phase 2 (Auth.js), Phase 4 (Supabase Storage), and Phase 9 (Inngest) without invented variable names.
- **Future Integrations (Unimplemented in Phase 0)**:
  - Phase 2 — Authentication (Auth.js / NextAuth)
  - Phase 4 — Object Storage (Supabase Storage)
  - Phase 9 — Background Jobs (Inngest)

## Completed
- Completed repository exploration and stack audit.
- Added canonical package scripts to `package.json`: `typecheck`, `test`, `test:e2e`.
- Declared direct `vitest@5.0.1` in `devDependencies` via Bun.
- Configured ESLint `globalIgnores` for agent skills directories.
- Created safe `.env.example` template and updated `.gitignore` (`!.env.example`, `/test-results/`).
- Executed all canonical verification gates and recorded evidence.
- Verified working tree: no secrets exposed, no Phase 1+ product features introduced.

## Next Action
Proceed to **Phase 1 — Database Domain Foundation**:
1. Reconcile/verify Prisma CLI & client version compatibility for schema authoring.
2. Define domain models in `prisma/schema.prisma` (`User`, `CertificateTemplate`, `CertificateBatch`, `Participant`, `Certificate`) mapping to FSD specification.
3. Validate and execute baseline migration against Supabase PostgreSQL using `DIRECT_URL`.
4. Run canonical verification gates (`typecheck`, `lint`, `build`).

## Open Issues
- Reconcile `@prisma/client` (^7.10.0) and `prisma` CLI (^8.0.0-rc.17) during Phase 1 schema setup.

## History

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
