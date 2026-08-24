# Driving tiers — what each can honestly judge

`validate-arc` and the `intent-validator` agent speak ONE generic tier vocabulary. The plugin owns the vocabulary; each **consumer repo binds each tier to a concrete command** in the `validationTiers` key of its `roadmap.config.json` (the binding the judge reads).

A criterion's `tier` is the **cheapest tier that can honestly see its `signal` and `bar`** — not the most thorough.

## The three tiers

### `wired` — in-process wired turn
- **What it judges:** logic and data flow through the real route table / handlers / seam, in-process. Deterministic, fast, free.
- **Evidence:** the transcript / asserted output — did the turn produce the signal, or dead-end / throw / degrade?
- **Blind to:** anything rendered. It cannot see a screen, so it cannot judge a "feels finished / no raw error on screen" bar. A rendered-UX bar tagged `wired` is a tier-honesty mismatch (validate-arc flags it).
- **Default for:** "does the governed turn / handler / contract actually do X" criteria.

### `live-ui` — rendered surface + screenshot
- **What it judges:** the rendered experience — is the signal actually on screen, labelled, finished, no raw error / placeholder? Judged by **vision over a real screenshot**, not a DOM assertion.
- **Evidence:** the screenshot path + a one-line description of what it shows.
- **Cost:** needs a running surface + auth (often a one-time captured session). Subjective bars here run a **two-judge agreement** panel (split verdict → GAP, the user arbitrates).
- **Default for:** "the user sees / can do X on the surface" criteria where how it looks matters.

### `live-host` — real model / masking against a running host
- **What it judges:** genuine end-to-end behaviour with the real model and the real masking/policy path — not a stub or fixture.
- **Evidence:** the real response body excerpt showing the signal present.
- **Cost:** nondeterministic, spends tokens, needs a running host (and its network/VNet). Use only when the criterion is specifically about real model/masking behaviour.

A worked example of one consumer's bindings is in `DESIGN-NOTES.md` §driving-tiers — worked example (azure_private_agent); the judge reads whichever bindings the consumer documents.
