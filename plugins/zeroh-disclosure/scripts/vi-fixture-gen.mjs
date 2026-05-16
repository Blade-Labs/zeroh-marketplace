#!/usr/bin/env node
// Generate the VI fixture set used by Phase E tests + the vi-demo.
// Produces in test/fixtures/vi/:
//   - issuer-key.json, issuer-jwks.json
//   - user-key.json,   user-jwks.json
//   - agent-key.json,  agent-jwks.json   (private + public; key reuse uses private)
//   - l1.sdjwt   (issuer → user, with user.cnf.jwk + selectively-disclosable email)
//   - l2.sdjwt   (user → agent,  with agent.cnf.jwk + 8 constraint examples,
//                  binds L1 via sd_hash)
//
// Mirrors VI's spec shape (Apache 2.0, pinned commit in lib/vi/README.md).
// All keys are synthetic — these fixtures are for tests, not production.
//
// Run:
//   node scripts/vi-fixture-gen.mjs
// Rerun any time the fixture format needs to change.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, calculateJwkThumbprint } from 'jose';
import { SDJwtVcInstance } from '@sd-jwt/sd-jwt-vc';
import { ES256, digest, generateSalt } from '@sd-jwt/crypto-nodejs';
import { sha256 } from '@noble/hashes/sha256';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_DIR = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'vi');

// argv: --agent-from-blade=<path-to-blade-agent.json>
//   When set, the bound agent JWK comes from a Blade bootstrap config blob
//   (Ed25519/OKP) instead of a synthetic ES256 keypair. The user-issuer
//   keypairs stay ES256 — only the agent's cnf.jwk changes shape.
//   Outputs land in *-blade.* files so the existing ES256 fixtures are
//   untouched (and the 28 pre-Phase-F-1 e2e checks keep passing).
const blFlag = process.argv.find((a) => a.startsWith('--agent-from-blade='));
const bladeConfigPath = blFlag ? blFlag.split('=')[1] : null;
const suffix = bladeConfigPath ? '-blade' : '';

await fs.mkdir(FIXTURE_DIR, { recursive: true });

const now = Math.floor(Date.now() / 1000);
const HOUR = 3600;
const DAY = 24 * HOUR;

// ---- issuer + user (always ES256) ------------------------------------------

const [issuer, user] = await Promise.all([
  makeKeyPair('issuer-key-1'),
  makeKeyPair('user-key-1'),
]);

// ---- agent: synthetic ES256 OR Ed25519 from Blade bootstrap config ----------

let agent;
if (bladeConfigPath) {
  const bladeCfg = JSON.parse(await fs.readFile(bladeConfigPath, 'utf8'));
  // Agent's PUBLIC half only — we never need to sign on behalf of the
  // agent in this fixture script; the user signs L2, and the Blade
  // wallet later signs receipts using the private half from blade-agent.json.
  agent = {
    pubJwk: bladeCfg.publicJwk,
    kid: bladeCfg.publicJwk.kid,
    thumbprint: await calculateJwkThumbprint(bladeCfg.publicJwk, 'sha256'),
    fromBlade: true,
    bladeDid: bladeCfg.did,
  };
  console.log(`✓ agent JWK sourced from ${bladeConfigPath}`);
  console.log(`  kty=${agent.pubJwk.kty} crv=${agent.pubJwk.crv} did=${agent.bladeDid}`);
} else {
  agent = await makeKeyPair('agent-key-1');
}

await writeJson(`issuer-jwks${suffix}.json`, { keys: [stripPriv(issuer.jwk)] });
await writeJson(`user-jwks${suffix}.json`,   { keys: [stripPriv(user.jwk)] });
await writeJson(`issuer-key${suffix}.json`,  issuer.jwk);
await writeJson(`user-key${suffix}.json`,    user.jwk);
if (!agent.fromBlade) {
  await writeJson('agent-jwks.json',  { keys: [stripPriv(agent.jwk)] });
  await writeJson('agent-key.json',   agent.jwk);
}

// ---- L1 (issuer → user) -----------------------------------------------------

const l1Payload = {
  iss: 'https://issuer.example.zeroh',
  sub: 'user-abc-123',
  iat: now,
  exp: now + 365 * DAY,
  vct: 'https://credentials.example.zeroh/card',
  cnf: { jwk: stripPriv(user.jwk) },
  pan_last_four: '1234',
  scheme: 'mastercard',
  email: 'alice@example.com', // selectively disclosable below
};
const l1Frame = { email: true };
const issuerSdjwt = await sdjwtFor(issuer);
const l1Compact = await issuerSdjwt.issue(l1Payload, l1Frame);
await fs.writeFile(path.join(FIXTURE_DIR, `l1${suffix}.sdjwt`), l1Compact);
console.log(`✓ l1${suffix}.sdjwt   (${l1Compact.length} bytes)`);

// ---- L2 (user → agent) ------------------------------------------------------
// We follow VI's *shape* but issue as a fresh SD-JWT signed by the user's key
// (which L1 binds via cnf.jwk). The user is the "issuer" of L2 to the agent.

const l1Hash = base64url(sha256(new TextEncoder().encode(l1Compact)));
const l2Payload = {
  iss: 'user-abc-123', // self-identifier; signature trust comes from L1.cnf.jwk
  aud: 'commerce',
  nonce: 'nonce-' + Math.random().toString(36).slice(2, 10),
  iat: now,
  exp: now + 30 * DAY,
  sd_hash: l1Hash,
  mode: 'autonomous',
  delegate_payload: {
    checkout_mandate: {
      vct: 'mandate.checkout.open.1',
      cnf: { jwk: agent.pubJwk ?? stripPriv(agent.jwk), kid: agent.kid },
      constraints: [
        {
          type: 'mandate.checkout.allowed_merchants',
          allowed: [
            { id: 'merchant-001', name: 'Test Coffee', website: 'https://coffee.example' },
          ],
        },
        {
          type: 'mandate.checkout.line_items',
          items: [{ id: 'sku-coffee', acceptable_items: ['sku-coffee'], quantity: 2 }],
          match_mode: 'subset',
        },
      ],
    },
    payment_mandate: {
      vct: 'mandate.payment.open.1',
      cnf: { jwk: agent.pubJwk ?? stripPriv(agent.jwk), kid: agent.kid },
      payment_instrument: { scheme: 'mastercard', pan_last_four: '1234' },
      constraints: [
        {
          type: 'mandate.payment.allowed_payees',
          allowed: [{ id: 'payee-001', name: 'Test Coffee' }],
        },
        {
          type: 'mandate.payment.amount_range',
          currency: 'USD',
          min: 100,
          max: 2000, // $20.00 in cents
        },
        {
          type: 'mandate.payment.budget',
          currency: 'USD',
          max: 5000,
        },
        {
          type: 'mandate.payment.recurrence',
          frequency: 'oneoff',
        },
        {
          type: 'mandate.payment.agent_recurrence',
          frequency: 'oneoff',
          max_occurrences: 1,
        },
        {
          type: 'mandate.payment.reference',
          conditional_transaction_id: 'binding-001',
        },
      ],
    },
  },
};
// Selectively disclose nothing for L2 to keep the fixture parseable from the
// raw payload — this is fine for our v1 chain check.
const userSdjwt = await sdjwtFor(user);
const l2Compact = await userSdjwt.issue(l2Payload, {});
await fs.writeFile(path.join(FIXTURE_DIR, `l2${suffix}.sdjwt`), l2Compact);
console.log(`✓ l2${suffix}.sdjwt   (${l2Compact.length} bytes)`);

// ---- mandate wrapper (one file ZEROH_VI_MANDATE_FILE can point at) -----------

await writeJson(`mandate${suffix}.json`, {
  version: '1',
  l1_compact: l1Compact,
  l2_compact: l2Compact,
  trusted_issuer_jwks: { keys: [stripPriv(issuer.jwk)] },
});

// ---- summary ----------------------------------------------------------------

console.log('\nFixtures written to', FIXTURE_DIR);
console.log('Pinned VI spec commit: see lib/vi/README.md');

// helpers ---------------------------------------------------------------------

async function makeKeyPair(kid) {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  const pubJwk = await exportJWK(publicKey);
  pubJwk.kid = kid;
  jwk.kid = kid;
  const thumb = await calculateJwkThumbprint(pubJwk, 'sha256');
  return { publicKey, privateKey, jwk, pubJwk, kid, thumbprint: thumb };
}

function stripPriv(jwk) {
  const { d, ...pub } = jwk;
  return pub;
}

async function sdjwtFor(keyPair) {
  const signer = await ES256.getSigner(keyPair.jwk);
  const verifier = await ES256.getVerifier(keyPair.pubJwk);
  return new SDJwtVcInstance({
    signer,
    verifier,
    signAlg: 'ES256',
    hasher: digest,
    hashAlg: 'sha-256',
    saltGenerator: generateSalt,
  });
}

async function writeJson(name, value) {
  await fs.writeFile(path.join(FIXTURE_DIR, name), JSON.stringify(value, null, 2) + '\n');
  console.log(`✓ ${name}`);
}

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
