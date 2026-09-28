# AutoCertif — Product Requirements Document

## 1. Product
**Name:** AutoCertif — `Certificate Generator` System

AutoCertif is a single-organization web application that allows an ADMIN to generate approximately 100 certificates at once from a reusable certificate template and a CSV containing participant names.

The core problem is repetitive manual certificate editing: the certificate design is already fixed, and only the participant name changes. AutoCertif removes the need to insert names one by one.

## 2. Goals
The MVP must allow an ADMIN to:

1. Upload a single-page certificate template in PDF, PNG, or JPG format.
2. Configure where the participant name appears on the template.
3. Import participant names from CSV.
4. Review and manage imported participants.
5. Generate one certificate per participant in bulk.
6. Automatically keep long names visually safe within the configured name field.
7. Identify exactly which participant names fail generation.
8. Review generated results.
9. Publish or unpublish a certificate batch.
10. Allow the public to search published certificates by participant name.
11. Allow public certificate download without login.
12. Regenerate one certificate or an entire batch when data changes.

## 3. Non-Goals
The MVP does not include:

- multi-tenant organizations
- multiple admin roles or permission levels
- public registration
- forgot-password/reset-password flow
- email delivery
- WhatsApp delivery
- QR verification
- analytics
- certificate-ID generation
- dynamic score, school, date, organization, or custom CSV fields
- multi-page certificate templates
- a full Canva-like certificate editor
- automatic redesign of uploaded certificate templates

## 4. Users

### ADMIN
A single internal ADMIN account manages all application data.

ADMIN can:
- log in/out
- create and manage certificate batches
- upload and configure templates
- import CSV
- create/edit/delete participants
- generate/regenerate certificates
- inspect failed generations
- publish/unpublish batches
- soft-delete/archive project data as defined by the implementation

### Public Visitor
No authentication required.

A visitor can:
- search published certificates by participant name
- open a published certificate result
- preview the certificate
- download the certificate

## 5. Core Product Flow

```text
ADMIN login
    ↓
Create Certificate Batch
    ↓
Upload Template
(PDF / PNG / JPG)
    ↓
Configure Name Placement
    ↓
Upload CSV
    ↓
Validate + Preview Participants
    ↓
Confirm Import
    ↓
Generate Certificates
    ↓
Review Success / Failure
    ↓
Fix Participant or Template if Needed
    ↓
Regenerate Individual / Batch
    ↓
Publish Batch
    ↓
Public Search by Name
    ↓
Preview / Download Certificate
```

## 6. Certificate Batch
A certificate batch groups:

- one certificate template
- one name-placement configuration
- many participants
- generated certificate records
- publish state

For the MVP:
- one participant receives one certificate per batch
- target batch size is approximately 100 participants
- publishing is performed at batch level

Suggested batch lifecycle:

```text
DRAFT
→ READY
→ GENERATING
→ GENERATED
→ PUBLISHED
```

Failures are tracked per participant/certificate and must not erase successful results.

## 7. Template Requirements
The previous center-only name alignment constraint is superseded by the typography editor requirements below.
Supported input:
- PDF
- PNG
- JPG

Rules:
- template must represent a single certificate page
- the existing certificate artwork/design is preserved
- the system does not redesign or reflow template content
- only participant name is dynamic in MVP
- ADMIN can visually place the name area
- ADMIN configures the registered font family, variant, preferred font size, placement, maximum width, and left/center/right text alignment for the participant name only
- the name field uses a center anchor; center is the backward-compatible default alignment
- template must have an available/configured font asset suitable for rendering the participant name

## 8. CSV Requirements
Required CSV field:

```csv
name
Naufal Nabil Ramadhan
Budi Santoso
```

No other field is required in MVP.

Import requirements:
- validate that `name` exists
- reject empty names
- trim unnecessary surrounding whitespace
- show a preview before confirmed import
- warn about duplicate names
- duplicates are allowed after warning
- ADMIN may add, edit, or delete participants after import

## 9. Name Fitting
The generator must use actual rendered text measurement.

Required behavior:

1. Render from the configured default font size.
2. If the name is too wide, decrease the font size until it fits or reaches minimum size.
3. If it is still too wide at minimum font size, wrap into at most two lines using the configured alignment.
4. If it still cannot fit safely, fail generation for that participant.
5. Never silently clip, truncate, or overflow the participant name.

The ADMIN must see the participant name for every failed certificate.

## 10. Generation
Generation is asynchronous/background work.

Requirements:
- generate one certificate per participant
- successful participants remain successful if another participant fails
- show progress/state to ADMIN
- preserve generated outputs in object storage
- allow retry/regeneration of one failed/changed participant
- allow whole-batch regeneration
- do not regenerate certificates on every public page request

The MVP target is approximately 100 participants per batch, but implementation should avoid request-time loops that depend on one long-running HTTP request.

## 11. Editing a Published Participant
If a participant name is edited after its certificate is published:

1. mark the current generated certificate as outdated/stale
2. keep the currently published file available while regeneration is in progress
3. regenerate the edited participant certificate
4. replace the published file only after successful regeneration
5. if regeneration fails, keep the last successful published file and surface the failure to ADMIN

## 12. Publish / Unpublish
Publish action applies to a batch.

Publishing:
- only successfully generated certificates become publicly searchable/downloadable
- failed participant generations remain unavailable
- ADMIN must be shown the number/names of failures before or during publish confirmation

Unpublishing:
- removes the batch certificates from public search
- direct public certificate routes must return/not-found as appropriate
- stored files and ADMIN data are not deleted merely because a batch is unpublished

## 13. Public Search
Search requirements:
- search only published certificates
- search by participant name only
- partial matching
- case-insensitive
- no authentication
- if duplicate participant names exist, return all matching published results
- do not expose internal/admin-only information

Because the product does not generate a visible certificate ID, internal database identifiers may be used for routing but must not be presented as certificate numbers.

## 14. Public Certificate Experience
A public result should prioritize the certificate itself.

Required actions:
- preview
- download

Certificate design must remain the uploaded template design with the generated participant name.

The surrounding web page should be:
- minimal
- professional
- responsive
- search-centric
- visually subordinate to the certificate artwork

## 15. Authentication
MVP authentication:
- one ADMIN account
- account provisioned manually/seeded/configured by the project
- no public registration
- no forgot-password flow

All ADMIN routes and mutations must require ADMIN authentication.

## 16. Deletion
MVP uses soft deletion for product records where deletion is supported.

Soft-deleted content:
- must not appear in normal ADMIN active lists unless explicitly requested
- must not appear in public search
- must not become publicly downloadable through normal application routes

Physical storage cleanup may be handled separately and must not create broken active records.

## 17. Acceptance Criteria
The MVP is acceptable when:

- ADMIN can authenticate.
- ADMIN can create a batch.
- ADMIN can upload PDF, PNG, or JPG template.
- ADMIN can visually configure the participant-name position.
- ADMIN can save and reload the name font family, variant, preferred size, width, and alignment.
- ADMIN can import a CSV containing only `name`.
- invalid/empty names are surfaced before generation.
- duplicate names generate an explicit warning but can be accepted.
- ADMIN can add/edit/delete participants after import.
- approximately 100 participants can be submitted as one generation batch.
- certificates preserve the original template appearance.
- participant names resize based on measured width.
- oversized names can wrap to at most two lines.
- unfit names fail safely without failing the whole batch.
- ADMIN can see exactly which participant names failed.
- ADMIN can regenerate one participant.
- ADMIN can regenerate the entire batch.
- ADMIN can publish/unpublish a batch.
- public users can partially search published certificates by name, case-insensitively.
- public users can preview and download a certificate without login.
- unpublished certificates are not publicly reachable through application routes.
- the defined critical E2E flow passes.
