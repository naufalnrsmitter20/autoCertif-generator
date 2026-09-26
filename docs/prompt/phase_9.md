You are working on AutoCertif — Certificate Generator System.

Plan:

PHASE 9 — BULK GENERATION + INNGEST ORCHESTRATION

This phase connects the already-completed deterministic rendering engine
(Phase 7) and name auto-fitting policy (Phase 8) to:

- background generation with Inngest
- one Certificate record per active participant
- per-participant failure isolation
- private Supabase Storage persistence
- deterministic batch lifecycle transitions

This is NOT the generation-management, manual retry UI, publish, or
public-delivery phase.

==================================================
SOURCE OF TRUTH
==================================================

Before proposing implementation, inspect the ACTUAL current repository:

- AGENTS.md
- docs/PRD.md
- docs/FSD.md
- docs/LOG.md
- package.json
- bun.lock
- prisma/schema.prisma
- prisma migrations

Completed phases:

0 Repository Baseline
1 Database Domain Foundation
2 ADMIN Authentication
3 Admin Shell + Batch CRUD
4 Template Upload + Private Storage
5 Name Position Editor
6 CSV + Participant CRUD
7 Single Certificate Engine
8 Name Auto-Fitting & Rendering Policy

Inspect specifically:

- CertificateBatch model and BatchStatus enum
- Participant model
- Certificate model and CertificateStatus enum
- all Certificate unique/index/FK constraints
- generatedFilePath / preview path fields actually present
- generatedAt
- error fields
- isStale
- deletedAt
- CertificateTemplate fields:
  - sourceFilePath
  - fileType
  - namePlacement
  - fontFamily
  - fontAssetPath
  - fontConfig
- current Supabase server storage helpers
- current bucket setup script
- renderSingleCertificate(...)
- RenderCertificateStyle
- Phase 8 fitting contract
- current production-font status
- current participant DRAFT mutation boundary
- current package versions
- whether `inngest` is already installed
- whether any Inngest files/routes/config already exist

Do not assume package versions, schemas, or helpers.

==================================================
CURRENT PRODUCT CONTRACT
==================================================

Generation requirements:

- approximately 100 participants per batch
- one certificate per participant
- final output is PDF
- generation MUST be asynchronous/background work
- successful participants remain successful if another participant fails
- failures are tracked per participant
- generated output is persisted in private object storage
- participant names that cannot render safely become FAILED
- batch must not depend on one long HTTP request

Canonical conceptual flow:

ADMIN requests generation
→ validate batch/template/font/participants
→ enqueue background generation
→ process participants independently
→ persist participant result
→ upload successful PDF
→ finish batch generation

FSD allows participant-level failures without rolling back successes.

==================================================
ROADMAP BOUNDARY
==================================================

Phase 9 owns:

- generation preflight
- initial bulk-generation request
- Inngest integration
- event orchestration
- per-participant background workers
- per-participant failure isolation
- generated PDF private-storage upload
- Certificate lifecycle required for first generation
- batch lifecycle required to represent generation
- automatic infrastructure retries for transient failures
- terminal batch finalization

Phase 9 MUST NOT implement:

- ADMIN manual retry/regenerate UI
- individual retry button
- whole-batch regenerate UI
- detailed generation-management dashboard
- rich progress UI
- published participant safe replacement
- publish / unpublish
- public search
- public preview
- public download

Those belong to Phase 10+.

IMPORTANT:

Automatic Inngest retries for transient infrastructure failure
ARE part of Phase 9 reliability.

ADMIN-initiated retry/regenerate behavior
is NOT Phase 9.

Do not confuse them.

==================================================
PRODUCTION FONT BLOCKER — MUST REMAIN EXPLICIT
==================================================

Current known state:

Production Font Asset:
NOT CONFIGURED

The TEST-ONLY font under tests/fixtures must NEVER become a production
fallback.

Before generation is accepted:

- template must have a deterministic usable font configuration;
- font bytes must resolve through a trusted server-only mechanism;
- style configuration required by Phase 8 must exist.

If the actual repository still has no production font asset/configuration:

DO NOT invent a font.

The Phase 9 implementation may build and test orchestration using explicitly
isolated test fixtures, but real production generation must remain blocked by
preflight with a clear configuration error.

The plan must state whether Phase 9 can be technically completed while
production generation remains configuration-blocked.

Do not claim real-template production readiness.

==================================================
FONT CONFIG / RENDER STYLE CONTRACT
==================================================

Inspect the Phase 8 RenderCertificateStyle contract.

Expected required rendering configuration includes conceptually:

- default/start font size
- minimum font size
- line height multiplier
- text color

and optionally the approved technical step size.

Determine how those values map to existing:

CertificateTemplate.fontFamily
CertificateTemplate.fontAssetPath
CertificateTemplate.fontConfig

Prefer using the existing JSON field.

Do NOT add Prisma columns solely for typography if the existing schema can
represent the required configuration safely.

Define a strict typed/Zod server-side parser for fontConfig.

Never trust arbitrary JSON.

Missing/invalid configuration:
→ generation preflight FAILS clearly.

Do not silently invent:

- font
- font size
- minimum size
- line height
- text color

==================================================
FONT ASSET RESOLUTION SECURITY
==================================================

Do not treat arbitrary database `fontAssetPath` as a trusted filesystem path.

If project-bundled fonts are the intended strategy:

prefer a controlled font registry or safely constrained asset resolver.

Example concept:

known font identifier
→ known bundled asset

NOT:

readFile(template.fontAssetPath)

with an unrestricted DB-controlled absolute/relative path.

If the actual architecture instead stores font assets privately in Supabase,
inspect and document that explicitly.

Do not create a new font-upload product flow in Phase 9.

==================================================
BATCH PRE-FLIGHT
==================================================

Generation may start only when ALL required conditions are satisfied.

Validate server-side:

- authenticated ADMIN
- batch exists
- batch not soft-deleted
- expected lifecycle state is valid for initial generation
- active template exists
- template not soft-deleted
- namePlacement exists and validates
- deterministic font asset resolves
- fontConfig parses and validates
- source template object exists
- at least one active participant exists
- active participants have valid normalized names
- no unsupported configuration prevents rendering

Do not partially start the batch when mandatory shared configuration is
invalid.

Shared configuration failure:
→ reject generation request synchronously
→ batch remains recoverable
→ do not enqueue participant work.

==================================================
BATCH LIFECYCLE
==================================================

Phase 6 deliberately left batches in:

DRAFT

Phase 9 is the first phase allowed to advance generation state.

Design a deterministic initial-generation lifecycle such as:

DRAFT
→ READY
→ GENERATING
→ GENERATED

FAILED is reserved for unrecoverable batch/orchestration-level failure,
not ordinary per-participant rendering failures.

The plan must inspect actual enum/state behavior and define exact atomic
transitions.

Preferred semantics:

DRAFT:
editable configuration/data

READY:
preflight succeeded and generation work is durably prepared / eligible to
start

GENERATING:
background generation is running

GENERATED:
the bulk generation attempt reached terminal participant results

PUBLISHED:
out of Phase 9

Do NOT transition to READY merely because participants exist.

==================================================
PARTICIPANT FREEZE DURING GENERATION
==================================================

Phase 6 mutations already require DRAFT.

Preserve this.

Once generation transitions out of DRAFT:

- participant add/edit/delete must remain blocked;
- template replacement/configuration must remain blocked;
- name placement mutation must remain blocked.

This prevents jobs from rendering a moving target.

Do not weaken earlier DRAFT guards.

==================================================
CERTIFICATE ROW INITIALIZATION
==================================================

Inspect the actual Certificate schema first.

Existing Phase 1 intent:

one active Certificate record per participant
with statuses:

PENDING
GENERATING
GENERATED
FAILED

Prefer preparing Certificate records in a bounded DB transaction during
generation initialization.

Requirements:

- active participants only
- participant/batch consistency preserved
- no raw participant names as storage identity
- one Certificate per participant
- duplicates in participant names remain irrelevant because IDs are unique

Do not create duplicate Certificate rows when a generation request is retried.

Use existing uniqueness constraints rather than application-only assumptions.

==================================================
GENERATION REQUEST IDEMPOTENCY
==================================================

This is critical.

A user can:

- double-click
- retry an HTTP request
- lose the response after the server successfully queued work
- refresh during enqueue

The result must NOT be two independent generation jobs.

Do not rely solely on Inngest event deduplication.

Inngest event IDs provide useful producer-side deduplication, but their
idempotency window is limited.

Database lifecycle/state is the authoritative long-term guard.

Plan a deterministic initialization strategy.

Preferred conceptual behavior:

request arrives
↓
transactionally inspect current batch state

if DRAFT:
  perform preflight
  create/upsert PENDING certificates
  transition to READY
  establish one stable initial-generation identity/key

if READY:
  treat as already prepared / safely resumable where appropriate

if GENERATING or GENERATED:
  reject duplicate initial-generation request
  unless later regenerate behavior is explicitly being handled by Phase 10

↓
send one idempotently-identifiable Inngest batch event

If event delivery fails after READY is persisted:

the system must remain safely re-enqueueable without creating a second
generation attempt.

The plan MUST explain exactly how the stable enqueue identity is derived from
existing persisted state.

If existing schema cannot safely represent this without ambiguity:

surface that as a schema-design issue rather than fabricating reliability.

==================================================
DO NOT TRUST 24-HOUR EVENT DEDUP AS THE DATABASE
==================================================

Inngest event idempotency is a useful extra layer.

It must NOT be the only guard against duplicate generation.

Use:

DB state / unique constraints
+
stable event identity
+
idempotent participant worker behavior

as defense in depth.

==================================================
INNGEST SDK
==================================================

Inspect the exact installed Inngest SDK state/version.

If missing:

add the current stable SDK version compatible with the repository.

Use official Next.js App Router integration.

Expected structure conceptually:

lib/inngest/client.ts
lib/inngest/events.ts
lib/inngest/functions/...
app/api/inngest/route.ts

but follow repository conventions.

For App Router, expose the official Inngest serve handler methods required by
the installed SDK.

Do not invent a custom webhook implementation.

==================================================
EVENT CONTRACT
==================================================

Use small typed event payloads.

Do NOT send:

- template bytes
- PDF bytes
- font bytes
- Prisma objects
- large participant arrays when avoidable
- secrets

Events should contain stable identifiers only.

Conceptual events:

autocertif/generation.batch.requested
{
  batchId,
  generationKey
}

autocertif/generation.participant.requested
{
  batchId,
  participantId,
  certificateId,
  generationKey
}

Exact names may differ if project conventions justify it.

Do not send participant names as identity.

==================================================
RECOMMENDED ORCHESTRATION SHAPE
==================================================

Prefer an architecture with:

BATCH ORCHESTRATOR
+
PARTICIPANT WORKER

rather than one giant HTTP request or one unbounded Promise.all loop.

Conceptual:

generation request
↓
batch event
↓
orchestrator confirms prepared batch
↓
batch → GENERATING
↓
fan out one event per active participant
↓
participant workers execute independently
↓
each reaches GENERATED or FAILED
↓
last terminal participant causes batch finalization
↓
batch → GENERATED

This architecture naturally isolates failures.

During planning compare this approach against the actual schema and Inngest
SDK.

Do not adopt a more complex graph unless it solves an actual repository
constraint.

==================================================
RELIABLE FAN-OUT
==================================================

When sending participant events from inside an Inngest function:

use the installed SDK's durable step/event mechanism.

Do not use fire-and-forget promises.

The fan-out operation itself must be checkpointed/retriable.

All participant events must use stable event identities derived from the
current generation identity + participant ID.

A retried fan-out step must not create duplicate effective work.

==================================================
BOUNDED CONCURRENCY
==================================================

Rendering PDF/image templates is CPU/memory/database/storage work.

Do not process ~100 certificates with uncontrolled concurrency.

Use explicit Inngest concurrency configuration for participant workers.

Inspect:

- current Inngest plan/environment if available
- rendering memory characteristics
- DB connection configuration
- Vercel runtime constraints

Choose a conservative initial concurrency value.

Document the chosen value and rationale.

Do not claim Inngest concurrency limits total function runs; it limits active
step execution according to SDK semantics.

Do not create custom semaphore infrastructure if Inngest concurrency solves
the requirement.

==================================================
PARTICIPANT WORKER CONTRACT
==================================================

Each participant worker must independently:

1. validate event identifiers;
2. load active Certificate/Participant/Batch/Template state;
3. verify relationships match;
4. verify current generation state still permits the work;
5. transition Certificate:
   PENDING → GENERATING
   using an idempotent/conditional mutation;
6. load template bytes from PRIVATE Supabase Storage;
7. resolve deterministic font bytes;
8. parse validated render configuration;
9. call Phase 8 `renderSingleCertificate`;
10. persist successful PDF to PRIVATE Supabase Storage;
11. atomically mark Certificate GENERATED with:
    - output storage path
    - generatedAt
    - cleared generation error
    - appropriate stale state
12. attempt batch completion check.

Expected participant-specific domain failures such as:

- NameDoesNotFitError
- unsupported glyph
- invalid participant-specific rendering condition

must be converted into:

Certificate.status = FAILED
+
safe structured/actionable generation error

and MUST NOT fail unrelated participants.

==================================================
TRANSIENT VS DOMAIN FAILURES
==================================================

Do not treat every error the same.

Expected deterministic/domain render failures:

examples:
- NAME_DOES_NOT_FIT
- UNSUPPORTED_GLYPH

→ mark participant Certificate FAILED
→ do not retry endlessly
→ continue batch

Transient/infrastructure failures:

examples:
- temporary Supabase network failure
- temporary DB connection failure
- Inngest transport failure

→ throw from the durable step
→ allow Inngest automatic retry policy

Invalid shared configuration should ideally be prevented by preflight.

If encountered unexpectedly in worker:
classify safely and avoid generating incorrect files.

Define the error taxonomy in the plan.

Do not expose stack traces/secrets as ADMIN-facing generation errors.

==================================================
INNGEST STEP DISCIPLINE
==================================================

Put non-deterministic side effects inside durable Inngest steps:

- DB state transitions
- storage downloads
- rendering + output upload boundary
- DB finalization
- event fan-out

Be aware that step results are serialized.

Do NOT return large PDF/font/template byte arrays from a step merely to pass
them into another step.

Avoid:

step.run(...)
→ return Uint8Array several MB
→ serialize it into Inngest state

Prefer keeping byte-heavy render/upload work inside an appropriately bounded
step and return only small metadata such as:

{
  storagePath,
  pageWidth,
  pageHeight,
  layoutMode
}

The plan must explicitly address this.

==================================================
STORAGE ARCHITECTURE
==================================================

Generated certificates must remain PRIVATE.

Inspect Phase 4 storage conventions and server client.

Use either:

- an existing appropriate private bucket
or
- a dedicated private generated-certificate bucket

based on repository evidence.

Do NOT create a public bucket.

Content-Type:

application/pdf

Preferred object identity:

certificates/{batchId}/{participantId}/{generationKey-or-version}.pdf

Exact bucket/path structure may follow existing storage conventions.

Use internal IDs only.

Never use raw participant name in an object path.

==================================================
IMMUTABLE OUTPUT PATHS
==================================================

Generated outputs should use a NEW immutable/versioned object path.

Do not repeatedly overwrite:

certificates/{participantId}.pdf

Phase 11 needs safe replacement semantics later.

Preferred property:

new generation
→ new object path

then database reference changes only after successful upload/finalization.

This gives Phase 11 a safe foundation.

Do not delete previous successful output during Phase 9.

==================================================
STORAGE RETRY IDEMPOTENCY
==================================================

Design upload semantics so an Inngest retry cannot corrupt state.

A durable participant attempt should have a deterministic storage path.

Do NOT blindly create a different random path on every retry.

Also do not overwrite another generation's object.

Possible safe pattern:

generation identity + participant ID
→ deterministic unique path for that attempt.

Use Supabase upload behavior intentionally.

If using `upsert: false`:

define how retry handles an object that was successfully uploaded before the
worker lost acknowledgment.

If using replacement/upsert semantics:

prove that the path belongs exclusively to the SAME generation attempt and
cannot overwrite a previous/live certificate.

Prefer immutable outputs and minimal overwrite behavior.

The plan must state the exact strategy.

==================================================
DB / STORAGE COMMIT ORDER
==================================================

Avoid DB pointing to an output that was never uploaded.

Preferred order:

render
↓
upload successfully
↓
transactionally mark Certificate GENERATED + store path

If DB finalization fails after successful upload:

the durable worker must be safely retryable.

An orphan object is preferable to a DB row pointing at a missing file.

Do not delete a valid existing certificate output merely because a later DB
write fails.

Physical orphan cleanup may be future maintenance work.

==================================================
CERTIFICATE FAILURE STATE
==================================================

On deterministic participant failure:

Certificate:
- status = FAILED
- generation error = safe structured message/code
- generatedAt = null unless schema semantics dictate otherwise
- no new generated file path

Do not delete successful files belonging to other participants.

For initial generation there should normally be no previous live certificate,
but do not implement Phase 11 replacement logic here.

==================================================
BATCH FINALIZATION
==================================================

Participant workers finish independently.

Design a race-safe terminal check.

After one participant reaches GENERATED or FAILED:

query current active generation certificates for the batch.

If ANY remain:

PENDING
or
GENERATING

→ batch remains GENERATING.

If NONE remain:

→ generation attempt is terminal.

Set batch → GENERATED using an idempotent conditional update.

Participant failures alone do not roll back successes.

Do not set batch FAILED merely because:

99 GENERATED
1 FAILED

That batch completed.

The plan must explicitly define what happens for:

100 GENERATED / 0 FAILED
99 GENERATED / 1 FAILED
1 GENERATED / 99 FAILED
0 GENERATED / 100 FAILED

Do not invent publish semantics here.

If product/source-of-truth does not clearly determine the all-failed batch
status, surface that specific lifecycle question in the plan rather than
quietly choosing an inconsistent meaning.

==================================================
ORCHESTRATOR-LEVEL FAILURE
==================================================

A failure before participant work is successfully dispatched is not a
participant failure.

Use Inngest retries first.

If the orchestration exhausts its retry policy:

define an explicit recoverable batch-level state consistent with the existing
BatchStatus enum.

If `FAILED` already exists for operational batch failure, evaluate using it.

Do NOT fabricate a new status without schema evidence.

Do not mark each participant FAILED just because fan-out infrastructure failed.

==================================================
RETRY CONFIGURATION
==================================================

Use explicit, bounded automatic retry configuration.

Do not use infinite/custom recursive retry loops.

Use Inngest's native retries.

Classify expected deterministic participant failures so they do not consume
retries unnecessarily.

The exact retry count should be proposed based on current SDK defaults and
repository needs; do not increase it without reason.

==================================================
FUNCTION / EVENT IDEMPOTENCY
==================================================

Use Inngest's idempotency/event IDs as an additional safety layer where
appropriate.

Remember:

provider-level idempotency windows do not replace database correctness.

A replay, delayed event, duplicate event, or retry must not:

- create duplicate Certificate rows
- regress GENERATED back to GENERATING
- overwrite another attempt's output
- duplicate effective participant generation unexpectedly
- move terminal batch state backward

Use conditional database updates and current-state checks.

==================================================
STALE EVENT SAFETY
==================================================

Every worker must protect against stale events.

For example, if an old event arrives after state has advanced:

do NOT blindly execute it.

Validate:

- expected generation identity
- batch state
- certificate state
- participant still active
- relationships still match

If event is stale/already completed:

return idempotently without changing current state.

If existing schema cannot distinguish generation attempts robustly:

surface this during planning.

Do not guess.

==================================================
SCHEMA / MIGRATION REVIEW — CRITICAL
==================================================

Phase 1 schema was designed before live Inngest orchestration.

Do NOT assume it is sufficient.

Inspect whether current schema can safely represent:

- one current Certificate per participant
- PENDING / GENERATING / GENERATED / FAILED
- output path
- generation error
- generated timestamp
- stale flag
- safe generation-attempt identity
- idempotent bulk initialization
- stale-event rejection
- future regeneration compatibility

If the current schema is sufficient:
prefer zero migration.

If a generation-attempt identifier/version is genuinely required for durable
correctness:

propose the smallest justified migration.

Do NOT avoid a necessary schema migration merely because previous phases had
zero migrations.

But do not add:

- generic job framework tables
- event log tables
- queue tables
- audit tables

unless correctness genuinely requires them.

==================================================
IMPORTANT GENERATION IDENTITY QUESTION
==================================================

The plan MUST explicitly answer:

How does the system distinguish:

Generation Attempt A
from
Generation Attempt B

for the same participant/batch?

Even though manual regeneration is Phase 10, Phase 9 storage paths and stale
event protection must not paint Phase 10 into a corner.

Possible representations include:

- generation version
- attempt ID
- equivalent immutable generation token

Do not select one before inspecting the schema.

This is one of the primary architecture review points.

==================================================
INNGEST FAILURE HANDLER
==================================================

Inspect current SDK support for function-level failure handling.

If used:

- keep it idempotent;
- use it for unrecoverable orchestration state reconciliation;
- do not allow it to overwrite a legitimately completed batch;
- do not convert one participant's domain failure into a batch-wide failure.

Do not add failure-handler complexity if the normal state machine already
handles the scenario adequately.

==================================================
ADMIN UI IN PHASE 9
==================================================

Keep UI minimal.

Phase 9 may add ONLY what is required to:

- trigger initial generation;
- communicate that generation was accepted/running;
- expose minimal current batch status if needed for verification.

Do NOT build the full generation-management experience.

No manual retry controls yet.

No failed-participant management dashboard yet.

Phase 10 owns that.

Reuse the existing SMK Telkom Malang design system.

==================================================
AUTHORIZATION
==================================================

The ADMIN generation trigger must:

- requireAdmin()
- independently validate the target batch
- never trust client-controlled lifecycle/status values

Inngest internal function invocations do not use browser auth,
but they must validate all IDs/state against DB.

Never expose:

SUPABASE secret
INNGEST signing key
INNGEST event key
font bytes
private storage paths

to the browser.

==================================================
INNGEST ROUTE / ENVIRONMENT
==================================================

Plan the official Next.js App Router Inngest endpoint using the installed SDK.

Inspect required environment variables.

Document which values are:

- server secret
- development-only
- production-required

Never print actual secret values in reports/logs/tests.

If live Inngest credentials are absent:

unit/integration implementation may proceed,
but live remote execution must be reported:

NOT VERIFIED

Do not fake PASS.

==================================================
SUPABASE OUTPUT BUCKET
==================================================

If Phase 9 needs a new bucket:

extend existing storage setup conventions idempotently.

Requirements:

- private bucket
- PDF output only
- no anonymous write
- server secret used for generation uploads
- do not weaken the private template bucket

Do not create bucket state manually in code on every participant generation.

Provision/configure infrastructure separately.

==================================================
TESTING — GENERATION INITIALIZATION
==================================================

Add focused tests covering:

- unauthorized generation request rejected
- nonexistent batch rejected
- deleted batch rejected
- no template rejected
- invalid/missing namePlacement rejected
- no participants rejected
- missing production font/config rejected
- malformed fontConfig rejected
- valid preflight transitions safely
- Certificate rows prepared exactly once
- duplicate trigger does not create duplicate rows
- batch does not jump directly from DRAFT to GENERATED
- participant/template edits remain unavailable outside DRAFT

==================================================
TESTING — PARTICIPANT WORKER
==================================================

Cover:

- valid participant → GENERATED
- PDF output uploaded
- correct content type
- output path uses IDs, never raw name
- PDF source generation works
- PNG source generation works
- JPG source generation works
- long name shrink works
- two-line name works
- NameDoesNotFit → participant FAILED only
- unsupported glyph → participant FAILED only
- one failed participant does not fail successful participant
- transient storage error is retryable
- transient DB failure is retryable
- duplicate/stale event is idempotently ignored
- GENERATED certificate is not regressed by duplicate event
- source template remains unchanged

==================================================
TESTING — STORAGE IDEMPOTENCY
==================================================

Explicitly test:

upload success
↓
simulated lost acknowledgement / DB finalization failure
↓
worker retry
↓
no corrupt duplicate state
↓
Certificate eventually references the intended existing output

Also test:

two different generation identities
→ cannot overwrite each other's object path.

==================================================
TESTING — BATCH FINALIZATION
==================================================

Cover:

- pending participant exists → remains GENERATING
- generating participant exists → remains GENERATING
- all terminal → finalizes once
- concurrent finalizer calls are safe
- mixed GENERATED + FAILED → terminal batch without rollback
- delayed duplicate participant event cannot revert final batch state

Resolve/document the all-participants-failed case during planning.

==================================================
TESTING — INNGEST
==================================================

Do not pretend unit tests are live Inngest verification.

Use the official/local Inngest development/testing mechanism available for
the installed version where practical.

Verify:

- function registration
- route exposes expected handlers
- batch event accepted
- fan-out reaches participant worker
- failure isolation
- native retry behavior or controlled retry simulation
- concurrency config present

If live/cloud Inngest verification is unavailable:

report that exact part as NOT VERIFIED.

==================================================
E2E
==================================================

Keep E2E proportional.

Preferred critical Phase 9 E2E:

ADMIN login
→ create unique test batch
→ upload/configure test template
→ create/import participants
→ trigger generation
→ background execution
→ successful Certificate becomes GENERATED
→ deliberately unfit participant becomes FAILED
→ batch reaches terminal generation state
→ successful PDF exists in private storage
→ failed participant has no successful output path
→ reload persists results

Do not require Phase 10 retry UI.

The production font MUST NOT use the test-only fixture.

For automated test environment only:

an explicitly isolated test rendering configuration may reference the licensed
test fixture.

Ensure there is no code path allowing that test fixture to become production
fallback.

==================================================
TEST DATA HYGIENE
==================================================

Use unique test-owned IDs/names.

Cleanup only exact resources created by the test.

No:

deleteMany({})
storage bucket wipe
global cleanup
shared-state resets

Account for DB relation ordering.

Do not remove user-owned template/output objects.

==================================================
OBSERVABILITY
==================================================

Use concise structured server logs where useful.

Do not log:

- font bytes
- PDF bytes
- Supabase keys
- Inngest secrets
- database URLs

Useful identifiers:

- batchId
- participantId
- certificateId
- generation identity
- status transition
- safe error code

Avoid excessive noisy logging.

==================================================
SECURITY
==================================================

Generated files remain private.

No public signed URL is required for Phase 9.

Do not expose storage paths to unauthenticated clients.

No participant name in object filenames.

No arbitrary filesystem path loading from fontAssetPath.

No browser-accessible service-role credentials.

==================================================
NO UNRELATED CHANGES
==================================================

Do not modify:

- Phase 5 coordinate semantics
- Phase 6 duplicate participant rules
- Phase 8 fitting algorithm
- template upload/replacement architecture
- public routes
- publish logic

unless an actual prerequisite defect is found.

If a defect is found:
document the narrow correction separately.

==================================================
VERIFICATION GATES
==================================================

After implementation run:

bun run prisma validate
bun run prisma generate
bun run prisma migrate status
bun run typecheck
bun run lint
bun run test
bun run test:e2e
bun run build

Also run:

- Inngest function registration verification
- generation worker integration tests
- Supabase generated-output storage verification
- idempotency/retry verification
- failure-isolation verification

Classify each result:

PASS
FAIL
NOT VERIFIED

Never convert skipped/live-unavailable checks to PASS.

==================================================
DOCUMENTATION
==================================================

After successful implementation update:

docs/LOG.md

Record:

- Inngest SDK version actually installed
- event contracts
- function topology
- generation identity strategy
- retry policy
- concurrency policy
- batch lifecycle transitions
- Certificate lifecycle transitions
- output bucket/path strategy
- storage idempotency behavior
- failure taxonomy
- production font status
- automated verification
- live Inngest verification status
- live Supabase verification status
- migration(s), if any
- unresolved risks
- next action:
  Phase 10 — Generation Management

Update docs/FSD.md only where Phase 9 establishes a durable technical
contract that future phases must rely on.

Do not rewrite PRD for implementation convenience.

==================================================
PLANNING REQUIREMENTS
==================================================

You are in /plan mode.

DO NOT IMPLEMENT YET.

Before proposing the plan:

1. inspect actual current schema;
2. inspect actual Phase 7/8 rendering APIs;
3. inspect current font configuration status;
4. inspect Supabase storage helpers/bucket setup;
5. inspect installed Inngest state/version;
6. verify current Next.js App Router structure;
7. determine whether current Certificate schema supports robust generation
   identity;
8. determine exact DRAFT → READY → GENERATING → GENERATED transition;
9. design durable enqueue/idempotency behavior;
10. design participant fan-out;
11. design storage retry semantics;
12. define participant domain vs transient failure handling;
13. design race-safe batch finalization;
14. determine if any migration is genuinely necessary;
15. produce a concise reviewable implementation plan.

==================================================
MANDATORY PLAN ANSWERS
==================================================

The plan MUST explicitly answer:

1. Is a Prisma migration required? Why/why not?

2. What exactly is the generation-attempt identity?

3. Where is that identity persisted?

4. How is an HTTP double-submit prevented from generating twice?

5. How is an Inngest duplicate/replay prevented from generating twice?

6. What happens if DB preparation succeeds but sending the initial Inngest
   event fails?

7. What happens if output upload succeeds but Certificate DB finalization
   fails?

8. What exact storage path is used?

9. Are output objects immutable?

10. What happens when one participant has NameDoesNotFitError?

11. What happens when Supabase temporarily times out?

12. How are 100 participants fanned out without unbounded concurrency?

13. How does the batch know every participant reached a terminal state?

14. What happens when all participants fail?

15. What conditions produce BatchStatus.FAILED?

16. What is the automatic Inngest retry configuration?

17. How are stale participant events rejected?

18. How are font bytes resolved safely?

19. What exact `fontConfig` shape is required?

20. How is production font NOT CONFIGURED handled?

21. What exact Inngest environment variables are required?

22. Which verification is unit/local vs actually live?

23. What responsibilities remain explicitly deferred to Phase 10?

==================================================
MANDATORY ESCALATION CONDITIONS
==================================================

Stop for human review if the plan discovers:

- current schema cannot safely distinguish generation attempts;
- a migration is required;
- current Certificate uniqueness prevents the intended safe lifecycle;
- real production font must be selected/provisioned before implementation
  can proceed;
- fontConfig product values require a human visual decision;
- current Inngest account/SDK limitation materially changes architecture;
- all-participants-failed batch state cannot be resolved consistently from
  existing source-of-truth;
- Phase 9 would require implementing Phase 10/11 behavior.

Do not hide these behind arbitrary defaults.

==================================================
DEFINITION OF DONE
==================================================

Phase 9 will eventually be complete only when:

- generation trigger is ADMIN-only
- shared preflight is deterministic
- initial generation is background-driven
- one active Certificate exists per participant
- generation identity is robust
- duplicate enqueue is safe
- participant workers are independently isolated
- concurrency is bounded
- Inngest retries transient failures
- deterministic domain failures become participant FAILED
- successful participants remain GENERATED
- successful PDFs persist privately in Supabase
- outputs use immutable/versioned ID-based paths
- DB never points at an unconfirmed upload
- duplicate/stale events are safe
- batch finalization is race-safe
- mixed participant success/failure completes without rollback
- production font absence never causes silent fallback
- no Phase 10 retry UI exists
- no publish/public functionality exists
- earlier regression gates remain green
- live checks are truthfully classified
- documentation matches actual implementation

Final completion report must contain:

1. Architecture/topology
2. Schema/migration decision
3. Generation identity/idempotency
4. Batch lifecycle
5. Certificate lifecycle
6. Inngest event/function contracts
7. Retry + concurrency policy
8. Failure taxonomy/isolation
9. Font/fontConfig handling
10. Supabase output-storage strategy
11. Storage retry/idempotency behavior
12. Race-safe batch finalization
13. Files materially changed
14. Automated test evidence
15. Live Inngest verification
16. Live Supabase verification
17. Canonical gate results
18. Production-font status
19. Scope check
20. Blockers/risks
21. Readiness for Phase 10