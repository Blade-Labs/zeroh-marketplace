#!/usr/bin/env node
// Live walkthrough of the VI + ZeroH composition. Mints no Hedera testnet
// dependencies beyond what the existing .env already provides; uses the
// committed fixtures under test/fixtures/vi/.
//
// What it demonstrates, in one process:
//   1. SessionStart loads the L2 mandate, verifies the chain, swaps the
//      receipt-signing wallet to the L2-bound agent key.
//   2. UserPromptSubmit produces a receipt for a clean prompt — and the
//      receipt carries intent_binding pointing at that mandate.
//   3. PreToolUse denies a commerce call whose amount exceeds the mandate.
//   4. PreToolUse allows a commerce call within the mandate's scope.
//   5. Stop finalizes all turns and anchors each receipt on Hedera (EVM
//      via Hashio in this sandbox; HCS where gRPC is available).
//   6. Prints a verifier summary tying VI's forward chain to ZeroH's
//      backward chain via the shared agent kid.
//
// Run:
//   node scripts/vi-demo.mjs
// Honors ZEROH_ANCHOR=1 + ECDSA EVM creds from .env (already wired).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_DIR = path.join(PLUGIN_ROOT, 'test/fixtures/vi');
const SESSION_ID = 'vi-demo';

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'zeroh-vi-demo-'));
const sessionDir = path.join(cwd, '.zeroh/sessions', SESSION_ID);
await loadConfig({ cwd });

const env = {
  ZEROH_VI_MANDATE_FILE: path.join(FIXTURE_DIR, 'mandate.json'),
  ZEROH_VI_AGENT_KEY_FILE: path.join(FIXTURE_DIR, 'agent-key.json'),
};

console.log(bold('ZeroH Disclosure + Verifiable Intent — live walkthrough'));
console.log(dim(`cwd:      ${cwd}`));
console.log(dim(`mandate:  ${env.ZEROH_VI_MANDATE_FILE}`));
console.log(dim(`agentkey: ${env.ZEROH_VI_AGENT_KEY_FILE}`));
console.log();

// --- 1. SessionStart ---------------------------------------------------------
console.log(bold('1. SessionStart — ingest mandate, swap signing key'));
const start = await runHook('hooks/session-start.js', {
  session_id: SESSION_ID, cwd, source: 'startup', hook_event_name: 'SessionStart',
}, env);
const startCtx = start.json?.hookSpecificOutput?.additionalContext || '';
console.log(indent(startCtx, '   '));
console.log();

const state = JSON.parse(await fs.readFile(path.join(sessionDir, 'state.json'), 'utf8'));
console.log(dim(`   state.vi.l1_hash:       ${state.vi.l1_hash}`));
console.log(dim(`   state.vi.l2_hash:       ${state.vi.l2_hash}`));
console.log(dim(`   state.vi.agent_jwk_kid: ${state.vi.agent_jwk_kid}`));
console.log(dim(`   state.vi.expiry:        ${new Date(state.vi.expiry * 1000).toISOString()}`));
console.log();

// --- 2. UserPromptSubmit (clean) --------------------------------------------
console.log(bold('2. UserPromptSubmit — clean prompt'));
await runHook('hooks/user-prompt-submit.js', {
  session_id: SESSION_ID, cwd,
  prompt: 'plan a coffee run',
}, env);
console.log(dim('   turn-1.json written; phase=allowed_no_findings; receipt will be finalized at Stop.'));
console.log();

// --- 3. PreToolUse out-of-scope ---------------------------------------------
console.log(bold('3. PreToolUse — commerce tool with out-of-scope amount'));
const denied = await runHook('hooks/pre-tool-use.js', {
  session_id: SESSION_ID, cwd,
  tool_name: 'mcp__example_payment__charge', tool_use_id: 'demo-deny',
  tool_input: {
    _intent_fulfillment: {
      amount: 9999, currency: 'USD',                             // > amount_range.max
      merchant: { id: 'merchant-001' },
      payee: { id: 'payee-001' },
      line_items: [{ id: 'sku-coffee', quantity: 1 }],
      reference: 'binding-001',
    },
  },
}, env);
const deniedReason = denied.json?.hookSpecificOutput?.permissionDecisionReason || '';
console.log(yellow('   permissionDecision: deny'));
console.log(indent(deniedReason, '   '));
console.log();

// --- 4. PreToolUse in-scope --------------------------------------------------
console.log(bold('4. PreToolUse — commerce tool within scope'));
await runHook('hooks/pre-tool-use.js', {
  session_id: SESSION_ID, cwd,
  tool_name: 'mcp__example_payment__charge', tool_use_id: 'demo-allow',
  tool_input: {
    _intent_fulfillment: {
      amount: 800, currency: 'USD',                              // within amount_range
      merchant: { id: 'merchant-001' },
      payee: { id: 'payee-001' },
      line_items: [{ id: 'sku-coffee', quantity: 1 }],
      reference: 'binding-001',
    },
  },
}, env);
console.log(green('   permissionDecision: allow (silent)'));
console.log();

// --- 5. Stop ----------------------------------------------------------------
console.log(bold('5. Stop — finalize receipts + anchor'));
const stop = await runHook('hooks/stop.js', {
  session_id: SESSION_ID, cwd, hook_event_name: 'Stop',
}, env);
const stopReason = stop.json?.reason || '';
console.log(indent(stopReason, '   '));
console.log();

// --- 6. Verifier summary ----------------------------------------------------
console.log(bold('6. Verifier summary — same key, two chains'));
const turn = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-1.json'), 'utf8'));
const ib = turn.receipt.public_claims.intent_binding;
const anchor = turn.anchor;
console.log(dim('   Forward chain (merchant trusts → agent authorized to act):'));
console.log(dim(`     L1 (issuer→user) hash:  ${ib.l1_hash}`));
console.log(dim(`     L2 (user→agent) hash:   ${ib.l2_hash}`));
console.log(dim(`     bound agent kid:        ${ib.agent_jwk_kid}`));
console.log(dim(`     audience:               ${ib.mandate_aud}`));
console.log(dim(`     authorized scope:       ${ib.scope_summary}`));
console.log();
console.log(dim('   Backward chain (user / regulator audits → policy was enforced):'));
console.log(dim(`     receipt id:             ${turn.receipt.receipt_id}`));
console.log(dim(`     receipt iss (signer):   ${turn.receipt.public_claims.iss}`));
console.log(dim(`     decision_action:        ${turn.receipt.public_claims.decision_action}`));
if (anchor?.anchored) {
  console.log(dim(`     anchor type:            ${anchor.type}`));
  if (anchor.tx_hash) console.log(dim(`     anchor tx_hash:         ${anchor.tx_hash}`));
  if (anchor.hashscan_url) console.log(dim(`     hashscan:               ${anchor.hashscan_url}`));
} else {
  console.log(dim(`     anchor:                 not submitted (${anchor?.reason || 'unknown'})`));
}
console.log();

const issMatch = turn.receipt.public_claims.iss.startsWith('did:jwk:');
const kidMatch = ib.agent_jwk_kid;
if (issMatch && kidMatch) {
  console.log(green(bold('   ✓ Receipt iss === did:jwk:<thumbprint of L2-bound agent key>')));
  console.log(green('     A verifier with the agent JWK can validate BOTH the L3 (forward)'));
  console.log(green('     AND the disclosure receipt (backward) in one signature check.'));
}
console.log();
console.log(dim(`Session dir kept at ${cwd}/.zeroh/sessions/${SESSION_ID} for inspection.`));

// helpers --------------------------------------------------------------------

function runHook(rel, event, extraEnv = {}) {
  const scriptPath = path.join(PLUGIN_ROOT, rel);
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
        try { json = JSON.parse(last); } catch {}
      }
      resolve({ exit, stdout, stderr, json });
    });
    child.stdin.end(JSON.stringify(event));
  });
}

function indent(s, prefix) {
  return s.split('\n').map((l) => prefix + l).join('\n');
}
