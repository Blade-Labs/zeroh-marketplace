// Load + verify a VI mandate at SessionStart. Priority:
//   1. process.env.ZEROH_VI_MANDATE_FILE  (absolute path to a wrapper JSON)
//   2. <project>/.zeroh.intent             (project-local override)
//
// The wrapper JSON shape (version "1"):
//   {
//     "version": "1",
//     "l1_compact": "<compact SD-JWT>",
//     "l2_compact": "<compact SD-JWT>",
//     "trusted_issuer_jwks": { "keys": [...] }
//   }
//
// On verify success, returns a compact `vi` block ready to be stored in
// session.state.vi and surfaced via SessionStart additionalContext.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { calculateJwkThumbprint } from 'jose';
import { verifyChain } from './verify.js';

/**
 * @param {object} opts
 * @param {string=} opts.cwd
 * @param {number=} opts.now            unix seconds; defaults to Date.now()/1000
 * @param {string=} opts.expectedAud    default 'commerce'
 * @param {string=} opts.mandateFile
 * @returns {Promise<{
 *   present: false
 * } | {
 *   present: true, ok: true, source: string, vi: object
 * } | {
 *   present: true, ok: false, source: string, errors: string[]
 * }>}
 */
export async function ingestMandate({ cwd, now, expectedAud = 'commerce', mandateFile = null } = {}) {
  const found = await locate({ cwd, mandateFile });
  if (!found) return { present: false };

  let wrapper;
  try {
    const raw = await fs.readFile(found.path, 'utf8');
    wrapper = JSON.parse(raw);
  } catch (e) {
    return { present: true, ok: false, source: found.path, errors: [`mandate file unreadable: ${e.message}`] };
  }

  if (wrapper.version !== '1') {
    return {
      present: true, ok: false, source: found.path,
      errors: [`unknown mandate wrapper version ${wrapper.version}; expected "1"`],
    };
  }
  if (!wrapper.l1_compact || !wrapper.l2_compact || !wrapper.trusted_issuer_jwks) {
    return {
      present: true, ok: false, source: found.path,
      errors: ['mandate wrapper missing l1_compact / l2_compact / trusted_issuer_jwks'],
    };
  }

  const r = await verifyChain({
    l1Compact: wrapper.l1_compact,
    l2Compact: wrapper.l2_compact,
    trustedIssuerJwks: wrapper.trusted_issuer_jwks,
    expectedAud,
    now,
  });
  if (!r.ok) return { present: true, ok: false, source: found.path, errors: r.errors };

  const vi = await buildSessionViBlock(r, wrapper, found.path);
  return { present: true, ok: true, source: found.path, vi };
}

async function locate({ cwd, mandateFile }) {
  if (mandateFile) {
    try {
      await fs.access(mandateFile);
      return { path: mandateFile, via: 'argument' };
    } catch {
      return null;
    }
  }
  const envPath = process.env.ZEROH_VI_MANDATE_FILE;
  if (envPath) {
    try {
      await fs.access(envPath);
      return { path: envPath, via: 'env' };
    } catch {
      return null;
    }
  }
  if (cwd) {
    const dot = path.join(cwd, '.zeroh.intent');
    try {
      await fs.access(dot);
      return { path: dot, via: 'dotfile' };
    } catch {}
  }
  return null;
}

async function buildSessionViBlock(r, wrapper, source) {
  const { l1Hash, l2Hash, l1Payload, l2Payload, agentJwk } = r;
  const agentJwkKid = agentJwk?.kid ?? (agentJwk ? await calculateJwkThumbprint(agentJwk, 'sha256') : null);

  const checkoutConstraints = l2Payload.delegate_payload?.checkout_mandate?.constraints || [];
  const paymentConstraints = l2Payload.delegate_payload?.payment_mandate?.constraints || [];

  return {
    l1_hash: l1Hash,
    l2_hash: l2Hash,
    l2_nonce: l2Payload.nonce ?? null,
    mandate_aud: l2Payload.aud ?? null,
    agent_jwk_kid: agentJwkKid,
    agent_jwk: agentJwk ?? null, // Public half only — used by Phase E.6 to
                                 // validate ZEROH_VI_AGENT_KEY_FILE matches
                                 // the mandate's bound key.
    issuer: l1Payload.iss ?? null,
    user_sub: l1Payload.sub ?? null,
    mode: l2Payload.mode ?? null,
    expiry: l2Payload.exp ?? null,
    source,
    evidence: {
      l1_compact: wrapper.l1_compact,
      l2_compact: wrapper.l2_compact,
      trusted_issuer_jwks: wrapper.trusted_issuer_jwks,
    },
    scope_summary: summariseScope(checkoutConstraints, paymentConstraints),
    constraints: { checkout: checkoutConstraints, payment: paymentConstraints },
  };
}

function summariseScope(checkout, payment) {
  const bits = [];
  const merchants = checkout.find((c) => c.type === 'mandate.checkout.allowed_merchants');
  if (merchants?.allowed?.length) {
    bits.push(`merchants:[${merchants.allowed.map((m) => m.name || m.id).join(',')}]`);
  }
  const amount = payment.find((c) => c.type === 'mandate.payment.amount_range');
  if (amount) bits.push(`amount:${amount.min}-${amount.max} ${amount.currency}`);
  const budget = payment.find((c) => c.type === 'mandate.payment.budget');
  if (budget) bits.push(`budget≤${budget.max} ${budget.currency}`);
  const summary = bits.join(' · ');
  return summary.length > 120 ? summary.slice(0, 117) + '…' : summary;
}
