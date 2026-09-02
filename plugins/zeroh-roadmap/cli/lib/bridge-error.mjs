/**
 * bridge-error — the typed bridge failure, in a module with NO plugin dependencies.
 *
 * It lives here, apart from tsx-bridge.mjs, for exactly one reason: roadmap-root.mjs
 * resolves the consumer schema seam and must throw this error, while tsx-bridge.mjs
 * consumes roadmap-root.mjs to find the root — declaring the class in either of those
 * two would make them import each other. tsx-bridge.mjs re-exports it unchanged, so
 * every existing `import { BridgeError } from './tsx-bridge.mjs'` still resolves and
 * every `e instanceof BridgeError` check keeps its one class identity.
 */

/** A typed bridge failure. kind ∈ 'tsx-absent' | 'schema-missing' | 'zod' | 'load' | 'eval-error'. */
export class BridgeError extends Error {
  constructor(kind, messageLines, extra = {}) {
    super(messageLines.join('\n'))
    this.name = 'BridgeError'
    this.kind = kind
    this.messageLines = messageLines
    Object.assign(this, extra)
  }
}
