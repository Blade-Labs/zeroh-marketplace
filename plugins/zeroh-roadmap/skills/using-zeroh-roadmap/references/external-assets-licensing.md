# External-asset licensing

The org's ratified policy for anything external a phase brings in — packages, fonts,
icons, images, snippets, models. A task introducing one NAMES its license and placement
before a byte lands; unknown fails closed.

## The tiers

| Tier | Licenses | Where |
| --- | --- | --- |
| Allowed anywhere | MIT, Apache-2.0, BSD, ISC, CC0, Unlicense, OFL | any artifact |
| Conditional | CC-BY (BY only — no NC/ND variants) with the attribution SHIPPED | any artifact, with the attribution in place |
| Server-side ONLY | GPL, LGPL, MPL | backend/services only — NEVER a shipped client artifact |
| Banned everywhere | AGPL, any non-commercial or no-derivatives clause (CC-BY-NC / CC-BY-ND), "free for personal use", unknown/unlicensed | nowhere; fail closed |

The server-side-only line is DELIBERATELY stricter than common practice (MPL is widely
treated as web-safe): the ratified policy draws it at the shipped artifact, never soften
it in a plan.

## The placement test — what counts as a shipped client artifact

The web bundle, the Office add-in, the Teams zip, the SPFx package — anything a customer
installs or a browser downloads. Copyleft code in one of these is a distribution event;
on a server we operate, it is not.

## The protocol

- **Planning** — a task introducing an external dependency or asset names its license and
  its placement tier in the task text. No license named = the task is not plannable.
- **Execution** — before vendoring/installing, verify the license matches what the plan
  named (read the upstream LICENSE, not the README badge). A mismatch stops the task; the
  verified license and placement land in the task's transparencyReport.
- **Unknown or gray-zone** (dual-licensed, custom terms) — fail
  closed and escalate: a `software-architect` Decision Contract call, and AGPL-class or
  commercial-terms questions go to the USER — never resolved by an executor.
- **Attribution duty** — CC-BY and any license requiring notice ships its attribution IN
  the artifact (a visible credits surface or bundled notice file), not in a repo comment.

This is a planning/execution rule, not a scanner: the org deliberately runs no CI license
gate — the plan-time naming and review-time check are the control.
