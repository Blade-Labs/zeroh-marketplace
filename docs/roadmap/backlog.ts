import { defineBacklog } from './lib/schema'

// Queue order only; phase files own status and completion.
export default defineBacklog({
  "tiers": [
    {
      "tier": 0,
      "label": "NATIVEGREEN — phases36–45",
      "items": [
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
