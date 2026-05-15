# ProtectionEngine Interface

ZeroH is not the masking engine. ZeroH applies a disclosure policy, records
which protection engine ran, signs the result, and makes it verifiable.

Every engine implements:

```js
{
  id: 'regex-local',
  async health({ policy, boundary }) {},
  async analyze({ text, policy, boundary }) {},
  async transform({ text, findings, hmacKeyBytes, categoriesToMask, policy, boundary }) {},
  async manifest({ policy, boundary }) {}
}
```

`analyze` returns normalized ZeroH findings:

```js
{
  type: 'EMAIL',
  risk: 'medium',
  start: 0,
  end: 17,
  length: 17,
  confidence: 0.86,
  source_entity_type: 'EMAIL_ADDRESS'
}
```

`transform` returns:

```js
{
  sanitized_text: 'contact [EMAIL-02cf9c]',
  replacements: [],
  masked_categories: ['EMAIL']
}
```

`manifest` must be stable enough to hash. It should include engine id,
interface version, provider/version where known, configured entity/operator
mapping, and whether cloud calls are made. It must not include timestamps.

Failure semantics are policy-owned:

- Regulated policies may fail closed if the preferred engine is unavailable.
- Demo/dev policies may fall back to `regex-local`, but the receipt must record
  the fallback in `protection_engine_resolution`.

Current engines:

- `regex-local`: reference implementation and zero-config fallback.
- `presidio-http`: first third-party engine, backed by Presidio analyzer and
  anonymizer HTTP sidecars.
