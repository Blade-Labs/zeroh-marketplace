// SPDX-License-Identifier: AGPL-3.0-only

// The processing boundary a receipt describes (who receives the content, over
// which runtime), normalised and hashed into the receipt.
import { canonicalJson, sha256B64u } from './crypto.js';

// Where the receipted content goes. Recorded in every receipt as a hash; the
// details stay in the local receipt's selective disclosures.
export function normalizeBoundary(input = {}) {
  return {
    boundary_type: input.boundary_type ?? 'external_ai_processor',
    source_runtime:
      input.source_runtime ?? 'claude_code_user_prompt_submit_hook',
    destination: input.destination ?? 'anthropic_claude_api',
    provider: input.provider ?? 'anthropic',
    model: input.model ?? 'claude-code',
    purpose: input.purpose ?? 'developer_assistance',
  };
}

export async function boundaryHash(boundary) {
  return sha256B64u(canonicalJson(boundary));
}
