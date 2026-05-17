# Blade AI Disclosure Policy v1

`blade-ai-disclosure-v1` is the sample policy for the proof wedge.

Intent:

- Apply a named disclosure policy before regulated data crosses an AI boundary.
- Use third-party masking infrastructure where available.
- Prove the exact policy, boundary, protection engine, decision, and transformed
  view that were applied.

Protection engine preference:

- Preferred engine: `presidio-http`
- Fallback engine: `regex-local`
- Default fallback mode: `fallback_with_receipt`
- Regulated mode: `fail_closed`

Sensitive categories:

- `EMAIL`
- `PHONE_NUMBER`
- `PERSON`
- `CARD_NUMBER`
- `IBAN`
- `ACCOUNT_NUMBER`
- `QATAR_ID`

Rules:

- Secrets and private keys are blocked.
- Sensitive categories crossing an external AI boundary are transformed before
  disclosure.
- Clean prompts still receive `allow_with_receipt` evidence.

The policy does not claim any protection engine catches every possible
sensitive value. It proves which engine and policy were applied in the
controlled ZeroH path.
