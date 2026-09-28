You are working on AutoCertif — Certificate Generator System.

PLAN:

PHASE 14 — FULL E2E + REGRESSION

==================================================
MISSION
==================================================

Phase 14 is a VERIFICATION, REGRESSION, and TEST-RELIABILITY phase.

Do NOT add new product features.

The objective is to prove that AutoCertif works correctly as one integrated
system across Phases 0–13 and to resolve the previously deferred full-suite
Playwright instability.

Known prior debt:

A previous full Playwright run produced:

18 total
14 passed
4 failed
0 skipped

while the affected specs passed independently.

The observed failures involved:
- auth.spec.ts
- template-upload.spec.ts
- position-editor.spec.ts

and live Supabase / dev-server execution showed intermittent network /
timeout behavior.

This debt was intentionally deferred to Phase 14.

Phase 13 targeted verification is currently PASS.

==================================================
SOURCE OF TRUTH
==================================================

Before planning, inspect the ACTUAL repository:

- AGENTS.md
- docs/PRD.md
- docs/FSD.md
- docs/LOG.md
- package.json
- playwright.config.*
- vitest.config.*
- next.config.*
- prisma/schema.prisma

Inspect all:

tests/e2e/*.spec.ts

and relevant:

tests/unit/
tests/integration/
test helpers / fixtures / setup / cleanup utilities

Inspect actual:

- Supabase PostgreSQL helpers
- Supabase Storage helpers
- transient retry utilities
- authentication setup
- Inngest client/functions/API handler
- generation pipeline
- publication pipeline
- public search
- public certificate delivery

Do not trust completion summaries blindly.

Use actual code and actual test configuration.

==================================================
STRICT PHASE BOUNDARY
==================================================

Phase 14 may:

- improve test isolation;
- fix legitimate regressions;
- fix deterministic race conditions;
- fix incorrect cleanup/setup;
- harden bounded transient test/infrastructure handling;
- improve diagnostics;
- add missing critical regression coverage.

Phase 14 must NOT introduce:

- new product features;
- new business workflows;
- new database concepts;
- UI redesign;
- analytics;
- certificate history/version browser;
- QR verification;
- new public functionality;
- production deployment configuration beyond what verification requires.

Expected:

NO Prisma migration.

If a schema migration appears necessary:
STOP FOR HUMAN REVIEW.

==================================================
PRIMARY PRINCIPLE
==================================================

Do NOT make failing tests green by weakening them.

Forbidden:

- test.skip
- describe.skip
- conditional skip for failing cases
- removing assertions
- increasing retries until tests eventually pass
- hiding failed first attempts
- turning real errors into warnings
- arbitrary global timeout inflation
- mocking behavior that the E2E test is supposed to verify live

Fix root causes.

==================================================
STEP 1 — BASELINE AUDIT
==================================================

Before changing code, record the current execution model.

Report:

- Playwright version
- test:e2e package.json command
- discovered spec files
- discovered test count
- workers
- fullyParallel
- retries
- retryStrategy if configured
- test timeout
- expect timeout
- trace setting
- screenshot setting
- video setting
- webServer command
- webServer timeout
- reuseExistingServer
- whether webServer uses `next dev` or production server
- baseURL

Also inspect whether tests use:

- fixed shared IDs
- fixed participant names
- fixed object paths
- shared ADMIN mutations
- shared database records
- global bucket cleanup
- cross-spec ordering assumptions

Do not modify anything yet.

==================================================
STEP 2 — DIAGNOSTIC FULL SUITE
==================================================

Run:

bun run test:e2e

with the normal canonical configuration.

For this diagnostic run, ensure failed tests retain useful evidence.

Preferred Playwright diagnostic behavior:

trace: "retain-on-failure"

Do not enable broad retries merely for diagnostics.

Collect for every failure:

- exact error
- assertion
- stack trace
- trace
- screenshot
- network failure if available
- Next.js server stderr
- Supabase error/status
- execution duration

Classify each failure as:

A. application/product defect
B. test-data collision
C. cleanup/state leakage
D. Supabase transient network failure
E. database connection/pool issue
F. Storage transient failure
G. Next.js dev-server/resource contention
H. timeout budget mismatch
I. Playwright harness defect
J. unknown

Do not label something "network flakiness" merely because rerunning it passes.

==================================================
STEP 3 — TEST ISOLATION AUDIT
==================================================

Every E2E test must be independently runnable.

Verify:

- unique batch records
- unique participant records
- unique storage object paths
- no shared mutable certificate rows
- no test depends on a prior spec
- no spec assumes another spec's cleanup
- browser/session state isolated
- DB cleanup is scoped to records created by that test/spec
- Storage cleanup only removes test-owned object paths

Never:

- wipe a shared bucket;
- delete every test batch globally;
- reuse deterministic shared paths that collide between tests.

If parallel workers exist, inspect worker-safe test data.

If tests already run with one worker, do NOT blame parallelism.

==================================================
STEP 4 — NETWORK / SUPABASE RELIABILITY
==================================================

Inspect all existing retry helpers before adding anything.

The application already contains transient handling such as Prisma retry
logic and Storage retry behavior.

Reuse existing patterns where correct.

Retries are permitted ONLY for clearly transient infrastructure failures,
such as:

- DNS resolution/transient network errors
- connection reset
- temporary gateway/service availability errors

Do NOT retry:

- validation failures
- auth failures
- publication conflicts
- stale generation keys
- business-rule errors
- assertion failures
- 4xx application correctness failures unless explicitly known transient

Retries must be:

- bounded
- low count
- narrow
- observable
- deterministic enough for tests

Do NOT add another retry dependency unless absolutely necessary.

Supabase explicitly warns that excessive retrying can reduce throughput or
exhaust available connection capacity.

==================================================
STEP 5 — PLAYWRIGHT RETRIES
==================================================

Do not use Playwright retries as the Phase 14 correctness solution.

For FINAL acceptance, prefer:

retries = 0

or otherwise report first-attempt failures separately.

Playwright considers:

first attempt fails
+
retry passes

as FLAKY.

A flaky result is not equivalent to a clean PASS for Phase 14 acceptance.

==================================================
STEP 6 — TIMEOUT POLICY
==================================================

Audit existing timeout increases from previous phases.

Keep timeout changes only where the underlying operation legitimately needs
the budget.

Do not globally raise all timeouts to hide slow or stuck operations.

Distinguish:

- cold Next.js startup
- actual browser interaction
- live Supabase upload/download
- generation waiting/polling

Use the narrowest appropriate timeout.

==================================================
STEP 7 — NEXT.JS TEST SERVER
==================================================

Inspect whether the E2E suite currently runs against:

next dev

or:

next start / production build

Do NOT switch blindly.

If diagnostic evidence shows dev-server/Turbopack cold compilation or
resource pressure is materially causing full-suite failures, evaluate a
production-like E2E server:

build
→ next start
→ Playwright

But only change the canonical test setup if there is evidence it improves
determinism without making developer workflow unreasonable.

If next dev is stable after isolation/network fixes, keep it.

==================================================
STEP 8 — CRITICAL CROSS-PHASE FLOW
==================================================

Audit whether the current suite proves the complete product journey.

The critical E2E contract is conceptually:

ADMIN login
↓
create batch
↓
upload certificate template
↓
configure participant-name placement
↓
import participants
↓
participant CRUD/validation
↓
generate certificates
↓
surface participant generation failure
↓
retry/fix as appropriate
↓
publish batch
↓
public search without authentication
↓
open certificate
↓
preview PDF
↓
download PDF
↓
ADMIN unpublishes
↓
public search no longer exposes certificate
↓
direct public detail/download are unavailable

If an existing single flow already proves this:
reuse it.

If current tests only prove disconnected phase slices and no coherent critical
flow exists:

add ONE focused:

tests/e2e/critical-flow.spec.ts

Do not duplicate every edge-case test.

Use small deterministic test data.

==================================================
STEP 9 — FAILURE ISOLATION REGRESSION
==================================================

Ensure automated evidence still proves:

one participant generation failure
does NOT fail successful certificates.

ADMIN must see the failed participant name.

Do not add duplicate E2E work if a strong existing generation test already
proves it.

Reference the existing test instead.

==================================================
STEP 10 — APPROXIMATELY 100 PARTICIPANTS
==================================================

PRD target is approximately 100 participants per batch.

Audit existing evidence.

If no current test proves the system can safely accept approximately 100
participants:

add the LOWEST-COST appropriate regression test.

Prefer service/integration-level evidence over a browser test that renders
100 certificates unnecessarily.

At minimum verify:

- ~100 active participants can be imported/represented;
- initialization does not depend on one unbounded request-time rendering loop;
- generation orchestration creates the expected participant work set;
- no accidental fixed 100-result truncation affects product behavior.

Do not create an expensive artificial stress benchmark.

==================================================
STEP 11 — ACTUAL INNGEST DEV SERVER VERIFICATION
==================================================

Until now:

Inngest function registration      PASS
Direct worker/function tests       PASS
Local Inngest Dev Server           NOT VERIFIED
Cloud Inngest                      NOT VERIFIED

Phase 14 should attempt to close LOCAL Inngest verification if the existing
environment permits it without product changes.

Inspect current Inngest SDK/version and scripts.

Preferred official local pattern:

INNGEST_DEV=1 application server

plus Inngest Dev Server pointed to:

http://localhost:3000/api/inngest

Verify:

- app functions discovered;
- generation event sent through actual local Inngest transport;
- orchestrator executes;
- participant worker executes;
- generated certificate reaches terminal state;
- batch finalizes correctly.

Use isolated test resources and the existing TEST-ONLY font registry.

Do NOT configure production font as part of this test.

Do NOT add a permanent app dependency merely to obtain the Inngest CLI.

If local CLI/environment execution is genuinely unavailable:
report:

Local Inngest Dev Server — NOT VERIFIED

Do not fake PASS via direct function invocation.

Cloud Inngest remains outside Phase 14 unless credentials/environment already
exist and testing it is explicitly safe.

==================================================
STEP 12 — PUBLICATION REGRESSION
==================================================

Verify Phase 11 semantics remain intact:

- mixed success/failure batch can publish successful certificates
- publishedAt is public visibility authority
- old published snapshot remains live during replacement
- replacement failure preserves old snapshot
- successful replacement cuts over correctly
- Unpublish blocks future application-authorized public access
- soft-deleted records unavailable

Do not rewrite publication code unless a real regression is found.

==================================================
STEP 13 — PUBLIC SEARCH REGRESSION
==================================================

Verify:

- unauthenticated
- publishedName only
- partial
- case-insensitive
- duplicate names all returned
- >100 matching result completeness remains valid
- no mutable Participant.name leak
- no private DTO leakage
- Unpublish removes results

==================================================
STEP 14 — PUBLIC PREVIEW/DOWNLOAD REGRESSION
==================================================

Verify:

- no login required
- detail uses publication snapshot
- private bucket remains private
- signed preview works
- PDF is application/pdf
- download works
- download route rechecks eligibility
- final post-sign eligibility guard remains intact
- Unpublish blocks new app-authorized access
- old signed URL TTL limitation remains documented truthfully
- no service credential exposure

==================================================
STEP 15 — AUTH / ADMIN REGRESSION
==================================================

Explicitly re-check the auth failure observed in the previous full suite.

Auth must not be dismissed as "Storage flakiness" without evidence.

Verify:

- unauthenticated /admin redirects correctly
- valid ADMIN login
- invalid credentials rejected
- logout
- session isolation
- /login authenticated redirect behavior if part of existing contract

If auth fails only in the full suite:
trace the shared-state/server cause.

==================================================
STEP 16 — UI / RESPONSIVE SMOKE
==================================================

Use existing UI tests rather than creating visual-test infrastructure.

Verify critical public/admin pages at existing representative viewports:

desktop
mobile

At minimum:
- no horizontal overflow
- core controls reachable
- public search usable
- certificate page usable
- admin generation/publication controls usable

No screenshot-diff framework is required.

==================================================
STEP 17 — DATA CLEANUP
==================================================

After test execution:

clean only test-owned:

- batches
- participants
- certificates
- templates
- storage objects

Do not delete production/manual data.

If cleanup itself hits transient network failure:

report it.

Do not allow cleanup errors to silently hide successful/failed test results.

==================================================
NO PRODUCT-SCOPE CHANGES
==================================================

Do not change:

- certificate fitting behavior
- font business rules
- publish eligibility rules
- search semantics
- signed URL TTL unless evidence demands it
- tutoring/other unrelated project code
- UI branding
- public routes
- storage privacy

Phase 14 is regression/harness stabilization.

==================================================
PRODUCTION FONT STATUS
==================================================

Production font remains:

NOT CONFIGURED

Tests may use the existing deterministic licensed TEST-ONLY font.

Never register the test fixture as a production fallback.

Real-template production visual acceptance remains a separate known blocker.

==================================================
PHASE 14 FINAL ACCEPTANCE STRATEGY
==================================================

After remediation:

run all canonical gates:

bun x prisma validate
bun x prisma generate
bun x prisma migrate status
bun run typecheck
bun run lint
bun run test
bun run test:e2e
bun run build

Then perform ONE additional consecutive:

bun run test:e2e

The two final FULL E2E runs must both be clean.

Required:

0 failed
0 skipped

Prefer:

0 flaky / retry-dependent results

Do not rerun repeatedly until two lucky passes appear.

If the first final run fails:

investigate the evidence before retrying.

==================================================
PASS CLASSIFICATION
==================================================

PASS means executed successfully.

FAIL means executed and failed.

NOT VERIFIED means it could not genuinely be tested.

FLAKY means:
failed first attempt but passed on retry/rerun without a proven root-cause
fix.

Do not classify FLAKY as PASS.

==================================================
EXPECTED PHASE 14 STATUS
==================================================

Expected:

NO database migration
NO product dependency
NO feature expansion

Possible changes should be limited to:

- Playwright config
- test fixtures/helpers
- setup/cleanup utilities
- bounded existing network retry utilities
- missing regression tests
- genuine narrow application bug fixes discovered by E2E

==================================================
MANDATORY PLAN ANSWERS
==================================================

The plan must explicitly answer:

1. What is the current Playwright execution configuration?
2. How many current E2E specs/tests exist?
3. What exactly caused the historical 14/18 full-run failure?
4. Are tests truly isolated at DB level?
5. Are tests truly isolated at Storage path level?
6. Does any cleanup affect another spec?
7. Are tests currently parallel or sequential?
8. Is changing worker count necessary?
9. Are Playwright retries currently enabled?
10. Will Phase 14 acceptance rely on retries?
11. What trace/diagnostic mode will be used?
12. Are current timeouts justified?
13. Does E2E use next dev or production server?
14. Is server mode contributing to flakiness?
15. Is any retry helper too broad or unbounded?
16. Which transient errors are safe to retry?
17. Which errors must never be retried?
18. Does one coherent critical user-flow E2E already exist?
19. If not, what minimum new critical-flow test is required?
20. Is ~100-participant behavior already verified?
21. Can Local Inngest Dev Server be genuinely tested?
22. How will real Inngest execution be distinguished from direct invocation?
23. What Phase 11 regression evidence remains?
24. What Phase 12 regression evidence remains?
25. What Phase 13 regression evidence remains?
26. Is any production application bug currently known?
27. Is any Prisma migration required?
28. Is any new dependency required?
29. What exactly must pass for Phase 14 acceptance?
30. What remains deferred to Phase 15?

==================================================
MANDATORY ESCALATION
==================================================

STOP for human review if:

- schema migration is proposed;
- product/business behavior needs changing;
- production font must be selected/configured;
- a new infrastructure service is proposed;
- tests can only pass by weakening assertions;
- permanent broad retries are proposed;
- destructive shared-data cleanup is required;
- Cloud Inngest testing would touch a production environment;
- a large architectural refactor appears necessary.

==================================================
VERIFICATION REPORT
==================================================

Final report must include:

PHASE 14 — FULL E2E + REGRESSION

1. Root-cause analysis of historical E2E flakiness
2. Playwright config before/after
3. Test-isolation findings
4. Files changed
5. Application bugs found/fixed
6. Harness bugs found/fixed
7. Retry policy
8. Timeout policy
9. Critical-flow E2E coverage
10. ~100 participant evidence
11. Local Inngest Dev Server status
12. Cloud Inngest status
13. Prisma Validate
14. Prisma Generate
15. Prisma Migrate Status
16. Typecheck
17. Lint
18. Unit/Integration tests
19. Full E2E Final Run #1
20. Full E2E Final Run #2
21. Per-spec results
22. Failed/skipped/flaky count
23. Production build
24. Live PostgreSQL status
25. Live Supabase Storage status
26. Phase 11 regression
27. Phase 12 regression
28. Phase 13 regression
29. Production font status
30. Remaining risks/debt
31. Readiness for Phase 15

Overall:

COMPLETE / FULL PASS

or

NEEDS NARROW REMEDIATION

Do NOT begin Phase 15 automatically.