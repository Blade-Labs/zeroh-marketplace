import { canonicalJson, sha256B64u } from './crypto.js';

export function normalizeBoundary(input = {}) {
  const b = {
    boundary_type: input.boundary_type ?? 'external_ai_processor',
    source_runtime: input.source_runtime ?? 'claude_code_user_prompt_submit_hook',
    destination: input.destination ?? 'anthropic_claude_api',
    destination_jurisdiction: input.destination_jurisdiction ?? input.jurisdiction ?? 'US',
    provider: input.provider ?? 'anthropic',
    model: input.model ?? 'claude-code',
    retention: input.retention ?? 'unknown',
    purpose: input.purpose ?? 'developer_assistance',
    route_policy: input.route_policy ?? null,
  };
  if (b.route_policy?.router === 'openrouter') b.boundary_type = 'external_ai_router';
  // VI mandate binding (Phase E.4). Added only when present so the canonical
  // JSON — and therefore boundary_hash — stays byte-identical for receipts
  // emitted with no active mandate.
  if (input.intent_binding) b.intent_binding = input.intent_binding;
  return b;
}

export async function boundaryHash(boundary) {
  return sha256B64u(canonicalJson(boundary));
}
