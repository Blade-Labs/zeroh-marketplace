// @bladelabs/sensitive-data-detectors: finds secrets and personal data in
// text, locally, with Node built-ins and vendored upstream code only.
// Plain ES modules with no build step, so a consumer may copy src/ and
// vendor/ as they are (ZeroH Disclosure does). Types: ./index.d.ts.

import {
  detectEntropyWarnings,
  detectionCatalog,
  detectorManifest,
  detectSensitiveData,
  GITLEAKS_CATALOG,
  looksLikeCodeValue,
  nameType,
  providerLabel,
  shannonEntropy,
} from './detector.js';
import {
  knownTopLevelDomain,
  LIBPHONENUMBER_VERSION,
  PERSONAL_DATA_KINDS,
  phoneRegion,
  supportedRegion,
  TLD_VERSION,
  TOP_LEVEL_DOMAINS,
  VALIDATOR_VERSION,
} from './pii/index.js';

// The profiles `detect` accepts.
export const PROFILES = Object.freeze(['prompt', 'tool', 'secrets']);

// The secret types. Every other type is personal data.
export const SECRET_TYPES = Object.freeze([
  'PRIVATE_KEY',
  'API_KEY',
  'SECRET',
  'TOKEN',
  'PASSWORD',
]);

// Every type a finding can have: the secret types, then the personal-data
// kinds in rule order (EMAIL, CARD_NUMBER, IBAN, …, US_SSN, QATAR_ID,
// SAUDI_NID, IQAMA, EMIRATES_ID, …).
export const TYPES = Object.freeze([
  ...SECRET_TYPES,
  ...PERSONAL_DATA_KINDS.map(({ type }) => type),
]);

// The versions of the vendored sources the rules come from.
export const VERSIONS = Object.freeze({
  gitleaks: GITLEAKS_CATALOG.generatedFrom.version,
  validator: VALIDATOR_VERSION,
  libphonenumber: LIBPHONENUMBER_VERSION,
  tlds: TLD_VERSION,
});

// Findings in `text`: [{ type, risk, start, end, length, confidence, … }].
export const detect = detectSensitiveData;
// What the rule set detects, for "what do you detect?" answers.
export const catalog = detectionCatalog;
// The engine id and its categories, for audit records.
export const manifest = detectorManifest;

export {
  detectEntropyWarnings,
  detectionCatalog,
  detectorManifest,
  detectSensitiveData,
  GITLEAKS_CATALOG,
  knownTopLevelDomain,
  looksLikeCodeValue,
  nameType,
  PERSONAL_DATA_KINDS,
  phoneRegion,
  providerLabel,
  shannonEntropy,
  supportedRegion,
  TOP_LEVEL_DOMAINS,
};
