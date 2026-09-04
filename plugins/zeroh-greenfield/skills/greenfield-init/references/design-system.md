# Design-system step

Choose after the stack ruling and before generation. Record the choice in the
design ADR, UX canon, and roadmap pointers; never invent brand values.

## Web

Use shadcn/ui with Tailwind v4 and its CSS-first configuration. The proposal
must name the component sources and license tier before installation.

Use this `components.json` shape, replacing registry names only with approved
open registries:

```json
{
  "style": "new-york",
  "baseColor": "neutral",
  "cssVariables": true,
  "iconLibrary": "lucide",
  "registries": {
    "@magicui": "https://magicui.design/r/{name}.json"
  }
}
```

Keep one token source and generate the CSS variable projection from it. The byte-check guard fails when generated CSS bytes differ from the token source projection.

Capture `fonts | palette | spacing | ux-canon` as inputs to the UX home. Use
`external-assets-licensing.md §The tiers` to classify every external source.

## beautifului.dev — MIT — Allowed anywhere

beautifului.dev may supply cited copy-paste AI-interface primitives or an
approved registry item. Record provenance with the component proposal.

## Mobile mappings

| stack | mapping | UX inputs | source |
| --- | --- | --- | --- |
| shadcn_flutter | Share semantic token names with web and project them to Dart | ux-canon fonts palette spacing | shadcn_flutter |
| Material 3 | Translate semantic roles to Material theme tokens | ux-canon fonts palette spacing | https://m3.material.io |
| react-native-reusables | Project semantic tokens to React Native primitives | ux-canon fonts palette spacing | @react-native-reusables/cli |

## Blade handoff

Invoke `zeroh-design:blade-design` using Path 2. It owns selection and token
values. Store only these approved outputs:

- `designHomes.ux.bindingDesignSystem` points to the sibling-owned theme.
- The `ux-canon pointer line` names that binding without copying tokens.
- The design-system `ADR line` records the choice and owner.

If zeroh-design is absent, print `/plugin install zeroh-design@zeroh-marketplace` and STOP.
