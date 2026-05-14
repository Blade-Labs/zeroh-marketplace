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
// Honors ZEROH_ANCHOR=1 + HEDERA_OPERATOR_* env vars: if set, the Stop hook
// submits to live HCS and the runner verifies the topic message.

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

await step('Commerce tool denied when mandate active but _intent_fulfillment is missing', async () => {
  const out = await runHook(HOOKS.preToolUse, {
    session_id: 'e2e-vi-ok', cwd,
    tool_name: 'mcp__example_checkout__buy', tool_use_id: 'e2e-cm-2',
    tool_input: { url: 'https://coffee.example/api/buy' },
  });
  const hso = out.json?.hookSpecificOutput;
  assert(hso?.permissionDecision === 'deny', 'permissionDecision=deny');
  assert(/must declare an _intent_fulfillment/.test(hso.permissionDecisionReason),
    `reason mentions missing _intent_fulfillment`);
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
  assert(out.exit === 0, 'exit 0');
  assert(out.json?.decision === 'block', 'decision=block');
  assert(out.json?.reason?.includes('Detected 2'), 'reason mentions 2 items');
  const turn2 = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-2.json'), 'utf8'));
  assert(turn2.phase === 'blocked_pending_user_resubmit', 'turn-2 phase blocked');
  assert(turn2.findings.length === 2, '2 findings recorded');
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

if (hcsConfigured || evmConfigured) {
  await step('VERIFY: every receipt is anchored on Mirror Node', async () => {
    const network = process.env.HEDERA_NETWORK || 'testnet';
    const mirrorBase = network === 'mainnet'
      ? 'https://mainnet-public.mirrornode.hedera.com'
      : 'https://testnet.mirrornode.hedera.com';
    const results = [];
    for (const n of [1, 2, 3]) {
      const turn = JSON.parse(await fs.readFile(path.join(sessionDir, `turn-${n}.json`), 'utf8'));
      const anchor = turn.anchor;
      assert(anchor?.anchored === true, `turn-${n} anchored (got: ${anchor?.reason || anchor?.error || 'not anchored'})`);
      if (anchor.type !== 'evm') {
        results.push(`${n}:hcs:${anchor.tx_id}`);
        continue;
      }
      const start = Date.now();
      const deadline = start + 20_000;
      let found = false;
      while (Date.now() < deadline) {
        const r = await fetch(`${mirrorBase}/api/v1/contracts/results/${anchor.tx_hash}`);
        if (r.ok) {
          const j = await r.json();
          if (j?.hash) { results.push(`${n}:evm:block ${j.block_number}`); found = true; break; }
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!found) throw new Error(`turn-${n} EVM tx ${anchor.tx_hash} not visible within 20s`);
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

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') out.cwd = path.resolve(argv[++i]);
    else if (a === '--keep') out.keep = true;
  }
  return out;
}
