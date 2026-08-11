# Component structure

The one standard for how UI components split and where they live — applied at PLANNING
time: a UI task names its target placement before a line is written.

## Granularity — split along state/render seams

A component accumulating distinct concerns splits: state management into a hook, distinct
render regions into subcomponents. The consumer's size ratchet is the tripline where one
exists; without one, the smell is a component you cannot name in one clause.

## Placement — reuse decides the home

| Reuse | Home |
| --- | --- |
| ≥2 pages/surfaces consume it | the consumer's SHARED components home |
| one consumer | its own folder, carrying everything that is only its own |

A single-consumer folder holds the component, its subcomponents, its state hook, and the
hook's co-located logic spec — never a render/markup spec (`test-worthiness.md` owns that
exclusion; looks are judged by parity/vision gates).

## The worked example — the hero-try shape

One folder: the panel component, its carved subcomponents (dock, chat, receipt row), the
state hook (`useDeskChat.ts`) holding every service call and transition, and
`useDeskChat.spec.ts` driving the hook's logic with a faked transport. The markup files
carry no specs; the hook carries them all.

## Deference — the consumer's own conventions win

Where a consumer states its own component-structure conventions (a structure spec, a
layering contract, an architecture page), those govern. This reference is the DEFAULT for
consumers that are silent — never an override.

## The planning duty

- A UI task's plan NAMES the target folder (shared home vs own folder) per this rule.
- The design gate (plan-arc Step 1b / ux-designer) places a new surface's components the
  same way, at design time.
- A component dropped loose in a flat directory, or one component wearing three concerns,
  is a quality-pass finding — the same class as dead code.
