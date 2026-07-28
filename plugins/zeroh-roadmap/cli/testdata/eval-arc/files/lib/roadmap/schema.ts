/**
 * The fixture consumer's schema home — a re-export of the CANONICAL contract by absolute
 * path (the tsx-bridge.test.mjs `makeConsumer` pattern). A re-export rather than a byte
 * copy on purpose: a copied schema.ts could not resolve its own `zod` import from a
 * mkdtemp repo, and a vendored copy would silently rot away from the contract the
 * collector is validated against.
 *
 * The default target is the PLUGIN's own templates/schema.ts, not any particular
 * consumer checkout: the fixture must build on a machine where no consumer repo exists,
 * and templates/schema.ts is the source every consumer's lib/roadmap/schema.ts is synced
 * from (that sync is proven separately). build-fixture.mjs rewrites this line when
 * `schemaPath` is overridden, so the path below is a DEFAULT, not a hard dependency.
 */
export * from '__SCHEMA_PATH__'
