Continue AutoCertif with a narrow Template Typography & Name Placement Editor
enhancement for manual production acceptance.

This is an explicit PRODUCT REQUIREMENT UPDATE.

Previously, participant-name placement was effectively center-aligned and
typography configuration was deferred.

The new locked requirement is:

ADMIN must be able to configure the participant-name field directly in the
template editor:

- font family
- font weight/style from registered assets
- font size
- text alignment: LEFT / CENTER / RIGHT
- visual position by dragging
- maximum text width by horizontal resizing

Only the participant-name field is editable.

This is NOT a general-purpose certificate designer.

==================================================
FIRST: INSPECT BEFORE EDITING
==================================================

Read:

- AGENTS.md
- docs/PRD.md
- docs/FSD.md
- docs/LOG.md
- package.json
- prisma/schema.prisma

Then inspect actual implementations of:

- current position editor
- PDF.js template preview
- NamePlacement types/schema
- rendering geometry
- font registry
- font config
- generation preflight
- single-certificate renderer
- auto-fit engine
- relevant unit/E2E tests

Inspect the actual DM Sans font files that the project owner has already
placed in the repository.

There should be approximately six DM Sans variants from light through bold.

DO NOT assume filenames or numeric weights.

Derive the available variants from the actual repository files.

Also confirm that:

react-rnd

is installed before implementing.

Do not add another drag/resize library.

==================================================
ARCHITECTURE DECISION
==================================================

Use:

- existing PDF.js for template background rendering
- react-rnd for participant-name bounding-box drag/resize
- existing shadcn/ui controls for typography controls
- browser @font-face for editor preview
- existing pdf-lib + @pdf-lib/fontkit for final PDF rendering

Do NOT migrate the editor to:

- Konva
- Fabric.js
- SVG editor frameworks
- a general design-editor SDK

The product only edits one participant-name field.

==================================================
NO DATABASE MIGRATION UNLESS PROVEN NECESSARY
==================================================

Inspect the current CertificateTemplate model first.

Existing fields already include concepts such as:

- namePlacement
- fontFamily
- fontAssetPath
- fontConfig

Prefer extending the existing JSON contracts where appropriate.

Do not create a Prisma migration merely to store values that can safely live
inside the existing fields.

If a schema migration genuinely becomes necessary:
STOP and report why before applying it.

==================================================
FONT REGISTRY
==================================================

Upgrade the production font registry from an empty/simple mapping into a
controlled metadata registry if necessary.

Conceptually:

{
  id: "dm-sans-regular",
  family: "DM Sans",
  weight: 400,
  label: "Regular",
  assetPath: "..."
}

BUT:

inspect the actual six files and derive their real metadata first.

Do not invent file names.

Each font variant must have a stable registry identifier.

Example conceptual identifiers:

dm-sans-light
dm-sans-regular
dm-sans-medium
dm-sans-semibold
dm-sans-bold

These are examples only.

Use exactly what the actual files support.

The registry may contain server-only filesystem paths.

Client-side UI must receive only safe metadata such as:

- id
- family
- weight
- label

Never expose absolute filesystem paths.

==================================================
FONT FAMILY VS FONT VARIANT
==================================================

Treat:

DM Sans

as the FAMILY.

Treat Light / Regular / Medium / SemiBold / Bold etc. as font VARIANTS /
weights.

Do NOT present every weight as a different font family.

Persist:

fontFamily = "DM Sans"

fontAssetPath = stable registry identifier for the chosen variant

The actual font file is resolved server-side through the controlled registry.

Do not use test fixture fonts as production fallback.

==================================================
FONT PREVIEW
==================================================

The editor preview must render using the actual selected DM Sans variant.

Create safe local @font-face declarations from the production font assets.

No Google Fonts CDN.

No external runtime font dependency.

The browser preview should switch immediately when ADMIN changes:

- font family
- font weight

The final renderer must still use the exact registered font bytes via
pdf-lib/fontkit.

==================================================
NAME PLACEMENT MODEL
==================================================

Preserve the established ratio-based coordinate system.

Do NOT switch persisted coordinates to CSS pixels.

Keep:

xRatio
yRatio
maxWidthRatio

normalized against the actual certificate surface.

IMPORTANT:

xRatio/yRatio continue representing the CENTER OF THE PARTICIPANT-NAME
BOUNDING BOX.

Changing text alignment must NOT change this coordinate contract.

Extend alignment from the old center-only contract to:

"left" | "center" | "right"

Conceptually:

type NameAlignment =
  | "left"
  | "center"
  | "right";

Do not interpret xRatio differently based on alignment.

==================================================
REACT-RND EDITOR
==================================================

Use react-rnd as a controlled component.

The participant-name bounding box must:

- be draggable within the certificate surface
- remain bounded by the actual certificate surface
- be horizontally resizable
- persist position as ratios
- persist width as maxWidthRatio
- remain deterministic across preview scale changes

Prefer horizontal resize handles only unless vertical resizing has an actual
domain purpose.

Do not persist browser pixels.

Conversion must be:

preview position/size
↓
normalized ratios
↓
persisted NamePlacement

and when loading:

persisted ratios
↓
current preview dimensions
↓
react-rnd position/width

The same configuration must survive:

- desktop resize
- refresh
- different preview scaling

without changing the logical certificate placement.

==================================================
TEXT ALIGNMENT
==================================================

Add ADMIN controls:

LEFT
CENTER
RIGHT

Use the existing shadcn/ui toggle/button patterns.

The bounding box position remains fixed.

Alignment only controls text placement inside that box.

Final renderer semantics:

boxLeft = centerX - boxWidth / 2

LEFT:
text begins from boxLeft

CENTER:
text centered inside box

RIGHT:
text ends at boxRight

Apply the same alignment semantics to both:

- single-line names
- wrapped two-line names

No line should use different alignment from the configured value.

==================================================
FONT SIZE
==================================================

ADMIN must be able to configure the preferred/default participant-name size.

Use the existing PDF rendering unit semantics.

Do NOT accidentally store CSS pixels if the renderer expects PDF points.

Inspect existing RenderCertificateStyle and fitting tests first.

Expose a clear:

Font Size

control.

Use a reasonable bounded numeric input.

Do not allow:

- zero
- negative values
- absurd values that exceed current schema limits

==================================================
AUTO-FIT CONTRACT MUST REMAIN
==================================================

User-selected font size is the preferred/default size.

Existing fitting behavior remains:

preferred font size
↓
shrink deterministically
↓
minimum font size
↓
if still too wide:
word-aware wrap, maximum 2 lines
↓
if still impossible:
participant generation fails safely

Do NOT remove auto-fit just because the ADMIN selects a size.

Do NOT clip or ellipsize names.

==================================================
MINIMUM FONT SIZE
==================================================

Inspect the existing domain contract and current fontConfig.

If minFontSize already has a meaningful existing default/configuration,
preserve that behavior.

Do not invent an arbitrary hidden rule without documenting it.

If the editor needs a min size for a previously-null template:

derive a conservative initial value from existing Phase 8 test/config
conventions and document the exact choice.

Do not expose additional UI complexity unless necessary.

The primary ADMIN-facing control requested is preferred Font Size.

==================================================
FONT CONFIG
==================================================

Reuse the existing fontConfig structure where possible.

Preserve required rendering properties including:

- fontSize
- minFontSize
- lineHeightMultiplier
- textColor
- stepSize where applicable

Changing font/weight/size/alignment must not erase unrelated existing
configuration.

Avoid replacing the entire JSON object if a merge/update is safer.

==================================================
EDITOR CONTROLS
==================================================

Add a compact typography control panel using existing shadcn/ui components.

Required controls:

Font
Weight
Font Size
Alignment

The visual design must remain:

- minimal
- professional
- desktop-first
- consistent with existing AutoCertif admin shell
- Telkom-red accent only where appropriate
- no gradients
- no oversized decorative UI

Do not build a Canva clone.

==================================================
INITIAL TEMPLATE CONFIGURATION
==================================================

Existing templates may currently have:

fontFamily = null
fontAssetPath = null
fontConfig = null

The editor must handle that safely.

For a template that has no production typography config:

- show DM Sans as the available production family
- allow ADMIN to explicitly choose/configure it
- provide sane initial editor values based on existing rendering contracts

Do NOT silently persist configuration merely by opening the page.

Persist only when ADMIN explicitly saves.

Generation preflight must continue to reject templates whose production font
configuration has not been saved.

==================================================
SAVE BEHAVIOR
==================================================

The Save action must atomically persist the complete participant-name
configuration:

- xRatio
- yRatio
- maxWidthRatio
- alignment
- fontFamily
- fontAssetPath
- fontConfig.fontSize
- all required retained fontConfig fields

Validate server-side.

Never trust browser values.

Reject:

- unknown font registry identifiers
- unsupported alignment
- invalid ratios
- invalid size
- missing font files
- malformed fontConfig

Do not allow the browser to submit arbitrary filesystem paths.

==================================================
RENDERER UPDATE
==================================================

Update the renderer/fitting pipeline only where required to honor:

- selected registered font variant
- selected preferred font size
- left/center/right alignment

Do not alter unrelated rendering behavior.

Use actual font metrics from the existing pdf-lib/fontkit pipeline.

The visual editor is a preview.

The server renderer remains authoritative.

==================================================
WRAPPED TEXT
==================================================

Ensure two-line fallback respects alignment.

For example:

LEFT:
John Very Long
Participant Name

both aligned to the same left edge.

CENTER:
both lines centered independently within the configured box.

RIGHT:
both lines aligned against the same right edge.

Use actual measured text width for final PDF placement.

==================================================
MIGRATION / BACKWARD COMPATIBILITY
==================================================

Previously saved NamePlacement values may contain:

alignment: "center"

They must continue to work.

No existing template should become unreadable.

If alignment is absent in legacy data:

inspect existing persisted contracts and choose the safest backward-compatible
interpretation.

Prefer center only if consistent with the old contract.

Document the compatibility behavior.

==================================================
TESTING
==================================================

Add/adjust focused unit tests for:

FONT REGISTRY
- all actual DM Sans variants resolve
- unknown identifier rejected
- missing file rejected
- test font remains outside production registry

PLACEMENT
- left accepted
- center accepted
- right accepted
- invalid alignment rejected
- ratio validation retained

RENDERING
- selected weight embeds successfully
- configured font size honored when text fits
- shrink still works
- two-line wrap still works
- LEFT coordinates correct
- CENTER coordinates correct
- RIGHT coordinates correct

EDITOR/PERSISTENCE
- changing typography does not modify template artwork
- persisted ratios survive preview resize
- font selection persists
- weight persists
- size persists
- alignment persists

PREFLIGHT
- configured real DM Sans passes font resolution
- null/unregistered font still fails safely

==================================================
E2E / MANUAL ACCEPTANCE
==================================================

Add or update the narrowest useful E2E coverage.

Do NOT rerun the entire unstable Phase 14 acceptance loop unless necessary.

At minimum verify:

ADMIN
→ open template editor
→ select DM Sans
→ choose one available weight
→ change size
→ choose LEFT
→ drag box
→ resize width
→ Save
→ reload editor
→ exact configuration restored

Then repeat alignment persistence for CENTER and RIGHT at the appropriate test
layer.

After saving a real configuration:

trigger generation for a small batch.

Expected:

DRAFT
→ generation preflight PASS

If generation still returns HTTP 400:

capture the exact response body.

Do not guess.

If generation reaches:

GENERATING

but does not complete:

report Inngest transport as the next blocker.

==================================================
VERIFICATION
==================================================

Run:

bun x prisma validate
bun x prisma generate
bun x prisma migrate status
bun run typecheck
bun run lint

Run the focused unit/integration suites covering the changed areas.

Run focused Playwright editor verification if practical.

Run:

bun run build

Do not claim PASS for anything not executed.

==================================================
DOCUMENTATION
==================================================

Update:

docs/PRD.md
docs/FSD.md
docs/LOG.md

because this is a genuine requirement change.

Explicitly record that the old center-only constraint is superseded.

New product contract:

ADMIN controls participant-name:

- registered production font family
- font variant/weight
- preferred font size
- placement
- max width
- left/center/right alignment

Auto-fit remains authoritative for overflow handling.

Do not modify unrelated requirements.

==================================================
FINAL REPORT
==================================================

Return:

1. Actual DM Sans files discovered
2. Production font registry mapping
3. Font families/weights exposed
4. react-rnd integration
5. NamePlacement contract changes
6. FontConfig handling
7. Backward compatibility behavior
8. Renderer alignment implementation
9. Files changed
10. Prisma migration status
11. Typecheck
12. Lint
13. Relevant unit/integration results
14. Relevant E2E result
15. Build
16. Generation preflight result
17. Remaining blocker, if any

Do not start unrelated deployment/Phase 15 work.