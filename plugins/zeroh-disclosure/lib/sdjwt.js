import { canonicalJson, randomB64u, sha256B64u, utf8, bytesToBase64Url, base64UrlToBytes } from './crypto.js';

export async function buildSelectiveDisclosures(claims) {
  const disclosures = [],
    digests = [];
  for (const [name, value] of Object.entries(claims)) {
    const salt = randomB64u(16);
    const disclosure = [salt, name, value];
    const encoded = bytesToBase64Url(utf8(canonicalJson(disclosure)));
    const digest = await sha256B64u(encoded);
    disclosures.push({ name, value, salt, encoded, digest });
    digests.push(digest);
  }
  return { disclosures, digests };
}

export function decodeDisclosure(encoded) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
}

export async function digestDisclosure(encoded) {
  return sha256B64u(encoded);
}

export async function createReceiptJwtLike({ wallet, publicClaims, selectiveClaims }) {
  const { disclosures, digests } = await buildSelectiveDisclosures(selectiveClaims);
  const header = {
    typ: 'zeroh+sd-jwt',
    alg: wallet.alg ?? 'WALLET-SIGNATURE',
    kid: await wallet.getKeyId(),
  };
  const payload = { ...publicClaims, _sd_alg: 'sha-256', _sd: digests };
  const signingInput = `${bytesToBase64Url(utf8(canonicalJson(header)))}.${bytesToBase64Url(utf8(canonicalJson(payload)))}`;
  const sig = await wallet.signMessage(utf8(signingInput), {
    purpose: 'zeroh_disclosure_receipt',
    receipt_id: publicClaims.receipt_id,
  });
  const compact = `${signingInput}.${bytesToBase64Url(sig)}`;
  return {
    compact,
    header,
    payload,
    disclosures: disclosures.map((d) => d.encoded),
    disclosure_manifest: disclosures.map((d) => ({ name: d.name, digest: d.digest })),
  };
}

export function createPresentation(receipt, claimNames = []) {
  const selected = [];
  for (const encoded of receipt.disclosures ?? []) {
    const [, name] = decodeDisclosure(encoded);
    if (claimNames.includes(name)) selected.push(encoded);
  }
  return `${receipt.compact}~${selected.join('~')}`;
}

export async function verifyPresentationDigests(presentation) {
  const [compact, ...encodedDisclosures] = presentation.split('~');
  const [, payloadB64u] = compact.split('.');
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64u)));
  const digests = new Set(payload._sd ?? []);
  const revealed = [];
  for (const encoded of encodedDisclosures.filter(Boolean)) {
    const digest = await digestDisclosure(encoded);
    if (!digests.has(digest)) return { ok: false, reason: 'disclosure_digest_not_in_receipt', digest };
    const [, name, value] = decodeDisclosure(encoded);
    revealed.push({ name, value, digest });
  }
  return { ok: true, receipt_payload: payload, revealed };
}
