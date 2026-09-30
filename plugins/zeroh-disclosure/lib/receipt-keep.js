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
import { projectKey, zerohHome } from './vault.js';

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
    'A legacy/<project>/sessions/<session>/ folder holds receipts of ZeroH',
    'Disclosure 0.1, copied from <project>/.zeroh: the signed receipts',
    '(turn-<n>.json), ProofPacks, evidence events and the public key (wallet.json).',
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
  writeManifest(dir, { receipts, legacy: manifest?.legacy_receipts, now });
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

function writeManifest(dir, { receipts = {}, legacy = null, now }) {
  writePrivate(
    path.join(dir, KEPT_MANIFEST),
    `${JSON.stringify(
      {
        schema: KEPT_SCHEMA,
        kept_at: now.toISOString(),
        note: "Receipts kept at uninstall. reveal_record: the unmask record checked with the local key before uninstall deleted it (verified, mismatch or none); a verified one is bound to the exact record kept by reveal_attestation, signed with the receipt's key.",
        receipts,
        ...(legacy && Object.keys(legacy).length
          ? { legacy_receipts: legacy }
          : {}),
      },
      null,
      2,
    )}\n`,
  );
  writePrivate(path.join(dir, KEPT_README), README(dir));
}

// --- receipts ZeroH Disclosure 0.1 kept inside the project -----------------
//
// 0.1.x wrote each session to <project>/.zeroh/sessions/<sid>/ (its
// lib/session.js): state.json (the session's HMAC key behind the value
// commitments), wallet.json (the public signing key), wallet.key.json (the
// PRIVATE signing key), turn-<n>.json (the signed receipt; a turn Stop had
// not finalised still holds the typed text in `local_private`),
// turn-<n>.proofpack.json, event-<n>.json (signed tool evidence) and
// tool-<id>.json (the original values of a tool call). 1.0 keeps nothing in
// the project (D-15), so doctor --fix and uninstall meet these folders.
// Receipts are never deleted: uninstall copies the public part (receipts
// without `local_private`, ProofPacks, evidence events, the public key) into
// the kept-receipts folder, and a folder that still holds anything private
// (a key, a value, a file this code does not know) stays where it is, for
// the user to delete.
const LEGACY_OURS = new Set(['sessions', 'allow.json', '.gitignore']);
const LEGACY_PUBLIC = [
  /^turn-\d+\.proofpack\.json$/u,
  /^event-\d+\.json$/u,
  /^wallet\.json$/u,
];
const LEGACY_PRIVATE = [
  /^state\.json$/u,
  /^wallet\.key\.json$/u,
  /^tool-.+\.json$/u,
];
const LEGACY_RECEIPT_RE = /^turn-\d+(?:\.proofpack)?\.json$/u;

// What a <project>/.zeroh folder holds, or null when it is not one ZeroH
// left (anything but sessions/, allow.json and .gitignore at its top):
// { dir, sessions: [{ id, dir, public, private }], receipts, private,
//   files }. `public` lists the files uninstall may keep; `private` the ones
// it never copies (keys, values, and anything unknown).
export function scanLegacyFolder(dir) {
  let names;
  try {
    if (!lstatSync(dir).isDirectory()) return null;
    names = readdirSync(dir);
  } catch {
    return null;
  }
  if (!names.length || !names.every((name) => LEGACY_OURS.has(name))) {
    return null;
  }
  const result = { dir, sessions: [], receipts: 0, private: 0, files: 0 };
  const sessionsRoot = path.join(dir, 'sessions');
  let entries = [];
  try {
    entries = readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    // No sessions folder: nothing but allow.json and .gitignore.
  }
  for (const entry of entries) {
    const sessionDir = path.join(sessionsRoot, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      result.private += 1;
      result.files += 1;
      continue;
    }
    const session = {
      id: entry.name,
      dir: sessionDir,
      public: [],
      private: [],
    };
    for (const item of readdirSync(sessionDir, { withFileTypes: true })) {
      result.files += 1;
      const name = item.name;
      const file = path.join(sessionDir, name);
      if (!item.isFile()) {
        session.private.push(name);
      } else if (/^turn-\d+\.json$/u.test(name)) {
        const ledger = readJsonFile(file);
        if (ledger?.receipt) session.public.push(name);
        // The typed text of a turn Stop had not finalised.
        if (!ledger?.receipt || ledger.local_private !== undefined) {
          session.private.push(name);
        }
      } else if (LEGACY_PUBLIC.some((re) => re.test(name))) {
        session.public.push(name);
      } else {
        // LEGACY_PRIVATE, and anything else: never copied.
        session.private.push(name);
      }
      if (LEGACY_RECEIPT_RE.test(name) && session.public.includes(name)) {
        result.receipts += 1;
      }
    }
    result.private += session.private.length;
    result.sessions.push(session);
  }
  return result;
}

// Whether doctor --fix may delete a scanned folder: it holds no file at all
// in its sessions (only allow.json, .gitignore and empty folders).
export function legacyFolderEmpty(scan) {
  return Boolean(scan) && scan.files === 0;
}

// Copies the public part of 0.1 receipts from scanned <project>/.zeroh
// folders (scanLegacyFolder) into `dir`, under
// legacy/<project>-<key>/sessions/<sid>/. Returns { dir, receipts, folders:
// [{ dir, kept, receipts, removable }] }: `removable` when everything in the
// folder was public and is now kept, so nothing is lost by deleting it.
export function keepLegacyReceipts({
  scans,
  env = process.env,
  dir = keptReceiptsDir(env),
  now = new Date(),
}) {
  const manifest = readJsonFile(path.join(dir, KEPT_MANIFEST));
  const known = manifest?.schema === KEPT_SCHEMA ? manifest : null;
  const legacy = { ...(known?.legacy_receipts ?? {}) };
  const folders = [];
  let total = 0;
  for (const scan of scans) {
    const root = path.dirname(scan.dir);
    const label = `${path.basename(root) || 'project'}-${projectKey(root)}`;
    let receipts = 0;
    let copied = 0;
    let wanted = 0;
    for (const session of scan.sessions) {
      const relative = path.join('legacy', label, 'sessions', session.id);
      for (const name of session.public) {
        wanted += 1;
        const source = path.join(session.dir, name);
        let text;
        if (/^turn-\d+\.json$/u.test(name)) {
          const ledger = readJsonFile(source);
          if (!ledger?.receipt) continue;
          delete ledger.local_private;
          text = `${JSON.stringify(ledger, null, 2)}\n`;
          const id = ledger.receipt.receipt_id;
          if (id) {
            legacy[id] = {
              file: path.join(relative, name).split(path.sep).join('/'),
              from: path.join(session.dir, name),
              version: '0.1',
            };
          }
        } else if (name === 'wallet.json') {
          const wallet = readJsonFile(source);
          const publicKey = publicKeyOnly(wallet);
          if (!publicKey) continue;
          text = `${JSON.stringify(
            {
              accountId: wallet.accountId ?? null,
              network: wallet.network ?? null,
              publicJwk: publicKey.publicJwk,
            },
            null,
            2,
          )}\n`;
        } else {
          try {
            text = readFileSync(source, 'utf8');
          } catch {
            continue;
          }
        }
        writePrivate(path.join(dir, relative, name), text);
        copied += 1;
        if (LEGACY_RECEIPT_RE.test(name)) receipts += 1;
      }
    }
    total += receipts;
    folders.push({
      dir: scan.dir,
      kept: copied > 0,
      receipts,
      removable: scan.private === 0 && copied === wanted,
    });
  }
  if (!total && !folders.some((folder) => folder.kept)) {
    return { dir: null, receipts: 0, folders };
  }
  writeManifest(dir, {
    receipts: known?.receipts ?? {},
    legacy,
    now,
  });
  return { dir, receipts: total, folders };
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
