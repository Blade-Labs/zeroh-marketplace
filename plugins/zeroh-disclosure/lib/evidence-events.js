import path from 'node:path';
import { canonicalJson, hmacSha256B64u, sha256B64u } from './crypto.js';
import { applyDisclosurePolicy, ledgerFromDisclosureResult, markDisclosureResultCommitted } from './disclosure.js';
import { evaluateConstraints } from './vi/constraints.js';
import { bumpEvent, hmacKeyBytes, listEvents, listTurns, readJson, writeEvent, writeJson } from './session.js';
import { receiptRecordToArtifact, verifyReceiptArtifactObject } from './verify-receipt.js';
import { verifyChain } from './vi/verify.js';

const FIELD_PATHS = {
  amount: ['amount', 'payment.amount', 'payment_amount.amount'],
  currency: ['currency', 'payment.currency', 'payment_amount.currency'],
  merchant: ['merchant', 'checkout.merchant'],
  payee: ['payee', 'payment.payee'],
  line_items: ['line_items', 'checkout.line_items'],
  reference: ['reference', 'payment.reference'],
};

export function toolTier(toolName) {
  if (String(toolName).startsWith('mcp__')) return /payment|checkout|commerce/i.test(toolName) ? 'commerce' : 'mcp';
  if (toolName === 'WebFetch') return 'network';
  if (toolName === 'Bash') return 'shell';
  if (toolName === 'Write' || toolName === 'Edit') return 'filesystem';
  if (toolName === 'Agent') return 'subagent';
  return 'standard';
}

export function agentEvidenceEnabled(policy) {
  return policy?.policy_id === 'agent-controlled-disclosure-v1' || boolEnv(process.env.ZEROH_REQUIRE_INTENT);
}

export function intentBindingFromSession(session) {
  return session.state.vi ? {
    l1_hash: session.state.vi.l1_hash,
    l2_hash: session.state.vi.l2_hash,
    l2_nonce: session.state.vi.l2_nonce,
    mandate_aud: session.state.vi.mandate_aud,
    agent_jwk_kid: session.state.vi.agent_jwk_kid,
    scope_summary: session.state.vi.scope_summary,
    expiry: session.state.vi.expiry,
  } : null;
}

export async function applyToolEvidence({
  session,
  cwd = process.cwd(),
  policyAlias = null,
  toolName,
  toolUseId,
  toolInput,
  action,
  reason,
  tier = toolTier(toolName),
  allowedToolInput = null,
  commerce = null,
  findings = [],
  replacements = [],
}) {
  const sequence = await bumpEvent(session);
  const inputCanonical = canonicalJson(toolInput ?? {});
  const allowedCanonical = allowedToolInput == null ? '' : canonicalJson(allowedToolInput);
  const toolInputHash = await sha256B64u(inputCanonical);
  const allowedToolInputHash = allowedToolInput == null ? null : await sha256B64u(allowedCanonical);
  const fulfillment = commerce?.fulfillment ?? null;
  const constraintResult = commerce?.constraint_result ?? null;
  const fulfillmentHash = fulfillment ? await sha256B64u(canonicalJson(fulfillment)) : null;
  const constraintHash = constraintResult ? await sha256B64u(canonicalJson(constraintResult)) : null;
  const inputCommitment = await hmacSha256B64u(hmacKeyBytes(session.state), {
    purpose: 'tool_input',
    tool_use_id: toolUseId,
    tool_name: toolName,
    input: toolInput ?? {},
  });
  const decisionAction = `tool_${action}`;
  const result = await applyDisclosurePolicy({
    text: inputCanonical,
    session,
    cwd,
    policyAlias,
    boundary: {
      boundary_type: 'agent_tool_boundary',
      source_runtime: 'claude_code_pre_tool_use_hook',
      destination: `tool:${toolName}`,
      model: process.env.ZEROH_MODEL || 'claude-code',
      retention: process.env.ZEROH_RETENTION || 'unknown',
      destination_jurisdiction: process.env.ZEROH_DESTINATION_JURISDICTION || 'US',
      intent_binding: intentBindingFromSession(session),
      tool_boundary: { tool_use_id: toolUseId, tool_name: toolName, tool_tier: tier },
    },
    proofStage: 'pre_tool_boundary',
    subjectType: 'tool_action',
    findingsOverride: findings,
    sanitizedTextOverride: allowedCanonical,
    decisionOverride: {
      action: decisionAction,
      matched_rules: [],
      reason,
      mask_categories: [],
      approval_required: false,
      blocked: action === 'deny',
    },
    publicClaimExtras: {
      tool_use_id: toolUseId,
      tool_name: toolName,
      tool_tier: tier,
      tool_input_hash: toolInputHash,
      tool_input_commitment: inputCommitment,
      allowed_tool_input_hash: allowedToolInputHash,
      intent_fulfillment_hash: fulfillmentHash,
      constraint_result_hash: constraintHash,
      raw_tool_input_sent_to_external_service: action !== 'deny' && isExternalTool(toolName),
    },
    selectiveClaimExtras: {
      tool_action_details: {
        action,
        reason,
        fulfillment_source: commerce?.fulfillment_source ?? null,
        violations: commerce?.violations ?? constraintResult?.violations ?? [],
      },
      intent_fulfillment: fulfillment,
      constraint_result: constraintResult,
    },
  });
  const event = {
    schema: 'zeroh-evidence-event/v1',
    kind: 'tool_action',
    sequence,
    stage: 'pre_tool_boundary',
    created_at: new Date().toISOString(),
    tool_use_id: toolUseId,
    tool_name: toolName,
    tool_tier: tier,
    decision_action: decisionAction,
    action,
    reason,
    policy_id: result.receipt.public_claims.policy_id,
    tool_input_hash: toolInputHash,
    tool_input_commitment: inputCommitment,
    allowed_tool_input_hash: allowedToolInputHash,
    intent_binding: intentBindingFromSession(session),
    fulfillment_source: commerce?.fulfillment_source ?? null,
    intent_fulfillment: fulfillment,
    constraint_result: constraintResult,
    violations: commerce?.violations ?? constraintResult?.violations ?? [],
    sanitized_text: allowedCanonical,
    receipt: ledgerFromDisclosureResult({ turn: null, phase: 'finalized', result, originalText: null }).receipt,
    token: result.token,
    anchor: result.anchor,
    local_private: { tool_input: toolInput ?? {}, allowed_tool_input: allowedToolInput },
  };
  const eventPath = await writeEvent({ dir: session.dir, sequence, payload: event });
  await markDisclosureResultCommitted({ session, result });
  return { event, event_path: eventPath, result };
}

export async function extractCommerceFulfillment(toolInput) {
  const deterministic = {};
  const sourcePaths = [];
  for (const [key, paths] of Object.entries(FIELD_PATHS)) {
    for (const p of paths) {
      const v = getPath(toolInput, p);
      if (v !== undefined) {
        deterministic[key] = v;
        sourcePaths.push(p);
        break;
      }
    }
  }
  const selfReported = toolInput?._intent_fulfillment && typeof toolInput._intent_fulfillment === 'object'
    ? normalizeFulfillment(toolInput._intent_fulfillment)
    : null;
  const hasDeterministic = Object.keys(deterministic).length > 0;
  const fulfillment = hasDeterministic ? normalizeFulfillment(deterministic) : selfReported;
  return {
    fulfillment,
    deterministic: hasDeterministic ? normalizeFulfillment(deterministic) : null,
    self_reported: selfReported,
    fulfillment_source: hasDeterministic ? 'deterministic' : selfReported ? 'self_reported' : 'missing',
    source_paths: sourcePaths,
  };
}

export async function evaluateCommerceIntent({ toolName, toolInput, viState, strict = false }) {
  const extraction = await extractCommerceFulfillment(toolInput);
  if (!viState) return denyCommerce(toolName, 'no_mandate', 'no active Verifiable Intent mandate is loaded', extraction);
  if (!extraction.fulfillment) return denyCommerce(toolName, 'missing_fulfillment', 'deterministic commerce fulfillment fields are missing', extraction);
  if (strict && extraction.fulfillment_source !== 'deterministic') {
    return denyCommerce(toolName, 'self_reported_only', 'strict agent mode requires fulfillment extracted from the actual tool input', extraction);
  }
  if (strict && extraction.self_reported && canonicalJson(extraction.self_reported) !== canonicalJson(extraction.deterministic)) {
    return denyCommerce(toolName, 'fulfillment_mismatch', '_intent_fulfillment does not match deterministic tool input fields', extraction);
  }
  const constraints = [...(viState.constraints?.checkout || []), ...(viState.constraints?.payment || [])];
  const constraintResult = evaluateConstraints(constraints, extraction.fulfillment);
  if (constraintResult.satisfied) {
    return { action: 'allow', ...extraction, constraint_result: constraintResult };
  }
  return {
    action: 'deny',
    reason: 'scope_violation',
    message: `🛡  ZeroH Disclosure: ${toolName} violates the active VI mandate (aud=${viState.mandate_aud}). The call exceeded the user-authorized scope on the following constraints:\n${constraintResult.violations.map((v) => `  • ${v.type}: ${v.reason}`).join('\n')}`,
    ...extraction,
    constraint_result: constraintResult,
    violations: constraintResult.violations,
  };
}

export async function buildAgentPacket({ session }) {
  const records = await readPacketRecords(session);
  if (records.length === 0) throw new Error('no evidence events found for session');
  const packet = {
    schema: 'zeroh-agent-accountability-packet/v1',
    session_id: session.state.sid || path.basename(session.dir),
    generated_at: new Date().toISOString(),
    policy_id: mostRecent(records, 'policy_id'),
    vi_summary: summarizeVi(session.state.vi),
    vi_evidence: session.state.vi?.evidence ?? null,
    receipt_count: records.length,
    action_count: records.filter((r) => r.kind === 'tool_action').length,
    decision_counts: countBy(records.filter((r) => r.kind === 'tool_action'), (r) => r.decision_action),
    events: records,
  };
  packet.packet_hash = await packetHash(packet);
  const packetPath = path.join(session.dir, 'agent-accountability-packet.json');
  await writeJson(packetPath, packet);
  return { path: packetPath, packet, packet_hash: packet.packet_hash };
}

export async function verifyAgentPacket(packet) {
  const checks = [];
  checks.push(check('schema', packet.schema === 'zeroh-agent-accountability-packet/v1', `got ${packet.schema}`));
  const expectedHash = await packetHash(packet);
  checks.push(check('packet_hash', packet.packet_hash === expectedHash, `expected ${expectedHash}, got ${packet.packet_hash}`));
  const events = Array.isArray(packet.events) ? packet.events : [];
  checks.push(check('events_present', events.length > 0, 'packet has no events'));
  checks.push(check('receipt_count', packet.receipt_count === events.length, `expected ${events.length}, got ${packet.receipt_count}`));
  const receiptResults = [];
  for (let i = 0; i < events.length; i++) {
    const r = await verifyReceiptArtifactObject(receiptRecordToArtifact(events[i], `packet#${i + 1}`), { verifySessionChain: false });
    receiptResults.push(r);
    checks.push(check(`receipt_${i + 1}`, r.ok, firstFailed(r)));
  }
  checks.push(...verifyEventChain(events));
  checks.push(...await verifyPacketIntent(packet, events));
  checks.push(...await verifyActionEvidence(events));
  const ok = checks.every((c) => c.ok);
  return { ok, packet_hash: expectedHash, policy_id: packet.policy_id, receipt_count: events.length, action_count: packet.action_count, anchor: anchorSummary(receiptResults), checks };
}

async function readPacketRecords(session) {
  const records = [];
  for (const turn of await listTurns({ dir: session.dir })) {
    const ledger = await readJson(path.join(session.dir, `turn-${turn}.json`));
    if (ledger?.receipt) records.push(promptRecord(ledger));
  }
  for (const n of await listEvents({ dir: session.dir })) {
    const event = await readJson(path.join(session.dir, `event-${n}.json`));
    if (event?.receipt) records.push(packetEvent(event));
  }
  return records.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

function promptRecord(ledger) {
  return {
    kind: 'prompt',
    stage: ledger.proof_stage,
    created_at: ledger.created_at,
    policy_id: ledger.policy_id,
    decision_action: ledger.receipt.public_claims.decision_action,
    sanitized_text: ledger.sanitized_text,
    receipt: ledger.receipt,
    token: ledger.token,
    anchor: ledger.anchor,
  };
}

function packetEvent(event) {
  const { local_private, sanitized_text, ...publicEvent } = event;
  void local_private;
  void sanitized_text;
  const copy = structuredClone(publicEvent);
  if (copy.kind === 'tool_action' && copy.receipt?.presentations) delete copy.receipt.presentations.user;
  return copy;
}

async function verifyPacketIntent(packet, events) {
  const checks = [];
  const allowedCommerce = events.some((e) => e.kind === 'tool_action' && e.tool_tier === 'commerce' && e.decision_action === 'tool_allow');
  if (!allowedCommerce && !packet.vi_summary) return checks;
  checks.push(check('vi_summary', !!packet.vi_summary, 'missing vi_summary'));
  checks.push(check('vi_evidence', !!packet.vi_evidence, 'missing vi_evidence'));
  if (!packet.vi_summary || !packet.vi_evidence) return checks;
  const vi = await verifyChain({
    l1Compact: packet.vi_evidence.l1_compact,
    l2Compact: packet.vi_evidence.l2_compact,
    trustedIssuerJwks: packet.vi_evidence.trusted_issuer_jwks,
  });
  checks.push(check('vi_chain', vi.ok, vi.errors?.join('; ')));
  if (vi.ok) {
    checks.push(check('vi_l1_hash', vi.l1Hash === packet.vi_summary.l1_hash, 'l1 hash mismatch'));
    checks.push(check('vi_l2_hash', vi.l2Hash === packet.vi_summary.l2_hash, 'l2 hash mismatch'));
  }
  for (const [i, e] of events.entries()) {
    if (e.kind !== 'tool_action' || !e.intent_binding) continue;
    checks.push(check(`event_${i + 1}_intent_l1`, e.intent_binding.l1_hash === packet.vi_summary.l1_hash, 'l1 mismatch'));
    checks.push(check(`event_${i + 1}_intent_l2`, e.intent_binding.l2_hash === packet.vi_summary.l2_hash, 'l2 mismatch'));
  }
  return checks;
}

async function verifyActionEvidence(events) {
  const checks = [];
  for (const [i, e] of events.entries()) {
    if (e.kind !== 'tool_action') continue;
    const claims = e.receipt?.public_claims || {};
    checks.push(check(`event_${i + 1}_decision`, e.decision_action === claims.decision_action, 'decision mismatch'));
    checks.push(check(`event_${i + 1}_tool_hash`, e.tool_input_hash === claims.tool_input_hash, 'tool hash mismatch'));
    if (e.intent_fulfillment) {
      const expected = await sha256B64u(canonicalJson(e.intent_fulfillment));
      checks.push(check(`event_${i + 1}_fulfillment_hash`, expected === claims.intent_fulfillment_hash, 'fulfillment hash mismatch'));
    }
    if (e.constraint_result) {
      const expected = await sha256B64u(canonicalJson(e.constraint_result));
      checks.push(check(`event_${i + 1}_constraint_hash`, expected === claims.constraint_result_hash, 'constraint hash mismatch'));
    }
    if (e.tool_tier === 'commerce' && e.decision_action === 'tool_allow') {
      checks.push(check(`event_${i + 1}_deterministic_fulfillment`, e.fulfillment_source === 'deterministic', 'allowed commerce action was not deterministic'));
      checks.push(check(`event_${i + 1}_constraints_satisfied`, e.constraint_result?.satisfied === true, 'constraints not satisfied'));
    }
    if (e.tool_tier === 'commerce' && e.decision_action === 'tool_deny') {
      checks.push(check(`event_${i + 1}_deny_reason`, !!e.reason || (e.violations || []).length > 0, 'denied action missing reason'));
    }
  }
  return checks;
}

function verifyEventChain(events) {
  const checks = [];
  if (events.length > 0) {
    const root = events[0].receipt?.public_claims || {};
    checks.push(check('chain_root_receipt', root.previous_receipt_hash == null, `got ${root.previous_receipt_hash}`));
    checks.push(check('chain_root_token', root.previous_token_hash == null, `got ${root.previous_token_hash}`));
  }
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const cur = events[i];
    const claims = cur.receipt?.public_claims || {};
    checks.push(check(`chain_${i}_receipt`, claims.previous_receipt_hash === prev.receipt?.receipt_hash, 'previous receipt mismatch'));
    checks.push(check(`chain_${i}_token`, claims.previous_token_hash === prev.token?.token_hash, 'previous token mismatch'));
  }
  return checks;
}

function denyCommerce(toolName, reason, detail, extraction) {
  return {
    action: 'deny',
    reason,
    message: `🛡  ZeroH Disclosure: ${toolName} cannot proceed: ${detail}.`,
    ...extraction,
  };
}

function normalizeFulfillment(input = {}) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) if (v !== undefined && k !== '_intent_fulfillment') out[k] = v;
  return out;
}

function getPath(obj, pathSpec) {
  let cur = obj;
  for (const part of pathSpec.split('.')) {
    if (!cur || typeof cur !== 'object' || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

async function packetHash(packet) {
  const unsigned = { ...packet };
  delete unsigned.packet_hash;
  return sha256B64u(canonicalJson(unsigned));
}

function summarizeVi(vi) {
  return vi ? {
    l1_hash: vi.l1_hash,
    l2_hash: vi.l2_hash,
    l2_nonce: vi.l2_nonce,
    mandate_aud: vi.mandate_aud,
    agent_jwk_kid: vi.agent_jwk_kid,
    mode: vi.mode,
    expiry: vi.expiry,
    scope_summary: vi.scope_summary,
  } : null;
}

function anchorSummary(results) {
  const anchored = results.filter((r) => r.anchor.status === 'anchored');
  if (anchored.length === 0) return { status: 'unanchored', verified: false, type: 'none' };
  return { status: anchored.every((r) => r.anchor.verified) ? 'anchored' : 'missing', verified: anchored.every((r) => r.anchor.verified), type: [...new Set(anchored.map((r) => r.anchor.type))].join('+') };
}

function countBy(items, fn) {
  const out = {};
  for (const item of items) {
    const key = fn(item) || 'unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function mostRecent(records, field) {
  for (let i = records.length - 1; i >= 0; i--) if (records[i][field]) return records[i][field];
  return null;
}

function isExternalTool(toolName) {
  return toolName === 'WebFetch' || toolName === 'Agent' || String(toolName).startsWith('mcp__');
}

function boolEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

function check(name, ok, detail = null) {
  return { name, ok: !!ok, detail: ok ? null : detail };
}

function firstFailed(result) {
  const failed = result.checks.find((c) => !c.ok);
  return failed ? `${failed.name}: ${failed.detail || 'failed'}` : null;
}
