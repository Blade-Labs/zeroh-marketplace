import { DurableProcessAgentDriver } from './durable-process-agent-driver.mjs'
import { MODEL_DRIVERS } from './drivers.mjs'

export class ClaudeAgentDriver extends DurableProcessAgentDriver {
  constructor(options) {
    super({
      ...options,
      driverId: 'claude',
      acceptsModel: (model) => MODEL_DRIVERS[model] === 'claude',
      launchOptions: (request) => ({ worktree: request.worktree, authority: request.authority, model: request.model, streamJson: true }),
      parseOptions: (request, expectedSessionId) => ({ expectedModel: request.model, ...(expectedSessionId === null ? {} : { expectedSessionId }) }),
    })
  }
}
