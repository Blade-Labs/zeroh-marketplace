# Stack matrices

Present only the applicable sections and preserve every row when asking for a choice.

## Web
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| Next.js + shadcn/ui | Integrated full-stack React and accessible primitives | Framework conventions add coupling | Product needs routing, rendering, and server seams | Registry components remain source-owned | https://nextjs.org/docs |
| Vite + React | Small, fast client toolchain | Backend and routing need separate choices | Client-rendered app has independent services | React components move between Vite applications | https://vite.dev/guide |
| SvelteKit | Concise components and integrated routing | Smaller React-library ecosystem | Team prefers Svelte and server rendering | Svelte components share within Svelte projects | https://svelte.dev/docs/kit |

## Mobile
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| Flutter + shadcn_flutter | One Dart UI across supported platforms | Native integrations need platform bridges | Consistent cross-platform UI is primary | Shared Dart widgets and token names | shadcn_flutter |
| Kotlin/Compose/Material 3 | Native Android APIs and tooling | Android-only UI implementation | Android fidelity and platform access dominate | Compose modules and translated token names | https://developer.android.com/compose |
| Expo + @react-native-reusables/cli | React Native workflow with reusable primitives | Native edge cases may require modules | TypeScript skills and multi-platform delivery matter | React Native components and shared token names | @react-native-reusables/cli |

## Monorepo
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| Nx | Project graph, generators, and dependency constraints | More governance concepts | Many projects need enforceable boundaries | Publishable and buildable libraries | https://nx.dev |
| Turborepo | Simple task graph and caching | Fewer architecture constraints | Existing workspace needs lightweight orchestration | Workspace packages | https://turborepo.com/docs |
| pnpm workspaces | Minimal native workspace layer | No project graph or generators | Package linking is the main requirement | Workspace packages | https://pnpm.io/workspaces |

## Library/CLI
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| tsup + node:test | Compact bundling with built-in tests | Two separate tools | Small TypeScript package values minimal test dependencies | Exported modules and fixtures | tsup |
| tsdown + vitest | Modern bundling and rich tests | Additional test dependency | Vite-aligned libraries need fast test ergonomics | Exported modules and test helpers | tsdown |
| unbuild | Convention-led library output | Less explicit build control | Multi-format package follows unjs conventions | Package presets and modules | unbuild |

## Backend
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| NestJS | Structured modules and dependency injection | Heavier framework conventions | Large API needs consistent layering | Modules, guards, and providers | https://docs.nestjs.com |
| Hono | Small web-standard API core | Fewer built-in enterprise patterns | Edge portability and low overhead matter | Handlers and middleware | https://hono.dev/docs |
| Fastify | Mature Node plugin ecosystem and schemas | Node-oriented runtime | Throughput and plugin composition matter | Plugins, schemas, and hooks | https://fastify.dev/docs |
