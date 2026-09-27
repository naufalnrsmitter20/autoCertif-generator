You are working on AutoCertif — Certificate Generator System.

Plan:

PHASE 11 — SAFE PUBLISHED UPDATE + BATCH PUBLISH / UNPUBLISH

Phase 10 is COMPLETE / FULL PASS.

This phase establishes a correct publication model and implements safe
published-participant name replacement.

The central invariant is:

PUBLICLY VISIBLE DATA MUST REPRESENT THE LAST SUCCESSFULLY PUBLISHED
CERTIFICATE, NOT MERELY THE LATEST EDIT OR LATEST GENERATION ATTEMPT.

Do not begin Phase 12 public search or Phase 13 public preview/download.

==================================================
SOURCE OF TRUTH
==================================================

Before planning, inspect the ACTUAL repository:

- AGENTS.md
- docs/PRD.md
- docs/FSD.md
- docs/LOG.md
- prisma/schema.prisma
- all migrations
- Phase 9 generation infrastructure
- Phase 10 management infrastructure
- participant CRUD/actions
- batch detail UI
- generation management UI
- Inngest orchestrator/worker
- checkAndFinalizeBatch
- generation preflight
- generated-certificate storage helpers
- all current tests

Do not assume earlier plans exactly match implementation.

Confirm the actual current fields on:

CertificateBatch:
- status
- currentGenerationKey
- publishedAt
- deletedAt

Participant:
- id
- batchId
- name
- deletedAt
- updatedAt

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

==================================================
LOCKED PRODUCT REQUIREMENTS
==================================================

Batch publishing:

- publication is a BATCH-level action;
- batch must have at least one eligible successfully generated certificate;
- failed participants do NOT prevent publishing successful participants;
- ADMIN must see failure count/names before publishing;
- failed certificates must remain unavailable publicly.

Unpublishing:

- removes the batch from public availability;
- does NOT delete generated files;
- does NOT hard-delete database records.

Published participant name edit:

edit participant name
↓
old published name/file remains live
↓
replacement generation runs asynchronously
↓
success:
  atomically switch published snapshot to new name + new PDF
↓
failure:
  keep previous published name + previous PDF
  surface failure to ADMIN

Never point public state at:

- a PENDING output
- a GENERATING output
- a failed output
- a missing storage object
- a new participant name paired with an old certificate PDF

==================================================
CRITICAL ARCHITECTURE PROBLEM
==================================================

The existing Phase 10 schema tracks:

Participant.name
Certificate.generatedFilePath
Certificate.generatedAt
Certificate.status
Certificate.isStale

Those fields represent CURRENT application/generation state.

They may NOT be sufficient to represent the independent state:

"What exact participant name and PDF are currently published?"

Example:

Published snapshot:
name = "Budi"
PDF = A.pdf

ADMIN edits participant:
"Budi" → "Budi Santoso"

While regeneration is running or if it fails:

Participant.name = "Budi Santoso"

but public users MUST still see/search:

published name = "Budi"
published PDF = A.pdf

If public search later reads Participant.name with the old PDF,
the system is semantically inconsistent.

Therefore explicitly evaluate whether Phase 11 requires a minimal publication
snapshot.

Strong expected direction:

Certificate.publishedName String?
Certificate.publishedFilePath String?

Exact field naming may follow repository conventions.

The published snapshot represents:

- the exact participant name currently associated with the public certificate;
- the exact immutable storage object currently publicly eligible.

DO NOT add fields merely because this prompt suggests them if inspection
proves an equally safe existing representation already exists.

However:

DO NOT force zero migration if the existing schema cannot independently
represent published name + published file.

If a migration is required, explicitly present it for human review.

Do not implement until the plan is approved.

==================================================
MINIMAL SCHEMA PRINCIPLE
==================================================

If migration is required, prefer the smallest schema change.

Likely sufficient:

Certificate:
- publishedName String?
- publishedFilePath String?

Do NOT add unless proven necessary:

- Publication table
- publication history table
- publishedGenerationKey
- publishedAt per Certificate
- pending participant table
- revision table
- audit/event log table
- duplicate Certificate rows per version

Batch already has:

publishedAt

Generated object paths are already immutable/version-isolated by
generationKey.

Keep architecture proportional to this MVP.

==================================================
PUBLICATION STATE SEMANTICS
==================================================

Treat publication and generation as related but distinct concerns.

Recommended durable contract:

CertificateBatch.publishedAt != null
→ batch is currently publicly enabled

Certificate.publishedFilePath != null
+
Certificate.publishedName != null
→ that Certificate has a currently published snapshot

Future Phase 12/13 eligibility should conceptually require:

batch.publishedAt != null
participant active
certificate active
publishedFilePath != null
publishedName != null

IMPORTANT:

Do NOT make future public eligibility depend solely on:

batch.status === PUBLISHED

because during safe replacement the batch may need to enter operational:

GENERATING

while the previous published snapshot must remain available.

The plan must explicitly determine and document:

- whether `publishedAt` becomes the authoritative publication flag;
- how BatchStatus interacts with publication while generation runs.

==================================================
RECOMMENDED BATCH STATE MODEL
==================================================

At steady state:

GENERATED + publishedAt == null
→ generated but unpublished

PUBLISHED + publishedAt != null
→ published and idle

During a published participant replacement:

PUBLISHED
↓
GENERATING

BUT:

publishedAt MUST remain non-null.

Therefore the previously published snapshot remains publicly eligible.

When replacement operation reaches terminal state:

if publishedAt != null:
  batch returns to PUBLISHED

else:
  batch returns to GENERATED

This likely requires generalizing:

checkAndFinalizeBatch(...)

so terminal status becomes publication-aware.

Do NOT blindly hard-code:

GENERATING → GENERATED

for every operation anymore.

==================================================
ORCHESTRATION FAILURE WHILE PUBLISHED
==================================================

A published replacement may suffer an orchestration-level failure.

In that case:

batch.status may become FAILED

BUT:

batch.publishedAt remains non-null
publishedName remains unchanged
publishedFilePath remains unchanged

Therefore old public certificates remain available.

Batch operational failure must NOT silently unpublish already published
certificates.

Recovery should continue using Phase 10 generationKey safety.

On successful recovery completion:

if publishedAt != null
→ return batch to PUBLISHED

Do not replace published snapshots until successful rendering.

==================================================
INITIAL BATCH PUBLISH
==================================================

Publish is allowed only from a stable generated state.

Expected prerequisites:

- ADMIN authenticated
- batch exists and active
- batch.status == GENERATED
- batch.publishedAt == null
- template exists and active
- no active generation operation
- at least one active eligible Certificate

Define eligible Certificate strictly.

Recommended initial eligibility:

participant active
certificate active
certificate.status == GENERATED
certificate.generatedFilePath != null
certificate.generatedAt != null
certificate.isStale == false

A FAILED Certificate with an old/stale generatedFilePath is NOT automatically
eligible for initial publication.

Reason:

"previous successful generation exists"
is not equivalent to
"latest certificate state is successful and ready to publish."

The plan must explicitly answer this.

==================================================
ATOMIC PUBLISH SNAPSHOT
==================================================

Publish must establish a coherent snapshot.

Within one DB transaction:

1. revalidate batch still GENERATED and unpublished;
2. re-read eligible active Certificates;
3. verify at least one eligible Certificate exists;
4. populate publication snapshot for each eligible Certificate:
   publishedFilePath = generatedFilePath
   publishedName = current Participant.name
5. ensure ineligible active Certificates do NOT receive a published snapshot;
6. set:
   batch.publishedAt = now
   batch.status = PUBLISHED

Do not perform slow Supabase/network calls inside the Prisma transaction.

Phase 9 already guarantees generatedFilePath is stored only after successful
upload.

Use DB invariants and storage integration tests rather than opening network
requests inside the publish transaction.

Prisma transactions should remain short.

==================================================
REPUBLISH SEMANTICS
==================================================

A previously unpublished batch may later be published again.

Do not blindly reuse old publication snapshots.

On each new publish operation:

recompute publication eligibility from CURRENT generation state.

Then:

- eligible current Certificates get fresh publication snapshots;
- ineligible current Certificates must not retain an old snapshot that could
  accidentally become public again.

The plan must define whether this is implemented by:

- clearing/rebuilding snapshots during publish,
or
- an equivalent safe transactional strategy.

A Certificate whose latest regeneration is FAILED/isStale must not become
newly public merely because it has an old generatedFilePath.

==================================================
PUBLISH WITH FAILURES
==================================================

Publishing is allowed with participant-level failures.

Example:

100 participants
95 eligible GENERATED
5 FAILED

Publish confirmation must clearly show:

95 certificates will be published
5 participants will remain unavailable

Display failed participant names.

Do not require 100% generation success.

Do not silently hide failures.

==================================================
PUBLISH DOUBLE-SUBMIT / STALE REQUEST SAFETY
==================================================

Use optimistic concurrency.

Publish request should carry the relevant expected state visible to the ADMIN,
including:

expectedCurrentGenerationKey

Inside transaction require:

batch.id == batchId
batch.status == GENERATED
batch.publishedAt == null
batch.currentGenerationKey == expectedCurrentGenerationKey
batch.deletedAt == null

If state changed:

return conflict.

Do not let a stale browser page publish an obsolete generation result.

==================================================
UNPUBLISH
==================================================

Unpublish must be a visibility operation, not a storage deletion.

Required effects:

batch.publishedAt = null

No generated PDF object is deleted.

No participant/certificate is hard deleted.

The plan must define status behavior.

Recommended:

if batch.status == PUBLISHED:
  batch.status = GENERATED

If publication is removed during another operational state such as
GENERATING or FAILED:

prefer making `publishedAt = null` authoritative immediately while leaving
the operational status intact.

Then:

- GENERATING remains GENERATING;
- FAILED remains FAILED;
- future finalization sees publishedAt == null and resolves to GENERATED.

This makes Unpublish an immediate publication kill switch without canceling
generation.

If the actual architecture makes this unsafe, explain the exact reason.

Do NOT cancel Inngest work merely because the batch is unpublished.

==================================================
PUBLIC STORAGE SAFETY
==================================================

The Supabase `generated-certificates` bucket MUST remain private.

Do NOT:

- change bucket to public;
- create permanent public object URLs;
- expose service-role credentials;
- expose raw private storage paths as public contracts.

Phase 11 manages publication STATE only.

Phase 13 will implement controlled certificate delivery.

==================================================
PUBLISHED PARTICIPANT NAME EDIT
==================================================

Only implement the explicitly required published mutation:

participant NAME edit.

Do not automatically unlock arbitrary add/delete/template mutations on a
published batch.

Existing restrictions remain unless explicit source-of-truth says otherwise.

Published edit prerequisites:

- ADMIN authenticated
- batch active
- batch currently published
- participant active and belongs to batch
- Certificate active and belongs to participant/batch
- no active generation operation
- new name validates using existing Phase 6 normalization/rules
- new name differs meaningfully from existing normalized name
- production rendering prerequisites pass

Use a fresh generationKey.

==================================================
PUBLISHED EDIT TRANSACTION
==================================================

Preferred atomic initialization:

Before:
Participant.name = OLD
Certificate.publishedName = OLD
Certificate.publishedFilePath = OLD_FILE

ADMIN edits to NEW.

Transaction:

1. validate batch/publication/currentGenerationKey CAS;
2. update Participant.name = NEW;
3. batch:
   status = GENERATING
   currentGenerationKey = freshKey
   publishedAt remains UNCHANGED
4. target Certificate:
   generationKey = freshKey
   status = PENDING
   generationError = null
   isStale = true
   generatedFilePath remains last successful generated file
   generatedAt remains last successful time
   publishedName remains OLD
   publishedFilePath remains OLD_FILE

All unrelated Certificates remain untouched.

Then dispatch through the existing Phase 9/10 background orchestration.

Do NOT create a second renderer pipeline.

==================================================
CRITICAL NAME SNAPSHOT INVARIANT
==================================================

During published replacement:

Participant.name may already contain NEW.

However public state must continue using:

Certificate.publishedName = OLD

until the replacement PDF for NEW succeeds.

This prevents:

new searchable name
+
old PDF containing old name

from becoming publicly inconsistent.

Future public search Phase 12 should query publishedName, not mutable
Participant.name.

Document this durable contract in FSD.

==================================================
PUBLISHED REPLACEMENT SUCCESS
==================================================

Worker renders using CURRENT Participant.name.

New PDF uploads to:

certificates/{batchId}/{participantId}/{newGenerationKey}.pdf

After upload succeeds, atomically finalize Certificate for the same key.

If batch remains published:

Certificate:
- status = GENERATED
- generatedFilePath = newPath
- generatedAt = new timestamp
- generationError = null
- isStale = false
- publishedFilePath = newPath
- publishedName = current Participant.name

This is the publication cutover.

Old storage object is NOT deleted.

Public state switches only after successful new PDF upload.

==================================================
PUBLISHED REPLACEMENT FAILURE
==================================================

If deterministic generation fails:

Certificate:
- status = FAILED
- latest generationError = safe error
- isStale = true

Preserve:

- generatedFilePath / generatedAt according to existing Phase 10 contract
- publishedFilePath = OLD_FILE
- publishedName = OLD_NAME

Batch returns to PUBLISHED if publication remains enabled.

ADMIN sees:

current participant name = NEW
replacement failed
public certificate still uses OLD published snapshot

No public outage.

No broken file replacement.

==================================================
TRANSIENT RETRY EXHAUSTION
==================================================

Phase 10 already handles worker retry exhaustion.

Update the failure path carefully so a permanently failed replacement:

- marks latest attempt FAILED;
- preserves old publication snapshot;
- invokes race-safe publication-aware finalization;
- cannot leave batch stuck GENERATING.

Stale onFailure from old generationKey must remain unable to mutate a newer
attempt.

==================================================
RETRY FAILED PUBLISHED REPLACEMENT
==================================================

A published name-edit replacement may fail.

ADMIN needs a narrow recovery action:

Retry Replacement

Expected:

- batch published and idle;
- Certificate status FAILED;
- isStale == true;
- current Participant.name contains desired NEW name;
- old published snapshot remains available.

Retry:

- fresh generationKey;
- do NOT change Participant.name;
- keep publishedName/publishedFilePath unchanged;
- set Certificate PENDING;
- batch → GENERATING while keeping publishedAt;
- reuse existing orchestrator;
- success swaps published snapshot;
- failure keeps old snapshot.

Do not require ADMIN to edit the same name again merely to retry.

==================================================
PUBLISHED CERTIFICATE WITHOUT OLD SNAPSHOT
==================================================

Consider participants that were FAILED during initial publish and therefore
were never publicly available.

If the product allows repairing such a participant while the batch is
already published:

success may establish its FIRST publishedName/publishedFilePath.

failure leaves both null.

Do not automatically expose an old stale file.

Inspect PRD/FSD/current UI and determine whether this repair action belongs in
Phase 11.

If not explicitly justified, defer it rather than expanding scope.

==================================================
GENERATION FINALIZATION CONTRACT
==================================================

Generalize the shared finalization helper.

Conceptually:

checkAndFinalizeBatch(batchId, generationKey)

1. verify batch.currentGenerationKey == generationKey;
2. count PENDING/GENERATING Certificates for this operation;
3. if unfinished remain → no-op;
4. if none remain:
   if batch.publishedAt != null:
      GENERATING → PUBLISHED
   else:
      GENERATING → GENERATED

Use CAS/idempotent update.

It must work for:

- unpublished regeneration
- published participant replacement
- recovery after replacement
- whole-batch unpublished regeneration

Do not regress Phase 9/10 behavior.

==================================================
ORCHESTRATOR onFailure CONTRACT
==================================================

The batch orchestrator failure handler currently may set:

GENERATING → FAILED

Preserve:

publishedAt

and all published snapshots.

Therefore:

published batch replacement orchestration failure
→ operational status FAILED
→ public state remains active because publishedAt != null.

Old public PDF remains valid.

Recovery may later use a fresh generationKey.

==================================================
GENERATION MANAGEMENT UI INTEGRATION
==================================================

Do not create another parallel admin system.

Reuse/extensively adapt existing:

/admin/batches/[batchId]/generation

and batch detail.

Add publication controls proportionally.

Recommended batch controls:

GENERATED + unpublished:
→ Publish Batch

PUBLISHED:
→ Published indicator
→ Unpublish
→ generation management link

Published participant row:
→ Edit Name
→ if replacement failed/stale: Retry Replacement

Do not add:
- analytics
- history timeline
- publication audit dashboard
- arbitrary certificate version browser

==================================================
PUBLISH CONFIRMATION UI
==================================================

Before Publish:

show concise confirmation:

- number eligible for publication
- number unavailable/failed
- names of failed participants when any exist

Example:

95 certificates ready
5 participants will remain unavailable

[Failed names...]

Confirm Publish
Cancel

Use shadcn dialog.
Use existing SMK Telkom Malang theme tokens.

No gradients.
No excessive cards/animations.

==================================================
UNPUBLISH CONFIRMATION
==================================================

Explain:

- public availability will stop;
- generated certificate files are NOT deleted;
- ADMIN records remain.

Do not imply physical file deletion.

==================================================
PUBLISHED EDIT UX
==================================================

For published participant name editing:

show current administrative name.

If published snapshot differs:

display restrained state such as:

Current participant name:
Budi Santoso

Published as:
Budi

Replacement status:
Failed / Updating

Do not expose:
- bucket names
- raw storage paths
- generationKey
- internal DB IDs as certificate numbers.

==================================================
PUBLIC SEARCH / DOWNLOAD BOUNDARY
==================================================

Phase 11 MUST NOT implement:

- public `/search`
- public certificate result pages
- public PDF preview
- public PDF download
- signed URL issuance for visitors
- SEO/public certificate pages

However Phase 11 MUST leave an explicit durable contract for Phase 12/13:

Future public lookup uses:

batch.publishedAt != null
+
Certificate.publishedName
+
Certificate.publishedFilePath
+
active Participant/Certificate records

NOT:
mutable Participant.name alone
NOT:
latest Certificate.status alone
NOT:
generatedFilePath alone.

==================================================
SOFT DELETE SAFETY
==================================================

Do not broaden published deletion behavior without explicit requirement.

Existing soft-delete rules remain.

Future public query contracts must exclude:

- deleted batch
- deleted participant
- deleted Certificate

Published snapshot never overrides soft-deletion safety.

==================================================
PRODUCTION FONT DEBT
==================================================

Production font remains:

NOT CONFIGURED

Publishing existing successfully generated certificates does not itself need
font rendering.

However:

published participant edit/replacement
and retry replacement

DO require generation preflight and therefore remain blocked in real
production until an approved production font is configured.

Do NOT use test-font.ttf as a production fallback.

Tests may explicitly register the licensed test-only fixture.

==================================================
DATABASE TRANSACTION SAFETY
==================================================

Keep publication/regeneration transactions short.

Do not perform:

- Supabase download
- storage upload
- font file network load
- Inngest send

inside the DB transaction.

Use:

validate/preflight
↓
atomic DB state transition
↓
external event dispatch
↓
existing Resume/recovery semantics if delivery fails

Use CAS with expectedCurrentGenerationKey where generation identity matters.

==================================================
SCHEMA / MIGRATION REVIEW — CRITICAL
==================================================

The plan MUST explicitly determine whether publication snapshot fields are
required.

Answer:

Can the current schema correctly represent all three values simultaneously?

1. current Participant.name = NEW
2. public searchable name = OLD
3. public PDF = OLD_FILE

during a failed/in-progress published replacement.

If NO:

a migration is REQUIRED.

Do not claim existing `isStale` alone solves the public-name mismatch.

`isStale` indicates state quality; it does not store the historical published
name.

If migration is proposed:

STOP for human review before implementation.

==================================================
TESTING — INITIAL PUBLISH
==================================================

Cover:

- unauthorized publish rejected
- nonexistent/deleted batch rejected
- only GENERATED stable batch can publish
- stale expected generation key rejected
- zero eligible certificates rejected
- 100 GENERATED → all eligible
- mixed GENERATED/FAILED → successful subset publishes
- failed participant names surfaced before confirmation
- FAILED with stale old generatedFilePath is NOT accidentally published
- published snapshots match exact current successful name + file
- batch.publishedAt set
- batch status PUBLISHED
- double submit is idempotently rejected/conflicted

==================================================
TESTING — UNPUBLISH
==================================================

Cover:

- unpublish removes publication eligibility immediately
- publishedAt becomes null
- generatedFilePath untouched
- storage objects untouched
- participant/certificate records untouched
- re-publish recomputes snapshots from CURRENT eligibility
- old failed/stale snapshot cannot accidentally become public again

If supporting unpublish during active generation:

verify:
- generation continues safely;
- public flag disappears immediately;
- terminal finalizer resolves to GENERATED, not PUBLISHED.

==================================================
TESTING — PUBLISHED NAME EDIT
==================================================

Critical scenario:

Published:
Participant.name = "Budi"
publishedName = "Budi"
publishedFilePath = A.pdf

ADMIN edits:
"Budi Santoso"

Immediately after transaction:

Participant.name == "Budi Santoso"
publishedName == "Budi"
publishedFilePath == A.pdf
batch.publishedAt unchanged
Certificate.isStale == true
Certificate.status == PENDING
batch.status == GENERATING

Old public snapshot remains coherent.

==================================================
TESTING — PUBLISHED EDIT SUCCESS
==================================================

After successful render:

Participant.name == "Budi Santoso"
generatedFilePath == B.pdf
publishedName == "Budi Santoso"
publishedFilePath == B.pdf
isStale == false
Certificate.status == GENERATED
batch.status == PUBLISHED
batch.publishedAt unchanged

A.pdf still exists in storage.

==================================================
TESTING — PUBLISHED EDIT FAILURE
==================================================

Force deterministic name-fitting or glyph failure.

Verify:

Participant.name == NEW
Certificate.status == FAILED
generationError populated safely
isStale == true

BUT:

publishedName == OLD
publishedFilePath == OLD_FILE
OLD_FILE still exists
batch.status returns PUBLISHED
publishedAt remains unchanged

No public outage.

==================================================
TESTING — RETRY REPLACEMENT
==================================================

After failed published replacement:

Retry Replacement
→ fresh generationKey
→ published snapshot unchanged during retry
→ success swaps snapshot
→ failure preserves snapshot again

Stale old event cannot mutate the new retry.

==================================================
TESTING — PUBLICATION-AWARE FINALIZATION
==================================================

Verify:

unpublished regeneration:
GENERATING → GENERATED

published replacement:
GENERATING → PUBLISHED

published replacement orchestration failure:
status FAILED
publishedAt remains non-null
published snapshot remains intact

recovered published replacement:
terminal → PUBLISHED

==================================================
LIVE STORAGE VERIFICATION
==================================================

Use isolated test resources.

Verify with real Supabase Storage where credentials exist:

- old published object exists
- replacement writes a NEW generationKey path
- success points publication snapshot to new path
- old object not deleted
- failure leaves publication snapshot at old path
- unpublish does not delete objects

Never wipe shared buckets.

==================================================
E2E
==================================================

Add proportional critical Phase 11 E2E.

Suggested flow using isolated TEST-ONLY font:

ADMIN login
→ generated batch with success + failure
→ Publish
→ confirm failure warning
→ batch shows Published
→ edit name of a published participant
→ observe updating/stale state
→ successful replacement
→ batch returns Published
→ published snapshot now reflects new name
→ force/seed failed replacement case
→ verify old published snapshot preserved
→ retry replacement
→ Unpublish
→ verify publication state disabled
→ reload
→ state persists

Do NOT implement or require Phase 12 public search UI to test publication
domain behavior.

Use server/domain assertions for publication snapshot correctness.

==================================================
REGRESSION
==================================================

Do not break:

- Phase 9 initial generation
- Inngest worker failure isolation
- Resume dispatch
- Phase 10 individual retry
- Phase 10 individual regenerate
- Phase 10 whole-batch regeneration
- FAILED operation recovery
- stale event protection
- participant CRUD DRAFT behavior
- template/position restrictions
- auth
- existing E2E

Full regression E2E is required.

==================================================
CANONICAL VERIFICATION
==================================================

After implementation eventually run:

bun x prisma validate
bun x prisma generate
bun x prisma migrate status
bun run typecheck
bun run lint
bun run test
bun run test:e2e
bun run build

If a migration is approved:
also verify it against the actual Supabase PostgreSQL environment.

Classify:

PASS
FAIL
NOT VERIFIED

Separately report:

- Live PostgreSQL
- Live Supabase Storage
- Inngest function registration
- Local Inngest Dev Server
- Cloud Inngest
- production font

Do not convert skipped/unavailable checks to PASS.

==================================================
DOCUMENTATION
==================================================

Update docs/FSD.md only for durable Phase 11 contracts:

- publication snapshot model
- publishedAt semantics
- operational BatchStatus vs public visibility
- publication eligibility
- published participant name replacement
- publication-aware generation finalization
- unpublish behavior
- future Phase 12/13 public lookup contract

Update docs/LOG.md with actual implementation and verification.

Do not modify PRD merely to fit implementation.

Next:

Phase 12 — Public Search

==================================================
PLANNING REQUIREMENTS
==================================================

You are in /plan mode.

DO NOT IMPLEMENT YET.

Before proposing the plan:

1. inspect actual Phase 10 code;
2. inspect current Prisma schema;
3. inspect existing publish-related fields/actions, if any;
4. inspect participant edit restrictions;
5. inspect generatedFilePath/isStale semantics;
6. inspect checkAndFinalizeBatch;
7. inspect orchestrator onFailure;
8. inspect Phase 10 recovery semantics;
9. determine whether a publication snapshot migration is necessary;
10. define publication eligibility exactly;
11. define batch status vs publishedAt semantics;
12. define published participant edit transaction;
13. define replacement success/failure cutover;
14. define unpublish behavior;
15. verify Phase 12/13 can consume the resulting model safely;
16. produce a concise, reviewable plan.

==================================================
MANDATORY PLAN ANSWERS
==================================================

The plan MUST explicitly answer:

1. Is a Prisma migration required?

2. Can existing schema represent current name NEW while published name/file
   remain OLD?

3. What exact fields represent the published snapshot?

4. What does batch.publishedAt mean?

5. During published replacement, what does batch.status become?

6. What makes a Certificate eligible on INITIAL publish?

7. Can a FAILED/isStale Certificate with an old generatedFilePath be newly
   published?

8. How are publication snapshots established atomically?

9. How does re-publish avoid resurrecting stale old snapshots?

10. What happens to failed participants when batch is published?

11. What exact state is retained while a published participant name changes?

12. Which name will Phase 12 search during an in-progress replacement?

13. Which PDF will Phase 13 serve during an in-progress replacement?

14. What happens when replacement succeeds?

15. What happens when replacement fails?

16. How can ADMIN retry a failed published replacement?

17. How does generation finalization return to PUBLISHED instead of GENERATED?

18. What happens if the orchestrator fails while the batch is already public?

19. Can the batch be unpublished while generation is running?

20. Does Unpublish delete any storage object?

21. How does stale browser publish/edit request protection work?

22. Which mutations remain blocked on PUBLISHED batches?

23. Does generated-certificates remain private?

24. How do future Phase 12/13 routes determine public eligibility?

25. What is the production-font status?

26. Which checks are unit/direct integration/live DB/live Storage/local
    Inngest/cloud Inngest?

==================================================
MANDATORY ESCALATION CONDITIONS
==================================================

STOP for human review before implementation if:

- publication snapshot requires a Prisma migration;
- the plan proposes using mutable Participant.name as the published name
  during replacement;
- existing schema cannot keep old published file safely;
- the plan needs a new publication/history table;
- published safe replacement requires changing Phase 9/10 generationKey
  semantics materially;
- published edit would cause temporary public outage;
- failed replacement would replace/remove the old public file;
- generated storage bucket would need to become public;
- Phase 12/13 public functionality would have to be implemented early;
- production font requires a human visual/business choice.

Do not hide these issues behind defaults.

==================================================
DEFINITION OF DONE
==================================================

Phase 11 will eventually be complete only when:

- batch publish works
- batch unpublish works
- mixed success/failure publish works
- zero-success publish is rejected
- exact published name/file state is explicitly represented
- failed certificates cannot accidentally become newly public
- published name edit uses a fresh generationKey
- old published name/file remain coherent during regeneration
- successful replacement atomically cuts over to new name/file
- failed replacement preserves old name/file
- retry replacement works
- old generated object is not deleted
- publication survives generation/orchestration failure
- unpublish does not delete generated files
- stale requests cannot publish/update obsolete state
- storage stays private
- Phase 9/10 regression remains green
- no Phase 12 search implementation exists
- no Phase 13 public delivery implementation exists
- production test font is never a fallback
- documentation reflects actual semantics

Final completion report must contain:

1. Schema/migration decision
2. Publication model
3. publishedAt semantics
4. Certificate eligibility rules
5. Initial publish flow
6. Mixed-success publish behavior
7. Unpublish flow
8. Published participant edit flow
9. Published snapshot semantics
10. Replacement success flow
11. Replacement failure flow
12. Retry replacement
13. Publication-aware generation finalization
14. Orchestration failure behavior
15. CAS/idempotency behavior
16. Storage/privacy behavior
17. Files materially changed
18. Unit/integration evidence
19. Full E2E results
20. Live PostgreSQL status
21. Live Supabase Storage status
22. Local/cloud Inngest status
23. Production-font status
24. Scope check
25. Risks/blockers
26. Readiness for Phase 12