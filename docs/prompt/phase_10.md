You are working on AutoCertif — Certificate Generator System.

Plan:

PHASE 10 — GENERATION MANAGEMENT

Phase 9 is COMPLETE / FULL PASS.

Phase 10 builds the ADMIN-facing generation-management layer on top of the
existing Phase 9 background-generation infrastructure.

Core goals:

- review generation results
- show failed participants and safe failure reasons
- show generation progress/state
- retry/regenerate ONE participant/certificate
- regenerate the WHOLE batch
- preserve previous successful outputs safely during regeneration
- reuse the existing Inngest pipeline and generation identity model

Do NOT begin publish/public functionality.

==================================================
SOURCE OF TRUTH
==================================================

Before planning, inspect the actual current repository:

- AGENTS.md
- docs/PRD.md
- docs/FSD.md
- docs/LOG.md
- prisma/schema.prisma
- latest Phase 9 migration
- current generation domain modules
- current Inngest functions/events
- current generation API/action
- current GenerationSection UI
- current batch queries
- current tests

Specifically inspect:

CertificateBatch:
- status
- currentGenerationKey
- publishedAt
- deletedAt

Certificate:
- participantId
- batchId
- status
- generationKey
- generatedFilePath
- generatedAt
- generationError
- isStale
- deletedAt

Phase 9 implementation:
- initialization
- preflight
- checkAndFinalizeBatch
- generate-batch orchestrator
- generate-participant worker
- participant worker onFailure
- generation trigger/resume route
- storage upload helper
- font-config/font registry
- current UI polling

Do not assume the Phase 9 plan exactly equals implementation.
Inspect actual code first.

==================================================
CURRENT VERIFIED PHASE 9 CONTRACT
==================================================

Phase 9 established:

Batch lifecycle:

DRAFT
→ GENERATING
→ GENERATED

BatchStatus.FAILED:
reserved for unrecoverable orchestration-level failure.

Certificate lifecycle:

PENDING
→ GENERATING
→ GENERATED | FAILED

Generation identity:

CertificateBatch.currentGenerationKey
Certificate.generationKey

Storage path:

certificates/{batchId}/{participantId}/{generationKey}.pdf

Generated outputs:
- private Supabase Storage
- new path across generation attempts
- same-attempt retry may recover the same deterministic path

Worker:
- concurrency limit = 5
- retries = 3
- participant-specific domain failures are isolated
- stale generationKey events are rejected
- batch finalization is race-safe

Production font:
NOT CONFIGURED

Never use test-font.ttf as production fallback.

==================================================
PHASE 10 PRODUCT REQUIREMENTS
==================================================

ADMIN must be able to:

1. inspect generation summary;
2. see every participant and its certificate generation status;
3. clearly identify failed participant names;
4. see safe/actionable failure reason;
5. retry/regenerate one participant/certificate;
6. regenerate the entire active batch;
7. observe generation progress;
8. see the final result after background work completes.

Failure of one participant must remain isolated.

Do not expose:
- stack traces
- storage secrets
- Inngest secrets
- raw service errors
- private storage implementation unnecessarily.

==================================================
STRICT PHASE BOUNDARY
==================================================

Phase 10 owns:

- ADMIN generation management page/UI
- generation summary/counts
- participant generation status table
- safe failure display
- individual retry/regeneration
- whole-batch regeneration
- progress polling/revalidation
- generation-operation state transitions required for retry/regeneration
- safe preservation of an existing successful output during an UNPUBLISHED
  regeneration attempt

Phase 10 MUST NOT implement:

- participant editing on GENERATED/PUBLISHED batches
- template editing outside DRAFT
- published-participant edit workflow
- publish / unpublish
- public search
- public certificate preview
- public certificate download
- certificate email/WhatsApp delivery
- storage cleanup/history UI
- arbitrary generation-attempt history/audit UI

Published safe replacement belongs to Phase 11.

Do not expand scope.

==================================================
CRITICAL GENERATION IDENTITY SEMANTICS
==================================================

Phase 10 introduces individual regeneration.

This changes an important Phase 9 assumption.

After an INDIVIDUAL regeneration:

CertificateBatch.currentGenerationKey
identifies the most recent/current generation OPERATION.

Certificate.generationKey
identifies the latest generation attempt for THAT certificate.

Therefore after an individual retry:

NOT every Certificate in the batch will necessarily share
batch.currentGenerationKey.

Example:

Batch currentGenerationKey = Attempt B

Participant A certificate generationKey = Attempt B
Participant B certificate generationKey = Attempt A
Participant C certificate generationKey = Attempt A

This is valid.

Do NOT retain a Phase 9 invariant that all certificates must always have the
same generationKey.

Batch finalization for a current operation must only consider Certificates
participating in:

generationKey == batch.currentGenerationKey

Summary UI should consider ALL active certificates regardless of historical
generationKey.

Document this semantic explicitly.

==================================================
EVERY MANUAL REGENERATION GETS A NEW GENERATION KEY
==================================================

Every Phase 10 generation operation must create a fresh UUID generationKey.

This applies to:

- retry failed participant
- regenerate successful participant
- regenerate whole batch
- retry/recover a failed generation operation where a new operation is
  intentionally started

Do NOT reuse an old completed generationKey for a new regeneration.

Reasons:

- stale-event rejection
- new storage path
- no old/new output collision
- reliable Inngest event identity
- future Phase 11 compatibility

Do not depend on Inngest's 24-hour event-ID deduplication as long-term
identity.

==================================================
INDIVIDUAL RETRY / REGENERATION
==================================================

Support both:

FAILED certificate
→ "Retry"

GENERATED certificate
→ "Regenerate"

For an UNPUBLISHED batch only.

Preferred flow:

ADMIN requests participant regeneration
↓
shared generation preflight
↓
generate fresh generationKey
↓
atomic transaction:
  - revalidate batch state
  - revalidate participant/certificate relationship
  - batch GENERATED → GENERATING
  - batch.currentGenerationKey = new generationKey
  - target Certificate.generationKey = new generationKey
  - target Certificate.status = PENDING
  - clear latest generationError
  - preserve existing successful generatedFilePath/generatedAt
  - set isStale appropriately when an old successful output exists
↓
send existing batch generation event
↓
existing orchestrator finds only PENDING certificates for current key
↓
fan-out one participant event
↓
worker renders/uploads
↓
success or failure
↓
checkAndFinalizeBatch
↓
batch → GENERATED

Do not create an entirely separate synchronous renderer.

Reuse Phase 9 background architecture.

==================================================
WHY USE THE EXISTING BATCH ORCHESTRATOR
==================================================

Prefer reusing:

autocertif/generation.batch.requested

even for one-participant regeneration.

For an individual operation:

only the target Certificate has:

generationKey == batch.currentGenerationKey
AND
status == PENDING

Therefore the existing orchestrator naturally fans out one worker.

Do not invent a second generation pipeline unless actual code structure makes
reuse unsafe.

==================================================
WHOLE-BATCH REGENERATION
==================================================

Whole-batch regeneration should:

- use a fresh generationKey;
- include all active participants/certificates;
- preserve previous successful generated outputs until replacements succeed;
- move batch into GENERATING atomically;
- set every participating certificate to PENDING with new generationKey;
- dispatch through the existing batch orchestrator;
- use Phase 9 bounded worker concurrency;
- return batch to GENERATED when all current-attempt certificates are
  terminal.

Do NOT delete old generated PDF objects when regeneration starts.

New attempt:
→ new generationKey
→ new storage path

Old objects may remain for later cleanup.

==================================================
SAFE PRE-PUBLISH REPLACEMENT
==================================================

Although published safe replacement is Phase 11, Phase 10 regeneration should
not unnecessarily destroy a previous successful output.

If a Certificate already has:

generatedFilePath != null

when regeneration begins:

PRESERVE:
- generatedFilePath
- generatedAt

Mark the certificate stale/in-progress using existing state fields.

On regeneration SUCCESS:

- status = GENERATED
- generatedFilePath = NEW generationKey path
- generatedAt = new timestamp
- generationError = null
- isStale = false

On regeneration FAILURE:

- status = FAILED
- generationError = latest safe error
- KEEP previous generatedFilePath if one existed
- KEEP previous generatedAt if one existed
- isStale = true when that previous output exists

If there was never a successful output:

- generatedFilePath remains null
- generatedAt remains null
- isStale should not falsely imply that an older successful output exists

Do not delete previous successful storage objects.

This prepares Phase 11 without implementing public/published behavior.

==================================================
IMPORTANT WORKER AUDIT
==================================================

Inspect Phase 9 participant failure handlers.

They may currently assume initial generation and do something like:

generatedAt = null
generatedFilePath = null

That may be correct for first generation but WRONG for regeneration when a
previous successful output exists.

Refactor narrowly so failure updates only latest attempt state/error and
preserves previous successful output where appropriate.

Do not weaken initial-generation behavior.

==================================================
BATCH STATUS DURING MANAGEMENT
==================================================

Normal Phase 10 actions:

GENERATED
→ GENERATING
→ GENERATED

For individual retry/regeneration:
only one certificate may participate in current generationKey.

For whole-batch regeneration:
all active certificates participate.

PUBLISHED:
must be rejected in Phase 10.

DRAFT:
use the existing Phase 9 initial-generation trigger, not Phase 10 regeneration.

GENERATING:
new regeneration requests are rejected.

No concurrent generation-management operation for the same batch.

==================================================
BATCH FAILED STATE
==================================================

Inspect actual Phase 9 semantics for BatchStatus.FAILED.

FAILED means orchestration-level failure, not participant failure.

Phase 10 should provide a minimal recoverable path.

Preferred direction:

"Retry generation operation"

using a FRESH generationKey.

Determine the target certificate set from the failed operation safely.

Do not reuse a failed Inngest event ID merely hoping provider dedup/replay
semantics will restart it.

Do not reset FAILED → DRAFT merely to reuse initial-generation code.

The plan MUST explicitly explain:

- how FAILED batch recovery works;
- whether it retries only certificates that belonged to the failed operation;
- how stale old workers are prevented from affecting the recovery attempt.

If current state does not safely identify the target set:
surface that issue instead of guessing.

==================================================
PRE-FLIGHT REUSE
==================================================

Phase 9 preflight may currently require:

batch.status === DRAFT

Do NOT duplicate the entire preflight for Phase 10.

Refactor toward reusable shared validation:

validate generation prerequisites:
- batch active
- template active
- namePlacement valid
- font asset resolves
- fontConfig valid
- source template exists
- required participants active/valid

Then operation-specific state validation:

INITIAL:
DRAFT

INDIVIDUAL REGEN:
GENERATED

WHOLE-BATCH REGEN:
GENERATED

FAILED-OPERATION RECOVERY:
FAILED, if safely supported

Keep product-state rules explicit.

==================================================
TRANSACTION / CONCURRENCY SAFETY
==================================================

Every regeneration initializer must be atomic.

Inside the Prisma transaction:

- re-read current batch
- verify expected status
- verify currentGenerationKey has not changed since request context
- verify active template identity/config is still expected
- verify target participant/certificate still belongs to batch and is active
- generate/apply one new generationKey
- update target Certificate(s)
- update batch currentGenerationKey
- transition batch → GENERATING

Use conditional updates/CAS semantics.

Double click / concurrent regeneration requests:

only one may succeed.

The loser receives a safe "generation already started" result.

==================================================
EVENT DELIVERY GAP / RESUME
==================================================

DB transaction commits BEFORE external Inngest event delivery.

Therefore preserve the Phase 9 recovery property.

If:

DB regeneration initialization succeeds
but
initial event delivery fails

the batch may be:

GENERATING
+
current attempt Certificates = PENDING

The existing narrow Resume mechanism should work for:

- one-participant operation
- whole-batch operation

Do NOT assume every Certificate in the batch must be PENDING.

Resume eligibility should be based on:

batch.currentGenerationKey
+
current-attempt certificates
+
their statuses

Reuse the SAME current generationKey for dispatch recovery.

This is dispatch recovery, not a new regeneration.

==================================================
EVENT IDEMPOTENCY
==================================================

New intentional regeneration:
→ fresh generationKey
→ fresh event IDs

Retrying event DELIVERY for the same already-initialized operation:
→ same generationKey
→ existing idempotency/DB guards

Keep DB state authoritative.

Do not rely solely on Inngest's provider-level dedup window.

==================================================
INNGEST CANCELLATION
==================================================

Do NOT add cancelOn/cancellation merely because Inngest supports it.

GenerationKey CAS guards already protect stale attempts.

Cancellation can be considered only if actual implementation evidence shows
a concrete need to save compute.

Even if cancellation is used, DB generationKey checks remain mandatory,
because cancellation occurs around durable step boundaries and is not a
replacement for state correctness.

==================================================
GENERATION MANAGEMENT QUERY
==================================================

Create/reuse a server-side query returning only data required by ADMIN UI.

Conceptually:

{
  batch: {
    id,
    status,
    currentGenerationKey
  },
  summary: {
    total,
    generated,
    failed,
    pending,
    generating,
    stale
  },
  participants: [
    {
      participantId,
      name,
      certificateId,
      certificateStatus,
      safeGenerationError,
      generatedAt,
      hasPreviousOutput,
      isStale
    }
  ]
}

Do NOT return:

- service-role credentials
- signed storage secrets
- raw storage provider errors
- stack traces
- font paths/bytes
- unnecessary private storage internals

Do not expose generatedFilePath directly in UI unless an existing admin
internal need specifically requires it.

==================================================
ADMIN UI
==================================================

Prefer a dedicated management route:

/admin/batches/[batchId]/generation

unless actual repository conventions strongly favor another structure.

Batch detail:
→ "Manage Generation"

Generation page should remain restrained and functional.

Recommended structure:

Header:
- batch name
- batch generation status

Compact summary:
- Total
- Generated
- Failed
- In Progress

Participant table:
- Participant
- Status
- Last Generated
- Failure / State
- Action

Actions:

FAILED
→ Retry

GENERATED
→ Regenerate

Batch-level:
→ Regenerate Batch

During GENERATING:
- disable regeneration actions
- show current progress
- poll/revalidate

Do not create decorative dashboard cards everywhere.

Reuse shadcn/ui and SMK Telkom Malang theme tokens.

No gradients.
No flashy progress animation.

==================================================
FAILURE DISPLAY
==================================================

ADMIN must see failed participant name + actionable safe reason.

Prefer mapping generation errors into:

code
+
human-readable safe message

Examples:

NAME_DOES_NOT_FIT
"Name could not fit safely within the configured certificate area."

UNSUPPORTED_GLYPH
"The configured font does not support one or more characters in this name."

INFRASTRUCTURE_FAILURE
"Generation could not complete because of a temporary system failure."

Do not expose:
- stack trace
- raw Supabase error
- Prisma internals
- absolute filesystem path

Preserve diagnostic code for debugging.

==================================================
POLLING / PROGRESS
==================================================

Phase 9 currently uses approximately 3-second polling.

Reuse the existing simplest pattern unless there is evidence it is inadequate.

Poll only while:

batch.status === GENERATING

Stop polling once terminal.

Do NOT add:

- WebSockets
- Supabase Realtime
- SSE
- a new state library

unless actual requirements demand it.

For ~100 participants, simple polling is sufficient.

==================================================
FILTERING
==================================================

Because batch target is approximately 100 participants:

keep filtering proportional.

Useful minimal filters:

- All
- Failed
- Generated
- In Progress

Do not build advanced data-grid infrastructure unless already present.

Participant names may duplicate.

Never identify a row by participant name.

Use IDs.

==================================================
CONFIRMATION UX
==================================================

Regenerate whole batch is a destructive-ish operational action because it
starts expensive background work.

Require a clear confirmation dialog.

Explain:

- all active participant certificates will be regenerated;
- existing successful outputs are retained until replacement succeeds;
- background processing may take time.

Individual retry/regenerate may use a lighter confirmation if existing UI
patterns justify it.

Avoid browser `window.confirm` if shadcn dialog is already available.

==================================================
PRODUCTION FONT STATUS
==================================================

Production Font remains:

NOT CONFIGURED

Do not hide this debt.

Generation actions in a production-like configuration must continue to fail
preflight cleanly until a production font is registered.

Tests may use the licensed test-only font ONLY through explicit test setup.

Never register the test fixture into PRODUCTION_FONT_REGISTRY.

==================================================
NO NEW SCHEMA UNLESS REQUIRED
==================================================

Expected:

NO Prisma migration.

The existing:

- CertificateBatch.currentGenerationKey
- Certificate.generationKey
- Certificate.generatedFilePath
- Certificate.generatedAt
- Certificate.generationError
- Certificate.isStale

should be sufficient for Phase 10 current-state management.

Do NOT add:

- GenerationAttempt table
- job history table
- retry history table
- audit log table
- previousGeneratedFilePath

unless repository inspection proves current schema cannot safely satisfy the
required behavior.

Old generated objects may remain in storage without DB history.

If a migration genuinely becomes necessary:
STOP for human review before implementation.

==================================================
STORAGE RULES
==================================================

Every intentional regeneration:

fresh generationKey
→ fresh object path

certificates/{batchId}/{participantId}/{generationKey}.pdf

Never use participant name.

Do not delete previous successful output during Phase 10.

Do not implement orphan cleanup.

Do not generate public URLs.

==================================================
TESTING — MANAGEMENT QUERY/UI
==================================================

Cover:

- ADMIN-only access
- deleted/nonexistent batch rejected/not-found
- summary counts correct
- duplicate participant names appear as separate rows
- failure name + safe reason visible
- raw internal errors/path not exposed
- status filters work
- polling only while GENERATING
- buttons disabled while active generation is running

==================================================
TESTING — INDIVIDUAL RETRY
==================================================

Verify:

FAILED certificate
→ new generationKey
→ batch GENERATED → GENERATING
→ target certificate PENDING
→ other certificates untouched
→ orchestrator fans out only target
→ success → GENERATED
→ batch returns GENERATED

Also:

successful Certificate
→ Regenerate
→ fresh generationKey
→ previous generatedFilePath remains until success
→ new output path differs from old
→ success atomically changes current generatedFilePath
→ old object is not deleted

==================================================
TESTING — REGENERATION FAILURE
==================================================

Critical case:

previous successful Certificate exists
↓
regenerate
↓
new attempt fails deterministically

Verify:

- status = FAILED
- latest safe generationError exists
- PREVIOUS generatedFilePath is preserved
- PREVIOUS generatedAt is preserved
- isStale = true
- previous object still exists in storage
- batch reaches GENERATED
- other certificates remain unchanged

This is required preparation for Phase 11.

==================================================
TESTING — WHOLE BATCH REGEN
==================================================

Verify:

- fresh batch currentGenerationKey
- all active Certificates participating receive fresh same generationKey
- all set PENDING atomically
- previous successful file references are initially preserved
- worker fan-out uses bounded Phase 9 concurrency
- successful replacements receive new paths
- failures preserve previous successful paths where available
- all current-attempt terminal → batch GENERATED
- participant failures do not roll back successes

==================================================
TESTING — GENERATION IDENTITY SEMANTICS
==================================================

Explicitly test:

Initial bulk:
all cert keys may equal batch key

After individual regeneration:
only target cert key equals new batch.currentGenerationKey

Other Certificates retain their previous generationKeys.

This MUST be treated as valid.

Stale Attempt A event:
cannot mutate Attempt B.

Old successful output:
cannot be overwritten by new generation path.

==================================================
TESTING — DOUBLE SUBMIT
==================================================

Concurrent requests:

individual retry + individual retry
individual retry + whole-batch regenerate
whole-batch regenerate + whole-batch regenerate

Only one initialization may transition:

GENERATED → GENERATING

No duplicate current operation.
No duplicate generation identity.
No certificate state corruption.

==================================================
TESTING — FAILED BATCH RECOVERY
==================================================

After repository inspection, test the approved FAILED recovery strategy.

At minimum:

- old generationKey becomes stale
- recovery gets fresh generationKey
- old events cannot modify recovered attempt
- affected target set is deterministic
- recovery can reach terminal GENERATED

Do not silently convert batch failure into participant failures.

==================================================
E2E
==================================================

Add proportional critical E2E coverage.

Preferred test flow in isolated test configuration:

ADMIN login
→ generated test batch with:
   one GENERATED participant
   one FAILED participant
→ open generation management
→ summary visible
→ failed name + safe reason visible
→ Retry failed participant
→ background processing
→ participant reaches terminal state
→ batch returns GENERATED
→ Regenerate a successful participant
→ fresh output path
→ whole-batch regenerate
→ all terminal
→ reload
→ state persists

Use explicit TEST-ONLY font configuration.

Production font registry must remain untouched.

If full real Inngest execution cannot run:
truthfully distinguish direct integration simulation from local/cloud Inngest.

==================================================
REGRESSION
==================================================

Do not break:

- initial Phase 9 generation
- Phase 9 Resume dispatch
- stale event protection
- worker retry exhaustion
- failure isolation
- rendering/fitting
- participants
- position editor
- template upload
- auth

Run the full existing E2E suite, not only Phase 10 specs.

==================================================
CANONICAL VERIFICATION
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

Expected:
NO NEW PRISMA MIGRATION.

Additionally verify:

- individual retry integration
- individual regenerate integration
- regeneration failure preserving previous output
- whole-batch regeneration
- stale-event isolation
- double-submit protection
- Phase 9 initial generation regression
- private storage new-path behavior

Classify external verification:

PASS
FAIL
NOT VERIFIED

separately for:

- Inngest function registration
- local Inngest execution
- cloud Inngest execution
- live Supabase storage

Do not claim cloud Inngest PASS without actual cloud execution.

==================================================
DOCUMENTATION
==================================================

Update docs/LOG.md with actual implementation evidence.

Update docs/FSD.md only where Phase 10 establishes durable contracts such as:

- semantics of batch.currentGenerationKey after individual regeneration
- Certificate.generationKey semantics
- regeneration replacement behavior
- previous-output preservation
- FAILED batch recovery semantics

Do not rewrite PRD for implementation convenience.

Next action after successful Phase 10:

Phase 11 — Safe Update + Publish

==================================================
PLANNING REQUIREMENTS
==================================================

You are in /plan mode.

DO NOT IMPLEMENT YET.

Before proposing implementation:

1. inspect the actual Phase 9 implementation;
2. inspect actual Prisma schema/migration;
3. inspect generationKey guards;
4. inspect current worker success/failure mutations;
5. inspect current Resume logic;
6. inspect current GenerationSection;
7. inspect current batch-generation queries;
8. verify how FAILED orchestration state is represented;
9. verify whether previous generatedFilePath survives current worker failures;
10. determine the smallest Phase 10 architecture;
11. identify whether any schema migration is truly needed;
12. produce a concise, reviewable implementation plan.

==================================================
MANDATORY PLAN ANSWERS
==================================================

The plan MUST explicitly answer:

1. Is any Prisma migration required?

2. What exactly does batch.currentGenerationKey mean after Phase 10?

3. What exactly does Certificate.generationKey mean?

4. How does individual retry work without changing unrelated Certificates?

5. How does individual GENERATED certificate regeneration work?

6. How does whole-batch regeneration work?

7. Does every intentional regeneration receive a fresh generationKey?

8. How is the previous successful generatedFilePath preserved during retry?

9. What happens when regeneration fails after a previous successful output?

10. What happens when regeneration succeeds?

11. How does current batch finalization work when only ONE Certificate belongs
    to the current generationKey?

12. Does the existing orchestrator work unchanged for individual regeneration?

13. Does Resume work when only a subset of Certificates belongs to the current
    generationKey?

14. How does BatchStatus.FAILED recovery work?

15. Can an old Inngest event mutate a new regeneration attempt?

16. How are concurrent/double-submit regeneration requests prevented?

17. What generation-management route/UI is added?

18. What participant status/error fields are shown?

19. Is any private storage path exposed to the browser?

20. Which previous output fields are preserved on failure?

21. How is isStale used in Phase 10?

22. What remains explicitly deferred to Phase 11?

23. What is the production-font status?

24. Which verification is mocked/direct integration/local Inngest/cloud
    Inngest/live Supabase?

==================================================
MANDATORY ESCALATION CONDITIONS
==================================================

STOP for human review before implementation if:

- a new Prisma migration appears necessary;
- current generationKey model cannot safely support one-participant
  regeneration;
- preserving previous successful output requires destructive schema changes;
- FAILED batch recovery target cannot be determined safely;
- the solution requires implementing published replacement behavior;
- production font needs a human visual/business decision;
- Phase 10 would need public/publish functionality.

Do not paper over these with arbitrary defaults.

==================================================
DEFINITION OF DONE
==================================================

Phase 10 will eventually be complete only when:

- ADMIN can see generation summary
- ADMIN can see failed participant names
- safe failure reasons are visible
- individual FAILED retry works
- individual GENERATED regeneration works
- whole-batch regeneration works
- every intentional regeneration uses fresh generationKey
- unrelated Certificates are untouched by individual regeneration
- previous successful output survives failed regeneration
- successful regeneration swaps to new output
- old object is not deleted
- stale old events cannot mutate new attempt
- double-submit is safe
- batch finalization works for one or many target Certificates
- progress UI reflects actual state
- Phase 9 initial generation remains green
- no publish/public behavior was added
- production test font never becomes a fallback
- full regression suite passes
- docs match actual behavior

Final completion report must contain:

1. Management architecture
2. UI structure
3. Individual retry flow
4. Individual regeneration flow
5. Whole-batch regeneration flow
6. Generation-key semantics
7. Previous-output preservation behavior
8. Failure/recovery behavior
9. FAILED batch recovery
10. Concurrency/idempotency behavior
11. Files materially changed
12. Unit/integration tests
13. Full E2E results
14. Inngest verification status
15. Supabase verification status
16. Canonical gate results
17. Production-font status
18. Scope check
19. Remaining risks
20. Readiness for Phase 11