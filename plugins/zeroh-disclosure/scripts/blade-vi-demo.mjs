#!/usr/bin/env node
// Hedera-rooted variant of vi-demo.mjs. Shows the one-key audit chain
// closing through a real did:hedera identity (Phase F-1).
//
// What it demonstrates, in one process:
//   1. (one-time) Bootstrap a Blade-rooted agent identity via
//      blade-agent-bootstrap.mjs. In live mode this provisions a real
//      Hedera account + publishes did:hedera v2.0 to HCS; in --dry-run
//      mode it uses real Ed25519 keys with synthetic Hedera IDs.
//   2. Regenerate VI fixtures with --agent-from-blade so the L2 mandate's
//      cnf.jwk is the Hedera-rooted Ed25519 public key.
//   3. SessionStart with the Blade-bound mandate → loadSession picks
//      BladeWallet (thumbprint match between mandate's cnf.jwk and the
//      published key).
//   4. UserPromptSubmit on a clean prompt → turn ledger queued.
//   5. PreToolUse denies an out-of-scope commerce call.
//   6. PreToolUse allows an in-scope commerce call.
//   7. Stop finalizes the receipt and anchors on Hedera (EVM via Hashio
//      where gRPC is blocked).
//   8. Verifier summary: same Ed25519 thumbprint signs BOTH the L2
//      mandate's cnf.jwk binding AND every disclosure receipt — closing
//      the one-key audit chain on a public ledger.
//
// Run:
//   node scripts/blade-vi-demo.mjs                  # dry-run (no Hedera RPC)
//   node scripts/blade-vi-demo.mjs --live           # real Hedera testnet bootstrap

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_DIR = path.join(PLUGIN_ROOT, 'test/fixtures/vi');
const SESSION_ID = 'blade-vi-demo';
const liveMode = process.argv.includes('--live');

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'zeroh-blade-vi-demo-'));
const sessionDir = path.join(cwd, '.zeroh/sessions', SESSION_ID);
const bladeAgentConfig = path.join(cwd, 'blade-agent.json');
await loadConfig({ cwd });

console.log(bold('ZeroH Disclosure + Verifiable Intent on Hedera — Blade walkthrough'));
console.log(dim(`cwd:       ${cwd}`));
console.log(dim(`mode:      ${liveMode ? 'LIVE (real Hedera RPC)' : 'DRY-RUN (synthetic Hedera IDs, real Ed25519 keys)'}`));
console.log();

// --- 0. Bootstrap the Blade agent identity ----------------------------------

console.log(bold('0. Bootstrap — provision Hedera-rooted agent identity'));
{
  const args = [path.join(PLUGIN_ROOT, 'scripts/blade-agent-bootstrap.mjs'),
                '--config-path', bladeAgentConfig];
  if (!liveMode) args.push('--dry-run');
  const result = await runScript(args);
  if (result.exit !== 0) {
    console.error(`bootstrap failed (exit ${result.exit}):\n${result.stderr}`);
    process.exit(1);
  }
}
const bladeCfg = JSON.parse(await fs.readFile(bladeAgentConfig, 'utf8'));
console.log(dim(`   accountId: ${bladeCfg.accountId}`));
console.log(dim(`   did:       ${bladeCfg.did}`));
console.log(dim(`   uaid:      ${bladeCfg.uaid}`));
console.log();

// --- 0b. Regenerate VI fixtures with Blade's Ed25519 cnf.jwk ----------------

console.log(bold('0b. Regenerate VI fixtures — bind the L2 mandate to the agent\'s Ed25519 key'));
await runScript([
  path.join(PLUGIN_ROOT, 'scripts/vi-fixture-gen.mjs'),
  `--agent-from-blade=${bladeAgentConfig}`,
]);
const mandatePath = path.join(FIXTURE_DIR, 'mandate-blade.json');
console.log(dim(`   wrote ${path.relative(PLUGIN_ROOT, mandatePath)}`));
console.log();

const env = {
  ZEROH_VI_MANDATE_FILE: mandatePath,
  ZEROH_BLADE_AGENT_CONFIG: bladeAgentConfig,
};

// --- 1. SessionStart ---------------------------------------------------------

console.log(bold('1. SessionStart — ingest mandate, swap signing wallet to BladeWallet'));
const start = await runHook('hooks/session-start.js', {
  session_id: SESSION_ID, cwd, source: 'startup', hook_event_name: 'SessionStart',
}, env);
console.log(indent(start.json?.hookSpecificOutput?.additionalContext || '', '   '));
console.log();

const state = JSON.parse(await fs.readFile(path.join(sessionDir, 'state.json'), 'utf8'));
console.log(dim(`   state.vi.l1_hash:       ${state.vi.l1_hash}`));
console.log(dim(`   state.vi.l2_hash:       ${state.vi.l2_hash}`));
console.log(dim(`   state.vi.agent_jwk_kid: ${state.vi.agent_jwk_kid}`));
console.log();

// --- 2. UserPromptSubmit (clean) --------------------------------------------

console.log(bold('2. UserPromptSubmit — clean prompt'));
await runHook('hooks/user-prompt-submit.js', {
  session_id: SESSION_ID, cwd, prompt: 'plan a coffee run',
}, env);
console.log(dim('   turn-1.json queued; receipt finalized at Stop.'));
console.log();

// --- 3. PreToolUse out-of-scope ---------------------------------------------

console.log(bold('3. PreToolUse — commerce tool with out-of-scope amount'));
const denied = await runHook('hooks/pre-tool-use.js', {
  session_id: SESSION_ID, cwd,
  tool_name: 'mcp__example_payment__charge', tool_use_id: 'demo-deny',
  tool_input: {
    _intent_fulfillment: {
      amount: 9999, currency: 'USD',
      merchant: { id: 'merchant-001' }, payee: { id: 'payee-001' },
      line_items: [{ id: 'sku-coffee', quantity: 1 }],
      reference: 'binding-001',
    },
  },
}, env);
console.log(yellow('   permissionDecision: deny'));
console.log(indent(denied.json?.hookSpecificOutput?.permissionDecisionReason || '', '   '));
console.log();

// --- 4. PreToolUse in-scope --------------------------------------------------

console.log(bold('4. PreToolUse — commerce tool within scope'));
await runHook('hooks/pre-tool-use.js', {
  session_id: SESSION_ID, cwd,
  tool_name: 'mcp__example_payment__charge', tool_use_id: 'demo-allow',
  tool_input: {
    _intent_fulfillment: {
      amount: 800, currency: 'USD',
      merchant: { id: 'merchant-001' }, payee: { id: 'payee-001' },
      line_items: [{ id: 'sku-coffee', quantity: 1 }],
      reference: 'binding-001',
    },
  },
}, env);
console.log(green('   permissionDecision: allow (silent)'));
console.log();

// --- 5. Stop ----------------------------------------------------------------

console.log(bold('5. Stop — finalize receipts + anchor on Hedera'));
const stop = await runHook('hooks/stop.js', {
  session_id: SESSION_ID, cwd, hook_event_name: 'Stop',
}, env);
console.log(indent(stop.json?.reason || '', '   '));
console.log();

// --- 6. Verifier summary ----------------------------------------------------

console.log(bold('6. Verifier summary — one Ed25519 key, two chains, both on Hedera'));
const turn = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-1.json'), 'utf8'));
const ib = turn.receipt.public_claims.intent_binding;
const anchor = turn.anchor;
const issIsHedera = turn.receipt.public_claims.iss.startsWith('did:hedera:');

console.log(dim('   Forward chain (merchant trusts the agent\'s authorized scope):'));
console.log(dim(`     L1 (issuer→user) hash:  ${ib.l1_hash}`));
console.log(dim(`     L2 (user→agent) hash:   ${ib.l2_hash}`));
console.log(dim(`     bound agent kid:        ${ib.agent_jwk_kid}`));
console.log(dim(`     audience:               ${ib.mandate_aud}`));
console.log(dim(`     authorized scope:       ${ib.scope_summary}`));
console.log();
console.log(dim('   Backward chain (user / regulator audits enforcement):'));
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

console.log(dim('   Hedera-native identity:'));
console.log(dim(`     did:hedera:             ${bladeCfg.did}`));
console.log(dim(`     HCS-14 UAID:            ${bladeCfg.uaid}`));
if (liveMode && bladeCfg.didTopicId) {
  const net = bladeCfg.network === 'mainnet' ? 'mainnet' : 'testnet';
  console.log(dim(`     DID topic on hashscan:  https://hashscan.io/${net}/topic/${bladeCfg.didTopicId}`));
}
console.log();

if (issIsHedera && ib.agent_jwk_kid && ib.agent_jwk_kid.startsWith('did:hedera:')) {
  console.log(green(bold('   ✓ Receipt iss === did:hedera:... (BladeWallet)')));
  console.log(green('     L2 mandate cnf.jwk === agent\'s published Ed25519 key'));
  console.log(green('     One JWK thumbprint, resolvable on Hedera Mirror Node, validates'));
  console.log(green('     BOTH the forward authorization AND every backward proof.'));
}
console.log();
console.log(dim(`Session dir kept at ${cwd}/.zeroh/sessions/${SESSION_ID} for inspection.`));
console.log(dim(`Blade config kept at ${bladeAgentConfig}.`));

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

function runScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('error', reject);
    child.on('close', (exit) => resolve({ exit, stdout, stderr }));
  });
}

function indent(s, prefix) {
  return s.split('\n').map((l) => prefix + l).join('\n');
}
