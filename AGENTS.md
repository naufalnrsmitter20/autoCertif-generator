<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

## Project
AutoCertif — `Certificate Generator` System.

A small single-organization web application for generating, reviewing, publishing, searching, and downloading certificates in bulk. The MVP target is approximately 100 participants per batch.

## Source of Truth
Use the smallest relevant source of truth for the task:

- Product scope and requirements: `docs/PRD.md`
- Functional behavior and technical contract: `docs/FSD.md`
- Current implementation state and handoff: `docs/LOG.md`
- Existing code: current implementation, not automatically the intended specification

If PRD, FSD, and implementation conflict:
1. Do not silently choose one.
2. Identify the conflict.
3. Preserve existing data and behavior where possible.
4. Resolve against the explicit product requirement before making a behavior-changing implementation.

Explicit user instructions override project documents.

## Working Rules
- Inspect relevant existing code before editing.
- Do not invent requirements, screens, fields, roles, or workflows.
- Keep implementation proportional to this project's size.
- Prefer the simplest maintainable solution that satisfies PRD/FSD.
- Reuse existing dependencies, utilities, components, and patterns before adding new ones.
- Do not add a dependency unless the existing stack cannot reasonably solve the task.
- Keep changes scoped. Avoid unrelated refactors.
- Preserve type safety.
- Do not claim a check passed unless it was actually executed successfully.
- Do not hide partial failures.

## Documentation Loading
Do not load every project document for every task.

- Read `PRD.md` when scope, UX, product behavior, or acceptance criteria matter.
- Read `FSD.md` when implementing flows, data models, validation, generation, storage, APIs, auth, or state transitions.
- Read `LOG.md` when continuing implementation or determining current status.
- For trivial isolated changes, inspect only the relevant code and documentation.

## UI/UX
- Use the installed `ui-ux-promax` and `anti-slop` skills when relevant to UI work.
- Admin UI: clean, functional, minimal, desktop-first, shadcn-based.
- Public UI: minimal, professional, responsive, search-centric.
- Avoid decorative dashboard clutter, unnecessary cards, gradients, excessive animations, or invented marketing sections.
- Certificate visual appearance comes from the uploaded certificate template. The system must not redesign the certificate itself.
- The only MVP dynamic certificate content is the participant name.

## Product Constraints
- Single organization.
- Single ADMIN account for MVP.
- No public registration.
- No forgot-password flow in MVP.
- One certificate per participant per batch.
- Approximate batch size: 100 participants.
- Template formats: single-page PDF, PNG, or JPG.
- CSV requires only `name`.
- No system-generated certificate number/ID is rendered onto the certificate.
- Duplicate names are allowed with an admin warning.
- Public search is by participant name only, partial and case-insensitive.
- Batch publish/unpublish is supported.
- Public certificate download does not require login.
- Participant CRUD is allowed after import.
- Individual and whole-batch regeneration are supported.
- A participant generation failure must not fail successful participants.

## Certificate Rendering Rules
- Preserve the original template appearance.
- The participant name is positioned through the template's name placement configuration.
- Start with the configured default name font size.
- Shrink based on actual rendered text width, not character count.
- Never shrink below the configured minimum font size.
- If the name still does not fit at minimum size, wrap it into at most two centered lines.
- If it still cannot fit safely in two lines, mark that participant generation as failed and surface the participant name to ADMIN.
- Do not silently clip or overflow a participant name.

### Font rule
"Font follows the PDF/template" means the rendered participant name must visually match the template font.

Do not assume arbitrary PDFs allow reliable automatic reuse/extraction of their embedded fonts. For deterministic rendering, each template must reference a usable font asset available to the application. If a template requires a custom font, that font asset must be provided/configured before generation.

## Engineering Stack
Use the already-installed project dependencies and existing configuration. The intended stack is:

- Next.js + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma
- PostgreSQL on Supabase
- Supabase Storage
- Auth.js
- `pdf-lib` for PDF composition
- `sharp` for image processing
- Papa Parse for CSV parsing
- Zod for validation
- Inngest for background generation jobs
- Vitest for unit/integration tests
- Playwright for E2E
- Bun as package manager/runtime command entrypoint
- Vercel deployment

Do not pin or change dependency versions unless required by the task.

## Verification
Use the actual scripts defined in `package.json`. Canonical project gates should cover:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:e2e
bun run build
```

If a canonical script is not present, inspect `package.json` before deciding whether the task requires adding it.

For UI or critical-flow changes, also perform browser verification when the environment supports it.

Core E2E coverage must include:
- ADMIN login
- create batch
- upload/configure template
- import CSV
- participant validation/CRUD
- generate certificates
- surface failed participant names
- publish batch
- public name search
- certificate preview/download
- unpublish behavior

A task is not complete merely because code compiles.

## Documentation Maintenance
- Update `PRD.md` only when product scope or product requirements change.
- Update `FSD.md` when functional or technical behavior changes.
- Update `LOG.md` after meaningful implementation work or verification.
- Keep `LOG.md` concise; it is a handoff document, not a diary.
- Never rewrite historical log entries to make an incomplete verification appear complete.

## Completion Report
When finishing a meaningful task, report:
1. What changed.
2. Files materially affected.
3. Verification actually executed and its result.
4. Remaining failures, risks, or follow-up work.
5. Update `docs/LOG.md`.
