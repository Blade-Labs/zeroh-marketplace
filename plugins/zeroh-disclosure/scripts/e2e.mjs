#!/usr/bin/env node
// End-to-end test of the disclosure lifecycle. Spawns the hook scripts as
// Claude Code would, with synthetic event payloads, and walks the resulting
// receipts to assert "policy was applied + signed proof exists".
//
// Run with:
//   node scripts/e2e.mjs               # ephemeral run in /tmp
//   node scripts/e2e.mjs --cwd ./foo   # persistent run in ./foo
//   node scripts/e2e.mjs --keep        # leave the tmpdir for inspection
//
// Honors ZEROH_ANCHOR=1 + HEDERA_* env vars: if set, the Stop hook submits to
// live HCS or EVM fallback and the runner verifies the mirror-node payload.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOOKS = {
  sessionStart: path.join(PLUGIN_ROOT, 'hooks/session-start.js'),
  userPromptSubmit: path.join(PLUGIN_ROOT, 'hooks/user-prompt-submit.js'),
  preToolUse: path.join(PLUGIN_ROOT, 'hooks/pre-tool-use.js'),
  stop: path.join(PLUGIN_ROOT, 'hooks/stop.js'),
};

const args = parseArgs(process.argv.slice(2));
const cwd = args.cwd || (await fs.mkdtemp(path.join(os.tmpdir(), 'zeroh-e2e-')));
// Pull .env values into process.env before deciding what to verify (anchor
// stage gates on ZEROH_ANCHOR + HEDERA_OPERATOR_ID, which usually live in .env).
await loadConfig({ cwd });
const SESSION_ID = 'e2e';
const sessionDir = path.join(cwd, '.zeroh', 'sessions', SESSION_ID);

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

console.log(bold('ZeroH Disclosure — end-to-end policy-application test'));
console.log(dim(`cwd: ${cwd}`));
console.log(dim(`session: ${SESSION_ID}`));
console.log(dim(`plugin: ${PLUGIN_ROOT}`));
console.log();

const results = [];

await step('VI fixtures parse (issuer-signed L1, user-signed L2)', async () => {
  const { decodeIssuerJwt } = await import('../lib/vi/index.js');
  const fixDir = path.join(PLUGIN_ROOT, 'test/fixtures/vi');
  const l1 = await fs.readFile(path.join(fixDir, 'l1.sdjwt'), 'utf8');
  const l2 = await fs.readFile(path.join(fixDir, 'l2.sdjwt'), 'utf8');
  const l1d = decodeIssuerJwt(l1);
  const l2d = decodeIssuerJwt(l2);
  assert(l1d.payload.iss === 'https://issuer.example.zeroh', 'L1 iss');
  assert(l1d.payload.cnf?.jwk?.kid === 'user-key-1', 'L1 binds user pubkey');
  assert(l2d.payload.aud === 'commerce', 'L2 aud=commerce');
  assert(l2d.payload.mode === 'autonomous', 'L2 mode=autonomous');
  const c = (l2d.payload.delegate_payload?.checkout_mandate?.constraints || []).length
          + (l2d.payload.delegate_payload?.payment_mandate?.constraints || []).length;
  assert(c === 8, `8 constraints in L2 (got ${c})`);
  return { l1_alg: l1d.header.alg, l2_kid: l2d.payload.delegate_payload?.checkout_mandate?.cnf?.jwk?.kid, constraints: c };
});

await step('VI chain verifies (signatures + sd_hash binding + audience)', async () => {
  const { verifyChain } = await import('../lib/vi/index.js');
  const fixDir = path.join(PLUGIN_ROOT, 'test/fixtures/vi');
  const l1 = await fs.readFile(path.join(fixDir, 'l1.sdjwt'), 'utf8');
  const l2 = await fs.readFile(path.join(fixDir, 'l2.sdjwt'), 'utf8');
  const issuerJwks = JSON.parse(await fs.readFile(path.join(fixDir, 'issuer-jwks.json'), 'utf8'));
  const r = await verifyChain({ l1Compact: l1, l2Compact: l2, trustedIssuerJwks: issuerJwks });
  assert(r.ok === true, `chain verifies (errors: ${r.errors.join('; ')})`);
  assert(typeof r.l1Hash === 'string' && r.l1Hash.length > 16, 'l1Hash present');
  assert(typeof r.l2Hash === 'string' && r.l2Hash.length > 16, 'l2Hash present');
  assert(r.agentJwk?.kid === 'agent-key-1', 'agent JWK extracted from L2');
  return { l1_short: r.l1Hash.slice(0, 12) + '…', l2_short: r.l2Hash.slice(0, 12) + '…', agent_kid: r.agentJwk.kid };
});

await step('VI chain rejects: expired L2', async () => {
  const { verifyChain } = await import('../lib/vi/index.js');
  const fixDir = path.join(PLUGIN_ROOT, 'test/fixtures/vi');
  const l1 = await fs.readFile(path.join(fixDir, 'l1.sdjwt'), 'utf8');
  const l2 = await fs.readFile(path.join(fixDir, 'l2.sdjwt'), 'utf8');
  const issuerJwks = JSON.parse(await fs.readFile(path.join(fixDir, 'issuer-jwks.json'), 'utf8'));
  const { decodeIssuerJwt } = await import('../lib/vi/index.js');
  const l2Exp = decodeIssuerJwt(l2).payload.exp;
  const r = await verifyChain({ l1Compact: l1, l2Compact: l2, trustedIssuerJwks: issuerJwks, now: l2Exp + 1 });
  assert(r.ok === false, 'chain rejected as expected');
  assert(r.errors.some((e) => /expired/i.test(e)), `error mentions expiry (got: ${r.errors.join(';')})`);
  return { error_first: r.errors[0] };
});

await step('VI chain rejects: wrong issuer JWKS', async () => {
  const { verifyChain } = await import('../lib/vi/index.js');
  const fixDir = path.join(PLUGIN_ROOT, 'test/fixtures/vi');
  const l1 = await fs.readFile(path.join(fixDir, 'l1.sdjwt'), 'utf8');
  const l2 = await fs.readFile(path.join(fixDir, 'l2.sdjwt'), 'utf8');
  const wrongJwks = JSON.parse(await fs.readFile(path.join(fixDir, 'user-jwks.json'), 'utf8'));
  const r = await verifyChain({ l1Compact: l1, l2Compact: l2, trustedIssuerJwks: wrongJwks });
  assert(r.ok === false, 'chain rejected as expected');
  assert(r.errors.some((e) => /signature/i.test(e) || /no matching/i.test(e)), `error mentions signature (got: ${r.errors.join(';')})`);
  return { error_first: r.errors[0] };
});

await step('VI chain rejects: wrong audience', async () => {
  const { verifyChain } = await import('../lib/vi/index.js');
  const fixDir = path.join(PLUGIN_ROOT, 'test/fixtures/vi');
  const l1 = await fs.readFile(path.join(fixDir, 'l1.sdjwt'), 'utf8');
  const l2 = await fs.readFile(path.join(fixDir, 'l2.sdjwt'), 'utf8');
  const issuerJwks = JSON.parse(await fs.readFile(path.join(fixDir, 'issuer-jwks.json'), 'utf8'));
  const r = await verifyChain({ l1Compact: l1, l2Compact: l2, trustedIssuerJwks: issuerJwks, expectedAud: 'not-commerce' });
  assert(r.ok === false, 'chain rejected as expected');
  assert(r.errors.some((e) => /aud=commerce expected not-commerce/.test(e)), `error mentions audience (got: ${r.errors.join(';')})`);
  return { error_first: r.errors[0] };
});

await step('SessionStart with valid VI mandate exposes state.vi', async () => {
  const mandatePath = path.join(PLUGIN_ROOT, 'test/fixtures/vi/mandate.json');
  const out = await runHook(HOOKS.sessionStart, {
    session_id: 'e2e-vi-ok', cwd, source: 'startup', hook_event_name: 'SessionStart',
  }, { ZEROH_VI_MANDATE_FILE: mandatePath });
  const ctx = out.json?.hookSpecificOutput?.additionalContext || '';
  assert(ctx.includes('Verifiable Intent mandate active'), `mandate line in additionalContext (got: ${ctx.slice(0, 200)})`);
  assert(ctx.includes('aud=commerce'), 'aud=commerce in summary');
  // state.json should now hold the vi block
  const stateFile = path.join(cwd, '.zeroh/sessions/e2e-vi-ok/state.json');
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert(state.vi?.l1_hash && state.vi?.l2_hash, 'state.vi populated with hashes');
  assert(state.vi?.agent_jwk_kid === 'agent-key-1', 'agent kid recorded');
  return { aud: state.vi.mandate_aud, kid: state.vi.agent_jwk_kid, scope: state.vi.scope_summary };
});

await step('Receipt boundary unchanged when no mandate (hash-stability regression guard)', async () => {
  // Compute boundary_hash for the default boundary (what Stop produces today
  // for non-VI sessions) and confirm it matches a fixed value. The string is
  // intentionally pinned — any future change to boundary defaults must be
  // accompanied by an explicit update here.
  const { normalizeBoundary, boundaryHash } = await import('../lib/boundary.js');
  const b = normalizeBoundary({
    destination: 'anthropic_claude_api', model: 'claude-code',
    retention: 'unknown', destination_jurisdiction: 'US',
  });
  assert(!('intent_binding' in b), 'intent_binding key absent from default boundary');
  const h = await boundaryHash(b);
  assert(h === '0yZ5pWz7p0_cigUKdGL7In6V-Sm83Y7SRqV7qTuQA3s',
    `boundary_hash stable for no-mandate path (got ${h})`);
  return { boundary_hash: h.slice(0, 16) + '…' };
});

await step('Receipt boundary changes when mandate is bound (hash differs + intent_binding present)', async () => {
  const { normalizeBoundary, boundaryHash } = await import('../lib/boundary.js');
  const sample = {
    l1_hash: 'aaa', l2_hash: 'bbb', l2_nonce: 'nonce-1',
    mandate_aud: 'commerce', agent_jwk_kid: 'agent-key-1',
    scope_summary: 'amount:100-2000 USD', expiry: 9999999999,
  };
  const b = normalizeBoundary({
    destination: 'anthropic_claude_api', model: 'claude-code',
    retention: 'unknown', destination_jurisdiction: 'US',
    intent_binding: sample,
  });
  assert(b.intent_binding?.l2_hash === 'bbb', 'intent_binding included');
  const h = await boundaryHash(b);
  assert(h !== '0yZ5pWz7p0_cigUKdGL7In6V-Sm83Y7SRqV7qTuQA3s',
    'boundary_hash differs from no-mandate baseline');
  return { boundary_hash: h.slice(0, 16) + '…' };
});

await step('Commerce tool denied without an active mandate', async () => {
  const out = await runHook(HOOKS.preToolUse, {
    session_id: 'e2e-cmrc-no-mandate', cwd,
    tool_name: 'mcp__example_payment__charge', tool_use_id: 'e2e-cm-1',
    tool_input: { amount: 800, currency: 'USD' },
  });
  const hso = out.json?.hookSpecificOutput;
  assert(hso?.permissionDecision === 'deny', 'permissionDecision=deny');
  assert(/no active Verifiable Intent mandate/.test(hso.permissionDecisionReason),
    `reason mentions missing mandate (got: ${hso.permissionDecisionReason?.slice(0, 200)})`);
  return { reason_starts: hso.permissionDecisionReason.split('\n')[0] };
});

await step('Commerce tool denied when mandate active but fulfillment is missing', async () => {
  const out = await runHook(HOOKS.preToolUse, {
    session_id: 'e2e-vi-ok', cwd,
    tool_name: 'mcp__example_checkout__buy', tool_use_id: 'e2e-cm-2',
    tool_input: { url: 'https://coffee.example/api/buy' },
  });
  const hso = out.json?.hookSpecificOutput;
  assert(hso?.permissionDecision === 'deny', 'permissionDecision=deny');
  assert(/fulfillment fields are missing/.test(hso.permissionDecisionReason),
    `reason mentions missing fulfillment`);
  return { reason_starts: hso.permissionDecisionReason.split('\n')[0] };
});

await step('Commerce tool denied when fulfillment exceeds amount_range', async () => {
  const out = await runHook(HOOKS.preToolUse, {
    session_id: 'e2e-vi-ok', cwd,
    tool_name: 'mcp__example_payment__charge', tool_use_id: 'e2e-cm-3',
    tool_input: {
      _intent_fulfillment: {
        amount: 9999, currency: 'USD', // > amount_range.max (2000)
        merchant: { id: 'merchant-001' },
        payee: { id: 'payee-001' },
        line_items: [{ id: 'sku-coffee', quantity: 1 }],
        reference: 'binding-001',
      },
    },
  });
  const hso = out.json?.hookSpecificOutput;
  assert(hso?.permissionDecision === 'deny', 'permissionDecision=deny');
  assert(/amount_range/.test(hso.permissionDecisionReason),
    `reason names violated constraint (got: ${hso.permissionDecisionReason?.slice(0, 200)})`);
  return { reason_first: hso.permissionDecisionReason.split('\n').find((l) => l.includes('amount_range')) };
});

await step('Commerce tool allowed when fulfillment is in scope', async () => {
  const out = await runHook(HOOKS.preToolUse, {
    session_id: 'e2e-vi-ok', cwd,
    tool_name: 'mcp__example_payment__charge', tool_use_id: 'e2e-cm-4',
    tool_input: {
      _intent_fulfillment: {
        amount: 800, currency: 'USD',
        merchant: { id: 'merchant-001' },
        payee: { id: 'payee-001' },
        line_items: [{ id: 'sku-coffee', quantity: 1 }],
        reference: 'binding-001',
      },
    },
  });
  // Allow = silent pass-through (no JSON output) OR explicit permissionDecision: allow.
  // Our hook currently exits 0 with no JSON for the allow path on commerce.
  assert(out.exit === 0, 'exit 0');
  // No deny JSON.
  assert(out.json?.hookSpecificOutput?.permissionDecision !== 'deny',
    `not denied (got: ${out.json?.hookSpecificOutput?.permissionDecision})`);
  return { passed: true };
});

await step('Agent accountability mode loads VI and reports enabled context', async () => {
  const mandatePath = path.join(PLUGIN_ROOT, 'test/fixtures/vi/mandate.json');
  const out = await runHook(HOOKS.sessionStart, {
    session_id: 'e2e-agent', cwd, source: 'startup', hook_event_name: 'SessionStart',
  }, { ZEROH_POLICY: 'agent', ZEROH_REQUIRE_INTENT: '1', ZEROH_VI_MANDATE_FILE: mandatePath });
  const ctx = out.json?.hookSpecificOutput?.additionalContext || '';
  assert(ctx.includes('Agent accountability: enabled'), 'agent accountability line present');
  assert(ctx.includes('Verifiable Intent mandate active'), 'VI line present');
  return { context: 'agent+vi' };
});

await step('Agent commerce allow signs deterministic tool evidence', async () => {
  const out = await runHook(HOOKS.preToolUse, {
    session_id: 'e2e-agent', cwd,
    tool_name: 'mcp__example_payment__charge', tool_use_id: 'e2e-agent-allow',
    tool_input: {
      amount: 800,
      currency: 'USD',
      merchant: { id: 'merchant-001' },
      payee: { id: 'payee-001' },
      line_items: [{ id: 'sku-coffee', quantity: 1 }],
      reference: 'binding-001',
    },
  }, { ZEROH_POLICY: 'agent', ZEROH_REQUIRE_INTENT: '1' });
  assert(out.exit === 0, `exit 0 (got ${out.exit})`);
  assert(out.json?.hookSpecificOutput?.permissionDecision !== 'deny', 'not denied');
  const event = JSON.parse(await fs.readFile(path.join(cwd, '.zeroh/sessions/e2e-agent/event-1.json'), 'utf8'));
  assert(event.decision_action === 'tool_allow', 'tool_allow receipt');
  assert(event.fulfillment_source === 'deterministic', 'deterministic fulfillment');
  assert(event.receipt.public_claims.subject_type === 'tool_action', 'tool action receipt');
  return { receipt: event.receipt.receipt_hash.slice(0, 12) + '…' };
});

await step('Agent strict mode denies self-reported-only fulfillment and signs it', async () => {
  const out = await runHook(HOOKS.preToolUse, {
    session_id: 'e2e-agent', cwd,
    tool_name: 'mcp__example_payment__charge', tool_use_id: 'e2e-agent-self',
    tool_input: {
      _intent_fulfillment: {
        amount: 800,
        currency: 'USD',
        merchant: { id: 'merchant-001' },
        payee: { id: 'payee-001' },
        line_items: [{ id: 'sku-coffee', quantity: 1 }],
        reference: 'binding-001',
      },
    },
  }, { ZEROH_POLICY: 'agent', ZEROH_REQUIRE_INTENT: '1' });
  const hso = out.json?.hookSpecificOutput;
  assert(hso?.permissionDecision === 'deny', 'permissionDecision=deny');
  assert(/strict agent mode/.test(hso.permissionDecisionReason), 'strict-mode denial reason');
  const event = JSON.parse(await fs.readFile(path.join(cwd, '.zeroh/sessions/e2e-agent/event-2.json'), 'utf8'));
  assert(event.decision_action === 'tool_deny', 'signed deny event');
  return { reason: event.reason };
});

await step('Agent commerce deny names amount_range and signs it', async () => {
  const out = await runHook(HOOKS.preToolUse, {
    session_id: 'e2e-agent', cwd,
    tool_name: 'mcp__example_payment__charge', tool_use_id: 'e2e-agent-amount',
    tool_input: {
      amount: 9999,
      currency: 'USD',
      merchant: { id: 'merchant-001' },
      payee: { id: 'payee-001' },
      line_items: [{ id: 'sku-coffee', quantity: 1 }],
      reference: 'binding-001',
    },
  }, { ZEROH_POLICY: 'agent', ZEROH_REQUIRE_INTENT: '1' });
  const hso = out.json?.hookSpecificOutput;
  assert(hso?.permissionDecision === 'deny', 'permissionDecision=deny');
  assert(/mandate\.payment\.amount_range/.test(hso.permissionDecisionReason), 'amount_range denial reason');
  const event = JSON.parse(await fs.readFile(path.join(cwd, '.zeroh/sessions/e2e-agent/event-3.json'), 'utf8'));
  assert(event.violations.some((v) => v.type === 'mandate.payment.amount_range'), 'event records amount_range');
  return { violation: 'amount_range' };
});

await step('Agent packet builds, verifies, and fails on tamper', async () => {
  const cli = path.join(PLUGIN_ROOT, 'bin/zeroh-disclosure.mjs');
  const built = await runNode(cli, ['agent-packet', '--cwd', cwd, '--session', 'e2e-agent', '--json']);
  assert(built.exit === 0, `agent-packet exit 0 (got ${built.exit}; stderr: ${built.stderr.slice(-200)})`);
  const builtJson = JSON.parse(built.stdout);
  const verified = await runNode(cli, ['verify', '--agent-packet', builtJson.path, '--json']);
  assert(verified.exit === 0, `verify agent packet exit 0 (got ${verified.exit}; stderr: ${verified.stderr.slice(-200)})`);
  const verifyJson = JSON.parse(verified.stdout);
  assert(verifyJson.ok === true, 'packet verifies');
  assert(verifyJson.action_count === 3, `action_count=3 (got ${verifyJson.action_count})`);
  const tamperedPath = path.join(cwd, 'tampered-agent-packet.json');
  const tampered = JSON.parse(await fs.readFile(builtJson.path, 'utf8'));
  tampered.events[0].decision_action = 'tool_deny';
  await fs.writeFile(tamperedPath, JSON.stringify(tampered, null, 2));
  const tamperedVerify = await runNode(cli, ['verify', '--agent-packet', tamperedPath, '--json']);
  assert(tamperedVerify.exit !== 0, 'tampered packet fails');
  return { packet: verifyJson.packet_hash.slice(0, 12) + '…' };
});

await step('End-to-end: receipt carries intent_binding when mandate is active', async () => {
  // Reuse the e2e-vi-ok session created earlier (already has state.vi
  // persisted). Submit one clean prompt then Stop, and inspect the receipt.
  const viSession = 'e2e-vi-ok';
  const viSessionDir = path.join(cwd, '.zeroh/sessions', viSession);
  await runHook(HOOKS.userPromptSubmit, {
    session_id: viSession, cwd,
    prompt: 'tell me about the weather',
  });
  await runHook(HOOKS.stop, {
    session_id: viSession, cwd, hook_event_name: 'Stop',
  });
  const turn = JSON.parse(await fs.readFile(path.join(viSessionDir, 'turn-1.json'), 'utf8'));
  assert(turn.phase === 'finalized', `vi-session turn-1 finalized (got ${turn.phase})`);
  const ib = turn.receipt?.public_claims?.intent_binding;
  assert(ib, 'public_claims.intent_binding present on receipt');
  assert(ib.mandate_aud === 'commerce', 'intent_binding.mandate_aud=commerce');
  assert(ib.agent_jwk_kid === 'agent-key-1', 'intent_binding.agent_jwk_kid=agent-key-1');
  assert(typeof ib.l1_hash === 'string' && ib.l1_hash.length > 16, 'intent_binding.l1_hash present');
  return {
    receipt_id: turn.receipt.receipt_id,
    aud: ib.mandate_aud,
    agent_kid: ib.agent_jwk_kid,
  };
});

await step('Key reuse: SessionStart with correct agent key swaps the receipt-signing wallet', async () => {
  const mandatePath = path.join(PLUGIN_ROOT, 'test/fixtures/vi/mandate.json');
  const agentKey = path.join(PLUGIN_ROOT, 'test/fixtures/vi/agent-key.json');
  await runHook(HOOKS.sessionStart, {
    session_id: 'e2e-vi-keyok', cwd, source: 'startup', hook_event_name: 'SessionStart',
  }, { ZEROH_VI_MANDATE_FILE: mandatePath, ZEROH_VI_AGENT_KEY_FILE: agentKey });
  // Run a clean prompt + Stop under this session so a receipt gets minted.
  await runHook(HOOKS.userPromptSubmit, {
    session_id: 'e2e-vi-keyok', cwd, prompt: 'hello',
  }, { ZEROH_VI_MANDATE_FILE: mandatePath, ZEROH_VI_AGENT_KEY_FILE: agentKey });
  await runHook(HOOKS.stop, {
    session_id: 'e2e-vi-keyok', cwd, hook_event_name: 'Stop',
  }, { ZEROH_VI_MANDATE_FILE: mandatePath, ZEROH_VI_AGENT_KEY_FILE: agentKey });
  const turn = JSON.parse(await fs.readFile(path.join(cwd, '.zeroh/sessions/e2e-vi-keyok/turn-1.json'), 'utf8'));
  const iss = turn.receipt.public_claims.iss;
  assert(iss.startsWith('did:jwk:'), `iss is did:jwk (got ${iss})`);
  const stateFile = path.join(cwd, '.zeroh/sessions/e2e-vi-keyok/state.json');
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert(!state.vi_error, 'no vi_error');
  return { iss_prefix: iss.slice(0, 16) + '…', kid_match: state.vi.agent_jwk_kid };
});

await step('Key reuse: SessionStart with wrong agent key records vi_error and skips wallet swap', async () => {
  const mandatePath = path.join(PLUGIN_ROOT, 'test/fixtures/vi/mandate.json');
  const wrongKey = path.join(PLUGIN_ROOT, 'test/fixtures/vi/issuer-key.json'); // not the agent's key
  await runHook(HOOKS.sessionStart, {
    session_id: 'e2e-vi-keybad', cwd, source: 'startup', hook_event_name: 'SessionStart',
  }, { ZEROH_VI_MANDATE_FILE: mandatePath, ZEROH_VI_AGENT_KEY_FILE: wrongKey });
  const stateFile = path.join(cwd, '.zeroh/sessions/e2e-vi-keybad/state.json');
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert(!state.vi, 'state.vi absent after wrong-key failure');
  assert(Array.isArray(state.vi_error?.errors), 'vi_error captured');
  assert(/agent key reuse/.test(state.vi_error.errors[0]), `error mentions agent key reuse (got: ${state.vi_error.errors[0]})`);
  return { error_first: state.vi_error.errors[0].slice(0, 70) + '…' };
});

await step('BladeWallet: signMessage roundtrip verifies via Web Crypto Ed25519 (F-1.4)', async () => {
  const { spawn: spawnChild } = await import('node:child_process');
  const cfgPath = path.join(cwd, 'blade-agent-wallet-test.json');
  // Produce a config blob with --dry-run (real Ed25519 keys, synthetic Hedera IDs)
  await new Promise((resolve, reject) => {
    const c = spawnChild('node', [
      path.join(PLUGIN_ROOT, 'scripts/blade-agent-bootstrap.mjs'),
      '--dry-run', '--config-path', cfgPath,
    ], { env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (b) => (err += b));
    c.on('close', (exit) => exit === 0 ? resolve() : reject(new Error(err)));
  });
  const { loadBladeWallet } = await import('../lib/wallet/blade-wallet.js');
  const wallet = await loadBladeWallet({ configPath: cfgPath });
  assert(wallet.alg === 'EdDSA', `alg=EdDSA (got ${wallet.alg})`);
  assert((await wallet.getAccount()).did.startsWith('did:hedera:'), 'did:hedera in getAccount');
  const msg = new TextEncoder().encode('zeroh signing roundtrip');
  const sig = await wallet.signMessage(msg);
  assert(sig.length === 64, `Ed25519 sig is 64 bytes (got ${sig.length})`);
  const { webcrypto } = await import('node:crypto');
  const pub = await wallet.getPublicKey();
  const ck = await webcrypto.subtle.importKey('jwk', pub.jwk, { name: 'Ed25519' }, false, ['verify']);
  const ok = await webcrypto.subtle.verify({ name: 'Ed25519' }, ck, sig, msg);
  assert(ok === true, 'Web Crypto verify');
  return { kid: (await wallet.getKeyId()).slice(-24) };
});

await step('SessionStart with ZEROH_BLADE_AGENT_CONFIG → BladeWallet selected (F-1.5)', async () => {
  const { spawn: spawnChild } = await import('node:child_process');
  const cfgPath = path.join(cwd, 'blade-agent-session-test.json');
  await new Promise((resolve, reject) => {
    const c = spawnChild('node', [
      path.join(PLUGIN_ROOT, 'scripts/blade-agent-bootstrap.mjs'),
      '--dry-run', '--config-path', cfgPath,
    ], { env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (b) => (err += b));
    c.on('close', (exit) => exit === 0 ? resolve() : reject(new Error(err)));
  });
  // Run UserPromptSubmit + Stop under a fresh session, with the Blade config
  // pointed at. Then assert the finalized receipt's iss is did:hedera:...
  const sid = 'e2e-blade-wallet';
  await runHook(HOOKS.userPromptSubmit, {
    session_id: sid, cwd, prompt: 'hello blade-rooted agent',
  }, { ZEROH_BLADE_AGENT_CONFIG: cfgPath });
  await runHook(HOOKS.stop, {
    session_id: sid, cwd, hook_event_name: 'Stop',
  }, { ZEROH_BLADE_AGENT_CONFIG: cfgPath });
  const turn = JSON.parse(await fs.readFile(path.join(cwd, '.zeroh/sessions', sid, 'turn-1.json'), 'utf8'));
  const iss = turn.receipt.public_claims.iss;
  assert(iss.startsWith('did:hedera:'), `iss starts with did:hedera: (got ${iss})`);
  // Decode header from compact_sdjwt — same pattern as the existing
  // "VERIFY: SD-JWT signature structure" step.
  const jwt = turn.receipt.compact_sdjwt;
  const headerB64 = jwt.split('~')[0].split('.')[0];
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  assert(header.alg === 'EdDSA', `alg=EdDSA (got ${header.alg})`);
  assert(header.kid && header.kid.endsWith('#did-root-key'), `kid ends with #did-root-key (got ${header.kid})`);
  return { iss_short: iss.slice(0, 30) + '…', alg: header.alg };
});

await step('VI mandate bound to Blade Ed25519 key — BladeWallet signs receipt (F-1.6)', async () => {
  const { spawn: spawnChild } = await import('node:child_process');
  // 1. Provision a Blade agent (dry-run) — synthetic Hedera IDs, real Ed25519 keys
  const cfgPath = path.join(cwd, 'blade-agent-vi-test.json');
  await new Promise((resolve, reject) => {
    const c = spawnChild('node', [
      path.join(PLUGIN_ROOT, 'scripts/blade-agent-bootstrap.mjs'),
      '--dry-run', '--config-path', cfgPath,
    ], { env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (b) => (err += b));
    c.on('close', (exit) => exit === 0 ? resolve() : reject(new Error(err)));
  });
  // 2. Regenerate VI fixtures with the Blade agent's Ed25519 key as cnf.jwk
  await new Promise((resolve, reject) => {
    const c = spawnChild('node', [
      path.join(PLUGIN_ROOT, 'scripts/vi-fixture-gen.mjs'),
      `--agent-from-blade=${cfgPath}`,
    ], { env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (b) => (err += b));
    c.on('close', (exit) => exit === 0 ? resolve() : reject(new Error(err)));
  });
  const mandateBladePath = path.join(PLUGIN_ROOT, 'test/fixtures/vi/mandate-blade.json');
  // 3. SessionStart with the Blade-bound mandate + Blade agent config
  const sid = 'e2e-vi-blade';
  const envOverrides = {
    ZEROH_VI_MANDATE_FILE: mandateBladePath,
    ZEROH_BLADE_AGENT_CONFIG: cfgPath,
  };
  const start = await runHook(HOOKS.sessionStart, {
    session_id: sid, cwd, source: 'startup', hook_event_name: 'SessionStart',
  }, envOverrides);
  const ctx = start.json?.hookSpecificOutput?.additionalContext || '';
  assert(ctx.includes('Verifiable Intent mandate active'), `mandate active line surfaced (got: ${ctx.slice(0, 200)})`);
  // 4. UserPromptSubmit + Stop → produce a receipt
  await runHook(HOOKS.userPromptSubmit, {
    session_id: sid, cwd, prompt: 'in-scope coffee purchase test',
  }, envOverrides);
  await runHook(HOOKS.stop, {
    session_id: sid, cwd, hook_event_name: 'Stop',
  }, envOverrides);
  // 5. The receipt's iss must be did:hedera:..., not did:jwk:...
  const turn = JSON.parse(await fs.readFile(path.join(cwd, '.zeroh/sessions', sid, 'turn-1.json'), 'utf8'));
  const iss = turn.receipt.public_claims.iss;
  assert(iss.startsWith('did:hedera:'), `iss is did:hedera (got ${iss})`);
  // SD-JWT header alg + kid match Blade
  const jwt = turn.receipt.compact_sdjwt;
  const header = JSON.parse(Buffer.from(jwt.split('~')[0].split('.')[0], 'base64url').toString('utf8'));
  assert(header.alg === 'EdDSA', `alg=EdDSA (got ${header.alg})`);
  assert(header.kid.endsWith('#did-root-key'), `kid ends with #did-root-key (got ${header.kid})`);
  // intent_binding mandate_aud preserved
  const ib = turn.receipt.public_claims.intent_binding;
  assert(ib?.mandate_aud === 'commerce', 'intent_binding.mandate_aud=commerce');
  return { iss_short: iss.slice(0, 30) + '…', alg: header.alg };
});

await step('Blade bootstrap --dry-run produces a complete config blob (F-1.3)', async () => {
  const { spawn: spawnChild } = await import('node:child_process');
  const cfgPath = path.join(cwd, 'blade-agent-dryrun.json');
  const r = await new Promise((resolve, reject) => {
    const child = spawnChild('node', [
      path.join(PLUGIN_ROOT, 'scripts/blade-agent-bootstrap.mjs'),
      '--dry-run', '--config-path', cfgPath,
    ], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    child.on('error', reject);
    child.on('close', (exit) => resolve({ exit, out, err }));
  });
  assert(r.exit === 0, `bootstrap exit 0 (got ${r.exit}; stderr: ${r.err.slice(-200)})`);
  const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
  for (const key of ['version', 'accountId', 'network', 'privateKeyHex', 'publicJwk', 'did', 'uaid', 'createdAt']) {
    assert(cfg[key], `config field ${key} present`);
  }
  assert(cfg.publicJwk.kty === 'OKP' && cfg.publicJwk.crv === 'Ed25519', 'publicJwk is Ed25519 OKP');
  assert(cfg.did.startsWith('did:hedera:'), `did starts with did:hedera: (got ${cfg.did})`);
  assert(cfg.uaid.startsWith('uaid:did:'), `uaid starts with uaid:did: (got ${cfg.uaid})`);
  return { account: cfg.accountId, did_short: cfg.did.slice(0, 40) + '…' };
});

await step('SessionStart with invalid VI mandate records vi_error', async () => {
  // Write a wrapper that points at the fixture but with a tampered L1 (random bytes).
  const tamperedPath = path.join(cwd, 'tampered.mandate.json');
  const orig = JSON.parse(await fs.readFile(path.join(PLUGIN_ROOT, 'test/fixtures/vi/mandate.json'), 'utf8'));
  const tampered = { ...orig, l1_compact: orig.l1_compact.replace(/.$/, 'X') };
  await fs.writeFile(tamperedPath, JSON.stringify(tampered));
  const out = await runHook(HOOKS.sessionStart, {
    session_id: 'e2e-vi-bad', cwd, source: 'startup', hook_event_name: 'SessionStart',
  }, { ZEROH_VI_MANDATE_FILE: tamperedPath });
  const ctx = out.json?.hookSpecificOutput?.additionalContext || '';
  assert(ctx.includes('FAILED'), `failure line surfaced (got: ${ctx.slice(0, 200)})`);
  const stateFile = path.join(cwd, '.zeroh/sessions/e2e-vi-bad/state.json');
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert(!state.vi, 'state.vi absent after failed ingest');
  assert(Array.isArray(state.vi_error?.errors), 'state.vi_error captured');
  return { error_first: state.vi_error.errors[0] };
});

await step('SessionStart', async () => {
  const out = await runHook(HOOKS.sessionStart, {
    session_id: SESSION_ID, cwd, source: 'startup', hook_event_name: 'SessionStart',
  });
  const ctx = out.json?.hookSpecificOutput?.additionalContext;
  assert(typeof ctx === 'string' && ctx.includes('ZeroH Disclosure'), 'additionalContext set');
  return { ctx_first_line: ctx.split('\n')[0] };
});

await step('Structured policy command activates Blade without a model prompt', async () => {
  const r = await runNode(path.join(PLUGIN_ROOT, 'commands/scripts/apply-policy.js'), ['blade'], {
    cwd,
    env: { CLAUDE_SESSION_ID: 'e2e-blade' },
  });
  assert(r.exit === 0, `apply-policy exit 0 (got ${r.exit}; stderr: ${r.stderr.slice(-200)})`);
  const state = JSON.parse(await fs.readFile(path.join(cwd, '.zeroh/sessions/e2e-blade/state.json'), 'utf8'));
  assert(state.active_policy_id === 'blade-ai-disclosure-v1', `active_policy_id=blade (got ${state.active_policy_id})`);
  return { policy: state.active_policy_id };
});

await step('CLI apply + verify works without Claude hooks', async () => {
  const cliCwd = path.join(cwd, 'cli-proof');
  await fs.mkdir(cliCwd, { recursive: true });
  const cli = path.join(PLUGIN_ROOT, 'bin/zeroh-disclosure.mjs');
  const applied = await runNode(cli, [
    'apply',
    '--cwd', cliCwd,
    '--policy', 'blade',
    '--engine', 'regex-local',
    '--session', 'demo',
    '--text', 'contact alice@example.com about card 4532 0151 1283 0366',
    '--json',
  ]);
  assert(applied.exit === 0, `CLI apply exit 0 (got ${applied.exit}; stderr: ${applied.stderr.slice(-200)})`);
  const applyJson = JSON.parse(applied.stdout);
  assert(applyJson.policy_id === 'blade-ai-disclosure-v1', `CLI policy_id blade (got ${applyJson.policy_id})`);
  assert(applyJson.protection_engine_id === 'regex-local', `CLI engine regex-local (got ${applyJson.protection_engine_id})`);
  assert(applyJson.model_safe_text.includes('[EMAIL-'), 'CLI emits model-safe text');
  const verified = await runNode(cli, ['verify', '--receipt', applyJson.ledger_path, '--json']);
  assert(verified.exit === 0, `CLI verify exit 0 (got ${verified.exit}; stderr: ${verified.stderr.slice(-200)})`);
  const verifyJson = JSON.parse(verified.stdout);
  assert(verifyJson.ok === true, 'CLI verify ok');
  const applied2 = await runNode(cli, [
    'apply',
    '--cwd', cliCwd,
    '--policy', 'blade',
    '--engine', 'regex-local',
    '--session', 'demo',
    '--text', 'follow up with bob@example.com',
    '--json',
  ]);
  assert(applied2.exit === 0, `second CLI apply exit 0 (got ${applied2.exit}; stderr: ${applied2.stderr.slice(-200)})`);
  const applyJson2 = JSON.parse(applied2.stdout);
  const proofpack = await runNode(cli, ['proofpack', '--cwd', cliCwd, '--session', 'demo', '--json']);
  assert(proofpack.exit === 0, `CLI proofpack exit 0 (got ${proofpack.exit}; stderr: ${proofpack.stderr.slice(-200)})`);
  const proofpackJson = JSON.parse(proofpack.stdout);
  const proofpackVerify = await runNode(cli, ['verify', '--proofpack', proofpackJson.path, '--json']);
  assert(proofpackVerify.exit === 0, `CLI verify --proofpack exit 0 (got ${proofpackVerify.exit}; stderr: ${proofpackVerify.stderr.slice(-200)})`);
  const proofpackVerifyJson = JSON.parse(proofpackVerify.stdout);
  assert(proofpackVerifyJson.ok === true, 'CLI proofpack verify ok');

  const tamperedReceiptPath = path.join(cliCwd, 'tampered-turn.json');
  const tamperedReceipt = JSON.parse(await fs.readFile(applyJson2.ledger_path, 'utf8'));
  tamperedReceipt.sanitized_text = `${tamperedReceipt.sanitized_text} tampered`;
  await fs.writeFile(tamperedReceiptPath, JSON.stringify(tamperedReceipt, null, 2));
  const tamperedVerify = await runNode(cli, ['verify', '--receipt', tamperedReceiptPath, '--json']);
  assert(tamperedVerify.exit !== 0, 'tampered sanitized text fails verification');

  const tamperedProofpackPath = path.join(cliCwd, 'tampered-proofpack.json');
  const tamperedProofpack = JSON.parse(await fs.readFile(proofpackJson.path, 'utf8'));
  tamperedProofpack.receipts[1].receipt.public_claims.previous_receipt_hash = 'tampered';
  await fs.writeFile(tamperedProofpackPath, JSON.stringify(tamperedProofpack, null, 2));
  const tamperedProofpackVerify = await runNode(cli, ['verify', '--proofpack', tamperedProofpackPath, '--json']);
  assert(tamperedProofpackVerify.exit !== 0, 'tampered proofpack fails verification');
  return { policy: applyJson.policy_id, engine: applyJson.protection_engine_id, proofpack: proofpackVerifyJson.receipts_count };
});

await step('CLI Blade proof demo produces a verifiable transcript', async () => {
  const cliCwd = path.join(cwd, 'cli-demo');
  await fs.mkdir(cliCwd, { recursive: true });
  const cli = path.join(PLUGIN_ROOT, 'bin/zeroh-disclosure.mjs');
  const demo = await runNode(cli, [
    'demo',
    'blade-proof',
    '--cwd', cliCwd,
    '--engine', 'regex-local',
    '--json',
  ]);
  assert(demo.exit === 0, `CLI demo exit 0 (got ${demo.exit}; stderr: ${demo.stderr.slice(-200)})`);
  const demoJson = JSON.parse(demo.stdout);
  assert(demoJson.policy_applied === 'blade-ai-disclosure-v1', 'demo policy blade');
  assert(demoJson.engine_used === 'regex-local', 'demo engine regex-local');
  assert(demoJson.raw_content_sent_to_ai_provider === false, 'raw not sent');
  assert(demoJson.receipt_verification_ok === true, 'demo receipt verifies');
  assert(demoJson.proofpack_verification_ok === true, 'demo proofpack verifies');
  return { receipt: demoJson.receipt_hash.slice(0, 12) + '…', anchor: demoJson.anchor.status };
});

let blockedPrompt = null, maskedRewrite = null;

await step('UserPromptSubmit (clean prompt → silent + turn ledger)', async () => {
  const out = await runHook(HOOKS.userPromptSubmit, {
    session_id: SESSION_ID, cwd,
    prompt: 'write me a haiku about coffee',
  });
  assert(out.exit === 0, 'exit 0');
  assert(out.stdout.trim() === '', 'silent (no JSON output)');
  // Even though we stayed silent to the model, a turn ledger should exist —
  // proof-of-application requires every prompt to be evidenced.
  const turn1 = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-1.json'), 'utf8'));
  assert(turn1.phase === 'allowed_no_findings', `turn-1 phase is allowed_no_findings (got ${turn1.phase})`);
  assert(turn1.findings.length === 0, '0 findings');
  return { phase: turn1.phase };
});

await step('UserPromptSubmit (PII prompt → block, turn-2)', async () => {
  blockedPrompt = 'contact alice@example.com about her card 4532 0151 1283 0366';
  const out = await runHook(HOOKS.userPromptSubmit, {
    session_id: SESSION_ID, cwd, prompt: blockedPrompt,
  });
  assert(out.exit === 0 || out.exit === 2, `exit 0 or hook-block exit 2 (got ${out.exit})`);
  const reason = out.json?.reason || out.stderr;
  assert(out.json?.decision === 'block' || out.exit === 2, 'decision=block or exit-2 hook block');
  assert(reason?.includes('Detected 2'), 'reason mentions 2 items');
  const turn2 = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-2.json'), 'utf8'));
  assert(turn2.phase === 'blocked_pending_user_resubmit', 'turn-2 phase blocked');
  assert(turn2.findings.length === 2, '2 findings recorded');
  assert(turn2.receipt?.public_claims?.proof_stage === 'pre_boundary', 'turn-2 receipt is pre_boundary');
  maskedRewrite = turn2.sanitized_text;
  return { findings: turn2.findings.map((f) => f.type).join(','), masked: maskedRewrite };
});

await step('UserPromptSubmit (masked re-submit → turn-3, token-map context)', async () => {
  const out = await runHook(HOOKS.userPromptSubmit, {
    session_id: SESSION_ID, cwd, prompt: maskedRewrite,
  });
  const ctx = out.json?.hookSpecificOutput?.additionalContext || '';
  assert(ctx.includes('[CARD_NUMBER-'), 'token map includes CARD_NUMBER');
  assert(ctx.includes('[EMAIL-'), 'token map includes EMAIL');
  const turn3 = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-3.json'), 'utf8'));
  assert(turn3.phase === 'allowed_tokenized_resubmit', 'turn-3 phase allowed_tokenized_resubmit');
  assert(turn3.findings.length === 0, '0 fresh findings');
  assert(turn3.referenced_tokens.length >= 2, 'tokens referenced are captured');
  return { tokens_listed: (ctx.match(/\[[A-Z_]+-[0-9a-f]{6}\]/g) || []).join(' ') };
});

await step('PreToolUse Write (PII content → rewrite)', async () => {
  const out = await runHook(HOOKS.preToolUse, {
    session_id: SESSION_ID, cwd,
    tool_name: 'Write', tool_use_id: 'e2e-write-1',
    tool_input: {
      file_path: '/tmp/test-out.txt',
      content: 'email alice@example.com about the new card 4532 0151 1283 0366',
    },
  });
  const hso = out.json?.hookSpecificOutput;
  assert(hso?.permissionDecision === 'allow', 'permissionDecision=allow');
  assert(hso?.updatedInput?.content?.includes('[CARD_NUMBER-'), 'content masked with token');
  // Token equality across hook types — critical for the receipt's coherence.
  const tokenInWrite = hso.updatedInput.content.match(/\[CARD_NUMBER-[0-9a-f]{6}\]/)?.[0];
  const tokenInPrompt = maskedRewrite.match(/\[CARD_NUMBER-[0-9a-f]{6}\]/)?.[0];
  assert(tokenInWrite === tokenInPrompt, `same CARD_NUMBER token in prompt and Write (${tokenInWrite} === ${tokenInPrompt})`);
  return { same_token: tokenInWrite };
});

await step('PreToolUse Bash (API key → deny)', async () => {
  const out = await runHook(HOOKS.preToolUse, {
    session_id: SESSION_ID, cwd,
    tool_name: 'Bash', tool_use_id: 'e2e-bash-1',
    tool_input: { command: 'curl -H "Authorization: Bearer sk_live_abc123def456ghi789" https://api.example.com' },
  });
  const hso = out.json?.hookSpecificOutput;
  assert(hso?.permissionDecision === 'deny', 'permissionDecision=deny');
  return { reason_starts: hso.permissionDecisionReason.split('\n')[0] };
});

await step('PreToolUse WebFetch (PII in URL → deny)', async () => {
  const out = await runHook(HOOKS.preToolUse, {
    session_id: SESSION_ID, cwd,
    tool_name: 'WebFetch', tool_use_id: 'e2e-webfetch-1',
    tool_input: { url: 'https://api.example.com/?email=alice@example.com', prompt: 'fetch' },
  });
  assert(out.json?.hookSpecificOutput?.permissionDecision === 'deny', 'permissionDecision=deny');
  return {};
});

await step('Stop hook → finalize all turns + ProofPack', async () => {
  const out = await runHook(HOOKS.stop, {
    session_id: SESSION_ID, cwd, hook_event_name: 'Stop',
  });
  assert(out.exit === 0, 'exit 0');
  // All three turns should now be finalized.
  for (const n of [1, 2, 3]) {
    const turn = JSON.parse(await fs.readFile(path.join(sessionDir, `turn-${n}.json`), 'utf8'));
    assert(turn.phase === 'finalized', `turn-${n} phase finalized`);
    assert(turn?.receipt?.receipt_id, `turn-${n} has receipt_id`);
  }
  return { receipts_finalized: 3 };
});

await step('VERIFY: receipts prove the policy was applied to every prompt', async () => {
  const expectations = {
    1: { decision: 'allow_with_receipt', categoriesGte: 0, categoriesLte: 0 },
    2: { decision: 'approval_required', categoriesGte: 2, categoriesLte: 2 },
    3: { decision: 'allow_with_receipt', categoriesGte: 0, categoriesLte: 0 },
  };
  const ids = [];
  for (const [n, exp] of Object.entries(expectations)) {
    const turn = JSON.parse(await fs.readFile(path.join(sessionDir, `turn-${n}.json`), 'utf8'));
    const claims = turn.receipt.public_claims;
    assert(claims.policy_id === 'qcb-ai-disclosure-v1', `turn-${n} policy_id`);
    assert(typeof claims.policy_hash === 'string' && claims.policy_hash.length > 20, `turn-${n} policy_hash`);
    assert(typeof claims.detector_hash === 'string' && claims.detector_hash.length > 20, `turn-${n} detector_hash`);
    assert(claims.schema === 'zeroh-disclosure-receipt/v2', `turn-${n} schema v2`);
    assert(claims.proof_stage === 'pre_boundary', `turn-${n} proof_stage=pre_boundary`);
    assert(claims.protection_engine_id === 'regex-local', `turn-${n} protection_engine_id=regex-local`);
    assert(claims.protection_engine_hash === claims.detector_hash, `turn-${n} detector_hash aliases protection_engine_hash`);
    assert(claims.decision_action === exp.decision, `turn-${n} decision_action=${exp.decision} (got ${claims.decision_action})`);
    const cats = claims.detected_categories?.length ?? 0;
    assert(cats >= exp.categoriesGte && cats <= exp.categoriesLte, `turn-${n} categories in [${exp.categoriesGte},${exp.categoriesLte}] (got ${cats})`);
    assert(claims.iss?.startsWith('did:hedera:'), `turn-${n} iss is did:hedera`);
    ids.push(`${n}:${claims.decision_action}`);
  }
  return { receipts: ids.join(' ') };
});

await step('VERIFY: SD-JWT signature structure', async () => {
  // Check turn-2 (the PII one) — has the most substantive claims.
  const turn = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-2.json'), 'utf8'));
  const jwt = turn.receipt.compact_sdjwt;
  assert(typeof jwt === 'string', 'compact_sdjwt is a string');
  const parts = jwt.split('~')[0].split('.');
  assert(parts.length === 3, 'JWT has 3 dot-separated parts');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  assert(header.alg === 'ES256', 'alg=ES256');
  assert(header.typ === 'zeroh+sd-jwt', 'typ=zeroh+sd-jwt');
  assert(parts[2].length > 40, 'signature non-empty');
  return { alg: header.alg, kid: header.kid?.slice(0, 16) + '…', sig_len: parts[2].length };
});

await step('VERIFY: ProofPack rolls up every receipt', async () => {
  // Stop writes the ProofPack against the last finalized turn.
  const pp = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-3.proofpack.json'), 'utf8'));
  assert(pp.schema === 'zeroh-proofpack/v1', 'schema=zeroh-proofpack/v1');
  assert(pp.summary?.receipts_count === 3, `rolls up 3 receipts (got ${pp.summary?.receipts_count})`);
  assert(typeof pp.proofpack_hash === 'string' && pp.proofpack_hash.length > 20, 'proofpack_hash present');
  return { receipts: pp.summary.receipts_count, hash: pp.proofpack_hash.slice(0, 12) + '…' };
});

const hcsConfigured = process.env.ZEROH_ANCHOR === '1'
  && process.env.HEDERA_OPERATOR_ID
  && process.env.HEDERA_OPERATOR_KEY
  && process.env.HEDERA_TOPIC_ID;
const evmConfigured = process.env.ZEROH_ANCHOR === '1'
  && process.env.HEDERA_EVM_OPERATOR_ID
  && process.env.HEDERA_EVM_OPERATOR_KEY;

await step('blade-vi-demo.mjs runs end-to-end (Hedera-rooted one-key chain) (F-1.7)', async () => {
  const { spawn: spawnChild } = await import('node:child_process');
  const r = await new Promise((resolve, reject) => {
    const child = spawnChild('node', [path.join(PLUGIN_ROOT, 'scripts/blade-vi-demo.mjs')], {
      env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('error', reject);
    child.on('close', (exit) => resolve({ exit, stdout, stderr }));
  });
  assert(r.exit === 0, `blade-vi-demo.mjs exit 0 (got ${r.exit}; stderr: ${r.stderr.slice(-200)})`);
  assert(/Receipt iss === did:hedera/.test(r.stdout), 'demo prints Hedera-rooted one-key confirmation');
  return { stdout_bytes: r.stdout.length };
});

await step('vi-demo.mjs runs end-to-end and produces a one-key chain receipt', async () => {
  // Spawn vi-demo as a child; it must exit 0 and the stdout must mention the
  // verifier-summary checkmark line.
  const { spawn: spawnChild } = await import('node:child_process');
  const r = await new Promise((resolve, reject) => {
    const child = spawnChild('node', [path.join(PLUGIN_ROOT, 'scripts/vi-demo.mjs')], {
      env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('error', reject);
    child.on('close', (exit) => resolve({ exit, stdout, stderr }));
  });
  assert(r.exit === 0, `vi-demo.mjs exit 0 (got ${r.exit}; stderr: ${r.stderr.slice(-200)})`);
  assert(/Receipt iss === did:jwk/.test(r.stdout), 'demo prints the one-key-chain confirmation line');
  return { stdout_bytes: r.stdout.length };
});

if (hcsConfigured || evmConfigured) {
  await step('VERIFY: every receipt anchor matches Mirror Node payload', async () => {
    const cli = path.join(PLUGIN_ROOT, 'bin/zeroh-disclosure.mjs');
    const results = [];
    for (const n of [1, 2, 3]) {
      const receiptPath = path.join(sessionDir, `turn-${n}.json`);
      const verified = await runNode(cli, ['verify', '--receipt', receiptPath, '--json']);
      assert(verified.exit === 0, `turn-${n} verify exit 0 (got ${verified.exit}; stderr: ${verified.stderr.slice(-200)})`);
      const json = JSON.parse(verified.stdout);
      assert(json.anchor.status === 'anchored', `turn-${n} anchor status anchored (got ${json.anchor.status})`);
      assert(json.anchor.verified === true, `turn-${n} anchor payload verified`);
      results.push(`${n}:${json.anchor.type}:${json.anchor.tx_id || json.anchor.tx_hash}`);
    }
    return { anchors: results.join(' | ') };
  });
} else {
  console.log(yellow('  ⏭  anchor verification skipped (set ZEROH_ANCHOR=1 + HEDERA_* env to enable)'));
}

console.log();
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
if (failed === 0) {
  console.log(bold(green(`✓ All ${passed} checks passed.`)));
  console.log(dim('Cryptographic proof of disclosure-policy application is in:'));
  console.log(dim(`  ${path.join(sessionDir, 'turn-{1,2,3}.json')} (per-prompt receipts)`));
  console.log(dim(`  ${path.join(sessionDir, 'turn-3.proofpack.json')} (rollup)`));
} else {
  console.log(bold(red(`✗ ${failed} / ${results.length} checks failed.`)));
  for (const r of results.filter((r) => !r.pass)) console.log(red(`  ✗ ${r.name}: ${r.error}`));
}

if (!args.cwd && !args.keep) {
  await fs.rm(cwd, { recursive: true, force: true });
} else {
  console.log(dim(`(session dir kept at ${cwd})`));
}

process.exit(failed === 0 ? 0 : 1);

// helpers ---------------------------------------------------------------------

async function step(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    const detail = await fn();
    const det = Object.entries(detail || {}).map(([k, v]) => `${k}=${v}`).join('  ');
    console.log(green('✓ ') + (det ? dim(det) : ''));
    results.push({ name, pass: true });
  } catch (e) {
    console.log(red('✗ ') + red(e.message));
    if (e.stack && process.env.DEBUG) console.log(dim(e.stack));
    results.push({ name, pass: false, error: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function runHook(scriptPath, event, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {
      env: { ...process.env, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('error', reject);
    child.on('close', (exit) => {
      let json = null;
      const last = stdout.trim().split('\n').filter(Boolean).at(-1);
      if (last) {
        try { json = JSON.parse(last); } catch { /* leave null */ }
      }
      resolve({ exit, stdout, stderr, json });
    });
    child.stdin.end(JSON.stringify(event));
  });
}

function runNode(scriptPath, argv = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...argv], {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('error', reject);
    child.on('close', (exit) => resolve({ exit, stdout, stderr }));
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') out.cwd = path.resolve(argv[++i]);
    else if (a === '--keep') out.keep = true;
  }
  return out;
}
