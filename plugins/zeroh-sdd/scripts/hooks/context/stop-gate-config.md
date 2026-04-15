# Stop Quality Gate Configuration

Edit the `severity` column to control what blocks stopping vs what warns.
- `warn` — advisory message, does not prevent stopping
- `block` — prevents session end until resolved

| check | severity | description |
|-------|----------|-------------|
| missing-meta | block | Shape files (.shape.ts) without .meta() semantic metadata |
| unwired-shapes | block | Files importing shapes but not calling safeParse/parse |
| missing-covers | warn | Test files without @covers or @spec traceability annotation |
| uncommitted-files | block | Tracked files not committed (handled by stop-check.sh) |
| missing-shape-briefs | warn | Plan complete but no shape briefs produced — run /speckit-shapes |
