# Phase 37.1 authority representation

2026-09-06 — PROCEED_WITH_FIX. Independent native architect fallback; requested Sol, runtime model unverified. The previously rejected external Fable call was not retried.

The pure lifecycle reducer carries `authorityRef`, not a native `AuthorityEnvelopeShape`. A known reference identifies an already validated persisted envelope by digest and source. An unknown reference states read-only projection, legacy unrecorded, or unreadable source. Neither is a grant. Disk derivation and inline lifecycle observation remain usable without fabricated native argv or permission provenance.

Preserve known provenance when an ordinary event supplies unknown authority. Reject conflicting known references and unreadable-source recovery without state change. The impure execution owner must still apply the existing arm, governance, parent authorization, launch-envelope and action controls. No new scheduler, host probe, authority loader or permission ceremony belongs in the reducer.

Verification: unknown projection never becomes a grant; resume preserves known identity; duplicate, invalid and conflicting events preserve state. Later workflow wiring retains existing mutation controls.
