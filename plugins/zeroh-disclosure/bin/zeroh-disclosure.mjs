#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';
import { applyDisclosurePolicy, buildSessionProofPack, ledgerFromDisclosureResult, markDisclosureResultCommitted, protectionEngineStatus } from '../lib/disclosure.js';
import { bumpTurn, loadSession, writeJson, writeTurn } from '../lib/session.js';
import { resolveActivePolicy, resolvePolicy, listPolicies } from '../lib/policy-registry.js';
import { loadReceiptArtifact, verifyProofPackArtifact, verifyReceiptArtifact } from '../lib/verify-receipt.js';
import { anchorEnvSummary } from '../lib/hedera-anchor.js';
import { evmAnchorEnvSummary } from '../lib/evm-anchor.js';
import { verifyAnchorEvidence } from '../lib/anchor-verify.js';
import { sha256B64u } from '../lib/crypto.js';
import { applyToolEvidence, buildAgentPacket, evaluateCommerceIntent, verifyAgentPacket } from '../lib/evidence-events.js';
import { ingestMandate } from '../lib/vi/ingest.js';

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const cwd = path.resolve(args.cwd || process.cwd());
const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await loadConfig({ cwd });

try {
  if (command === 'apply') await cmdApply(args, cwd);
  else if (command === 'verify') await cmdVerify(args);
  else if (command === 'proofpack') await cmdProofPack(args, cwd);
  else if (command === 'agent-packet') await cmdAgentPacket(args, cwd);
  else if (command === 'poll-anchor') await cmdPollAnchor(args);
  else if (command === 'doctor') await cmdDoctor(args, cwd);
  else if (command === 'demo') await cmdDemo(args, cwd);
  else help(command ? 1 : 0);
} catch (e) {
  console.error(`zeroh-disclosure: ${e.message}`);
  if (process.env.DEBUG && e.stack) console.error(e.stack);
  process.exit(1);
}

async function cmdApply(args, cwd) {
  const text = args.text ?? await readStdin();
  if (!text) throw new Error('apply requires --text or stdin');
  const sessionId = args.session || 'cli-default';
  const session = await loadSession({ cwd, sessionId });
  const turn = await bumpTurn(session);
  const result = await applyDisclosurePolicy({
    text,
    session,
    cwd,
    policyAlias: args.policy || null,
    engineId: args.engine || null,
    boundary: {
      source_runtime: 'zeroh_cli',
      destination: args.destination || process.env.ZEROH_DESTINATION || 'anthropic_claude_api',
      model: args.model || process.env.ZEROH_MODEL || 'cli',
      retention: process.env.ZEROH_RETENTION || 'unknown',
      destination_jurisdiction: process.env.ZEROH_DESTINATION_JURISDICTION || 'US',
    },
  });
  const ledger = {
    ...ledgerFromDisclosureResult({
      turn,
      phase: 'finalized',
      result,
      originalText: null,
    }),
    finalized_at: new Date().toISOString(),
  };
  const ledgerPath = await writeTurn({ dir: session.dir, turn, payload: ledger });
  await markDisclosureResultCommitted({ session, result });

  const out = {
    session_id: sessionId,
    turn,
    ledger_path: ledgerPath,
    policy_id: result.receipt.public_claims.policy_id,
    protection_engine_id: result.receipt.public_claims.protection_engine_id,
    decision_action: result.receipt.public_claims.decision_action,
    model_safe_text: result.sanitized_text,
    receipt_hash: result.receipt.receipt_hash,
    anchor: result.anchor,
  };
  print(out, args.json, [
    `policy_id: ${out.policy_id}`,
    `engine: ${out.protection_engine_id}`,
    `decision: ${out.decision_action}`,
    `receipt_hash: ${out.receipt_hash}`,
    `ledger_path: ${out.ledger_path}`,
    '',
    'model_safe_text:',
    out.model_safe_text,
  ]);
}

async function cmdVerify(args) {
  if (args['agent-packet']) {
    const packet = JSON.parse(await fs.readFile(args['agent-packet'], 'utf8'));
    const result = await verifyAgentPacket(packet);
    print(result, args.json, [
      `ok: ${result.ok}`,
      `agent_accountability: ${result.ok ? 'verified' : 'failed'}`,
      `policy: ${result.policy_id}`,
      `receipt_count: ${result.receipt_count}`,
      `action_count: ${result.action_count}`,
      `packet_hash: ${result.packet_hash}`,
      `anchor_status: ${result.anchor.status}`,
      '',
      ...result.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`),
    ]);
    if (!result.ok) process.exit(1);
    return;
  }
  if (args.proofpack) {
    const result = await verifyProofPackArtifact(args.proofpack);
    print(result, args.json, [
      `ok: ${result.ok}`,
      `proofpack_hash: ${result.proofpack_hash}`,
      `receipts_count: ${result.receipts_count}`,
      '',
      ...result.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`),
    ]);
    if (!result.ok) process.exit(1);
    return;
  }
  const file = args.receipt || args.file || args._[1];
  if (!file) throw new Error('verify requires --receipt <path>');
  const result = await verifyReceiptArtifact(file);
  print(result, args.json, [
    `ok: ${result.ok}`,
    `receipt_id: ${result.receipt_id}`,
    `policy_id: ${result.policy_id}`,
    `engine: ${result.protection_engine_id}`,
    `decision: ${result.decision_action}`,
    `anchor: ${result.anchor.status}${result.anchor.verified ? ' verified' : ''}`,
    '',
    ...result.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`),
  ]);
  if (!result.ok) process.exit(1);
}

async function cmdProofPack(args, cwd) {
  const session = await loadSession({ cwd, sessionId: args.session || 'cli-default' });
  const result = await buildSessionProofPack({ session });
  if (!result) throw new Error('no receipts found for session');
  print(result, args.json, [
    `proofpack_path: ${result.path}`,
    `receipts_count: ${result.receipts_count}`,
    `proofpack_hash: ${result.proofpack.proofpack_hash}`,
  ]);
}

async function cmdAgentPacket(args, cwd) {
  const session = await loadSession({ cwd, sessionId: args.session || 'cli-default' });
  const result = await buildAgentPacket({ session });
  print(result, args.json, [
    `agent_packet_path: ${result.path}`,
    `packet_hash: ${result.packet_hash}`,
    `receipt_count: ${result.packet.receipt_count}`,
    `action_count: ${result.packet.action_count}`,
  ]);
}

async function cmdPollAnchor(args) {
  const file = args.receipt || args.file || args._[1];
  if (!file) throw new Error('poll-anchor requires --receipt <path>');
  const artifact = await loadReceiptArtifact(file);
  const result = await verifyAnchorEvidence(artifact.anchor, {
    receiptHash: await sha256B64u(artifact.compact),
    tokenHash: artifact.token?.token_hash ?? null,
  });
  print(result, args.json, [
    `status: ${result.status}`,
    `type: ${result.type}`,
    `verified: ${result.verified}`,
    result.detail ? `detail: ${result.detail}` : null,
  ].filter(Boolean));
  if (!result.ok) process.exit(1);
}

async function cmdDoctor(args, cwd) {
  const { policy } = await resolveActivePolicy({ cwd, explicit: args.policy || null });
  const engines = await protectionEngineStatus({ policy });
  const out = {
    cwd,
    active_policy: (await resolveActivePolicy({ cwd, explicit: args.policy || null })).policy.policy_id,
    policies: listPolicies(),
    engines,
    hedera_hcs: anchorEnvSummary(),
    hedera_evm: evmAnchorEnvSummary(),
  };
  print(out, args.json, [
    `cwd: ${cwd}`,
    `active_policy: ${out.active_policy}`,
    '',
    'policies:',
    ...out.policies.map((p) => `  ${p.policy_id} (${(p.aliases || []).join(', ') || '-'})`),
    '',
    'protection engines:',
    ...engines.map((e) => `  ${e.id}: ${e.ok ? 'ok' : `unavailable (${e.error})`}`),
    '',
    `hcs_anchor_enabled: ${out.hedera_hcs.enabled}`,
    `evm_anchor_enabled: ${out.hedera_evm.enabled}`,
  ]);
}

async function cmdDemo(args, cwd) {
  const name = args._[1];
  if (name === 'agent-accountability') return cmdDemoAgentAccountability(args, cwd);
  if (name !== 'blade-proof') throw new Error('demo requires "blade-proof"');
  const engineId = args.engine || 'presidio-http';
  const sessionId = args.session || `blade-proof-demo-${Date.now().toString(36)}`;
  const { policy } = resolvePolicy('blade');
  const doctor = {
    engines: await protectionEngineStatus({ policy }),
    hedera_hcs: anchorEnvSummary(),
    hedera_evm: evmAnchorEnvSummary(),
  };
  const requestedEngine = doctor.engines.find((e) => e.id === engineId);
  if (engineId === 'presidio-http' && !requestedEngine?.ok && !args['allow-fallback']) {
    throw new Error(`Presidio is unavailable for the Blade demo: ${requestedEngine?.error || 'health check failed'}. Start docker compose or pass --allow-fallback.`);
  }

  const session = await loadSession({ cwd, sessionId });
  const turn = await bumpTurn(session);
  const text = args.text || 'Contact alice@example.com about card 4532 0151 1283 0366 before sending it to the AI provider.';
  const result = await applyDisclosurePolicy({
    text,
    session,
    cwd,
    policyAlias: 'blade',
    engineId,
    policyMode: args['allow-fallback'] ? 'fallback_with_receipt' : 'fail_closed',
    boundary: {
      source_runtime: 'zeroh_cli_demo',
      destination: args.destination || process.env.ZEROH_DESTINATION || 'anthropic_claude_api',
      model: args.model || 'blade-proof-demo',
      retention: process.env.ZEROH_RETENTION || 'unknown',
      destination_jurisdiction: process.env.ZEROH_DESTINATION_JURISDICTION || 'US',
    },
  });
  const ledger = {
    ...ledgerFromDisclosureResult({ turn, phase: 'finalized', result, originalText: null }),
    finalized_at: new Date().toISOString(),
  };
  const ledgerPath = await writeTurn({ dir: session.dir, turn, payload: ledger });
  await markDisclosureResultCommitted({ session, result });

  const receiptVerification = await verifyReceiptArtifact(ledgerPath);
  const proofpack = await buildSessionProofPack({ session });
  const proofpackVerification = await verifyProofPackArtifact(proofpack.path);
  const out = {
    demo: 'blade-proof',
    session_id: sessionId,
    ledger_path: ledgerPath,
    proofpack_path: proofpack.path,
    policy_applied: result.receipt.public_claims.policy_id,
    engine_requested: engineId,
    engine_used: result.receipt.public_claims.protection_engine_id,
    engine_resolution: result.receipt.public_claims.protection_engine_resolution,
    raw_content_sent_to_ai_provider: result.receipt.public_claims.raw_content_sent_to_ai_provider,
    sanitized_text: result.sanitized_text,
    receipt_hash: result.receipt.receipt_hash,
    proofpack_hash: proofpack.proofpack.proofpack_hash,
    anchor: receiptVerification.anchor,
    receipt_verification_ok: receiptVerification.ok,
    proofpack_verification_ok: proofpackVerification.ok,
  };
  print(out, args.json, [
    `demo: ${out.demo}`,
    `policy_applied: ${out.policy_applied}`,
    `engine_used: ${out.engine_used}`,
    `engine_resolution: ${out.engine_resolution.status}${out.engine_resolution.fallback ? ` (${out.engine_resolution.reason})` : ''}`,
    `raw_content_sent_to_ai_provider: ${out.raw_content_sent_to_ai_provider}`,
    `receipt_hash: ${out.receipt_hash}`,
    `proofpack_hash: ${out.proofpack_hash}`,
    `anchor: ${out.anchor.status}${out.anchor.verified ? ' verified' : ''}`,
    `receipt_verification: ${out.receipt_verification_ok}`,
    `proofpack_verification: ${out.proofpack_verification_ok}`,
    `ledger_path: ${out.ledger_path}`,
    `proofpack_path: ${out.proofpack_path}`,
    '',
    'sanitized_text:',
    out.sanitized_text,
  ]);
  if (!receiptVerification.ok || !proofpackVerification.ok) process.exit(1);
}

async function cmdDemoAgentAccountability(args, cwd) {
  const sessionId = args.session || `agent-accountability-demo-${Date.now().toString(36)}`;
  const session = await loadSession({ cwd, sessionId });
  const mandateFile = args.mandate || process.env.ZEROH_VI_MANDATE_FILE || path.join(PLUGIN_ROOT, 'test/fixtures/vi/mandate.json');
  const mandate = await ingestMandate({ cwd, mandateFile });
  if (!mandate.present) throw new Error(`No VI mandate found at ${mandateFile}`);
  if (!mandate.ok) throw new Error(`VI mandate invalid: ${mandate.errors.join('; ')}`);
  session.state.vi = mandate.vi;
  session.state.active_policy_id = 'agent-controlled-disclosure-v1';
  session.state.active_policy_alias = 'agent';
  session.state.updated_at = new Date().toISOString();
  await writeJson(session.statePath, session.state);

  const allowedInput = {
    amount: 800,
    currency: 'USD',
    merchant: { id: 'merchant-001' },
    payee: { id: 'payee-001' },
    line_items: [{ id: 'sku-coffee', quantity: 1 }],
    reference: 'binding-001',
  };
  const allowed = await evaluateCommerceIntent({
    toolName: 'mcp__example_payment__charge',
    toolInput: allowedInput,
    viState: session.state.vi,
    strict: true,
  });
  if (allowed.action !== 'allow') throw new Error(`expected allowed demo action, got ${allowed.reason}`);
  await applyToolEvidence({
    session,
    cwd,
    policyAlias: 'agent',
    toolName: 'mcp__example_payment__charge',
    toolUseId: 'demo-allow-1',
    toolInput: allowedInput,
    allowedToolInput: allowedInput,
    action: 'allow',
    reason: 'commerce_constraints_satisfied',
    tier: 'commerce',
    commerce: allowed,
  });

  const highAmountInput = { ...allowedInput, amount: 9999 };
  const highAmount = await evaluateCommerceIntent({
    toolName: 'mcp__example_payment__charge',
    toolInput: highAmountInput,
    viState: session.state.vi,
    strict: true,
  });
  await applyToolEvidence({
    session,
    cwd,
    policyAlias: 'agent',
    toolName: 'mcp__example_payment__charge',
    toolUseId: 'demo-deny-amount',
    toolInput: highAmountInput,
    action: 'deny',
    reason: highAmount.reason,
    tier: 'commerce',
    commerce: highAmount,
  });

  const selfOnlyInput = {
    _intent_fulfillment: allowedInput,
  };
  const selfOnly = await evaluateCommerceIntent({
    toolName: 'mcp__example_payment__charge',
    toolInput: selfOnlyInput,
    viState: session.state.vi,
    strict: true,
  });
  await applyToolEvidence({
    session,
    cwd,
    policyAlias: 'agent',
    toolName: 'mcp__example_payment__charge',
    toolUseId: 'demo-deny-self-reported',
    toolInput: selfOnlyInput,
    action: 'deny',
    reason: selfOnly.reason,
    tier: 'commerce',
    commerce: selfOnly,
  });

  const packet = await buildAgentPacket({ session });
  const verification = await verifyAgentPacket(packet.packet);
  const out = {
    agent_accountability: verification.ok ? 'verified' : 'failed',
    policy: packet.packet.policy_id,
    intent: packet.packet.vi_summary ? 'valid' : 'missing',
    agent_key: packet.packet.vi_summary?.agent_jwk_kid ?? null,
    actions_allowed: packet.packet.decision_counts.tool_allow || 0,
    actions_denied: packet.packet.decision_counts.tool_deny || 0,
    violations: packet.packet.events.flatMap((e) => e.violations || [])[0]?.type ?? null,
    raw_sensitive_content_sent: false,
    packet_hash: packet.packet_hash,
    anchor_status: verification.anchor.status,
    packet_path: packet.path,
    verification_result: verification.ok,
  };
  print(out, args.json, [
    `agent_accountability: ${out.agent_accountability}`,
    `policy: ${out.policy}`,
    `intent: ${out.intent}`,
    `agent_key: ${out.agent_key}`,
    `actions_allowed: ${out.actions_allowed}`,
    `actions_denied: ${out.actions_denied}`,
    `violations: ${out.violations}`,
    `raw_sensitive_content_sent: ${out.raw_sensitive_content_sent}`,
    `packet_hash: ${out.packet_hash}`,
    `anchor_status: ${out.anchor_status}`,
    `packet_path: ${out.packet_path}`,
  ]);
  if (!verification.ok) process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (key === 'json') {
      out.json = true;
      continue;
    }
    if (key === 'allow-fallback') {
      out[key] = true;
      continue;
    }
    out[key] = argv[++i];
  }
  return out;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return raw.trim();
}

function print(obj, asJson, lines) {
  if (asJson) {
    console.log(JSON.stringify(obj, null, 2));
  } else {
    console.log(lines.join('\n'));
  }
}

function help(exit) {
  console.log(`Usage:
  zeroh-disclosure apply --policy blade --text "..."
  zeroh-disclosure verify --receipt <turn-json>
  zeroh-disclosure verify --proofpack <proofpack-json>
  zeroh-disclosure verify --agent-packet <packet-json>
  zeroh-disclosure proofpack --session <id>
  zeroh-disclosure agent-packet --session <id>
  zeroh-disclosure poll-anchor --receipt <turn-json>
  zeroh-disclosure doctor [--policy blade]
  zeroh-disclosure demo blade-proof --engine presidio-http [--allow-fallback]
  zeroh-disclosure demo agent-accountability [--mandate <path>]
`);
  process.exit(exit);
}

void resolvePolicy;
