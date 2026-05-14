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

await step('SessionStart', async () => {
  const out = await runHook(HOOKS.sessionStart, {
    session_id: SESSION_ID, cwd, source: 'startup', hook_event_name: 'SessionStart',
  });
  const ctx = out.json?.hookSpecificOutput?.additionalContext;
  assert(typeof ctx === 'string' && ctx.includes('ZeroH Disclosure'), 'additionalContext set');
  return { ctx_first_line: ctx.split('\n')[0] };
});

let blockedPrompt = null, maskedRewrite = null;

await step('UserPromptSubmit (clean prompt)', async () => {
  const out = await runHook(HOOKS.userPromptSubmit, {
    session_id: SESSION_ID, cwd,
    prompt: 'write me a haiku about coffee',
  });
  assert(out.exit === 0, 'exit 0');
  assert(out.stdout.trim() === '', 'silent (no JSON output)');
  return {};
});

await step('UserPromptSubmit (PII prompt → block)', async () => {
  blockedPrompt = 'contact alice@example.com about her card 4532 0151 1283 0366';
  const out = await runHook(HOOKS.userPromptSubmit, {
    session_id: SESSION_ID, cwd, prompt: blockedPrompt,
  });
  assert(out.exit === 0, 'exit 0');
  assert(out.json?.decision === 'block', 'decision=block');
  assert(out.json?.reason?.includes('Detected 2'), 'reason mentions 2 items');
  const turnFile = path.join(sessionDir, 'turn-1.json');
  const turn = JSON.parse(await fs.readFile(turnFile, 'utf8'));
  assert(turn.phase === 'blocked_pending_user_resubmit', 'turn phase blocked_pending_user_resubmit');
  assert(turn.findings.length === 2, '2 findings recorded');
  maskedRewrite = turn.sanitized_text;
  return { turn: 1, findings: turn.findings.map((f) => f.type).join(','), masked: maskedRewrite };
});

await step('UserPromptSubmit (masked re-submit → token-map context)', async () => {
  const out = await runHook(HOOKS.userPromptSubmit, {
    session_id: SESSION_ID, cwd, prompt: maskedRewrite,
  });
  const ctx = out.json?.hookSpecificOutput?.additionalContext || '';
  assert(ctx.includes('[CARD_NUMBER-'), 'token map includes CARD_NUMBER');
  assert(ctx.includes('[EMAIL-'), 'token map includes EMAIL');
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

await step('Stop hook → finalize receipt + ProofPack', async () => {
  const out = await runHook(HOOKS.stop, {
    session_id: SESSION_ID, cwd, hook_event_name: 'Stop',
  });
  assert(out.exit === 0, 'exit 0');
  const turnFile = path.join(sessionDir, 'turn-1.json');
  const turn = JSON.parse(await fs.readFile(turnFile, 'utf8'));
  assert(turn.phase === 'finalized', 'turn phase finalized');
  return { receipt_id: turn?.receipt?.receipt_id || '(none)' };
});

await step('VERIFY: receipt proves policy was applied', async () => {
  const turn = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-1.json'), 'utf8'));
  const claims = turn.receipt.public_claims;
  assert(claims.policy_id === 'qcb-ai-disclosure-v1', 'policy_id matches');
  assert(typeof claims.policy_hash === 'string' && claims.policy_hash.length > 20, 'policy_hash present');
  assert(typeof claims.detector_hash === 'string' && claims.detector_hash.length > 20, 'detector_hash present');
  assert(typeof claims.boundary_hash === 'string' && claims.boundary_hash.length > 20, 'boundary_hash present');
  assert(claims.decision_action === 'approval_required', 'decision_action=approval_required');
  assert(Array.isArray(claims.detected_categories) && claims.detected_categories.length === 2, '2 detected categories');
  assert(claims.iss?.startsWith('did:hedera:'), 'iss is did:hedera');
  return {
    receipt_id: claims.receipt_id, decision: claims.decision_action,
    policy_hash: claims.policy_hash.slice(0, 12) + '…',
    detector_hash: claims.detector_hash.slice(0, 12) + '…',
    iss: claims.iss,
  };
});

await step('VERIFY: SD-JWT signature structure', async () => {
  const turn = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-1.json'), 'utf8'));
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

await step('VERIFY: ProofPack rolls up receipt', async () => {
  const pp = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-1.proofpack.json'), 'utf8'));
  assert(pp.schema === 'zeroh-proofpack/v1', 'schema=zeroh-proofpack/v1');
  assert(pp.summary?.receipts_count === 1, 'rolls up 1 receipt');
  assert(typeof pp.proofpack_hash === 'string' && pp.proofpack_hash.length > 20, 'proofpack_hash present');
  return { receipts: pp.summary.receipts_count, hash: pp.proofpack_hash.slice(0, 12) + '…' };
});

const fullyConfigured = process.env.ZEROH_ANCHOR === '1'
  && process.env.HEDERA_OPERATOR_ID
  && process.env.HEDERA_OPERATOR_KEY
  && process.env.HEDERA_TOPIC_ID;
if (fullyConfigured) {
  await step('VERIFY: live HCS anchor on Mirror Node', async () => {
    const turn = JSON.parse(await fs.readFile(path.join(sessionDir, 'turn-1.json'), 'utf8'));
    const anchor = turn.anchor;
    assert(anchor?.submitted === true, `anchor submitted (got: ${anchor?.reason || 'no anchor field'})`);
    assert(anchor?.tx_id, 'tx_id present');
    return { tx_id: anchor.tx_id, topic_id: anchor.topic_id };
  });
} else {
  const missing = [];
  if (process.env.ZEROH_ANCHOR !== '1') missing.push('ZEROH_ANCHOR=1');
  if (!process.env.HEDERA_OPERATOR_ID) missing.push('HEDERA_OPERATOR_ID');
  if (!process.env.HEDERA_OPERATOR_KEY) missing.push('HEDERA_OPERATOR_KEY');
  if (!process.env.HEDERA_TOPIC_ID) missing.push('HEDERA_TOPIC_ID (run scripts/finalize-anchor-setup.mjs)');
  console.log(yellow(`  ⏭  anchor verification skipped (missing: ${missing.join(', ')})`));
}

console.log();
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
if (failed === 0) {
  console.log(bold(green(`✓ All ${passed} checks passed.`)));
  console.log(dim('Cryptographic proof of disclosure-policy application is in:'));
  console.log(dim(`  ${path.join(sessionDir, 'turn-1.json')}`));
  console.log(dim(`  ${path.join(sessionDir, 'turn-1.proofpack.json')}`));
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

function runHook(scriptPath, event) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
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
