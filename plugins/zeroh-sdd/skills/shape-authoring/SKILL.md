---
name: shape-authoring
description: "Zod shape authoring from golden template — writes complete .shape.ts files with .describe() on every field, 7-tag JSDoc frontmatter, GlobalMeta (SKOS + PROV-O), standards_provenance metadata, and version 1.0.0. Apply during shape fill Step 5, after ontology alignment produces the field classification."
disable-model-invocation: false
---

# Shape Author

## Role

You are a schema engineer writing Zod shape files from the super golden template — transforming an ontology-aligned field classification, L1 standard binding, SKOS crosswalk, and PROV-O provenance into a complete, production-ready `.shape.ts` file with GlobalMeta.

---

## First Principles — Why Each Field Exists

The golden shape pattern is not arbitrary. Every field traces to a published standard or established framework. Understanding WHY enables reasoning about unfamiliar shapes.

### The Standards Stack (6 layers)

| Layer | Standard | What It Gives Us | Authority |
|-------|----------|-----------------|-----------|
| Identity | RDF (URIs) | Dereferenceable identifiers | W3C Rec (2014) |
| Linking | JSON-LD 1.1 | URI-based binding in JSON | W3C Rec (2020) |
| Conformance | Dublin Core | "This conforms to standard X" | ISO 15836 |
| Provenance | W3C PROV-O | "This was derived from X" | W3C Rec (2013) |
| Mapping | W3C SKOS | Concept-to-concept relationships | W3C Rec (2009) |
| Profiling | W3C PROF | Machine-verifiable conformance | W3C WG Note (2019) |

### Field-to-Standard Traceability

| Meta Field | Standard | Why Required | Tier |
|------------|----------|-------------|------|
| `name` | (platform) | Shape registry identification | Operational |
| `version` | SemVer | Stub (0.x) vs filled (1.x) lifecycle | Operational |
| `category` | (platform) | Domain routing for discovery | Operational |
| `id` | W3C SKOS (skos:Concept) | Global identifier as CURIE — cross-ontology linking | Secondary |
| `prefLabel` | W3C SKOS (skos:prefLabel) | Human-readable label for catalog browsing | Secondary |
| `definition` | W3C SKOS (skos:definition) | Machine-readable definition (min 20 chars) | Secondary |
| `broader` | W3C SKOS (skos:broader) | Hierarchy — shapes belong to domain concepts | Secondary |
| `related` | W3C SKOS (skos:related) | Sibling relationships for navigation | Secondary |
| `cascadeGroup` | (platform) | Discovery grouping for cascade changes | Secondary |
| `standards_provenance` | Schreiber (2008) | Source taxonomy + conformance binding | Secondary |
| `exactMatch` | W3C SKOS (skos:exactMatch) | "This shape IS that standard concept" | Golden |
| `closeMatch` | W3C SKOS (skos:closeMatch) | "This shape ADAPTS that concept" | Golden |
| `broadMatch` | W3C SKOS (skos:broadMatch) | "This shape is NARROWER than that concept" | Golden |
| `narrowMatch` | W3C SKOS (skos:narrowMatch) | "This shape is BROADER than that concept" | Golden |
| `relatedMatch` | W3C SKOS (skos:relatedMatch) | "Conceptually related across domains" (e.g., Maqasid ↔ DPV) | Golden |
| `wasDerivedFrom` | W3C PROV-O (prov:wasDerivedFrom) | Dereferenceable source URIs — audit trail | Golden |
| `wasGeneratedBy` | W3C PROV-O (prov:wasGeneratedBy) | Activity that produced this shape | Golden (opt) |
| `wasAttributedTo` | W3C PROV-O (prov:wasAttributedTo) | Agent responsible | Golden (opt) |
| `bfoClass` | BFO (ISO/IEC 21838-2) | Ontological classification for OWL/Turtle emission | Golden |

### Schreiber Source Taxonomy (conformance_predicate selection)

| source_type | Meaning | Predicate | Why |
|---|---|---|---|
| `formal` | Standards body (ISO, W3C) | `dcterms:conformsTo` | Full conformance to published spec |
| `normative` | Professional/academic body | `prov:wasDerivedFrom` | Concepts derived, not full conformance |
| `de_facto` | Industry-dominant framework | `prof:isProfileOf` | Profile/extension of widely adopted spec |
| `heuristic` | ZeroH-native innovation | (none) | ZeroH IS the authority — no external ref |

### The Heuristic Exception

Shapes with `source_type: 'heuristic'` are classified as **golden** when they pass secondary validation AND have a valid `bfoClass`. Rationale: ZeroH IS the standard — requiring external crosswalk or wasDerivedFrom for ZeroH-native concepts is logically impossible. The shape author is the authority. However, every shape still needs ontological classification (`bfoClass`) for OWL/Turtle emission. `classifyMetaTier()` in the project's shape meta module encodes this exception.

### The BFO Ecosystem Connection

Shapes reaching golden tier automatically participate in the BFO ecosystem:

```
GlobalMetaShape → classifyMetaTier() → emit-ontology.ts → zeroh-prov.ttl → BFO alignment → OBO Foundry
```

The meta field names (`wasDerivedFrom`, `broader`, `related`, `prefLabel`, `definition`) are exactly the keys in the project's JSON-LD context file — the JSON-LD context that maps to W3C URIs.

### The Parseable Contract

The authoritative tier contract is the project's shape meta module (e.g., `@project/shapes/meta`):

```typescript
// Import from the project's shape meta module:
// import { classifyMetaTier, parseGlobalMeta, GlobalMetaShape } from '@project/shapes/meta'
```

- **`GlobalMetaShape`** — Zod schema defining golden tier (SKOS Tier 1-3 + PROV-O + infrastructure)
- **`SecondaryMetaShape`** — SKOS identity + hierarchy + Schreiber binding
- **`OperationalMetaShape`** — minimum viable (name + version + category)
- **`classifyMetaTier(meta)`** — returns `'golden' | 'secondary' | 'operational' | 'none'`
- **`parseGlobalMeta(meta)`** — returns `{ success, data, error }` with detailed field-level errors

---

## Trigger

This protocol activates:

- During shape fill Step 5, after ontology-aligner produces the field classification
- When upgrading a stub shape (version 0.1.0) to a filled shape (version 1.0.0)
- When the shape file needs corrections identified by provenance-auditor

---

## Input

You receive:

1. **Field classification** — from ontology-aligner: `{ fields_from_standard: string[], zeroh_extensions: string[], crosswalk: { type, target, rationale }, justifications }`
2. **L1 standard binding** — `{ key, name, uri, version, source_type, conformance_predicate, wasDerivedFrom: string[] }`
3. **Source profile** — from shape-source-profiler: `{ pattern, fields: [{name, inferredType, enumCandidates}] }`
4. **Shape name and domain** — e.g., `ScholarProfileShape` in domain `scholar`

---

## Protocol

### Step 1: Read the Existing Stub

Read the current `.shape.ts` file at the project's shapes directory (e.g., `src/shapes/{domain}/{shape-kebab-name}.shape.ts`).

Identify stub markers to remove:
- `// TODO: Expand fields from research artifacts and source interfaces`
- `version: '0.1.0'`
- JSDoc containing `(stub — expand from research)`
- Single `name` field only

### Step 2: Write the JSDoc Frontmatter

Shape files use 7 structured JSDoc tags as frontmatter for LLM discovery. Provenance details live in `.meta()` — JSDoc is a lightweight summary for scanning (~120 tokens).

```typescript
/**
 * @shape {ShapeName}Shape
 * @purpose {What filling this shape produces — MUST be unique per shape, not generic}
 * @standard {Standard Name} ({source_type})
 * @domain {category}
 * @keywords {distinctive, comma-separated, search tokens}
 * @pairsWith {OtherShape} — {business rationale for composition}
 * @module @project/shapes/{domain}/{shape-kebab-name}
 */
```

**Tag specification:**

| Tag | Source of Truth | LLM Use | Rule |
|-----|----------------|---------|------|
| `@shape` | `.meta().name` | "Which shape am I looking at?" | Exact match to export name |
| `@purpose` | `.meta().definition` | "What does filling this shape produce?" | MUST be unique per shape — generic purposes create Context Confusion |
| `@standard` | `.meta().standards_provenance.standard` | "What authority backs this?" | Format: `{Name} ({source_type})` |
| `@domain` | `.meta().category` | "What domain is this?" | Exact match to category value |
| `@keywords` | `.meta().keywords` | LLM search/matching | MUST be distinctive — reject keywords shared across all domain shapes |
| `@pairsWith` | `.meta().pairsWellWith` | "What shapes go with this and WHY?" | Format: `{ShapeName} — {business rationale}`. Omit for standalone shapes. Multiple tags allowed. |
| `@module` | (package tooling) | typedoc/jsdoc | Format: `@project/shapes/{domain}/{shape-kebab-name}` |

**Examples:**

```typescript
// Formal standard with composition hints
/**
 * @shape DPAShape
 * @purpose Complete GDPR-compliant Data Processing Agreement — all mandatory Art. 28(3) clauses
 * @standard EU GDPR 2016/679 + W3C DPV (formal)
 * @domain zeroh-compliance
 * @keywords GDPR, data-processing-agreement, Art-28, controller-processor, DPA
 * @pairsWith ClassifiedFileShape — data classification is prerequisite for processing agreements
 * @pairsWith ControlDefinitionShape — DPA maps to control definitions in GRC framework
 * @module @project/shapes/compliance/dpa
 */

// Heuristic — no @pairsWith needed if standalone
/**
 * @shape HeroSectionShape
 * @purpose Landing page hero section with headline, CTA, and social proof
 * @standard ZeroH (heuristic)
 * @domain landing
 * @keywords hero, landing-page, headline, call-to-action, above-fold
 * @module @project/shapes/landing/hero-section
 */
```

**Anti-hallucination rules:**
- `@purpose` MUST be unique per shape — if two shapes could share the same purpose, one is redundant
- `@keywords` MUST be distinctive — "compliance" alone is useless; "GDPR, Art-28, DPA" is distinctive
- `@pairsWith` includes business rationale — LLM knows WHY shapes compose, not just that they do

**Non-deterministic fields** (require human judgment):
- The **`.describe()` text** for each field — must be specific and informative, not generic
- The **`@purpose`** — summarizes the shape's unique value proposition
- The **`@keywords`** — distinctive discovery tokens for this specific shape
- The **`@pairsWith`** rationale — business reason for composition

### Step 3: Write the Zod Object Fields

Map each field from the source profile to Zod types using these rules:

**Type mapping table:**

| Source Type | Zod Type | Notes |
|-------------|----------|-------|
| `string` | `z.string()` | |
| `string` with enum candidates | `z.enum([...values])` | Use when ≤8 distinct values observed |
| `number` | `z.number()` | |
| `number` (integer only) | `z.number().int()` | When all observed values are integers |
| `number` (0-1 range) | `z.number().min(0).max(1)` | For normalized scores/weights |
| `boolean` | `z.boolean()` | |
| `string[]` | `z.array(z.string())` | |
| `T[]` | `z.array({ZodType})` | |
| Optional field (`?:`) | `.optional()` | Append to any type |
| Nested object | `z.object({...})` | Inline or import upstream shape |
| Union type | `z.enum([...])` or `z.union([...])` | Prefer enum for string unions |

**Nested/inline schemas** (enums and objects defined with `const`, not exported):

When the shape has inline helper schemas (e.g., `PartyInfoSchema`, `GapTypeShape`), they MUST get `.meta({ cascadeGroup })` matching the parent shape's cascadeGroup. This enables cascade discovery — when the parent shape changes, all related schemas are found.

```typescript
// ✅ CORRECT — nested enum tagged with parent's cascadeGroup
const GapTypeShape = z
  .enum(['missing-control', 'unmapped-control', 'structural'])
  .describe('ZeroH gap type classification')
  .meta({ cascadeGroup: 'grc-core-compliance' })

// ✅ CORRECT — nested inline object tagged with parent's cascadeGroup
const PartyInfoSchema = z
  .object({ /* fields with .describe() */ })
  .meta({ cascadeGroup: 'zeroh-compliance-gdpr' })

// ❌ WRONG — nested schema without cascadeGroup (breaks discovery)
const TransferDestinationSchema = z.object({ /* fields */ })
```

Nested schemas do NOT get Tier 1 GlobalMeta (id/prefLabel/definition) — only the primary exported shape gets full GlobalMeta. cascadeGroup is the minimum tag for discovery.

**Field ordering convention:**
1. Fields from standard first
2. ZeroH extensions second
3. Within each group, order by importance/usage

**Section comments** (`// --- Fields from standard ---` / `// --- ZeroH extensions ---`):
- **REQUIRED** when the shape has 5+ fields (improves scannability)
- **OPTIONAL** for shapes with fewer than 5 fields (the golden example ScoringDimensionShape omits them with only 4 fields)
- When present, place the comment on its own line before the first field in each group

**Non-serializable fields:** If the source interface contains fields with non-serializable types (React components like `LucideIcon`, function types, class instances, DOM elements), EXCLUDE them from the shape. Shapes must be JSON-serializable for emission (K10: KNOWLEDGE-EMIT-VERIFICATION). Add excluded fields as a comment: `// Excluded: icon (LucideIcon — non-serializable, UI-only)`

**Mandatory `.describe()` on EVERY field — no exceptions:**

```typescript
name: z.string().describe('Dimension identifier (e.g., referential_integrity, novelty)'),
score: z.number().min(0).max(1).describe('Normalized score on 0-1 scale'),
```

**ZeroH extensions should be `.optional()` by default** unless the platform requires them for every instance.

### Step 4: Write the .describe() and .meta() Chain

For Schreiber source taxonomy, conformance predicate selection, and URI patterns, see [references/schreiber-provenance.md](references/schreiber-provenance.md).

For programmatic tier validation, use the project's shape meta module:
- `parseGlobalMeta(shape._zod.def.meta)` — validates golden tier compliance
- `classifyMetaTier(shape._zod.def.meta)` — classifies into golden/secondary/operational/none

```typescript
export const {ShapeName}Shape = z
  .object({ /* fields */ })
  .describe('{One-line description} per {Standard Short Name}')
  .meta({
    // ── GlobalMeta Tier 1 (Identity) ───────────────────────────
    id: 'zeroh:{domain}/{shape-kebab-name}',
    prefLabel: '{Human Name}',
    definition: '{What this shape represents — one clear sentence}',

    // ── GlobalMeta Tier 2 (SKOS Hierarchy) ─────────────────────
    broader: ['zeroh:{domain}'],
    // related: ['zeroh:{domain}/{sibling-shape}'],  // if applicable

    // ── GlobalMeta Tier 3 (Standards Crosswalk) ────────────────
    // Use the crosswalk type from ontology-aligner output:
    //   exactMatch: shape fully implements the standard concept
    //   closeMatch: shape adapts/extends the standard concept
    //   broadMatch: shape is narrower than the standard concept
    {CROSSWALK_TYPE}: ['{STANDARD_CURIE}'],

    // ── PROV-O Provenance ──────────────────────────────────────
    wasDerivedFrom: ['{PUBLICATION_URI}'],  // from l1-standard-locator

    // ── BFO Upper Ontology Alignment ─────────────────────────
    bfoClass: '{BFO_CLASS}',  // see BFO class selection below

    // ── Knowledge Shape Discovery ────────────────────────────
    cascadeGroup: '{cascade-group-name}',

    // ── Existing (preserved) ───────────────────────────────────
    name: '{ShapeName}Shape',
    description: '{Longer description for metadata consumers}',
    version: '1.0.0',
    category: '{domain}',
    standards_provenance: {
      source_type: '{formal|normative|de_facto|heuristic}',
      standard: '{Standard Name — from L1 constant or composite}',
      standard_uri: '{Dereferenceable URI — from L1 constant}',
      version: '{Standard Version — from L1 constant}',
      conformance_predicate: '{dcterms:conformsTo|prof:isProfileOf|prov:wasDerivedFrom}',
      fields_from_standard: [/* field names from ontology-aligner */],
      zeroh_extensions: [/* field names from ontology-aligner */],
    },
  })
```

**BFO class selection (REQUIRED for ALL source_types):**

| Shape represents... | bfoClass | Key PROV-O predicates |
|---|---|---|
| Data artifact, document, concept | `bfo:Entity` | wasDerivedFrom, wasGeneratedBy, wasAttributedTo |
| Process, workflow, transformation | `bfo:Process` | used, wasInformedBy, startedAtTime, endedAtTime |
| Person, org, software agent | `bfo:MaterialEntity` | actedOnBehalfOf, wasAssociatedWith |
| Information record, report, bundle | `iao:InformationContentEntity` | wasDerivedFrom, wasAttributedTo |

**GlobalMeta rules by source_type:**

| Field | formal/normative/de_facto | heuristic |
|-------|--------------------------|-----------|
| `id` (CURIE) | REQUIRED | REQUIRED |
| `prefLabel` | REQUIRED | REQUIRED |
| `definition` | REQUIRED | REQUIRED |
| `broader` | REQUIRED | REQUIRED |
| `bfoClass` | REQUIRED | REQUIRED |
| Tier 3 crosswalk | REQUIRED (exactMatch/closeMatch/broadMatch) | OMIT (ZeroH IS the standard) |
| `wasDerivedFrom` | REQUIRED (dereferenceable URIs) | OMIT |
| `cascadeGroup` | REQUIRED | REQUIRED |
| `standards_provenance` | full object | `{ source_type: 'heuristic', zeroh_extensions: [...] }` |

**standards_provenance rules by source_type (preserved):**

| Field | formal | normative | de_facto | heuristic |
|-------|--------|-----------|----------|-----------|
| `source_type` | REQUIRED | REQUIRED | REQUIRED | REQUIRED |
| `standard` | REQUIRED | REQUIRED | REQUIRED | omit |
| `standard_uri` | REQUIRED | REQUIRED | REQUIRED | omit |
| `version` | REQUIRED | REQUIRED | REQUIRED | omit |
| `conformance_predicate` | REQUIRED | REQUIRED | REQUIRED | omit |
| `fields_from_standard` | populated | populated | populated | `[]` |
| `zeroh_extensions` | populated | populated | populated | populated |

### Step 5: Add the Type Export

```typescript
export type {ShapeName} = z.infer<typeof {ShapeName}Shape>
```

### Step 6: Self-Validate Before Committing

Run these checks mentally before declaring complete:

**JSDoc Frontmatter (7 structured tags):**
- [ ] `@shape` tag present with correct shape name
- [ ] `@purpose` tag present — unique, specific to THIS shape (not generic)
- [ ] `@standard` tag present with standard name + source_type
- [ ] `@domain` tag present matching `.meta().category`
- [ ] `@keywords` tag present — distinctive tokens (not shared across all domain shapes)
- [ ] `@pairsWith` tag(s) present with business rationale (omit only for standalone shapes)
- [ ] `@module` tag present with correct import path
- [ ] No L1/L2/L3 lines (provenance is in .meta(), not JSDoc)

**GlobalMeta (super golden):**
- [ ] `id` present as `zeroh:{domain}/{name}` CURIE
- [ ] `prefLabel` present (non-empty string)
- [ ] `definition` present (non-empty string)
- [ ] `broader` present pointing to domain
- [ ] `bfoClass` present (bfo:Entity, bfo:Process, bfo:MaterialEntity, or iao:InformationContentEntity)
- [ ] At least one SKOS Tier 3 crosswalk (for non-heuristic shapes)
- [ ] `wasDerivedFrom` present with valid URI (for non-heuristic shapes)
- [ ] `cascadeGroup` present

**Preserved (unchanged):**
- [ ] Every field has `.describe('...')`
- [ ] `version: '1.0.0'` (not 0.1.0)
- [ ] `standards_provenance` still present (not removed by GlobalMeta upgrade)
- [ ] `fields_from_standard` array matches ontology-aligner output
- [ ] `zeroh_extensions` array matches ontology-aligner output
- [ ] Import statement uses `zod/v4` (not `zod`)
- [ ] Type export present at bottom
- [ ] No `// TODO:` comments remain

---

## Mode 2: Audit & Remediate Existing Shape

### When to Use

- Checking if an existing shape meets golden tier
- After provenance-auditor flags issues
- When upgrading shapes identified by K21 ratchet as non-golden
- During shape maturity improvement campaigns

### Step A: Classify Current Tier

```typescript
// Import from the project's shape meta module:
         parseOperationalMeta } from '@project/shapes/meta'

const meta = MyShape._zod.def.meta
const tier = classifyMetaTier(meta)
// tier → 'golden' | 'secondary' | 'operational' | 'none'
```

### Step B: Diagnose Gaps

Parse against the NEXT tier to get specific error messages:

| Current Tier | Parse Against | What It Reveals |
|---|---|---|
| `none` | `parseOperationalMeta(meta)` | Missing name/version/category |
| `operational` | `parseSecondaryMeta(meta)` | Missing SKOS identity/hierarchy/infrastructure |
| `secondary` | `parseGlobalMeta(meta)` | Missing crosswalk matches or wasDerivedFrom |
| `golden` | — | Fully compliant |

```typescript
// Example: shape is 'operational', diagnose what's needed for secondary
const result = parseSecondaryMeta(meta)
if (!result.success) {
  for (const issue of result.error.issues) {
    console.log(`Gap: ${issue.path.join('.')} — ${issue.message}`)
  }
}
```

### Step C: Apply Tier-by-Tier Remediation

**none → operational** (3 fields):

```typescript
.meta({
  name: 'MyShape',
  version: '1.0.0',
  category: 'my-domain',
})
```

**operational → secondary** (add SKOS identity + hierarchy + Schreiber binding):

1. `id` — CURIE: `'zeroh:{domain}/{shape-kebab-name}'`
2. `prefLabel` — human-readable label
3. `definition` — min 20 chars, from standard or domain expertise
4. `broader` — `['zeroh:{domain}']` (min 1 CURIE)
5. `cascadeGroup` — for cascade discovery
6. `standards_provenance` — determine source_type per Schreiber taxonomy,
   then select conformance_predicate (see [references/schreiber-provenance.md](references/schreiber-provenance.md))

**secondary → golden** (2 paths):

**Path A — Non-heuristic** (formal/normative/de_facto):

1. Determine SKOS crosswalk type (see [references/reference.md](references/reference.md) § SKOS Crosswalk Type Decision)
2. Add at least ONE of: `exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, `relatedMatch`
3. Add `wasDerivedFrom` with dereferenceable publication URI(s) (see [references/schreiber-provenance.md](references/schreiber-provenance.md) § URI Pattern Guide)
4. For domain-specific mapping, invoke `l1-standard-locator` → `ontology-aligner`

**Path B — Heuristic** (ZeroH-native):

Already golden if secondary passes. No crosswalk or wasDerivedFrom needed.
`classifyMetaTier()` handles this automatically.

### Step D: Verify Remediation

```bash
# Verify GlobalMeta gates (K19 provenance + K20 consistency + K21 ratchet)
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts

# Verify Schreiber binding (K1-K7)
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts

# Verify .describe() coverage (K12) + version consistency (K14)
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
```

### Sub-Skills for Domain-Specific Remediation

When remediating secondary → golden, crosswalk and L1 binding require domain expertise.
Delegate to these skills in sequence:

1. **`l1-standard-locator`** — discovers the authoritative standard for the domain concept
2. **`ontology-aligner`** — classifies fields as fields_from_standard vs zeroh_extensions
3. **`shape-author`** (Mode 1) — writes the updated .meta() with golden fields
4. **`provenance-auditor`** — blind audit to verify remediation quality

---

## Programmatic Measurement

This skill's gap: "Does the shape file have .describe() on every field, correct version, GlobalMeta, and JSDoc frontmatter?"

### Pre-step (measure the gap)

```bash
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
  -t "GATE K12"
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
  -t "GATE K14"
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
  -t "GATE K15"
```

K12: FIELD-DESCRIBE-COVERAGE — shows which filled shapes have fields missing `.describe()`.
K14: VERSION-CONSISTENCY — shows filled shapes with version < 1.0.0 (stubs not yet bumped).
K15: JSDOC-PROVENANCE-ANCHORS — shows which shape files lack L1/L2/L3 or @module in JSDoc.

### Post-step (confirm gap closed)

```bash
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
  -t "GATE K15"
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
  -t "GATE K10"
```

K12 + K14 (via quality file) — violations should be 0 for the authored shape.
K15 — JSDoc @module present (super golden shapes exempt from L1/L2/L3 check).
K10: EMIT-VERIFICATION — filled shape produces valid JSON Schema via `z.toJSONSchema()`.

```bash
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
  -t "GATE K19"
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
  -t "GATE K20"
```

K19: GLOBALMETA-PROVENANCE — id + prefLabel + definition + crosswalk + wasDerivedFrom present.
K20: GLOBALMETA-CONSISTENCY — CURIEs valid, heuristic rules, URIs well-formed.

---

## Golden Example

For the complete, production-ready reference shape, see your project's reference shape file (ScoringDimensionShape). This is the super golden pattern:

```typescript
/**
 * @shape ScoringDimensionShape
 * @purpose Atomic unit of multi-criteria scoring — normalized score and importance weight per dimension
 * @standard IEC 31010:2019 / MAUT (formal)
 * @domain scoring
 * @keywords scoring-dimension, MAUT, multi-criteria, weight, IEC-31010, risk-criterion
 * @pairsWith ConfidenceSignalShape — confidence signals aggregate scoring dimensions into composite measures
 * @pairsWith ScorecardMetricShape — scorecard metrics track scoring dimensions over time
 * @module @project/shapes/scoring/scoring-dimension
 */
import { z } from 'zod/v4'

export const ScoringDimensionShape = z
  .object({
    name: z.string().describe('Dimension identifier (e.g., referential_integrity, novelty)'),
    score: z.number().min(0).max(1).describe('Normalized score on 0-1 scale'),
    weight: z.number().min(0).max(1).describe('Relative importance weight (weights sum to 1.0)'),
    evidence: z.string().optional().describe('Human-readable justification for the score'),
  })
  .describe('A single scoring dimension per IEC 31010 / MAUT')
  .meta({
    // ── GlobalMeta Tier 1 (Identity) ───────────────────────────
    id: 'zeroh:scoring/scoring-dimension',
    prefLabel: 'Scoring Dimension',
    definition:
      'Atomic unit of multi-criteria scoring — every scoring system decomposes quality into named dimensions with a normalized score and importance weight',

    // ── GlobalMeta Tier 2 (SKOS Hierarchy) ─────────────────────
    broader: ['zeroh:scoring'],
    related: ['zeroh:scoring/confidence-signal', 'zeroh:scoring/scorecard-metric'],

    // ── GlobalMeta Tier 3 (Standards Crosswalk) ────────────────
    exactMatch: ['iec31010:risk-criterion'],

    // ── PROV-O Provenance ──────────────────────────────────────
    wasDerivedFrom: ['https://www.iso.org/standard/72140.html'],

    // ── BFO Upper Ontology Alignment ─────────────────────────
    bfoClass: 'bfo:Entity',

    // ── Knowledge Shape Discovery ────────────────────────────
    cascadeGroup: 'scoring-maut',

    // ── Existing (preserved) ───────────────────────────────────
    name: 'ScoringDimensionShape',
    description:
      'Atomic scoring dimension with normalized score and weight for multi-criteria assessment',
    version: '1.0.0',
    category: 'scoring',
    standards_provenance: {
      source_type: 'formal',
      standard: 'IEC 31010:2019 / MAUT (Keeney & Raiffa 1976)',
      standard_uri: 'https://www.iso.org/standard/72140.html',
      version: '2019',
      conformance_predicate: 'dcterms:conformsTo',
      fields_from_standard: ['name', 'score', 'weight'],
      zeroh_extensions: ['evidence'],
    },
  })

export type ScoringDimension = z.infer<typeof ScoringDimensionShape>
```

For the full golden template with labeled placeholders, see [references/reference.md](references/reference.md).

---

## Beyond .describe() — Business Rule Validation (Zod v4 Tiers 2-9)

Shapes should express business LOGIC, not just STRUCTURE. The golden template handles Tier 1 (field types) and Tier 12 (.meta()). These tiers handle everything in between:

### Tier 2: Parse-Boundary Normalization
```typescript
.transform(id => id.trim().toLowerCase())  // normalize at boundary
z.strictObject({...})  // v4 replacement for .strict() — rejects unknown keys
```

### Tier 3: Cross-Field Validation
```typescript
.refine(d => new Date(d.updatedAt) >= new Date(d.createdAt),
  { message: 'updatedAt must be >= createdAt', path: ['updatedAt'] })
```

### Tier 4: State Machine
```typescript
z.discriminatedUnion('status', [
  z.object({ status: z.literal('draft'), createdAt: z.string().datetime() }),
  z.object({ status: z.literal('approved'), createdAt: z.string().datetime(), approvedBy: z.string() }),
])
```

### Tier 5: Temporal
```typescript
z.iso.date()       // YYYY-MM-DD only
z.iso.datetime()   // full ISO 8601
z.iso.duration()   // P6M, P1Y (contract terms)
```

### Tier 6: Business Formulas
```typescript
.refine(d => Math.abs(d.totalValue - (d.costPrice + d.profitMargin)) < 0.01,
  { message: 'totalValue must equal costPrice + profitMargin' })
```

### Tier 7: Conditional Requirements
```typescript
.refine(d => d.status !== 'executed' || d.executionDate !== undefined,
  { message: 'executionDate required when status is executed', path: ['executionDate'] })
```

### Tier 8: Nominal Types
```typescript
const ContractId = z.string().uuid().brand<'ContractId'>()
const CounterpartyId = z.string().uuid().brand<'CounterpartyId'>()
// Compile-time safety: cannot pass CounterpartyId where ContractId expected
```

### Tier 9: String Patterns
```typescript
z.templateLiteral([z.string().min(1), '-', z.number()])  // "ac-1", "mp-12"
z.hash('sha256')   // document integrity
z.e164()           // phone number (KYC)
```

### Critical v4 Note
`.strict()` is REMOVED in Zod v4. Use `z.strictObject({...})` for parse boundaries.
`.meta()` MUST be placed LAST — it is lost if placed before `.refine()`.

---

## Verification

After completing the protocol, verify output correctness before declaring done.

### Verify Shape Metadata

Cross-check the authored shape with `checkDescribeCoverage()` and `extractZodMeta()` from `tests/fitness/lib/shape-analyzer.ts`:

```bash
pnpm vitest run --config tests/fitness/vitest.config.ts -t "GATE K1"
pnpm vitest run --config tests/fitness/vitest.config.ts -t "GATE K2"
```

K1 validates `.meta()` presence with `standards_provenance`. K2 validates the provenance object against `StandardsProvenanceShape`.

### Verify Describe Coverage

```bash
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
```

This runs all K1-K7 gates. For shape-author, focus on K1 (meta present) and K2 (meta valid).

### Completeness Checklist

- [ ] `.describe()` on every field — no exceptions
- [ ] JSDoc has 7-tag frontmatter (@shape, @purpose, @standard, @domain, @keywords, @pairsWith, @module)
- [ ] `.meta()` has GlobalMeta Tier 1 (id CURIE, prefLabel, definition)
- [ ] `.meta()` has GlobalMeta Tier 2 (broader)
- [ ] `.meta()` has GlobalMeta Tier 3 crosswalk (non-heuristic: exactMatch/closeMatch/broadMatch)
- [ ] `.meta()` has wasDerivedFrom with valid URI (non-heuristic)
- [ ] `.meta()` has `standards_provenance` with correct `source_type`, `standard`, `standard_uri`, `version`, `conformance_predicate`
- [ ] Type export (`export type X = z.infer<typeof XShape>`) present at bottom
- [ ] Version is `1.0.0` (not `0.1.0`)
- [ ] Import uses `zod/v4` (not `zod`)
- [ ] `fields_from_standard` and `zeroh_extensions` arrays match ontology-aligner output

If any check fails, re-read the ontology alignment output and fix the shape file. Do NOT produce partial output.

---

## Gate References (Complete K1-K21 Catalog)

All gates run via: `pnpm vitest run --config tests/fitness/vitest.config.ts {test-file} -t "GATE {ID}"`

### Provenance Gates (K1-K7) — `knowledge-shape-provenance.fitness.ts`

| Gate | Name | Validates | Sev | Failure Means |
|------|------|-----------|-----|---------------|
| K1 | META-PRESENT | Every filled shape has standards_provenance in .meta() | error | .meta() missing or lacks standards_provenance |
| K2 | META-VALID | Provenance validates against StandardsProvenanceShape | error | Provenance structure malformed — check fields per source_type |
| K3 | URI-PRESENT | Formal/normative/de_facto shapes have standard_uri | warn | URI missing — add from L1 binding |
| K4 | URI-FORMAT | standard_uri is a valid URL | error | Malformed — fix to valid HTTPS publication URL |
| K5 | FIELDS-MAPPED | Formal/normative shapes have non-empty fields_from_standard | warn | Field arrays empty — populate from ontology-aligner |
| K6 | LAYERS-COMPLETE | Each domain has diverse source_type coverage | warn | Domain lacks source type variety |
| K7 | ROUNDTRIP | Provenance survives JSON emit/parse round-trip | error | Non-serializable values in .meta() — use plain JSON types |

### Cascade Gates (K8-K9, K11) — `knowledge-shape-cascade.fitness.ts`

| Gate | Name | Validates | Sev | Failure Means |
|------|------|-----------|-----|---------------|
| K8 | CASCADE-VALID | dependsOn targets exist, no cycles, cascade groups consistent | error | Broken dependency — check target shape exists |
| K9 | CROSS-DOMAIN | Cross-domain dependsOn targets are resolvable | warn | Cross-domain ref points to non-existent shape |
| K11 | FILLED-RATCHET | Filled shape count never decreases (monotonic) | error | Shape was un-filled or deleted — restore it |

### Emit Gate (K10) — `knowledge-shape-emit.fitness.ts`

| Gate | Name | Validates | Sev | Failure Means |
|------|------|-----------|-----|---------------|
| K10 | EMIT-VERIFICATION | Filled shapes produce valid JSON Schema via z.toJSONSchema() | warn | Zod types not JSON-Schema-compatible — avoid z.function(), z.promise() |

### Quality Gates (K12-K14) — `knowledge-shape-quality.fitness.ts`

| Gate | Name | Validates | Sev | Failure Means |
|------|------|-----------|-----|---------------|
| K12 | FIELD-DESCRIBE-COVERAGE | Every field in filled shapes has .describe() | warn | Add .describe() to every field — no exceptions |
| K13 | FIELD-CLASSIFICATION | Every field in fields_from_standard XOR zeroh_extensions | error | Field missing from both arrays or in both |
| K14 | VERSION-CONSISTENCY | filled:true → version ≥ 1.0.0; filled:false → 0.x | error | Bump version to 1.0.0 for filled shapes |

### JSDoc Gate (K15) — `knowledge-shape-jsdoc.fitness.ts`

| Gate | Name | Validates | Sev | Failure Means |
|------|------|-----------|-----|---------------|
| K15 | JSDOC-ANCHORS | Filled shapes have provenance anchors + @module in JSDoc | warn | Add 7-tag JSDoc frontmatter per template |

### Resolution Gates (K16-K17) — `knowledge-shape-resolution.fitness.ts`

| Gate | Name | Validates | Sev | Failure Means |
|------|------|-----------|-----|---------------|
| K16 | META-RESOLUTION | .meta() standards_provenance has valid source_type | error | source_type not in formal/normative/de_facto/heuristic |
| K17 | META-CONSISTENCY | .meta() name/category match export name and file path | warn | name or category doesn't match file convention |

### Discovery Gates (K18) — `knowledge-shape-discovery.fitness.ts`

| Gate | Name | Validates | Sev | Failure Means |
|------|------|-----------|-----|---------------|
| K18 | DISCOVERY-RATCHET | Discovery finds ≥ baseline shape count (monotonic) | error | Shape was removed from discovery — check exports |

### GlobalMeta Gates (K19-K21) — `knowledge-shape-globalmeta.fitness.ts`

| Gate | Name | Validates | Sev | Failure Means |
|------|------|-----------|-----|---------------|
| K19 | GLOBALMETA-PROVENANCE | Super golden: id + prefLabel + definition + crosswalk + wasDerivedFrom + bfoClass | error | Add GlobalMeta Tier 1/2/3 + PROV-O + BFO per template |
| K20 | GLOBALMETA-CONSISTENCY | CURIEs valid, heuristic rules, URIs well-formed | error | Fix CURIE format or remove exactMatch from heuristic |
| K21 | META-MATURITY-RATCHET | Non-golden count ≤ baseline (monotonic improvement) | error | Shape regressed — run classifyMetaTier() to diagnose |

### Quick Reference: Shape-Author Accountability

Shape-author is the **primary producer** for: K1-K5, K7, K10, K12-K15, K19, K20.
Most K-gate failures after a shape fill trace back to shape-author output.

```bash
# Run ALL gates for a freshly authored shape
# Run the relevant shape fitness tests for your project:
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts
# e.g., pnpm vitest run tests/fitness/shape-quality.test.ts

# Or run all fitness gates at once
pnpm test:fitness
```

---

## Error Recovery

### If shape authoring fails:

- **Stub file not found:** Verify the shape file exists at the project's shapes directory (e.g., `src/shapes/{domain}/{shape-kebab-name}.shape.ts`). If missing, the shape may need to be scaffolded first. Check the manifest for the correct `file` path.
- **Ontology alignment input missing:** Cannot author without field classification. Go back to ontology-aligner. The `fields_from_standard` and `zeroh_extensions` arrays are required inputs.
- **L1 binding input missing:** Cannot write GlobalMeta or provenance without L1 binding. Go back to l1-standard-locator.
- **`.describe()` text unclear:** Reference the L1 standard's definition for standard fields. For ZeroH extensions, describe the platform-specific purpose. Never use generic descriptions like "the value" or "a string".
- **Import path wrong:** Use `import { z } from 'zod/v4'`, NOT `from 'zod'`. The platform uses Zod v4.
- **Gate failure (K1-K5):** Fix the shape file to satisfy the gate — do NOT weaken the gate (AP: Test Capitulation). Re-read the gate's error message for specific remediation.
- **Escalation:** If recovery fails after 2 attempts, pause and report the error with full context to the lead.

---

## Related Skills

- **`l1-standard-locator`** — Discovers the authoritative L1 standard for a domain concept (used before shape authoring)
- **`ontology-aligner`** — Classifies fields as `fields_from_standard` vs `zeroh_extensions` using SKOS alignment
- **`provenance-auditor`** — Blind audit of a filled shape's provenance quality (used after shape authoring)
- **`knowledge-shape-constructor`** — Research and planning for shape fills (full Schreiber reference at `references/meta-standard-provenance.md`)

## Meta Shape Contract

The authoritative tier contract is the project's shape meta module (e.g., `@project/shapes/meta`):

- **`GlobalMetaShape`** — parseable definition of "super golden" (SKOS Tier 1-3 + PROV-O + infrastructure)
- **`SecondaryMetaShape`** — SKOS identity + hierarchy + Schreiber binding
- **`OperationalMetaShape`** — minimum viable (name + version + category)
- **`classifyMetaTier(meta)`** — programmatic tier classification: golden > secondary > operational > none

Shapes reaching golden tier automatically participate in the BFO ecosystem via the ontology emission pipeline: `GlobalMetaShape` → `classifyMetaTier()` → `emit-ontology.ts` → `zeroh-prov.ttl` → BFO alignment.

---

## Anti-Patterns

- **Do NOT omit `.describe()` on any field.** The K1-K8 gates check this. Every field must be self-documenting.
- **Do NOT copy field names verbatim from Pattern B sources.** Pattern B (existing Zod → new Zod) requires conceptual extraction — design the shape from the L1 standard's perspective, not from the existing implementation.
- **Do NOT leave `version: '0.1.0'`.** Filled shapes use `1.0.0`. This is a stub marker and the ratchet gate checks for it.
- **Do NOT use `import { z } from 'zod'`.** The platform uses `import { z } from 'zod/v4'`.
- **Do NOT write the provenance helpers (`prov()`, `heuristic()`) in the shape file.** Those are manifest-only. Shape files use inline provenance objects.

---

## Key Principle

> Every field tells you what it is (.describe), every shape tells you where it came from (.meta() with GlobalMeta + standards_provenance), every shape connects to its standard (SKOS crosswalk + PROV-O wasDerivedFrom).
