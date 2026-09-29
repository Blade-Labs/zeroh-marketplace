// Types for @bladelabs/sensitive-data-detectors (./index.js). The package is
// plain JavaScript with no build step; test/exports.test.mjs keeps this file's
// export list equal to the module's.

/** The secret types. Every other type is personal data. */
export type SecretType =
  'PRIVATE_KEY' | 'API_KEY' | 'SECRET' | 'TOKEN' | 'PASSWORD';

/** The personal-data kinds, in rule order. */
export type PersonalDataType =
  | 'EMAIL'
  | 'CARD_NUMBER'
  | 'IBAN'
  | 'ES_NIF'
  | 'ES_NIE'
  | 'IT_FISCAL_CODE'
  | 'FI_PERSONAL_IDENTITY_CODE'
  | 'PHONE_NUMBER'
  | 'IP_ADDRESS'
  | 'CRYPTO'
  | 'US_SSN'
  | 'US_ITIN'
  | 'UK_NINO'
  | 'QATAR_ID'
  | 'IN_AADHAAR'
  | 'IN_PAN'
  | 'PK_CNIC'
  | 'EMIRATES_ID'
  | 'SAUDI_NID'
  | 'IQAMA'
  | 'BR_CPF'
  | 'PL_PESEL'
  | 'SE_PERSONNUMMER'
  | 'NL_BSN'
  | 'CN_RESIDENT_ID'
  | 'TW_NATIONAL_ID'
  | 'HK_IDENTITY_CARD'
  | 'NO_FODSELSNUMMER'
  | 'TH_TNIN'
  | 'IL_ID'
  | 'MALAYSIA_NRIC'
  | 'PASSPORT'
  | 'DOB';

export type DetectedType = SecretType | PersonalDataType;

export type Profile = 'prompt' | 'tool' | 'secrets';

export type Risk = 'critical' | 'high' | 'medium' | 'low';

/** A half-open [start, end) range of UTF-16 offsets. */
export type Span = readonly [start: number, end: number];

export interface DetectOptions {
  /**
   * `prompt` (default): secrets and personal data, for text a person writes.
   * `tool`: the same without national-format phone numbers, for tool output.
   * `secrets`: secrets only.
   */
  profile?: Profile | string;
  /**
   * Default region for national-format phone numbers (prompt profile only):
   * a two-letter region, `null` for none, or `undefined` for the locale's
   * (see {@link phoneRegion}).
   */
  region?: string | null;
  /** Only these types; `null` or omitted for all. */
  enabledTypes?: readonly string[] | null;
  /**
   * Spans no finding may overlap, e.g. the caller's own placeholders, or a
   * function that returns them for the text.
   */
  ignore?: readonly Span[] | ((text: string) => readonly Span[]) | null;
}

export interface Finding {
  type: DetectedType;
  risk: Risk;
  start: number;
  end: number;
  length: number;
  confidence: number;
  /** The vendored source that decided (personal data). */
  source?: string;
  /** The gitleaks rule id (imported provider rules). */
  ruleId?: string;
  /** Set when an imported gitleaks rule matched. */
  imported?: true;
  /** Set when the value was found by its key name, not its own shape. */
  generic?: true;
}

export interface EntropyWarning {
  type: 'ENTROPY_WARNING';
  risk: 'warning';
  name: null;
  start: number;
  end: number;
  length: number;
  entropy: number;
  confidence: number;
}

export interface PersonalDataKind {
  readonly type: PersonalDataType;
  /** Singular, e.g. "email address". */
  readonly name: string;
  /** Plural, e.g. "email addresses". */
  readonly label: string;
  /** The vendored source that decides, e.g. "validator.isEmail + IANA TLDs". */
  readonly source: string;
}

export interface Catalog {
  source: string;
  provider_formats: number;
  providers: { name: string; rules: string[] }[];
  named_prefixes: { prefix: string; label: string }[];
  also: string[];
  personal_data: PersonalDataType[];
  personal_data_kinds: {
    type: PersonalDataType;
    label: string;
    source: string;
  }[];
  personal_data_sources: string[];
}

export interface Manifest {
  id: string;
  engine: 'regex-local';
  cloud_calls: false;
  categories: { type: DetectedType; risk: Risk; confidence: number }[];
  provider_catalog: {
    source: GitleaksSource;
    imported: number;
    skipped: number;
  };
}

export interface GitleaksSource {
  readonly project: string;
  readonly version: string;
  readonly commit: string;
  readonly license: string;
  readonly file: string;
  /** SHA-256 of the vendored upstream file; the importer refuses any other. */
  readonly sha256: string;
}

export interface GitleaksRule {
  readonly id: string;
  readonly description?: string;
  readonly regex: string;
  readonly flags: string;
  readonly type: SecretType;
  readonly keywords?: readonly string[];
  readonly entropy?: number;
  readonly secretGroup?: number;
  /**
   * Length of the upstream leading `[\w.-]{0,N}?` context the importer
   * dropped for linear-time matching; `match` allowlists see it again.
   */
  readonly leading?: number;
  /**
   * Upstream `\bword\b(?:.*?|…{1,N})` prefix the importer replaced with a
   * constant-time check: `word` stands before the match, at most
   * `lineBreaks` line breaks away.
   */
  readonly anchor?: { readonly word: string; readonly lineBreaks: number };
  readonly allowlists?: readonly unknown[];
}

export interface GitleaksCatalog {
  readonly generatedFrom: GitleaksSource;
  readonly counts: {
    readonly source: number;
    readonly imported: number;
    readonly skipped: number;
  };
  readonly rules: readonly GitleaksRule[];
  readonly skipped: readonly unknown[];
}

export const PROFILES: readonly Profile[];
export const SECRET_TYPES: readonly SecretType[];
/** Every type a finding can have: the secret types, then the personal-data kinds. */
export const TYPES: readonly DetectedType[];
export const PERSONAL_DATA_KINDS: readonly PersonalDataKind[];
export const VERSIONS: {
  readonly gitleaks: string;
  readonly validator: string;
  readonly libphonenumber: string;
  readonly tlds: string;
};
/** The provider rules imported from gitleaks, read-only. */
export const GITLEAKS_CATALOG: GitleaksCatalog;
/** The IANA root-zone top-level domains, lower case (punycode for IDNs). */
export const TOP_LEVEL_DOMAINS: readonly string[];

/** Findings in `text`, sorted by position, overlaps resolved. */
export function detect(text: string, options?: DetectOptions): Finding[];
/** The same function as {@link detect}. */
export function detectSensitiveData(
  text: string,
  options?: DetectOptions,
): Finding[];
/**
 * Random-looking values that no rule found and that have no key-like name in
 * front of them: candidates for a warning, not for masking.
 */
export function detectEntropyWarnings(
  text: string,
  options?: Pick<DetectOptions, 'ignore' | 'region'>,
): EntropyWarning[];
/** What the rule set detects. */
export function catalog(): Catalog;
/** The same function as {@link catalog}. */
export function detectionCatalog(): Catalog;
/** The engine id and its categories. */
export function manifest(): Manifest;
/** The same function as {@link manifest}. */
export function detectorManifest(): Manifest;
/** A provider name for a detected secret value, or null. */
export function providerLabel(
  value: string,
  options?: Pick<DetectOptions, 'ignore'>,
): string | null;
/** The locale's default phone region (LC_ALL, LC_TELEPHONE, LANG), or null. */
export function phoneRegion(
  env?: Record<string, string | undefined>,
): string | null;
/** The region in upper case when the phone metadata knows it, else null. */
export function supportedRegion(value: string): string | null;
/** True when the domain ends in an IANA top-level domain (or example/test/invalid). */
export function knownTopLevelDomain(domain: string): boolean;
/** Shannon entropy of a string, in bits per character. */
export function shannonEntropy(value: string): number;
/** The secret type a key name implies (`DB_PASSWORD` → PASSWORD). */
export function nameType(name: string): SecretType;
/**
 * True when the text after a secret-named key is code or a name, not a
 * value (`process.env.X`, `string`, `${VAR}`, `^1.2.3`).
 */
export function looksLikeCodeValue(
  value: string,
  name?: string,
  options?: { words?: boolean },
): boolean;
