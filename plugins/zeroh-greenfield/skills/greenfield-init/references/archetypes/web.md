# Web

Decide browser-only versus server-backed, first user journey and data boundary.

## Prerequisites and creation

Node/package manager appropriate to the approved framework; backend prerequisites only if needed.

Vite, Next.js and SvelteKit are examples. Follow the selected generator documentation; do not silently choose Next.js.

## Minimal shape and rationale

src/ with app entry, a domain function and data adapter only where needed; tests/ or colocated tests; README with run/test commands.

Keep browser presentation separate from domain behavior and external I/O. Start with one useful route.

## Run and test

Run the actual development command and exercise that route. Test its meaningful domain behavior and a user interaction where relevant; build when required by the selected framework.

Record concrete commands after inspecting generated output. This recipe is guidance, not an observed platform acceptance result. Missing tooling or an unrun target remains unverified. Canonical architecture and test homes can be README sections.

Sources to check when selecting tooling: https://vite.dev/guide/ · https://nextjs.org/docs/app/api-reference/cli/create-next-app · https://svelte.dev/docs/kit
