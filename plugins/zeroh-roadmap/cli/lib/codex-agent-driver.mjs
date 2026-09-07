import { DurableProcessAgentDriver } from './durable-process-agent-driver.mjs'
import { resolveDriver } from './drivers.mjs'

export class CodexAgentDriver extends DurableProcessAgentDriver {
  constructor(options) {
    super({
      ...options,
      driverId: 'codex',
      acceptsModel: (model) => model === resolveDriver('codex').model,
      launchOptions: (request, context = {}) => ({ worktree: request.worktree, authority: request.authority, json: true, ...(context.outputSchemaPath ? { outputSchemaPath: context.outputSchemaPath } : {}) }),
      parseOptions: (_request, expectedSessionId) => expectedSessionId === null ? {} : { expectedSessionId },
    })
  }
}
