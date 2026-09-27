You are working on AutoCertif — Certificate Generator System.

Plan:

PHASE 13 — PUBLIC CERTIFICATE PREVIEW + DOWNLOAD

Phase 12 Public Search is functionally COMPLETE.

Known deferred verification debt:
the full Playwright suite previously showed intermittent live-Supabase /
dev-server reliability failures when run continuously, while affected specs
passed independently.

Do NOT spend Phase 13 chasing that previously accepted harness debt unless
Phase 13 introduces or exposes a reproducible product defect.

The final QA phase will revisit full-suite stability.

==================================================
PHASE 13 GOAL
==================================================

Implement the public, unauthenticated certificate detail experience:

Public Search
→ select a result
→ open certificate detail
→ preview the currently published PDF
→ download the currently published PDF

Required public behavior:

- no authentication;
- only currently published certificate snapshots are accessible;
- unpublished/direct invalid routes return not-found;
- private Supabase Storage remains private;
- no internal storage path is exposed as application data;
- preview/download always use Certificate.publishedFilePath;
- certificate artwork remains the dominant UI element.

This phase must NOT modify certificate generation or publication semantics.

==================================================
SOURCE OF TRUTH — INSPECT FIRST
==================================================

Before planning, inspect the ACTUAL repository:

- AGENTS.md
- docs/PRD.md
- docs/FSD.md
- docs/LOG.md
- prisma/schema.prisma
- Phase 11 publication migration
- Phase 11 publication service
- Phase 12 public search service
- app/page.tsx
- app/search-form.tsx
- Supabase server/storage helpers
- generated-certificate bucket setup
- current CSP/security headers if any
- next.config.*
- package.json
- current Playwright configuration/tests

Inspect actual installed versions/types for:

- Next.js
- @supabase/supabase-js
- Prisma

Do not assume an earlier plan exactly matches implementation.

==================================================
LOCKED PRODUCT CONTRACT
==================================================

The product requires:

- public certificate preview;
- public certificate download;
- no login;
- unpublished certificates not reachable through application routes;
- soft-deleted records unavailable;
- private storage access through a controlled application/storage pattern.

The route may use an opaque internal Certificate.id.

It must NOT present Certificate.id as:

- certificate number
- verification code
- official certificate ID

==================================================
PHASE 11/12 PUBLICATION SNAPSHOT CONTRACT
==================================================

Public delivery MUST use:

Certificate.publishedName
Certificate.publishedFilePath

NOT:

Participant.name
Certificate.generatedFilePath

The public snapshot is authoritative.

Example:

Participant.name = NEW
publishedName = OLD
publishedFilePath = OLD_FILE
replacement status = GENERATING or FAILED

Public page must still show:

OLD publishedName
OLD_FILE

until Phase 11 replacement succeeds.

Do NOT leak the pending/current administrative participant name.

==================================================
PUBLIC ELIGIBILITY
==================================================

Create/reuse one server-only public certificate lookup primitive.

Conceptually:

getPublishedCertificateById(certificateId)

A Certificate is publicly accessible only when:

Certificate:
- id == requested certificateId
- deletedAt == null
- publishedName != null
- publishedFilePath != null

Participant:
- deletedAt == null

CertificateBatch:
- deletedAt == null
- publishedAt != null

IMPORTANT:

Do NOT require:

batch.status == PUBLISHED
Certificate.status == GENERATED
Certificate.isStale == false
Certificate.generationKey == batch.currentGenerationKey

Those would break safe publication during replacement/failure.

If:

batch.status == GENERATING
publishedAt != null
published snapshot exists

the OLD public snapshot remains accessible.

If:

batch.status == FAILED
publishedAt != null
published snapshot exists

the OLD public snapshot remains accessible.

If:

publishedAt == null

public detail/download must immediately fail application-level eligibility.

==================================================
ROUTES
==================================================

Expected route:

/certificates/[certificateId]

Public detail page.

Expected controlled download route:

/certificates/[certificateId]/download

or another equally narrow route following actual repository conventions.

Do not add multiple public aliases.

Modify Phase 12 search results so each result links to:

/certificates/{certificateId}

Do not expose certificateId as human-facing metadata.

==================================================
404 / NOT-FOUND SEMANTICS
==================================================

The following must return application-level not-found:

- unknown certificate ID
- deleted Certificate
- deleted Participant
- deleted Batch
- batch.publishedAt == null
- publishedName == null
- publishedFilePath == null

Use the existing Next.js App Router not-found mechanism.

Do not distinguish:

"certificate exists but unpublished"

from:

"certificate does not exist"

to unauthenticated visitors.

Both should appear unavailable/not-found.

This avoids information disclosure.

==================================================
PRIVATE STORAGE ARCHITECTURE
==================================================

The generated-certificates bucket MUST remain private.

Do NOT:

- convert it to public;
- use getPublicUrl();
- expose service-role credentials;
- proxy permanent storage URLs;
- serialize publishedFilePath to client code.

Use server-created SHORT-LIVED signed URLs.

Supabase private Storage officially supports time-limited signed URLs for
public sharing of otherwise private objects.

==================================================
IMPORTANT VERCEL PAYLOAD CONSTRAINT
==================================================

Do NOT default to:

Supabase download()
→ read entire PDF in Next.js Function
→ return entire PDF response

The generated certificate bucket can contain PDFs larger than Vercel's
ordinary Function response body limit.

Vercel currently documents:

FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE
maximum response payload: 4.5 MB

while this project allows generated PDFs up to approximately 20 MB.

Therefore prefer:

application DB authorization
↓
create short-lived Supabase signed URL
↓
browser fetches PDF directly from Supabase Storage

This avoids routing large PDF bytes through Vercel.

Do not introduce a proxy solely to customize filenames.

If repository/deployment evidence proves streaming bypasses the relevant
production limit safely for this exact runtime, explain it in the plan before
choosing it.

Otherwise signed URL is the preferred architecture.

==================================================
SIGNED URL SECURITY MODEL
==================================================

Signed URLs are bearer-style temporary access URLs.

Generate them ONLY server-side after public eligibility is checked.

Do not persist signed URLs in the database.

Do not log them.

Do not store them in analytics.

Do not place them in public search results.

Do not expose publishedFilePath alongside them.

Use a short expiration appropriate for PDF browser viewing.

The plan MUST inspect actual Supabase client types and choose a concrete TTL.

Balance:

too short:
PDF viewers may perform delayed/range requests and fail after expiry

too long:
Unpublish revocation window is unnecessarily large

Recommended planning range:

approximately 2–5 minutes

but do not blindly select a number without verifying actual browser/storage
behavior.

Document the chosen TTL as a TECHNICAL access-token duration, not business
publication semantics.

==================================================
SIGNED URL REVOCATION LIMITATION
==================================================

Be explicit:

batch.publishedAt controls APPLICATION access immediately.

After Unpublish:

- /certificates/[id] must return 404 immediately;
- /certificates/[id]/download must return 404 immediately;
- no new signed URL may be issued.

However, a signed URL already issued before Unpublish may remain usable until
its storage token/cache lifetime expires.

Supabase documents that signed URLs remain valid until expiry and are not
individually revocable through normal application behavior.

This does NOT change the locked application-route requirement.

Do not claim signed URLs provide instantaneous revocation.

If the product requirement is interpreted as requiring revocation of an
already-issued raw URL at the exact moment of Unpublish, STOP for human
review because that requires a different delivery architecture/trade-off.

==================================================
PREVIEW ARCHITECTURE
==================================================

Prefer the browser's native PDF viewer for MVP.

Recommended:

<iframe src={shortLivedPreviewUrl} ... />

or the smallest browser-native PDF embedding approach supported by the
actual security policy.

Do NOT build:

- custom PDF.js viewer
- page navigation framework
- zoom controls
- annotation UI
- certificate renderer
- canvas rendering pipeline

unless repository/browser evidence proves native preview insufficient.

The app already generated a final PDF.
Do not render it again.

The iframe MUST have an accessible title, for example:

title={`Certificate for ${publishedName}`}

Provide a visible fallback/open action if native embedded preview is not
usable on a device.

Do not sandbox the iframe blindly if it breaks the native PDF viewer.

==================================================
CSP CHECK
==================================================

Inspect current Content-Security-Policy.

If a restrictive CSP exists:

ensure frame-src allows ONLY the necessary Supabase Storage origin required
for signed preview.

Do NOT add:

frame-src *

or broadly weaken the policy.

If no CSP exists, do NOT create a large unrelated security-header project in
Phase 13.

==================================================
REFERRER / TOKEN LEAKAGE
==================================================

Signed preview URLs contain temporary tokens.

Minimize accidental leakage.

Prefer:

referrerPolicy="no-referrer"

on the PDF iframe where supported.

Do not include signed URL tokens in:

- page metadata
- console output
- error reporting
- DOM attributes unrelated to the iframe/link itself
- server logs

Do not place them in query parameters of the application page URL.

==================================================
DETAIL PAGE DATA CONTRACT
==================================================

Server-side detail lookup should return only what the page needs.

Conceptually:

type PublicCertificateDetail = {
  certificateId: string
  publishedName: string
}

Storage path remains server-only.

The server uses publishedFilePath internally to create the signed preview URL.

Do not pass:

publishedFilePath
generatedFilePath
Participant.name
generationError
generationKey
batchId
participantId
isStale
deletedAt

to the client.

==================================================
PUBLIC DETAIL PAGE UX
==================================================

Route:

/certificates/[certificateId]

Minimal structure:

AutoCertif header / Back to Search
↓
published participant name
↓
large certificate preview
↓
Download Certificate action

Certificate should dominate the page.

Use SMK Telkom Malang theme tokens:

Primary Telkom Red
#E4262C

Deep Red
#B72024

Charcoal
#201E1E

Neutral Gray
#707274

Reuse existing design tokens rather than hardcoding repeated colors.

No gradients.
No marketing sections.
No dashboard cards.
No excessive animation.
No fake verification badges.

Do not display internal certificate ID.

==================================================
RESPONSIVE PREVIEW
==================================================

Desktop:

certificate preview should use most available width while maintaining a
reasonable max width.

Mobile:

- no horizontal page overflow;
- preview area remains usable;
- allow the native viewer/container to scroll internally if required;
- Download action remains accessible.

Do not distort PDF aspect ratio.

Do not assume desktop-only PDF browser behavior.

Include an "Open PDF" fallback if useful for mobile browsers.

==================================================
DOWNLOAD FLOW
==================================================

When user clicks Download:

browser requests:

/certificates/[certificateId]/download

The server MUST re-check CURRENT public eligibility at request time.

Do NOT reuse eligibility from a page rendered minutes earlier.

Flow:

GET download route
↓
lookup certificate using publication eligibility contract
↓
if unavailable → 404
↓
create NEW short-lived signed URL for publishedFilePath
↓
configure signed URL for download if supported by the installed
@supabase/supabase-js version
↓
redirect browser to signed Storage URL

The private object path remains server-side.

==================================================
DOWNLOAD FILENAME
==================================================

Inspect installed Supabase JS types.

If createSignedUrl supports a download filename string:

prefer a safe human-friendly filename derived from publishedName.

Example concept:

certificate-budi-santoso.pdf

Use a small filename sanitizer.

Rules:

- no path separators;
- no control characters;
- no traversal;
- no raw storage key;
- reasonable length;
- `.pdf` extension.

If Supabase only supports `download: true` in the installed version:

use it.

Do NOT proxy file bytes through Vercel solely to get a custom filename.

Filename UX is secondary to correct private delivery.

==================================================
DOWNLOAD ROUTE CACHING
==================================================

The application authorization route must not cache stale publication state.

Use dynamic/no-store behavior appropriate to actual Next.js 16 codebase.

After Unpublish:

a NEW request to:

/certificates/[id]

or:

/certificates/[id]/download

must see publishedAt == null and return not-found.

Do not statically generate certificate detail routes.

Do not cache public eligibility indefinitely.

==================================================
SEARCH RESULT INTEGRATION
==================================================

Modify Phase 12 search result presentation minimally.

Each result becomes navigable to:

/certificates/{certificateId}

Preserve Phase 12 guarantees:

- duplicate names all remain separate;
- React key remains certificateId;
- no publishedFilePath leakage;
- no download signed URL on the search page.

Search page must NOT pre-generate signed URLs for all results.

Only the detail/download request should generate them.

==================================================
STORAGE FAILURE HANDLING
==================================================

If DB says a published snapshot exists but signed URL creation fails:

this is an infrastructure/integrity error.

Do NOT expose raw Supabase errors publicly.

For detail page:

show a controlled temporary-unavailable error state or use the repository's
existing error boundary, depending on current conventions.

Do NOT falsely report that the certificate never existed if the DB
publication record is valid but Storage is temporarily unavailable.

For nonexistent/unpublished records:
use 404.

For storage infrastructure failure:
use generic application error behavior.

The plan must distinguish these two cases.

==================================================
MISSING STORAGE OBJECT
==================================================

A publication snapshot should reference an existing PDF.

Add live integration evidence that:

publishedFilePath
→ signed URL
→ HTTP fetch succeeds
→ content-type is application/pdf
→ bytes represent a valid PDF

Do not add a storage HEAD/download call to every normal detail DB query unless
necessary.

Treat missing-object behavior as an integrity failure and cover it
appropriately.

==================================================
CONTENT TYPE
==================================================

Generated certificate output must be:

application/pdf

Preview/download tests should verify the signed URL returns PDF content.

Do not trust filename extension alone.

==================================================
NO AUTH REQUIREMENT
==================================================

Public certificate detail and download MUST work:

- logged out;
- incognito;
- without ADMIN session.

Do NOT call requireAdmin().

But server-side public eligibility filtering remains mandatory.

==================================================
NO NEW DATABASE SCHEMA
==================================================

Expected:

NO Prisma migration.

Existing:

Certificate.id
Certificate.publishedName
Certificate.publishedFilePath
CertificateBatch.publishedAt
soft-delete fields

are sufficient.

If the plan proposes:

- publicSlug
- downloadToken table
- access-log table
- certificate version table
- preview URL column
- signed URL column

STOP for human review.

Do not persist ephemeral signed URLs.

==================================================
NO NEW DEPENDENCY BY DEFAULT
==================================================

Expected:

NO new PDF viewer dependency.

Use existing browser PDF capability.

If a new dependency is proposed:
prove why existing browser preview + current stack cannot satisfy MVP.

Do not add react-pdf/pdfjs UI merely for aesthetics.

==================================================
SECURITY / PRIVACY TEST MATRIX
==================================================

Explicitly test:

A. valid published certificate
→ detail 200
→ publishedName shown
→ PDF preview available

B. unknown certificate ID
→ 404

C. unpublished batch
→ detail 404

D. unpublished batch
→ download 404

E. soft-deleted batch
→ 404

F. soft-deleted participant
→ 404

G. soft-deleted certificate
→ 404

H. publishedName null
→ 404

I. publishedFilePath null
→ 404

J. batch operational GENERATING + publishedAt non-null
→ OLD published snapshot remains accessible

K. batch operational FAILED + publishedAt non-null
→ OLD published snapshot remains accessible

L. Certificate status FAILED / isStale true but valid published snapshot
→ OLD published snapshot remains accessible

M. Phase 11 successful replacement
→ detail resolves NEW publishedName + NEW publishedFilePath

N. Unpublish after detail previously loaded
→ new detail request 404
→ new download request 404

O. signed URL is never returned by search service

P. publishedFilePath is never rendered as text/serialized application DTO

Q. no ADMIN authentication required

==================================================
SIGNED URL TESTING
==================================================

Unit tests:

- public eligibility lookup
- DTO leakage
- filename sanitization if implemented
- signed URL helper error mapping

Live Supabase integration:

seed/use isolated published certificate
↓
create preview signed URL
↓
fetch signed URL
↓
HTTP 200
↓
Content-Type application/pdf
↓
valid PDF bytes

Download signed URL:

verify download disposition behavior if supported.

Do NOT delete shared bucket contents.

==================================================
UNPUBLISH / SIGNED URL TEST
==================================================

Test application semantics truthfully.

Before Unpublish:

detail → accessible
download route → issues controlled temporary URL

After Unpublish:

detail application route → 404
download application route → 404
no new signed URL can be issued

Do NOT write a false test claiming an already-issued Supabase signed URL is
instantly revoked unless the platform actually guarantees it.

Document the temporary signed-URL expiry window.

==================================================
E2E — PHASE 13
==================================================

Add focused Playwright coverage.

Suggested flow:

public search page
↓
search known published participant
↓
click result
↓
detail page opens WITHOUT authentication
↓
publishedName shown
↓
preview iframe/object is present
↓
signed preview resource resolves successfully
↓
download action available
↓
download starts / route redirects correctly
↓
unpublish test fixture through controlled setup
↓
reload detail
↓
404/not-found
↓
direct download route
↓
404/not-found

Also verify:

- mobile viewport
- desktop viewport
- no horizontal overflow
- accessible iframe title
- keyboard-accessible download/back actions

Do not require ADMIN login for public viewing.

==================================================
PHASE 12 KNOWN E2E DEBT
==================================================

The user explicitly chose to defer the previously observed full-suite
Playwright reliability issue to Final QA.

Therefore Phase 13 completion requires:

- Phase 13 targeted E2E PASS;
- relevant unit/integration tests PASS;
- build/typecheck/lint PASS.

You MAY run the full E2E suite once for regression signal.

If it reproduces the already-known live-Supabase/dev-server flakiness while
Phase 13 targeted tests remain clean:

- report it as existing deferred verification debt;
- do NOT spend this phase repeatedly chasing unrelated harness flakiness;
- do NOT mark the failing full suite as PASS.

Do not weaken tests or add skips.

Final QA will perform the comprehensive stability pass.

==================================================
REGRESSION
==================================================

Do not break:

- Phase 12 public search
- Phase 11 publish/unpublish
- published safe replacement
- Phase 10 generation management
- generation pipeline
- private storage
- ADMIN routes/auth

At minimum run relevant targeted regression tests.

==================================================
CANONICAL VERIFICATION
==================================================

After implementation run:

bun x prisma validate
bun x prisma generate
bun x prisma migrate status
bun run typecheck
bun run lint
bun run test
bun run test:e2e tests/e2e/public-certificate.spec.ts
bun run build

Expected:

NO Phase 13 migration.

Additionally verify with live Supabase Storage when credentials exist:

- signed preview URL
- PDF HTTP 200
- application/pdf
- download signed URL behavior
- old/new published snapshot resolution
- unpublish blocks new application access

Report:

PASS
FAIL
NOT VERIFIED

Do not call skipped checks PASS.

Full-suite E2E may remain a known deferred QA item as described above.

==================================================
DOCUMENTATION
==================================================

Update docs/FSD.md with durable Phase 13 contracts only:

- public detail route
- public eligibility
- publishedFilePath server-only usage
- private bucket remains private
- signed URL delivery architecture
- signed URL TTL/revocation limitation
- download route rechecks eligibility
- unpublished routes return not-found
- storage error vs resource-not-found semantics

Update docs/LOG.md with actual:

- files changed
- tests run
- live Storage result
- signed URL TTL
- no-migration status
- known Phase 12/full-suite E2E debt
- next phase

Do not rewrite PRD for implementation convenience.

==================================================
NEXT PHASE
==================================================

After successful Phase 13:

Phase 14 — Full E2E + Regression

That phase is the correct place to revisit the deferred full-suite
Playwright stability debt comprehensively.

==================================================
PLANNING REQUIREMENTS
==================================================

You are in /plan mode.

DO NOT IMPLEMENT YET.

Before proposing implementation:

1. inspect the actual Phase 12 implementation;
2. inspect actual Phase 11 publication snapshot implementation;
3. inspect Supabase Storage server helpers;
4. inspect generated-certificates bucket limits/private configuration;
5. inspect current Next.js public routes;
6. inspect CSP/security headers;
7. inspect installed Supabase signed URL API/types;
8. inspect Vercel deployment constraints relevant to PDF response sizes;
9. choose preview delivery architecture;
10. choose download delivery architecture;
11. choose signed URL TTL with rationale;
12. define immediate application-level Unpublish semantics;
13. define signed URL expiry/revocation limitation honestly;
14. verify no schema/dependency is required;
15. produce a concise reviewable plan.

==================================================
MANDATORY PLAN ANSWERS
==================================================

The plan MUST explicitly answer:

1. Is any Prisma migration required?

2. Is any new dependency required?

3. What exact public detail route is added?

4. What exact download route is added?

5. What DB predicates define public detail eligibility?

6. Why does detail use publishedName/publishedFilePath instead of mutable
   Participant.name/generatedFilePath?

7. Does detail require batch.status == PUBLISHED?

8. Does detail require Certificate.status == GENERATED?

9. Does detail require isStale == false?

10. What happens during published replacement GENERATING?

11. What happens after published replacement FAILED?

12. What happens immediately after Unpublish?

13. Is generated-certificates still private?

14. Why use signed URLs instead of proxying PDF bytes through Vercel?

15. What is the actual Vercel response-payload constraint relevant to the
    current deployment?

16. What signed URL TTL is selected and why?

17. Can an already-issued signed URL be instantly revoked on Unpublish?

18. What exact application-level guarantees does Unpublish provide?

19. How is PDF preview rendered?

20. Why is a custom PDF viewer unnecessary?

21. Does any private storage path reach the browser?

22. Does any service-role credential reach the browser?

23. How does the download route re-check eligibility?

24. Can a stale detail page still obtain a NEW download after Unpublish?

25. How is download filename handled?

26. What happens when Storage is temporarily unavailable?

27. What happens if the DB snapshot points to a missing object?

28. Does Phase 12 search generate any signed URLs?

29. What CSP change, if any, is required?

30. What remains deferred to Phase 14?

==================================================
MANDATORY ESCALATION CONDITIONS
==================================================

STOP for human review before implementation if:

- a Prisma migration is proposed;
- generated-certificates must become public;
- public delivery would require exposing service credentials;
- a new PDF viewer dependency is proposed without necessity;
- PDF bytes must be proxied through a Vercel Function despite files possibly
  exceeding the production response limit;
- application-level Unpublish cannot immediately stop NEW detail/download
  access;
- existing Phase 11 publication snapshot semantics are incompatible;
- instant revocation of already-issued signed URLs is treated as a hard
  business requirement;
- implementation requires changing generation/publish business rules.

Do not silently invent workarounds.

==================================================
DEFINITION OF DONE
==================================================

Phase 13 will eventually be complete when:

- search results link to certificate detail
- detail works without login
- valid published snapshot displays
- PDF can be previewed
- PDF can be downloaded
- private bucket remains private
- signed URL is short-lived and server-generated
- publishedFilePath remains server-only application data
- service credentials never reach browser
- operational GENERATING/FAILED does not break old published snapshot
- Unpublish makes NEW application detail access return 404
- Unpublish makes NEW application download access return 404
- soft-deleted records return 404
- storage failures are not leaked
- no PDF bytes are unnecessarily proxied through Vercel
- no new schema is added
- no unnecessary PDF viewer dependency is added
- targeted Phase 13 E2E passes
- live Storage signed URL test passes or is truthfully NOT VERIFIED
- docs describe signed URL revocation limitation accurately
- Phase 12 known full-suite stability debt remains tracked for Phase 14