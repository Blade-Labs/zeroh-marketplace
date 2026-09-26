# What ZeroH Disclosure detects

The free plugin detects values by pattern and by exact value. Run
`node "<plugin>/bin/zeroh-disclosure.mjs" catalog` (or ask Claude "what does ZeroH Disclosure
detect?") to print the rule set that is installed.

## Contents

- [Secrets](#secrets)
- [Personal data](#personal-data)
- [Notes on the personal-data rules](#notes-on-the-personal-data-rules)
- [What is not detected](#what-is-not-detected)
- [False positives, measured](#false-positives-measured)

## Secrets

- **API keys and tokens by provider format**: 221 provider rules from 129 providers, generated
  from the [gitleaks](https://github.com/gitleaks/gitleaks) v8.30.1 rule set, plus ZeroH's own
  rules for Anthropic, OpenAI, Stripe, GitHub, AWS, Google, Slack, npm, PyPI, Docker, HashiCorp
  Vault and others. 38 well-known prefixes (`sk_live_`, `ghp_`, `AKIA`, …) are named by provider
  on your screen.
- **Secrets by context**: passwords, tokens and secrets next to a key-like name (`password: …`,
  `db_password = …`, `AUTH_TOKEN=<random>`), private keys (PEM, OpenSSH, PuTTY, age),
  `Authorization` headers, credentials in URLs and connection strings, signed URLs, OTP seeds and
  password hashes. A value next to a key-like name counts only when it looks like a value: code
  after the name (`process.env.X`, `API_KEY`, a type, a call, a package version, a template
  placeholder) and plain names made only of letters are left alone. These rules mask what the
  model reads; they do not rewrite what the model writes, which can only hold tokens.
- **Your own values**: every value in your project's `.env` and `.env.*` files (not
  `.env.example`, `.sample`, `.template`, `.dist` or `.defaults`), secret-named environment
  variables, and credentials in AWS, GitHub CLI, npm, PyPI, `.netrc`, `.git-credentials` and
  Docker files. They are matched exactly, also in base64, URL-safe base64, hexadecimal and
  URL-encoded form. Once a value is masked, it stays masked wherever it shows up again.
- **Private key and credential stores** (SSH keys, `.p12`, `.pfx`, `.jks`, `.kdbx`, `.ppk`,
  Terraform state, `.netrc`, `.pgpass`, `.git-credentials`, kubeconfig, AWS credentials, Docker
  config) are never read into the conversation.

## Personal data

ZeroH's own code only proposes candidates (the characters around an `@`, the printed layouts of
cards and IBANs, the shape of each ID) and, for numbers that are nothing but digits, looks for a
word naming them. A published rule or a vendored library decides; a candidate it rejects stays
text. There are 33 kinds:

| Kind                                | Token                       | Decided by                                                                                                          | Needs a context word                       |
| ----------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Email addresses                     | `EMAIL`                     | validator.js `isEmail` (UTF-8 and quoted local parts, IP literals), and a top-level domain in IANA's root zone list | no                                         |
| Card numbers                        | `CARD_NUMBER`               | validator.js `isCreditCard`: an issuer's number range and the Luhn check                                            | no                                         |
| IBANs, compact or in groups of four | `IBAN`                      | validator.js `isIBAN`: the country's format and the mod-97 checksum                                                 | no                                         |
| Phone numbers                       | `PHONE_NUMBER`              | libphonenumber-js with Google's libphonenumber metadata: only numbers valid for their region                        | no (see below)                             |
| IP addresses, v4 and v6             | `IP_ADDRESS`                | validator.js `isIP`, without the special-purpose ranges below                                                       | no                                         |
| US Social Security numbers          | `US_SSN`                    | SSA assignment rules; the published sample numbers (Presidio `UsSsnRecognizer`)                                     | only as 9 bare digits                      |
| US ITINs                            | `US_ITIN`                   | IRS Publication 4757: `9XX` and the group ranges                                                                    | only as 9 bare digits                      |
| UK National Insurance numbers       | `UK_NINO`                   | HMRC manual NIM39110: the prefix letters, six digits, suffix A–D                                                    | no                                         |
| Qatar ID numbers                    | `QATAR_ID`                  | century, birth year and an ISO 3166-1 nationality code (i18n-iso-countries)                                         | yes: QID, Qatar ID, national ID, ID number |
| Spanish DNI and NIE                 | `ES_NIF`, `ES_NIE`          | validator.js `isIdentityCard('ES')`: the control letter                                                             | no                                         |
| Italian codice fiscale              | `IT_FISCAL_CODE`            | validator.js `isTaxID('it-IT')`: the control character                                                              | no                                         |
| Finnish henkilötunnus               | `FI_PERSONAL_IDENTITY_CODE` | validator.js `isIdentityCard('FI')`: the control character                                                          | no                                         |
| Aadhaar                             | `IN_AADHAAR`                | validator.js `isIdentityCard('IN')`: the Verhoeff check digit                                                       | yes: Aadhaar, UIDAI                        |
| Indian PAN                          | `IN_PAN`                    | the PAN format (holder-type letter), as Presidio's `InPanRecognizer`                                                | yes: PAN                                   |
| Pakistani CNIC                      | `PK_CNIC`                   | validator.js `isIdentityCard('PK')`                                                                                 | only without dashes                        |
| Emirates ID                         | `EMIRATES_ID`               | the `784-YYYY-NNNNNNN-N` format (no check digit is published)                                                       | only without dashes                        |
| Saudi national ID                   | `SAUDI_NID`                 | Saudi-ID-Validator `validateSAID`: starts with 1, the check digit                                                   | yes: NID, national ID, citizen             |
| Saudi iqama (residents)             | `IQAMA`                     | Saudi-ID-Validator `validateSAID`: starts with 2, the check digit                                                   | yes: iqama, residency, resident ID         |
| Brazilian CPF                       | `BR_CPF`                    | validator.js `isTaxID('pt-BR')`: both check digits                                                                  | only without dots and dash                 |
| Polish PESEL                        | `PL_PESEL`                  | validator.js `isIdentityCard('PL')`                                                                                 | yes: PESEL                                 |
| Swedish personnummer                | `SE_PERSONNUMMER`           | validator.js `isTaxID('sv-SE')`: the date and the Luhn check                                                        | yes: personnummer                          |
| Dutch BSN                           | `NL_BSN`                    | validator.js `isTaxID('nl-NL')`: the 11-proof                                                                       | yes: BSN                                   |
| Norwegian fødselsnummer             | `NO_FODSELSNUMMER`          | validator.js `isIdentityCard('NO')`: both check digits                                                              | yes: fødselsnummer                         |
| Thai national ID                    | `TH_TNIN`                   | validator.js `isIdentityCard('TH')`                                                                                 | yes: Thai ID, national ID                  |
| Israeli ID                          | `IL_ID`                     | validator.js `isIdentityCard('he-IL')`                                                                              | yes: teudat zehut, Israeli ID              |
| Chinese resident ID                 | `CN_RESIDENT_ID`            | validator.js `isIdentityCard('zh-CN')`: region, date and check character                                            | yes: 身份证, resident ID                   |
| Taiwanese national ID               | `TW_NATIONAL_ID`            | validator.js `isIdentityCard('zh-TW')`                                                                              | yes: 身分證, Taiwan ID                     |
| Hong Kong identity card             | `HK_IDENTITY_CARD`          | validator.js `isIdentityCard('zh-HK')`                                                                              | only without the bracketed check digit     |
| Malaysian NRIC (MyKad)              | `MALAYSIA_NRIC`             | a real date and a JPN place-of-birth code (`YYMMDD-PB-###G`)                                                        | only without dashes                        |
| Passport numbers (GB, US, MY)       | `PASSPORT`                  | validator.js `isPassportNumber`                                                                                     | yes: passport                              |
| Dates of birth                      | `DOB`                       | a real calendar date from 1900 to five years ago                                                                    | yes: DOB, born, date of birth, birthday    |
| Bitcoin and Ethereum addresses      | `CRYPTO`                    | validator.js `isBtcAddress`, `isEthereumAddress`                                                                    | Ethereum in tool output only: wallet, …    |

The national IDs cover 21 countries. `ZEROH_MASK_PII=off` turns personal-data masking off in tool
output and leaves only secrets.

## Notes on the personal-data rules

- **A context word** must be within 40 characters before the number or 20 after it on the same
  line (a label, or a key such as `"ssn":` or `QATAR_ID=`), or, in a CSV or TSV table, in the
  header of the number's column. A 9- to 13-digit number on its own is more often an order number,
  a timestamp or a constant.
- **Phone numbers** with a country code (`+974 5512 3456`) are found everywhere. A number without
  one (`020 7946 0958`) is found only in what you type, only when written with spaces, hyphens or
  parentheses, and only with a region: `ZEROH_PHONE_REGION` (for example `GB`, or `none`), else the
  territory of your locale (`LC_ALL`, `LC_TELEPHONE` or `LANG`, such as `en_GB.UTF-8`). In code and
  command output, digit groups are more often ids, hashes and constants.
- **IP addresses** that never identify a person or a network are left out (IANA's special-purpose
  ranges, RFC 6890): loopback (`127.0.0.0/8`, `::1`), unspecified (`0.0.0.0/8`, `::`), broadcast
  and netmasks, link-local (`169.254.0.0/16`, the cloud metadata address; `fe80::/10`), multicast
  and reserved (`224.0.0.0/3`, `ff00::/8`) and the documentation ranges (`192.0.2.0/24`,
  `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`). So are versions and section numbers
  (`v1.2.3.4`, `pkg@1.2.3.4`, `version 1.2.3.4`, `section 13.2.5.8`, `1.2.3.4.5`) and array slices
  such as `a[1::2]`. Private addresses (`10.0.0.0/8`, `192.168.0.0/16`, …) are masked.
- **Email addresses**: SSH logins such as `git@github.com:org/repo` and no-reply addresses are not
  treated as email addresses. Sizes, resolutions, grouped numbers, dates and diff lines are not
  treated as phone numbers.
- **Saudi, Qatar and other Gulf IDs** may be written in Arabic-Indic digits (`١٠٠٠٠٠٠٠٠٨`); they
  are normalised before the check, and the Arabic context words (هوية، الهوية، إقامة) count.
- **Ethereum addresses** are `0x` and 40 hex digits, the same shape as contract addresses and
  hashes in code: in what you type they are always masked, in tool output only next to a word such
  as wallet, send to, recipient or ETH address. A Bitcoin candidate must mix letters and digits
  and not be plain hex.
- The Gulf IDs, Malaysian NRIC, passport, date-of-birth and crypto rules, and the Arabic-Indic
  digits, are shared with Blade Labs' chat product (ai-ui-chat); ZeroH keeps its stricter SSN,
  NINO and Qatar ID checks.
- The ID kinds use the same names as ZeroH Enterprise's recognizers (`QATAR_ID`, `SAUDI_NID`,
  `IQAMA`, `EMIRATES_ID`, `US_SSN`, `US_ITIN`, `IP_ADDRESS`), and otherwise the entity names of
  Microsoft Presidio's recognizers.

## What is not detected

- **Names, postal addresses and currency amounts.** They need context-aware detection, which is
  planned for Premium.
- **Passports of other countries**: they have no check digit, and their formats overlap with
  ordinary codes.
- **Company numbers** such as the Brazilian CNPJ or the US EIN: they are not personal data.
- **ID formats with no published check digit or context word** to rely on.
- **Values with no known shape and no name.** A random-looking value next to a key-like name
  (`AUTH_TOKEN=…`, `secret: …`) is masked. One with no key-like name, such as a URL path segment
  or a bare command argument, matches no rule and is sent as is. When you type one, ZeroH adds a
  warning; in files and command output there is no warning. Put such a value in `.env` or a
  credential file, or report it with `/zeroh-disclosure:report-miss`, and it is masked by exact
  match from then on.
- **Images and scanned PDFs.** They pass to the model unchanged, with a notice. Text PDFs and
  notebooks are masked.

## False positives, measured

Measured on 6,000 open-source files (installed npm packages and the Python standard library), tool
output: email addresses in author and contact lines (154 in 109 files) and IP addresses (58 in 7
files, 47 of them in Python's own `ipaddress` module documentation); no card, IBAN, ID or phone
number.

The ID rules find nothing there. Without their context words, the bare-digit shapes would match
32 times in 6 files for US SSNs, 4 times in 2 files for Israeli IDs, 2 for ITINs and 1 for Dutch
BSNs (hash constants such as `139408157`), which is why they need one. NRIC, passport, date of
birth, Saudi and Qatar IDs and crypto addresses find nothing in tool output, typed prompts or the
normal-work sample. Without their context word, dates of birth would match 149 times (numeric
forms in 28 files, month names in 23: versions such as `4.1.10`, release dates) and passports 47
times in 15 files.
