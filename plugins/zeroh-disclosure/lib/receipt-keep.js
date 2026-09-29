// SPDX-License-Identifier: AGPL-3.0-only

// Uninstall keeps the receipts (owner decision, 2026-09-28). Everything else
// ZeroH keeps on this machine goes; every signed receipt, each session's
// receipt.html and receipt bundle, and exactly what verifying them later
// needs (each session's PUBLIC signing key) move to one folder outside
// ZEROH_HOME, so ZEROH_HOME itself can be deleted:
//
//   <ZEROH_RECEIPTS_DIR>                  when set, else
//   <ZEROH_HOME>-receipts                 when ZEROH_HOME is set, else
//   ~/ZeroH Receipts                      macOS and Linux
//   %LOCALAPPDATA%\ZeroH Receipts         Windows (beside %LOCALAPPDATA%\ZeroH)
//
// Laid out as ZEROH_HOME lays them out, projects/<project>/sessions/<id>/,
// with a README.txt and a manifest (zeroh-receipts.json). Receipts never
// hold a value: a turn that Stop had not finalised loses its `local_private`
// part (the key behind the value commitments), no private signing key, vault,
// key or allow list is copied, and receipt.html is written again without the
// value previews the original shows from the vault. A second uninstall adds
// to the folder; a new install never reads or changes it.
//
// One check of a receipt needs a secret: its unmask record is authenticated
// with an HMAC under the local allow-list key, which uninstall deletes. That
// check is done here, with the key, before it goes; the manifest records the
// result per receipt. A result alone proves nothing about the file later
// (Astra pre-1.0.0 R6), so a verified record is also bound to the exact
// unmask record kept: an attestation signed with the session's receipt
// signing key, before its private half is deleted, over the hash of
// `revealed_under_grant` and its HMAC. `verify` checks that attestation with
// the receipt's public key for a kept receipt, and reports the check as
// unavailable (not passed) when there is none (lib/verify-receipt.js). Node
// built-ins only.
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allowKeyPath, signatureFor, signaturesMatch } from './allow-rules.js';
import { canonicalJson, importPrivateJwk, sha256B64u } from './crypto.js';
import { createSignedReceipt } from './selective-disclosure.js';
import { LocalSigningKey } from './signing-key.js';
import { zerohHome } from './vault.js';

export const KEPT_MANIFEST = 'zeroh-receipts.json';
export const KEPT_SCHEMA = 'zeroh-kept-receipts/v1';
const KEPT_README = 'README.txt';
export const KEPT_REVEAL_SCHEMA = 'zeroh-kept-reveal-record/v1';

// The hash an attestation binds: the unmask record exactly as kept.
export async function keptRevealDigest(receipt) {
  return sha256B64u(
    canonicalJson({
      revealed_under_grant: receipt?.revealed_under_grant ?? null,
      revealed_under_grant_hmac: receipt?.revealed_under_grant_hmac ?? null,
    }),
  );
}

// The session's receipt signing key, while its private half exists; null
// when it doesn't (never created here).
async function sessionSigner(sessionDir) {
  const record = readJsonFile(path.join(sessionDir, 'signing-key.json'));
  const privateJwk = readJsonFile(
    path.join(sessionDir, 'signing-key.private.json'),
  );
  if (!record?.publicJwk || !privateJwk) return null;
  try {
    return new LocalSigningKey({
      keyId: record.keyId ?? null,
      publicKey: null,
      privateKey: await importPrivateJwk(privateJwk),
      publicJwk: record.publicJwk,
    });
  } catch {
    return null;
  }
}

// Signed by the receipt's own key: this receipt's unmask record was
// verified with the local key, and it is exactly these bytes.
async function revealAttestation(receipt, signer) {
  const signed = await createSignedReceipt({
    signer,
    publicClaims: {
      schema: KEPT_REVEAL_SCHEMA,
      receipt_id: receipt.receipt_id,
      receipt_hash:
        receipt.receipt_hash ?? (await sha256B64u(receipt.compact ?? '')),
      reveal_record: 'verified',
      reveal_record_sha256: await keptRevealDigest(receipt),
      iat: new Date().toISOString(),
    },
    selectiveClaims: {},
  });
  return { schema: KEPT_REVEAL_SCHEMA, compact: signed.compact };
}
const TURN_RE = /^turn-\d+\.json$/u;

// Where uninstall keeps the receipts.
export function keptReceiptsDir(
  env = process.env,
  platform = process.platform,
  homedir = os.homedir,
) {
  if (env.ZEROH_RECEIPTS_DIR) return path.resolve(env.ZEROH_RECEIPTS_DIR);
  if (env.ZEROH_HOME) return `${path.resolve(env.ZEROH_HOME)}-receipts`;
  if (platform === 'win32') {
    return path.win32.join(
      env.LOCALAPPDATA || path.win32.join(homedir(), 'AppData', 'Local'),
      'ZeroH Receipts',
    );
  }
  return path.posix.join(homedir(), 'ZeroH Receipts');
}

function regularFile(file) {
  try {
    return lstatSync(file).isFile();
  } catch {
    return false;
  }
}

function directories(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writePrivate(file, text) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, text, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows: the folder's ACL applies.
  }
}

// 'verified', 'mismatch' or 'none' (no unmask record): the receipt's unmask
// record checked with the local allow-list key, while it still exists.
function revealRecord(receipt, key) {
  const entries = receipt?.revealed_under_grant;
  const hmac = receipt?.revealed_under_grant_hmac;
  if (entries === undefined && hmac === undefined) return 'none';
  if (!key || !Array.isArray(entries) || typeof hmac !== 'string')
    return 'mismatch';
  const expected = signatureFor(
    {
      version: 1,
      receipt_id: receipt.receipt_id,
      revealed_under_grant: entries,
    },
    key,
  );
  return signaturesMatch(hmac, expected) ? 'verified' : 'mismatch';
}

// The public half of a session signing key, or null.
function publicKeyOnly(record) {
  const jwk = record?.publicJwk;
  if (!jwk || typeof jwk !== 'object') return null;
  const { kty, crv, x, y } = jwk;
  if (typeof x !== 'string' || typeof y !== 'string') return null;
  return { keyId: record.keyId ?? null, publicJwk: { kty, crv, x, y } };
}

const README = (dir) =>
  [
    'ZeroH Disclosure receipts, kept when ZeroH Disclosure was uninstalled.',
    '',
    'Each projects/<project>/sessions/<session>/ folder holds the signed',
    'receipt of every turn (turn-<n>.json), the session receipt bundle',
    '(session.bundle.json), receipt.html, and the public key that verifies',
    'them (signing-key.json). They hold no secret or personal value: only',
    'categories, counts, masked text and tokens. No private key, vault or',
    'allow list was kept.',
    '',
    `zeroh-receipts.json lists them, with the result of the one check that`,
    `needs the deleted local key (the unmask record), made at uninstall.`,
    '',
    'To check one after installing ZeroH Disclosure again:',
    '  zeroh-disclosure verify --receipt <turn-n.json>',
    '',
    `To delete them, remove this folder: ${dir}`,
    '',
  ].join('\n');

// Copies the receipts out of ZEROH_HOME (see the header). Returns { dir,
// receipts, sessions, files } (files relative to `dir`); { dir: null,
// receipts: 0 } when there is nothing to keep, and then nothing is created.
export async function keepReceipts({
  env = process.env,
  home = zerohHome(env),
  dir = keptReceiptsDir(env),
  now = new Date(),
  renderHtml = null,
} = {}) {
  const projectsRoot = path.join(path.resolve(home), 'projects');
  let key = null;
  try {
    key = readFileSync(allowKeyPath(home));
  } catch {
    // No allow-list key: an unmask record can't be checked ('mismatch').
  }
  const manifestFile = path.join(dir, KEPT_MANIFEST);
  const manifest = readJsonFile(manifestFile);
  const receipts =
    manifest?.schema === KEPT_SCHEMA && manifest.receipts
      ? { ...manifest.receipts }
      : {};
  const files = [];
  const sessions = [];
  let count = 0;
  for (const project of directories(projectsRoot)) {
    const sessionsRoot = path.join(projectsRoot, project, 'sessions');
    for (const session of directories(sessionsRoot)) {
      const from = path.join(sessionsRoot, session);
      const relative = path.join('projects', project, 'sessions', session);
      const to = path.join(dir, relative);
      const signer = await sessionSigner(from);
      let kept = 0;
      for (const name of readdirSync(from)) {
        const source = path.join(from, name);
        if (!regularFile(source)) continue;
        if (TURN_RE.test(name)) {
          const ledger = readJsonFile(source);
          if (!ledger?.receipt?.receipt_id) continue;
          // The key behind the value commitments of a turn Stop had not
          // finalised: never kept.
          delete ledger.local_private;
          const reveal = revealRecord(ledger.receipt, key);
          let attestation = null;
          if (reveal === 'verified' && signer) {
            try {
              attestation = await revealAttestation(ledger.receipt, signer);
            } catch {
              // Without it, verify reports the check as unavailable.
            }
          }
          writePrivate(
            path.join(to, name),
            `${JSON.stringify(ledger, null, 2)}\n`,
          );
          receipts[ledger.receipt.receipt_id] = {
            file: path.join(relative, name).split(path.sep).join('/'),
            reveal_record: reveal,
            ...(attestation ? { reveal_attestation: attestation } : {}),
          };
          files.push(path.join(relative, name));
          kept += 1;
        } else if (name === 'session.bundle.json') {
          writePrivate(path.join(to, name), readFileSync(source, 'utf8'));
          files.push(path.join(relative, name));
        } else if (name === 'signing-key.json') {
          const publicKey = publicKeyOnly(readJsonFile(source));
          if (!publicKey) continue;
          writePrivate(
            path.join(to, name),
            `${JSON.stringify(publicKey, null, 2)}\n`,
          );
          files.push(path.join(relative, name));
        }
      }
      if (kept) {
        count += kept;
        sessions.push(to);
      }
    }
  }
  if (!count && !manifest) return { dir: null, receipts: 0, sessions: 0 };
  writePrivate(
    manifestFile,
    `${JSON.stringify(
      {
        schema: KEPT_SCHEMA,
        kept_at: now.toISOString(),
        note: "Receipts kept at uninstall. reveal_record: the unmask record checked with the local key before uninstall deleted it (verified, mismatch or none); a verified one is bound to the exact record kept by reveal_attestation, signed with the receipt's key.",
        receipts,
      },
      null,
      2,
    )}\n`,
  );
  writePrivate(path.join(dir, KEPT_README), README(dir));
  for (const session of sessions) {
    // receipt.html again, from the kept receipts and without value previews.
    if (!renderHtml) continue;
    try {
      await renderHtml(session);
      files.push(path.join(path.relative(dir, session), 'receipt.html'));
    } catch {
      // The receipts themselves are kept; the page is a view of them.
    }
  }
  return {
    dir,
    receipts: count,
    sessions: sessions.length,
    files: [...files, KEPT_MANIFEST, KEPT_README].map((file) =>
      file.split(path.sep).join('/'),
    ),
  };
}

// Whether `dir` is a folder of kept receipts (it holds the manifest).
export function isKeptReceiptsDir(dir) {
  return readJsonFile(path.join(dir, KEPT_MANIFEST))?.schema === KEPT_SCHEMA;
}

// The kept record for `receiptId` when `file` lies in a folder of kept
// receipts (a manifest in it or up to five folders above), else null.
export function keptReceiptRecord(file, receiptId) {
  if (!file || !receiptId) return null;
  let dir = path.dirname(path.resolve(String(file).replace(/#.*$/u, '')));
  for (let depth = 0; depth < 6; depth += 1) {
    const manifestFile = path.join(dir, KEPT_MANIFEST);
    if (existsSync(manifestFile)) {
      const manifest = readJsonFile(manifestFile);
      if (manifest?.schema !== KEPT_SCHEMA) return null;
      const record = manifest.receipts?.[receiptId];
      return record ? { ...record, kept_at: manifest.kept_at } : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
