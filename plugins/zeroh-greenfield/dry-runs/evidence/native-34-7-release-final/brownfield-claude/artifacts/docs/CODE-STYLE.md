# Code style

## Lint

`none`: `eslint.config.mjs` exports an empty flat config (`export default []`) and ESLint is not locked in `package-lock.json`. Bind a lint command when the tool is installed; do not invent a standard.

## Format

`none`: no formatter configuration (Prettier, Biome or EditorConfig) exists. Existing sources are ESM `.mjs` files with single quotes and no semicolons; keep new files consistent with neighbouring code.
