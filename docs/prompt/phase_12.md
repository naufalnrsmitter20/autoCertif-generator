You are working on AutoCertif — Certificate Generator System.

Plan:

PHASE 12 — PUBLIC CERTIFICATE SEARCH

Phase 12 implements the public, unauthenticated certificate-name search
experience on top of the publication snapshot model established in Phase 11.

This is a SEARCH-ONLY phase.

Do NOT implement certificate preview or certificate download.
Those belong to Phase 13.

==================================================
FIRST: VERIFY CURRENT REPOSITORY STATE
==================================================

Before planning, inspect the ACTUAL repository.

Read only the relevant sources:

- AGENTS.md
- docs/PRD.md
- docs/FSD.md
- docs/LOG.md
- prisma/schema.prisma
- Phase 11 publication migration
- current publication service
- current public/root routes
- current admin publish/unpublish implementation
- current soft-delete query patterns
- current UI/theme primitives
- current tests

Inspect specifically whether the implemented schema contains:

CertificateBatch:
- status
- publishedAt
- deletedAt

Participant:
- id
- batchId
- name
- deletedAt

Certificate:
- id
- batchId
- participantId
- publishedName
- publishedFilePath
- deletedAt
- status
- isStale

Do not assume the Phase 11 completion report equals the actual code.

Also inspect whether the Phase 11 final verification requested by the project
was actually completed and documented.

If Phase 11 publication invariants are missing or broken, surface the issue
before implementing Phase 12.

Do NOT silently reconstruct or reinterpret missing Phase 11 behavior.

==================================================
LOCKED PRODUCT REQUIREMENTS
==================================================

Public users:

- do NOT authenticate;
- search certificates by participant name only;
- search is partial;
- search is case-insensitive;
- duplicate names are allowed and ALL matching published certificates must
  be returned;
- unpublished certificates must never appear;
- soft-deleted records must never appear;
- internal/admin-only information must never be exposed.

Example:

query:
naufal

may match:

Naufal Nabil Ramadhan

Search is against the exact currently PUBLISHED name snapshot.

==================================================
CRITICAL PHASE 11 PUBLICATION CONTRACT
==================================================

Phase 11 introduced publication snapshots:

Certificate.publishedName
Certificate.publishedFilePath

The public search MUST use:

Certificate.publishedName

NOT:

Participant.name

This is mandatory.

Example:

Currently published snapshot:

Participant.name = "Budi"
publishedName = "Budi"
publishedFilePath = A.pdf

ADMIN edits published participant:

Participant.name = "Budi Santoso"

Replacement is still GENERATING or replacement FAILED.

During that period:

public query "Budi"
→ MUST still find the certificate

public query "Budi Santoso"
→ MUST NOT find it yet

because the live public certificate is still:

publishedName = "Budi"
publishedFilePath = A.pdf

Only after successful Phase 11 cutover:

publishedName = "Budi Santoso"
publishedFilePath = B.pdf

should the new name become searchable.

Do not accidentally leak mutable Participant.name into public search.

==================================================
PUBLIC ELIGIBILITY — CRITICAL
==================================================

Future public search eligibility must be based on publication state, not
latest generation state.

A Certificate is searchable only when ALL applicable conditions are true:

CertificateBatch:
- publishedAt != null
- deletedAt == null

Participant:
- deletedAt == null
- belongs to Certificate/batch

Certificate:
- deletedAt == null
- publishedName != null
- publishedFilePath != null

IMPORTANT:

Do NOT require:

batch.status == PUBLISHED

because a published batch can temporarily be:

GENERATING

during published safe replacement, while the old publication snapshot must
remain publicly available.

Similarly, an orchestration failure may leave:

batch.status == FAILED
publishedAt != null

while the previous publication snapshot remains valid.

Therefore:

publishedAt != null

is the authoritative public-visibility gate.

Also do NOT require:

Certificate.status == GENERATED
Certificate.isStale == false
Certificate.generationKey == batch.currentGenerationKey

for PUBLIC SEARCH eligibility.

Why:

during a published replacement failure:

Certificate.status may be FAILED
Certificate.isStale may be true

while:

publishedName
+
publishedFilePath

still correctly represent the last successful public snapshot.

This is intentional Phase 11 behavior.

==================================================
UNPUBLISH BEHAVIOR
==================================================

As soon as:

batch.publishedAt == null

the certificate must disappear from search.

This must hold even if:

publishedName != null
publishedFilePath != null

historically remain in the database.

Do not rely on snapshot clearing alone.

Visibility authority is:

batch.publishedAt != null

Unpublish must behave as an immediate public search kill-switch.

==================================================
SOFT DELETE SAFETY
==================================================

Exclude:

- deleted batches
- deleted participants
- deleted certificates

even if historical publication snapshots still exist.

Publication snapshot never overrides soft deletion.

Do not expose soft-deleted records through alternate search paths.

==================================================
SEARCH SEMANTICS
==================================================

Input:

participant name query only.

Server normalization:

- accept a string only;
- trim leading/trailing whitespace;
- empty/whitespace-only query returns NO results;
- do not return all certificates for an empty query.

Case-insensitive partial matching:

preferred Prisma/PostgreSQL shape:

publishedName: {
  contains: query,
  mode: "insensitive"
}

BUT inspect Prisma 7 generated types and actual repository version first.

Do not copy syntax blindly if current generated Prisma API differs.

==================================================
LIKE / ILIKE INPUT SAFETY
==================================================

Prisma contains filters on PostgreSQL map to LIKE / ILIKE behavior.

User input is intended as literal participant-name text, not as a SQL pattern.

Therefore explicitly test literal search behavior for characters such as:

%
_

If the actual Prisma API treats them as wildcard pattern characters in the
generated query, escape them using the simplest safe helper consistent with
Prisma/PostgreSQL behavior.

Do NOT interpolate raw SQL.

Do NOT construct:

$executeRawUnsafe
$queryRawUnsafe

for public search.

Prefer normal Prisma query APIs.

If normal Prisma `contains + mode: insensitive` can correctly satisfy literal
search after escaping, use it.

==================================================
NO FULL-TEXT SEARCH
==================================================

Do NOT use:

- PostgreSQL full-text search
- Prisma fullTextSearchPostgres preview
- Elasticsearch
- Meilisearch
- Algolia
- fuzzy search
- semantic search
- AI search

Requirement is simple substring matching.

Do not broaden product semantics.

==================================================
NO SEARCH INDEX MIGRATION BY DEFAULT
==================================================

Expected:

NO Prisma migration.

Do NOT add a normal B-tree:

@@index([publishedName])

just for:

ILIKE '%query%'

It does not meaningfully solve arbitrary contains-search optimization.

At current MVP scale, use the simplest correct query.

If repository/data inspection proves a real performance problem,
surface evidence before proposing a database optimization.

A future optimization could use PostgreSQL pg_trgm with an appropriate
GIN/GiST index, but do NOT introduce it without measured need.

Phase 12 correctness > speculative indexing.

==================================================
RESULT DATA CONTRACT
==================================================

Create a narrow public-safe result type.

Conceptually:

type PublicCertificateSearchResult = {
  certificateId: string
  publishedName: string
}

The internal opaque Certificate.id MAY be used for future route navigation.

It must NOT be presented to users as:

- certificate number
- certificate code
- verification number

Do not expose:

- participantId
- batchId unless an actual public UI requirement needs it
- generationKey
- currentGenerationKey
- generatedFilePath
- publishedFilePath
- generationError
- generatedAt
- isStale
- deletedAt
- admin information
- storage bucket
- storage URLs
- Supabase metadata

Phase 13 will resolve the opaque certificate ID to a controlled public
certificate route.

==================================================
DUPLICATE NAMES
==================================================

Duplicate published names are valid.

Example:

publishedName = "Budi Santoso"
publishedName = "Budi Santoso"

Both records MUST be returned.

Never:

- use name as React key;
- use DISTINCT publishedName;
- collapse/dedupe results by name;
- return only the first matching name.

Use Certificate.id internally as stable identity.

Do not display that ID as a certificate number.

==================================================
RESULT ORDERING
==================================================

Use deterministic ordering.

Prefer:

publishedName ASC
then Certificate.id ASC

or equivalent deterministic ordering supported by the actual schema.

Do NOT introduce relevance scoring or fuzzy ranking.

The requirement is substring matching, not ranked search.

==================================================
ROUTE DESIGN
==================================================

Inspect the current App Router structure before deciding.

FSD permits a minimal public search route such as:

/

or:

/certificates

Prefer:

/

if the root route is unused or already intended as the public landing/search
experience.

If the repository already has meaningful root behavior, preserve it and use
the smallest route consistent with existing conventions.

Do NOT create multiple equivalent public search routes.

==================================================
SEARCH UI ARCHITECTURE
==================================================

Prefer the simplest server-driven flow.

Recommended:

GET search using URL search params

Example:

/?q=naufal

or:

/certificates?q=naufal

Use the page's server-side searchParams to execute the Prisma query.

A native GET form is acceptable and preferred if it keeps the implementation
simpler and accessible.

Do NOT create a separate public search API merely to search from the same
Next.js page unless repository architecture gives a concrete reason.

Do NOT add a state-management library.

Do NOT add React Query/TanStack Query solely for this page.

==================================================
URL SEARCH PARAMS
==================================================

Search query should be represented in the URL.

Benefits:

- reload-safe
- shareable
- server-renderable
- back/forward navigation behaves naturally

Keep one canonical parameter, for example:

q

Do not introduce multiple aliases like:

q
query
search
name

Use one.

If a client search field updates the URL, use existing Next.js App Router
patterns.

Do not add a dependency such as `use-debounce` unless it is already installed
and genuinely needed.

For MVP, explicit submit is completely acceptable.

==================================================
PUBLIC PAGE UX
==================================================

Public UI is:

- minimal
- professional
- responsive
- search-centric
- subordinate to the certificate experience that will arrive in Phase 13

Use existing shadcn/ui primitives and SMK Telkom Malang theme tokens.

Palette remains:

Primary:
#E4262C

Deep red:
#B72024

Charcoal:
#201E1E

Neutral gray:
#707274

Use theme tokens rather than repeating raw hex where the theme already
contains them.

Do NOT create:

- marketing hero bloat
- testimonials
- pricing
- dashboard widgets
- gradients
- decorative background noise
- excessive animations

Suggested structure:

AutoCertif identity/header
↓
clear search title
↓
one name search input
↓
search button
↓
results / empty / no-result state

Keep it focused.

==================================================
SEARCH STATES
==================================================

Required UX states:

1. INITIAL

No query.

Show prompt such as:

"Search for your certificate by participant name."

Do NOT list every published certificate.


2. LOADING

If architecture exposes a transition/loading state:

show restrained accessible feedback.

Do not invent elaborate skeletons unless useful.


3. RESULTS

Show:

- publishedName
- neutral "Certificate available" context if helpful

At Phase 12, do NOT expose a Download button.


4. NO RESULTS

Example:

"No published certificate found for 'naufal'."

Do not imply the participant never existed.

It only means no currently published matching certificate is available.


5. INVALID / OVERSIZED INPUT

Validate server-side.

Reuse existing domain/input-length constraints where applicable.

Do not rely only on HTML maxLength.

Do not invent a new participant-name business length if the repository
already defines one.

==================================================
PHASE 13 BOUNDARY
==================================================

Phase 12 MUST NOT implement:

- public certificate detail page
- PDF preview
- PDF iframe/embed
- signed URL generation
- PDF proxy/download route
- Supabase Storage object download
- public download button
- browser access to publishedFilePath
- storage bucket changes

Search result data should be designed so Phase 13 can later link using:

certificateId

or another already-existing opaque internal identifier.

Do NOT introduce a public slug schema in Phase 12 unless repository inspection
proves it is necessary.

Internal opaque IDs are explicitly acceptable for routing and are not product
certificate numbers.

==================================================
SECURITY
==================================================

Public search requires NO authentication.

Do NOT accidentally apply requireAdmin().

But all filtering/security constraints must be server-side.

Never trust client filtering for publication eligibility.

Do not expose private fields through:

- serialized Server Component props
- JSON endpoints
- HTML data attributes
- console debugging
- error messages

React escaping should remain intact.

Do not use dangerouslySetInnerHTML for search highlights.

If highlighting the matched substring would add complexity, skip highlighting.

==================================================
CACHE / FRESHNESS
==================================================

Search must reflect publish/unpublish changes promptly.

Inspect the actual Next.js 16 caching/data-fetching setup.

Do NOT add unstable caching that could make:

Unpublish
→ certificate remains searchable

or:

Publish
→ certificate remains invisible

for an unexpected period.

Prefer normal dynamic request rendering for search.

If the current app uses explicit cache wrappers, tags, or revalidation,
integrate correctly with the existing pattern.

Do not invent caching infrastructure for this small query.

==================================================
QUERY PERFORMANCE
==================================================

Target scale is small.

Correctness first.

Expected Prisma query should:

- filter in the database;
- select only public-safe fields;
- not load PDF bytes;
- not query Supabase Storage;
- not N+1 fetch related records;
- not fetch all certificates then filter in JavaScript.

Perform publication/soft-delete/name filtering at the DB level.

No storage/network calls are needed to produce search results.

==================================================
PUBLIC QUERY SERVICE
==================================================

Prefer one server-only domain/query primitive, conceptually:

searchPublishedCertificates(query: string)

Responsibilities:

- normalize/validate search text
- empty → []
- query Prisma
- enforce all publication rules
- select narrow public result fields
- deterministic ordering

Keep it pure from UI concerns.

Do not place Prisma queries directly in client components.

==================================================
CRITICAL PUBLICATION SNAPSHOT TESTS
==================================================

Test all of these explicitly.

A. Basic search

publishedName:
"Naufal Nabil Ramadhan"

query:
"naufal"

→ match


B. Case-insensitive

"Naufal Nabil Ramadhan"

query:
"NAUFAL"

→ match


C. Partial middle substring

"Naufal Nabil Ramadhan"

query:
"Nabil"

→ match


D. Trim

query:
"   naufal   "

→ same search as "naufal"


E. Empty query

""
"    "

→ zero results


F. Duplicate names

2 published Certificates with same publishedName

→ 2 distinct results


G. Unpublished batch

publishedAt == null

→ excluded


H. Soft-deleted batch

→ excluded


I. Soft-deleted Participant

→ excluded


J. Soft-deleted Certificate

→ excluded


K. Missing published snapshot

publishedName == null
OR
publishedFilePath == null

→ excluded


L. Published replacement IN PROGRESS

Participant.name = "Budi Santoso"
publishedName = "Budi"
publishedFilePath = OLD_FILE
batch.status = GENERATING
publishedAt != null

search "Budi"
→ INCLUDED

search "Budi Santoso"
→ NOT INCLUDED


M. Published replacement FAILED

Participant.name = NEW
Certificate.status = FAILED
isStale = true
publishedName = OLD
publishedFilePath = OLD_FILE
publishedAt != null

search OLD
→ INCLUDED

This is mandatory.


N. Successful cutover

publishedName changes OLD → NEW

search OLD
→ no longer matches

search NEW
→ matches


O. Unpublish immediately after prior publication

publishedAt = null

→ result disappears even if publishedName/publishedFilePath remain stored.


P. Batch operational FAILED but still published

batch.status = FAILED
publishedAt != null
valid publication snapshot

→ result remains searchable.


Q. Literal LIKE characters

Names/query containing:

%
_

must behave according to literal participant-name search semantics,
not accidental wildcard enumeration.

==================================================
QUERY LEAK TEST
==================================================

Assert search result shape does NOT include:

generatedFilePath
publishedFilePath
generationError
participantId
batchId
generationKey
currentGenerationKey
deletedAt
isStale

unless one is proven necessary for a public contract.

Expected minimum:

certificateId
publishedName

==================================================
E2E
==================================================

Add focused public-search Playwright coverage.

Suggested:

seed/publication setup
↓
visit public search page WITHOUT login
↓
search partial lowercase name
↓
published result appears
↓
case-insensitive query works
↓
duplicate names both appear
↓
unpublished record does not appear
↓
soft-deleted record does not appear
↓
old published snapshot remains searchable during replacement state
↓
clear query
↓
results disappear

Do NOT click into certificate preview/download because that is Phase 13.

Also verify:

- public route does not redirect to login;
- responsive layout has no horizontal overflow;
- keyboard form submission works;
- accessible input label/name exists.

==================================================
FULL REGRESSION
==================================================

Phase 12 must not break:

- ADMIN auth
- batch CRUD
- template upload
- position editor
- participants
- Phase 9 generation
- Phase 10 generation management
- Phase 11 publish/unpublish
- safe published replacement

Run the FULL existing E2E suite.

Not only:

tests/e2e/public-search.spec.ts

==================================================
EXPECTED DATABASE CHANGE
==================================================

Expected:

NO Prisma migration.

If Antigravity concludes a schema/index migration is required:

STOP FOR HUMAN REVIEW.

Explain exactly:

- why current publishedName snapshot cannot satisfy search;
- what measured problem requires the migration;
- why application-level query semantics cannot solve it.

Do not add pg_trgm or indexes speculatively.

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

Expected migration status:

Phase 11 publication migration applied
NO Phase 12 migration

Also verify:

- public search without authentication
- partial match
- case-insensitive match
- duplicate-name handling
- publishedName snapshot correctness
- unpublish invisibility
- soft-delete filtering
- private-field non-disclosure
- literal wildcard handling
- responsive public UI

Report checks only as:

PASS
FAIL
NOT VERIFIED

Do not call skipped tests PASS.

==================================================
DOCUMENTATION
==================================================

Update docs/FSD.md only where Phase 12 establishes durable contracts:

- public search uses Certificate.publishedName
- batch.publishedAt is authoritative visibility gate
- public eligibility does not depend on operational BatchStatus
- duplicate published names return all matches
- no private paths are exposed
- public search route/query semantics

Update docs/LOG.md with:

- actual files changed
- actual test counts
- actual verification
- migration status
- next phase

Do not rewrite PRD merely for implementation convenience.

Next:

Phase 13 — Public Certificate Preview + Download

==================================================
PLANNING REQUIREMENTS
==================================================

You are in /plan mode.

DO NOT IMPLEMENT YET.

Before proposing implementation:

1. inspect actual Phase 11 schema and migration;
2. inspect actual publication service;
3. inspect actual unpublish behavior;
4. inspect current public/root routes;
5. inspect soft-delete relations;
6. inspect Next.js caching conventions;
7. inspect Prisma 7 generated query capabilities;
8. determine the minimal public search route;
9. determine exact result DTO;
10. verify no migration is needed;
11. verify no Phase 13 functionality is required;
12. produce a concise reviewable implementation plan.

==================================================
MANDATORY PLAN ANSWERS
==================================================

The plan MUST explicitly answer:

1. What route will host public search, and why?

2. Is a Prisma migration required?

3. Which field is searched?

4. Why must search use publishedName instead of Participant.name?

5. What exact DB predicates define public eligibility?

6. Does search require batch.status == PUBLISHED?

7. Does search require Certificate.status == GENERATED?

8. Does search require isStale == false?

9. What happens during published replacement GENERATING state?

10. What happens after published replacement FAILED state?

11. What happens immediately after Unpublish?

12. How are duplicate published names handled?

13. How is case-insensitive partial matching implemented with the actual
    Prisma/PostgreSQL stack?

14. How are literal % and _ search characters handled?

15. What happens for empty/whitespace query?

16. What public-safe fields are returned?

17. Is publishedFilePath ever serialized to the browser?

18. How will Phase 13 identify a result without exposing a certificate number?

19. Is search state represented in the URL?

20. Is any new API route required?

21. Is pagination needed at current scale?

22. Is a pg_trgm/index migration required at current scale?

23. How does search stay fresh immediately after publish/unpublish?

24. Which soft-delete conditions are enforced?

25. Which tests prove old publishedName remains searchable while mutable
    Participant.name has changed?

26. What remains explicitly deferred to Phase 13?

==================================================
MANDATORY ESCALATION CONDITIONS
==================================================

STOP for human review before implementation if:

- a Phase 12 Prisma migration/index is proposed;
- search cannot be implemented from publishedName;
- Phase 11 publication snapshots are missing/inconsistent;
- public search would require exposing publishedFilePath;
- current route structure requires destroying an existing meaningful public
  route;
- implementation would require Phase 13 preview/download work;
- a new search service/dependency is proposed;
- Phase 11 final publication invariants are not actually present.

Do not hide these issues with assumptions.

==================================================
DEFINITION OF DONE
==================================================

Phase 12 will eventually be complete only when:

- public users can search without login
- search is participant-name only
- search is partial
- search is case-insensitive
- surrounding whitespace is trimmed
- empty search returns no results
- duplicate names all appear
- publishedName is the searched field
- mutable Participant.name cannot leak before safe publication cutover
- published snapshots remain searchable during published replacement
- operational FAILED state does not cause a public outage while publishedAt
  remains set
- Unpublish removes results immediately
- soft-deleted records never appear
- missing publication snapshot never appears
- private storage paths/errors are never serialized
- generated-certificates stays private
- no preview/download functionality is added
- no speculative search migration is added
- full regression remains green
- documentation reflects actual behavior

Final completion report must include:

1. Search architecture
2. Public route
3. Search query semantics
4. Publication eligibility predicates
5. Snapshot behavior during replacement
6. Duplicate-name behavior
7. Input normalization/literal pattern handling
8. Public DTO
9. Security/privacy checks
10. Files materially changed
11. Unit/integration tests
12. Public search E2E
13. Full E2E regression
14. Prisma migration status
15. Canonical gate results
16. Phase 11 regression status
17. Scope check
18. Remaining risks
19. Readiness for Phase 13