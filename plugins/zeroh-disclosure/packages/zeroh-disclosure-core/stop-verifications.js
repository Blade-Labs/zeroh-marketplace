// SPDX-License-Identifier: AGPL-3.0-only

import { writeReceiptJson } from './receipt-sink.js';
// Stop's HTML receipt reuses verification of unchanged historical receipts.
// Cache results are signed by this session's key, and bound to the complete
// ledger, its predecessor, the current policy and the local unmask key. The
// CLI always verifies fresh. Previews and displayed counts are never cached.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { allowKeyPath } from './allow-rules.js';
import { canonicalJson, sha256B64u } from './crypto.js';
import { policyById, policyHash } from './policy.js';
import { keptReceiptManifest } from './receipt-keep.js';
import {
  createSignedReceipt,
  verifyCompactReceiptSignature,
} from './selective-disclosure.js';
import { readJson } from './session.js';
import {
  receiptRecordToArtifact,
  verifyReceiptArtifactObject,
} from './verify-receipt.js';

const SCHEMA = 'zeroh-stop-verifications/v1';

// A plugin update can change verification without changing the policy ID.
// Bind cached verdicts to the implementation as well as the receipt inputs.
const VERIFIER_FILES = [
  'verify-receipt.js',
  'receipt-artifact.js',
  'selective-disclosure.js',
  'crypto.js',
  'turn-summary.js',
  'receipt-keep.js',
  'unmask.js',
  'allow-rules.js',
  'policy.js',
  'policies/zeroh-disclosure.v1.js',
  'boundary.js',
  'report-counts.js',
  'report-slip.js',
  'unchecked.js',
  'stop-verifications.js',
];
const verifierDigest = Promise.all(
  VERIFIER_FILES.map(async (name) =>
    sha256B64u(await readFile(new URL(name, import.meta.url))),
  ),
)
  .then((hashes) => sha256B64u(canonicalJson(hashes)))
  .catch(() => null);

async function cachedRecords(file, session, implementation) {
  try {
    const cache = await readJson(file);
    const { jwk } = await session.signingKey.getPublicKey();
    const result = await verifyCompactReceiptSignature(cache.compact, jwk);
    if (
      !implementation ||
      result.payload.implementation !== implementation ||
      !result.ok ||
      result.payload.schema !== SCHEMA ||
      result.payload.dir !== session.dir
    )
      return {};
    return result.payload.records ?? {};
  } catch {
    return {};
  }
}

async function fingerprints(entries, digestPolicy) {
  const allowKey = await readFile(allowKeyPath()).catch(() => null);
  const allowKeyHash = allowKey ? await sha256B64u(allowKey) : null;
  const hashes = new Map(
    await Promise.all(
      entries.map(async (entry) => [
        entry.turn,
        // A content fingerprint need not sort every nested claim: stable
        // JSON serialization binds all values just as strongly. Reordering
        // keys merely causes a safe extra verification, never a cache hit.
        await sha256B64u(JSON.stringify(entry.ledger)),
      ]),
    ),
  );
  const policies = new Map();
  const manifest = keptReceiptManifest(entries[0]?.file);
  const keptRecords = new Map(
    entries.map((entry) => {
      const record = manifest?.receipts?.[entry.ledger?.receipt?.receipt_id];
      return [
        entry.turn,
        record ? { ...record, ['kept_at']: manifest.kept_at } : null,
      ];
    }),
  );
  const digests = new Map(
    await Promise.all(
      entries.map(async (entry) => {
        const policy = entry.ledger?.receipt?.public_claims?.policy_id;
        if (!policies.has(policy))
          policies.set(
            policy,
            Promise.resolve()
              .then(() => digestPolicy(policy))
              .catch(() => null),
          );
        const fingerprint = await sha256B64u(
          canonicalJson({
            ledger: hashes.get(entry.turn),
            previous: hashes.get(entry.turn - 1) ?? null,
            policy: await policies.get(policy),
            allowKeyHash,
            keptRecord: keptRecords.get(entry.turn),
          }),
        );
        return [entry.turn, fingerprint];
      }),
    ),
  );
  return { digests, allowKey, keptRecords };
}

// Verify exactly the records that were fingerprinted. Reopening a live
// file here could sign a verdict for different bytes than the cached digest.
export function verifyStopSnapshot(
  file,
  { ledger, previousLedger, allowKey, keptRecord },
) {
  const turn = Number(path.basename(file).match(/^turn-(\d+)\.json$/u)?.[1]);
  const previousFile = path.join(path.dirname(file), `turn-${turn - 1}.json`);
  const previousArtifact = previousLedger
    ? receiptRecordToArtifact(previousLedger, previousFile)
    : null;
  return verifyReceiptArtifactObject(receiptRecordToArtifact(ledger, file), {
    verifySessionChain: true,
    previousArtifact,
    allowKey,
    keptRecord,
  });
}

export async function verifyStopReceipts({
  session,
  entries,
  verify = verifyStopSnapshot,
  digestPolicy = (id) => policyHash(policyById(id)),
  implementation = verifierDigest,
}) {
  implementation = await implementation;
  const file = path.join(session.dir, 'stop-verifications.json');
  const cached = await cachedRecords(file, session, implementation);
  const { digests, allowKey, keptRecords } = await fingerprints(
    entries,
    digestPolicy,
  );
  const ledgers = new Map(entries.map((entry) => [entry.turn, entry.ledger]));
  const records = {};
  const verifications = new Map();
  await Promise.all(
    entries
      .filter((entry) => entry.ledger)
      .map(async (entry) => {
        const fingerprint = digests.get(entry.turn);
        const prior = cached[entry.turn];
        let verification;
        if (prior?.fingerprint === fingerprint)
          verification = prior.verification;
        else {
          try {
            const fresh = await verify(entry.file, {
              ledger: entry.ledger,
              previousLedger: ledgers.get(entry.turn - 1) ?? null,
              allowKey,
              keptRecord: keptRecords.get(entry.turn),
            });
            // Only the report's verdict is retained, never remote content,
            // previews or unsanitized labels from the ledger.
            verification = {
              ok: fresh.ok,
              coverage: fresh.coverage,
              failed: fresh.failed,
              checks: fresh.checks
                ?.filter((check) => check.name === 'signature')
                .map(({ name, ok }) => ({ name, ok })),
            };
          } catch {
            verifications.set(entry.turn, { ok: false, checks: [] });
            return; // Transient read failures must be retried next Stop.
          }
        }
        records[entry.turn] = { fingerprint, verification };
        verifications.set(entry.turn, verification);
      }),
  );
  const signed = await createSignedReceipt({
    signer: session.signingKey,
    publicClaims: { schema: SCHEMA, dir: session.dir, implementation, records },
    selectiveClaims: {},
  });
  await writeReceiptJson(file, { compact: signed.compact });
  return verifications;
}
