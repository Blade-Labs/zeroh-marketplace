# UX craft bar — what a design-gate artifact must reach

The reference standard for every artifact the `ux-designer` agent produces (prose note or
preview). Written 2026-07-03 after two gate artifacts diverged sharply in quality: one
preview reached sign-off through seven user-review rounds (the consumer's
`docs/ux-previews/marketplace-landing.html`, arc MARKETPLACE), while another shipped a
competent-but-generic sheet the same week. The difference was never taste. It was a set
of checkable habits. This file makes them the bar.

The identity itself is always the CONSUMER's (bound via its `CLAUDE.md` "## Design
homes"); this file is about the CRAFT applied to that identity.

## 1. Identity fidelity — the consumer's brand, actually rendered

- **Load the real webfonts.** A preview that names the canon's typefaces in CSS but ships
  no `<link>`/`@font-face` renders in system fallbacks — the single most common reason a
  preview reads "generic AI SaaS". If the canon names the families, load them (Google
  Fonts link or repo assets) and confirm the display face is visibly NOT a fallback.
- **Use the real brand assets.** Search the consumer's repos for the actual logo/wordmark
  file (SVG preferred) and the real app icons, and inline them. A text-styled fake
  wordmark or emoji placeholder marks the artifact as a mock; the real mark makes it a
  decision-grade design. Recolor per the consumer's lockup rules when the surface's
  sub-brand differs from the asset's origin.
- **Type has roles, not sizes.** Apply the canon's role split (display / UI body / the
  record voice — e.g. mono for identifiers, amounts, anything ledger-grade). If the canon
  has a record voice, machine facts NEVER render in the body face.
- **Tokens, not approximations.** Copy the consumer's color/radius/shadow/spacing tokens
  verbatim into the preview's `:root`. Eyeballed hexes drift; drifted previews teach the
  build phases the wrong values.

## 2. Form — prototype over screen sheet

- **A flow is a prototype, not a stack of screenshots.** If the surface has 2+ sequential
  states (funnel, wizard, stepper), build ONE interactive page: click-through with real
  transitions, simulated latency on async boundaries, and a small **designer rail**
  (restart / jump-to-state / failure toggles) so reviewers reach the unhappy paths the
  happy path never shows. Stacked static frames are acceptable only for single-state
  surfaces.
- **Motion is specified, not sprinkled.** A staged reveal per view (staggered rise),
  state-transition durations named in the CSS, one signature moment maximum (a stepper
  fill, a stamp) — and ALL of it collapsing under `prefers-reduced-motion`.
- **Real interaction affordances.** Buttons are `<button>`, tooltips open on
  hover AND `:focus-within`, live regions carry `role="status"`/`role="alert"`, focus
  rings visible. The preview demonstrates the accessibility bar, not just claims it.

## 3. Restraint — the say-it-once doctrine

The reviewed-to-sign-off preview lost something in EVERY round: kickers, fine print,
duplicate completion signals, a paragraph "no one will read". Design for that ending:

- **Each view says its one thing once.** If a stepper shows completion, the view does not
  also need a chip, a seal AND a receipt saying it again. Count the ways a screen states
  its message; keep the strongest, cut the rest.
- **No text answering unasked questions.** Reassurance fine-print, legal-ish asides, and
  secondary offers belong in the footer or nowhere. If a sentence exists "just in case",
  cut it.
- **Labels the chrome already provides are clutter.** A "STEP 2 OF 3" kicker under a
  stepper, a "marketplace" badge under a hero that says Microsoft sent you — delete.
- **Run an explicit declutter pass before returning.** Re-read every view asking "what
  would a reviewer cut?" and cut it first.

## 4. Copy — the consumer's voice, human-sounding

- If the consumer binds copy rules (banned AI-tell vocabulary, no filler phrases, no
  em-dash sentence connectors, lead with a specific fact), every string in the artifact
  follows them — headings, microcopy, empty states, error text.
- **No cleverness that pattern-matches to AI.** "One thing left, and it's a click" died
  in review; "You're in." survived. Short declaratives beat winks.
- **Money and promises are exact.** Pricing copy states what is billed and what is not,
  in the buyer's terms, without mechanism jargon in the headline layer (unit prices are
  receipt-level detail, not hero copy).

## 5. Honesty — in the artifact itself

- **Never fake a screenshot.** If the artifact wants "the product in action" and no real
  capture exists, draw a clearly stylized vignette in the design language and record
  "replace with real e2e captures" as a build-phase task. A mocked image posing as the
  product is a lie the marketing team will ship.
- **Design the honest states.** Empty, loading, refused, not-yet-measured — with the
  consumer's semantic state vocabulary used as facts (a "granted" color appears only
  after the granting act), never as decoration.
- **No duplicated/placeholder blocks.** A copy-pasted card left twice in the artifact, or
  lorem-grade filler, fails the gate. Every block in the preview is intentional.

## 5b. Handover — a design is delivered as a LINK, not a path

A handed-over artifact the reviewer cannot open in one click is not handed over. Before
returning, make the artifact viewable and put the URL in your return message:
- If the consumer already serves its previews directory (a running static server, a docs
  site), use that URL.
- Otherwise start one per the consumer's own environment conventions (its CLAUDE.md /
  host rules — e.g. a memory-capped static server on a shared box) and hand back the
  REACHABLE address those rules prescribe (never localhost when the reviewer is on
  another machine).
- The file path is still reported (it is the designRef); the link is how the human
  actually reviews it. No link, no handover.

## 6. Self-check before returning (all must pass)

1. Open the preview: is the display face visibly the canon's (not a fallback)?
2. Is the real wordmark/logo in the chrome, from the consumer's assets?
3. Machine facts (ids, amounts, paths) in the record voice, not body text?
4. Multi-state surface → is it clickable end to end, failure states reachable?
5. Did a declutter pass actually remove something? (If nothing fell, look harder.)
6. Does every string pass the consumer's copy rules?
7. Reduced-motion, keyboard focus, live regions present?
8. If the consumer's Design homes name a **quality exemplar**, does this artifact stand
   next to it without embarrassment?
9. Does the return message carry a clickable URL where the artifact is served (§5b)?
