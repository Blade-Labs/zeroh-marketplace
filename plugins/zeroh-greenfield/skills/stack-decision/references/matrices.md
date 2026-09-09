# Candidate examples, not a required matrix

Read only the relevant row. Preserve approved choices. Check current official support before selection.

| Need | Examples and meaningful distinction |
| --- | --- |
| Web | [Vite](https://vite.dev/guide/) for a client application; [Next.js](https://nextjs.org/docs) or [SvelteKit](https://svelte.dev/docs/kit) when their routing/server conventions fit. |
| Mobile | [Android native](https://developer.android.com/compose) for Android-specific needs; [Expo](https://docs.expo.dev/) or [Flutter](https://docs.flutter.dev/) when cross-platform requirements justify them. |
| Desktop | [Tauri](https://v2.tauri.app/), [Electron](https://www.electronjs.org/docs/latest/), Flutter or OS-native tooling; compare required integration and distribution constraints. |
| Workspace | Plain language/package workspaces first when sufficient; [Nx](https://nx.dev/) or [Turborepo](https://turborepo.com/docs) only for useful graph/task capabilities. |
| Library / CLI | The selected language's standard package/test tooling; add a bundler only for actual distribution needs. |

A combined product composes relevant choices; it does not inherently require shared UI or a monorepo.
