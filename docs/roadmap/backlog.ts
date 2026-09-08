import { defineBacklog } from './lib/schema'

// Queue order only; phase files own status and completion.
export default defineBacklog({
  "tiers": [
    {
      "tier": 0,
      "label": "NATIVEGREEN Codex pilot \u2014 authorized task43.4 only",
      "items": [
        {
          "phase": 43,
          "name": "One Codex pilot: stop after43.4;43.5\u201343.8 deferred"
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
      "label": "DEFERRED \u2014 standing owner hold",
      "items": [
        {
          "phase": 12,
          "name": "DEFERRED \u2014 closed-loop trigger design: scheduled detection that authors draft fix proposals"
        },
        {
          "phase": 44,
          "name": "DEFERRED \u2014 owner scope: Encode safety invariants and retire production incident archaeology"
        },
        {
          "phase": 45,
          "name": "DEFERRED \u2014 owner scope: Truthful intent-to-green-PR README, guide, orientation, and clean-room onboarding"
        }
      ]
    }
  ]
})
