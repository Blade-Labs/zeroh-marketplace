import { DurableProcessAgentDriver } from './durable-process-agent-driver.mjs'
import { resolveDriver } from './drivers.mjs'

export class CodexAgentDriver extends DurableProcessAgentDriver {
  constructor(options) {
    super({
      ...options,
      driverId: 'codex',
      acceptsModel: (model) => model === resolveDriver('codex').model,
      launchOptions: (request) => ({ worktree: request.worktree, authority: request.authority, json: true }),
      parseOptions: (_request, expectedSessionId) => expectedSessionId === null ? {} : { expectedSessionId },
    })
  }
}
