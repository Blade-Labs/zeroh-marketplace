import { defineBacklog } from '@/lib/roadmap/schema'

// Queue order only; phase files own status and completion.
export default defineBacklog({
  "tiers": [
    {
      "tier": 0,
      "label": "NATIVEGREEN — phases36–45",
      "items": [
        {
          "phase": 36,
          "name": "Governance precedence, safe authority, and dual-host packaging proof"
        },
        {
          "phase": 37,
          "name": "Typed lifecycle reducer and exact-head restart semantics"
        },
        {
          "phase": 38,
          "name": "Durable run identity and native Claude/Codex adapters"
        },
        {
          "phase": 39,
          "name": "Atomic marketplace migration to the discovered roadmap root"
        },
        {
          "phase": 40,
          "name": "Safe pre-PR history normalization and roadmap-owned worktree garbage collection"
        },
        {
          "phase": 41,
          "name": "Idempotent arc delivery with explicit branch and merge authority"
        },
        {
          "phase": 42,
          "name": "Exact-head full-CI monitoring with bounded owned-failure correction"
        },
        {
          "phase": 43,
          "name": "Native lifecycle conformance with resumable four-host comparison"
        },
        {
          "phase": 44,
          "name": "Encode safety invariants and retire production incident archaeology"
        },
        {
          "phase": 45,
          "name": "Truthful intent-to-green-PR README, guide, orientation, and clean-room onboarding"
        }
      ]
    },
    {
      "tier": 1,
      "label": "Existing unfinished work",
      "items": [
        {
          "phase": 34,
          "name": "GREENFIELD keystone: missing-home remedy, packaging, skill grades, and dry-run evidence"
        }
      ]
    },
    {
      "tier": 2,
      "label": "DEFERRED — standing owner hold",
      "items": [
        {
          "phase": 12,
          "name": "DEFERRED — closed-loop trigger design: scheduled detection that authors draft fix proposals"
        }
      ]
    }
  ]
})
