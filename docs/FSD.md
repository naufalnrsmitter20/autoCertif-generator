# AutoCertif — Functional & System Design

## 1. Purpose
This document defines how AutoCertif behaves technically. It translates `PRD.md` into a deterministic implementation contract without turning the project into an over-engineered platform.

## 2. Architecture

```text
Browser
  │
  ├── Public UI
  │     └── Certificate Search / Preview / Download
  │
  └── ADMIN UI
        ├── Auth
        ├── Batch Management
        ├── Template Configuration
        ├── CSV Import / Participant CRUD
        ├── Generation Status
        └── Publish / Unpublish
              │
              ▼
          Next.js App
              │
      ┌───────┼───────────┐
      │       │           │
   Prisma   Inngest   Supabase Storage
      │       │           │
      ▼       ▼           ▼
 Supabase   Generation   Templates /
PostgreSQL    Jobs       Certificates
```

Intended deployment:
- application: Vercel
- database: Supabase PostgreSQL
- object storage: Supabase Storage
- background jobs: Inngest
- package manager/runtime commands: Bun

## 3. Main Domain Model

Exact Prisma field names may follow existing project conventions, but behavior must map to these concepts.

### User
MVP has one ADMIN.

Core fields:
- `id`
- authentication identity/credentials required by Auth.js
- `role = ADMIN`
- timestamps

### CertificateTemplate
Represents one uploaded certificate template and the participant-name rendering configuration.

Core fields:
- `id`
- `name`
- `sourceFilePath`
- `fileType` (`PDF | PNG | JPG`)
- template dimensions/page dimensions
- name placement configuration
- font configuration/reference
- soft-delete state
- timestamps

### CertificateBatch
Core fields:
- `id`
- `name`
- `templateId`
- generation/publish state
- `publishedAt`
- soft-delete state
- timestamps

### Participant
Core fields:
- `id`
- `batchId`
- `name`
- soft-delete state
- timestamps

No email or certificate number is required in MVP.

### Certificate
Represents the generated output for one participant.

Core fields:
- `id` — internal identifier only
- `batchId`
- `participantId`
- generated file path
- preview path if separately stored
- generation status
- generation error message/code when failed
- stale/outdated flag or equivalent state
- generation timestamps
- publication eligibility/state if needed
- soft-delete state

`Certificate.id` may be used internally for routes. It is not a product-level certificate number.

## 4. Recommended State Model

### Batch
A simple state model is sufficient:

```text
DRAFT
READY
GENERATING
GENERATED
PUBLISHED
```

A batch may contain participant-level failures while still reaching a generated state if at least some generation results completed. Failure details belong primarily to participant/certificate generation records, not to a single all-or-nothing batch flag.

Implementation may add an operational `FAILED` state only for unrecoverable batch/job-level failure.

### Certificate Generation
Recommended statuses:

```text
PENDING
GENERATING
GENERATED
FAILED
```

A changed participant with an existing generated certificate must also be representable as stale/outdated until regeneration succeeds.

## 5. Template Upload

### PDF
- accept a single-page PDF
- preserve the original page
- overlay the participant name at configured coordinates

If a multi-page PDF is uploaded, reject it in MVP with an actionable validation message.

### PNG / JPG
- accept a single image
- treat it as the complete certificate background
- overlay participant name
- final downloadable output should be PDF
- an image preview may be generated if useful for browser display

## 6. Coordinate System
Persist name placement in a resolution-independent normalized form.

### Canonical Coordinate Contract
- **Origin**: TOP-LEFT $(0, 0)$ of the certificate media surface.
- **Center Anchor**: $(xRatio, yRatio)$ represents the normalized center anchor of the participant name bounding box.
- **Strictly Spatial Contract**:
```ts
export type NamePlacement = {
  xRatio: number;        // Normalized horizontal center: [maxWidthRatio / 2, 1 - maxWidthRatio / 2]
  yRatio: number;        // Normalized vertical center: [0.0, 1.0]
  maxWidthRatio: number; // Normalized maximum allowed width: [0.1, 1.0]
  alignment: "center";   // Fixed invariant: "center"
};
```
- Spatial placement is completely decoupled from font sizing and text fitting.
- Normalized values are viewport-, canvas-, and devicePixelRatio-independent.
- Boundary clamping enforces $xRatio \in [\frac{maxWidthRatio}{2}, 1 - \frac{maxWidthRatio}{2}]$ and $yRatio \in [0, 1]$.
- Atomic concurrency protection: mutation verifies that batch status is `DRAFT`, `batch.templateId` matches the submitted template, and soft-delete is null, rejecting stale writes with HTTP 409 Conflict.

### Downstream Rendering Translation (Established in Phase 7)
- In the single certificate rendering engine, $(xRatio, yRatio)$ is converted to PDF bottom-left page space:
  - $\text{centerX} = xRatio \times pageWidth$
  - $\text{centerYFromBottom} = (1 - yRatio) \times pageHeight$
  - $\text{maxWidth} = maxWidthRatio \times pageWidth$
- **Typographic Box Centering Baseline Formula**:
  $$\text{baselineY} = \text{centerYFromBottom} - \frac{ascent - descent}{2}$$
  Where $totalHeight = \text{font.heightAtSize}(fontSize, \{\text{descender: true}\})$, $ascent = \text{font.heightAtSize}(fontSize, \{\text{descender: false}\})$, and $descent = totalHeight - ascent$.
- **Horizontal Positioning**:
  $$\text{startX} = \text{centerX} - \frac{\text{textWidth}}{2}$$
  Where $\text{textWidth} = \text{font.widthOfTextAtSize}(name, fontSize)$.
- **Single-Line Pre-Fitting Gate (Phase 7)**:
  If $\text{textWidth} > \text{maxWidth}$, throws `NameDoesNotFitError`. Shrink-until-fit and two-line wrapping are deferred to Phase 8.
- **Image-to-PDF Physical Sizing Policy**:
  - Valid source density ($\ge 72$ and $\le 1200$) is used when present in image headers.
  - Missing/undefined density defaults to **300 DPI** as an implementation technical fallback (never written into source metadata).
  - Physical points: $\text{points} = \frac{\text{pixels} \times 72}{\text{dpi}}$.
- **PDF Geometry Contract**:
  Single-page PDFs are supported only when `rotation === 0`, `CropBox === MediaBox` with origin $(0, 0)$, and `UserUnit` is absent or 1.0; otherwise throws `UnsupportedTemplateGeometryError`.
- **Image Orientation Contract**:
  EXIF orientations $2..8$ throw `UnsupportedTemplateGeometryError` to prevent silent auto-rotation or re-encoding.

## 7. Template Positioning Editor
MVP editor supports the participant-name field only.

Required behavior:
- visual template preview using Mozilla PDF.js canvas rendering (for PDF templates) or high-DPI image element (for PNG/JPG)
- one draggable participant-name placeholder with center alignment
- slider control for maximum allowed width ($maxWidthRatio$) with immediate $xRatio$ bounds recalculation and clamping
- keyboard positioning support (Arrow keys for 1% step, Shift+Arrow for 5% step)
- live coordinate readout ($X$, $Y$, $Width$ in percentages)
- atomic persistence with 409 conflict dialog if template was replaced concurrently
- realistic sample name ("Naufal Nabil Ramadhan")
- no arbitrary text, stickers, or shapes

## 8. Font Handling & Phase Dependencies
Product expectation: the generated name visually follows the certificate template font.

- **Phase 5 (Name Position Editor)**: Captures strictly spatial geometry (`NamePlacement`).
- **Phase 7 (Single Certificate Engine Prerequisite)**: Deterministic font asset configuration (`fontFamily`, `fontAssetPath`). The system must not assume arbitrary PDFs allow extraction of embedded fonts; deterministic rendering requires referencing project-bundled font assets.
- **Phase 8 (Name Auto-Fitting)**: Measurement and dynamic fitting parameters (`defaultFontSize`, `minFontSize`, `lineHeight`, shrink loop, and 2-line word wrapping).

## 9. Name Measurement & Fitting (Established in Phase 8)

### Inputs
- participant `name`
- font (`PDFFont`)
- `fontSize` (default font size, finite > 0)
- `minFontSize` (minimum font size, finite > 0, <= fontSize)
- `lineHeightMultiplier` (finite > 0)
- `stepSize` (optional, default 1.0 pt)
- target spatial coordinate: `centerX`, `centerYFromBottom`, `maxWidth`
- `pageHeight`

### Algorithm

```text
normalize input whitespace
↓
generate descending candidate font sizes [defaultFontSize, ..., minFontSize]
↓
single-line fitting loop (largest font size first):
  fits horizontally (width <= maxWidth) AND vertically safe (top <= pageHeight, bottom >= 0)?
   ├─ yes → render single centered line
   └─ no → continue descending
↓
single-line fits?
 ├─ yes → render single centered line
 └─ no
      ↓
      words < 2 (single unbroken word)?
       ├─ yes → fail immediately with NameDoesNotFitError(SINGLE_WORD_OVERFLOW)
       └─ no
            ↓
            authoritative two-line evaluation:
            for every valid word-boundary split (N - 1 candidate splits for N >= 2 words):
              find largest candidate font size in [minFontSize, defaultFontSize] where:
                line1Width <= maxWidth AND line2Width <= maxWidth
                AND vertical page bounds are safe (top <= pageHeight, bottom >= 0)
                AND typographic line boxes do not overlap (lineHeight >= ascent + descent)
            ↓
            discard invalid candidates
            rank remaining candidates deterministically by:
              1. largest fontSize
              2. smallest abs(line1Width - line2Width)
              3. smallest max(line1Width, line2Width)
              4. earliest split index (deterministic tie-break)
            ↓
            valid candidate exists?
             ├─ yes → render two centered lines
             └─ no → fail generation with typed NameDoesNotFitError (TWO_LINE_OVERFLOW / VERTICAL_OVERFLOW)
```

### Rules & Invariants
- Use actual font metrics (`PDFFont.widthOfTextAtSize`, `heightAtSize`), never character counts.
- Preserve words strictly: split only across existing whitespace boundaries. No arbitrary hyphenation or letter splitting.
- Both lines must independently fit `maxWidth`.
- **Vertical Safety Definition**:
  Phase 5 does not persist an arbitrary height ratio. Vertical safety strictly means:
  1. No page-edge clipping: `topLineTop <= pageHeight` and `bottomLineBottom >= 0`.
  2. No typographic line-box overlap: `topLineBaseline - descent >= bottomLineBaseline + ascent`.
- Do not truncate with ellipsis.
- Do not clip or overflow silently.
- Single-word names exceeding `maxWidth` at `minFontSize` fail safely with `SINGLE_WORD_OVERFLOW`.
- If no valid layout plan exists, throw typed `NameDoesNotFitError` surfacing the participant name and reason for ADMIN reporting.

## 10. CSV Import

Expected MVP CSV:

```csv
name
Naufal Nabil Ramadhan
Budi Santoso
```

### Parse
Use a proper CSV parser.

### Validation
For every row:
- `name` header must exist
- trim surrounding whitespace
- normalize accidental repeated whitespace where safe
- reject empty name

### Duplicate Handling
Duplicates are not blocked.

Before confirm import:
- detect duplicate normalized names within the upload and, where relevant, against active participants already in the batch
- present a warning
- ADMIN may proceed

Do not create a unique database constraint on participant name.

### Import Preview
Show:
- row number
- participant name
- validity
- duplicate warning if applicable
- reason for invalidity

Only confirmed valid rows are imported.

## 11. Participant CRUD
After import, ADMIN can:
- add participant
- edit participant name
- soft-delete participant

Changing a participant name must invalidate/stale its current generated certificate.

Deleting a participant must remove it from active generation/public behavior without requiring hard deletion.

## 12. Bulk Generation

### Trigger
ADMIN requests generation for:
- entire batch, or
- one participant/certificate

### Execution
Bulk generation must be performed through background job processing rather than one long HTTP request.

Recommended flow:

```text
ADMIN starts generation
↓
server validates batch/template/font/participants
↓
create/enqueue generation job
↓
process participants independently
↓
persist per-participant result
↓
upload successful output
↓
update generation progress
↓
ADMIN polls/subscribes/revalidates status
```

Implementation may process participants in bounded parallelism/chunks. Do not create unbounded concurrency.

### Failure Isolation
A participant failure must not roll back successful certificate generations.

Example:

```text
100 participants
99 GENERATED
1 FAILED
```

The batch UI must explicitly show the failed participant name and failure reason.

### Retry & Regeneration Contracts (Established in Phase 10)
Generation management enforces distinct, strictly validated server-side contracts:

#### 1. Operation Preconditions
- **Retry Failed Participant (`retry-participant`)**:
  - Precondition: `batch.status === GENERATED` AND target certificate `status === FAILED`.
  - Touches only the specified target Certificate record.
- **Regenerate Successful Participant (`regenerate-participant`)**:
  - Precondition: `batch.status === GENERATED` AND target certificate `status === GENERATED`.
  - Touches only the specified target Certificate record.
- **Regenerate Whole Batch (`regenerate-batch`)**:
  - Precondition: `batch.status === GENERATED`.
  - Resets all active certificates in the batch to `PENDING` under a new generation key.
- **Recover Failed Batch (`recover-batch`)**:
  - Precondition: `batch.status === FAILED`.
  - Recovers only unfinished certificates belonging to the failed operation.

#### 2. Stale Request Protection & Optimistic Concurrency Control (CAS)
Every management request MUST provide `expectedCurrentGenerationKey` matching the generation identity visible when ADMIN initiated the action.
Inside the database transaction, an atomic Compare-And-Swap (CAS) verifies:
- `batch.id` matches
- `batch.status` matches expected lifecycle state
- `batch.currentGenerationKey === expectedCurrentGenerationKey`
- `batch.deletedAt IS NULL`

If any check fails (e.g., another generation finished concurrently), the server rejects the request with `ConcurrentGenerationConflictError` (HTTP 409).

#### 3. Scope-Preserving FAILED Batch Recovery
When a batch enters `FAILED` status, it reflects failure of the CURRENT generation operation identified by `failedGenerationKey = batch.currentGenerationKey`.
The recovery target set is determined strictly by:
- `batchId === batch.id`
- `generationKey === failedGenerationKey`
- `deletedAt IS NULL`
- `status IN [PENDING, GENERATING]`

Behavior:
- Only unfinished certificates from the failed operation are assigned the fresh recovery `generationKey` and reset to `PENDING`.
- Terminal certificates (`GENERATED`, `FAILED`) belonging to earlier completed operations remain untouched.
- If failed operation had zero unfinished certificates remaining, the batch reconciles directly to `GENERATED` without launching superfluous workers.

#### 4. Safe Output & Stale Flag Preservation
- Previous output paths (`generatedFilePath`) and timestamps (`generatedAt`) are NEVER nullified during regeneration or worker failure.
- Certificates under regeneration are flagged with `isStale = true`.
- If regeneration succeeds, `generatedFilePath` points to the new storage object, `generatedAt` is updated, and `isStale` becomes `false`.
- If regeneration fails, the previous successful file path and timestamp remain intact on the database record and in Supabase Storage, preserving the stale output with `isStale = true` and `status = FAILED`. Old storage files are never deleted.

#### 5. Information Exposure Boundary
Generation management APIs and UI present sanitized, user-safe error categories (e.g., `NAME_DOES_NOT_FIT: SINGLE_WORD_OVERFLOW` mapped to `"Name could not fit safely within configured certificate area."`). Internal filesystem paths, database error traces, and raw storage URLs are never exposed.

## 13. Output Files
Each participant gets one generated certificate PDF.

Recommended storage organization:

```text
templates/{templateId}/source.*
certificates/{batchId}/{participantId}/{generationVersion}.pdf
```

Exact naming may differ.

Use internal IDs in storage paths rather than raw participant names.

Do not construct public storage URLs from unsanitized participant names.

## 14. Safe Replacement / Published Edit
When ADMIN edits the name of a participant that already has a published certificate:

```text
edit name
↓
mark certificate stale
↓
keep last successful published PDF active
↓
generate replacement
   ├─ success → atomically point current record to new output
   └─ failure → keep previous published output and show ADMIN failure
```

Never replace the live file reference with a failed/incomplete output.

Old files may be cleaned later; cleanup must not break the current published reference.

## 15. Publishing

### Batch Publish
Publish is a batch-level action.

Preconditions:
- template exists
- batch has at least one successfully generated active certificate

If failures exist:
- display failure count and names
- successful certificates may still be published
- failed certificates remain unavailable publicly

Publishing sets batch public state and makes eligible generated certificates searchable.

### Unpublish
Unpublishing:
- removes all certificates in the batch from public search
- makes direct application certificate routes unavailable/not-found
- does not delete generated files or ADMIN records

## 16. Public Search
Search input: participant name only.

Behavior:
- trim query
- case-insensitive
- partial matching
- search only active participants in published batches with a current successful generated certificate
- return all matches when names collide

Example:
- query: `naufal`
- may match: `Naufal Nabil Ramadhan`

Do not expose:
- auth data
- internal storage path
- generation errors
- soft-deleted records
- unnecessary internal identifiers as human-facing certificate numbers

A route may still contain an opaque internal record ID or opaque public slug.

## 17. Public Certificate Page
Required:
- certificate preview
- download action

The certificate artwork is the dominant visual artifact. Surrounding UI remains minimal.

Download:
- no authentication
- only for a current successful certificate in a published active batch
- should resolve through a controlled application/storage access pattern consistent with storage privacy configuration

## 18. Authentication & Authorization
Auth.js protects ADMIN behavior.

Requirements:
- one ADMIN identity
- no public registration
- no forgot-password UI
- all `/admin` pages require ADMIN session
- all ADMIN server mutations re-check authorization server-side
- hiding a UI control is not authorization

Admin account provisioning is manual/seed/config driven.

## 19. Soft Deletion
Soft deletion applies to product records where delete is exposed.

Recommended fields:
- `deletedAt: DateTime?`

Queries for normal behavior must exclude soft-deleted records.

Soft-deleted:
- batch: not public/searchable
- participant: not generated/searchable
- template: unavailable for new active use according to references
- certificate: not public

Existing referential integrity must be preserved.

## 20. Security / Input Safety
- validate file type and size server-side
- validate PDF page count
- never trust CSV MIME/header alone
- limit CSV row count to a safe upper bound above the target batch size
- sanitize filenames used for display/storage
- never use raw user filenames as authoritative storage keys
- protect ADMIN mutations server-side
- prevent path traversal
- prevent public access to unpublished records through application routes
- use signed/private access where appropriate if storage is not intentionally public

## 21. Error Handling
Errors must be actionable.

Examples:
- invalid template type
- PDF has more than one page
- missing `name` CSV header
- empty participant name
- unavailable configured font
- name cannot fit in two lines
- storage upload failed
- generation job failed

Per-participant generation errors must store enough context for ADMIN to know which participant failed and why.

Do not expose internal stack traces publicly.

## 22. UI Structure

Suggested routes:

```text
/admin
/admin/batches
/admin/batches/new
/admin/batches/[batchId]
/admin/batches/[batchId]/template
/admin/batches/[batchId]/participants
/admin/batches/[batchId]/certificates

/
or /certificates

/certificates/[opaqueIdOrSlug]
```

Exact route organization may follow the existing Next.js project structure.

### Admin Batch Detail
Should make these states obvious:
- participant count
- generation progress
- generated count
- failed count
- failed participant names
- publish state
- stale certificates requiring regeneration

Avoid dashboard clutter unrelated to certificate generation.

## 23. Verification Strategy

### Unit / Integration
At minimum cover:
- CSV validation
- duplicate detection
- whitespace normalization
- name measurement/fitting
- two-line split behavior
- unfit-name failure
- publish eligibility
- public search filtering
- stale-certificate replacement rules

### E2E
Required core E2E flow:
1. ADMIN login
2. create batch
3. upload/configure template
4. import CSV
5. confirm participants
6. generate certificates
7. inspect generation result
8. publish
9. public partial-name search
10. preview certificate
11. download
12. unpublish and verify public route no longer resolves

Also cover at least one participant-generation failure without causing other participant generations to fail.

Use actual project scripts from `package.json`, with Bun as command entrypoint.
