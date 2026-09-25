# AutoCertif — Project Log

## Current State
**Phase:** Harness / Foundation  
**Status:** READY FOR IMPLEMENTATION

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

## Not Yet Verified
The assistant has not executed the local project scripts or inspected the local workspace in this harness-creation step.

Therefore the following are **not yet verified**:
- dependency integrity
- Prisma configuration
- environment variables
- Auth.js configuration
- Supabase connection/storage
- Inngest configuration
- typecheck
- lint
- unit/integration tests
- E2E tests
- production build

Do not convert any of the above to PASS until the command/check has actually been executed successfully.

## Next Action
Start implementation foundation by inspecting the existing repository and `package.json`, then align the codebase with `PRD.md` and `FSD.md`.

Recommended first implementation slice:

```text
Repository inspection
→ verify scripts/config
→ Prisma domain model
→ migration
→ single ADMIN authentication
→ minimal admin shell
→ verification
→ update this LOG
```

Do not begin certificate rendering before the domain/storage/auth foundation is stable.

## Open Issues
None currently requiring a product decision.

## History

### 2026-09-25 — Harness Baseline
- Locked MVP scope after product clarification.
- Defined source-of-truth boundaries.
- Defined background generation and failure-isolation rules.
- Defined deterministic name fitting and two-line fallback.
- Defined published-certificate safe replacement behavior.
- Defined public name-search behavior.
- Defined mandatory core E2E coverage.
