export const bladeAiDisclosurePolicyV1 = {
  policy_id: 'blade-ai-disclosure-v1',
  aliases: ['blade'],
  name: 'Blade AI Disclosure Sample Policy v1',
  jurisdiction: 'US',
  version: '0.1.0-poc',
  raw_content_seen_by_zeroh_saas: false,
  protection_engine: {
    preferred_engine: 'presidio-http',
    fallback_engine: 'regex-local',
    default_mode: 'fallback_with_receipt',
    regulated_mode: 'fail_closed',
    entities: {
      EMAIL: { presidio: 'EMAIL_ADDRESS', operator: 'replace', replacement: '[EMAIL]' },
      PHONE_NUMBER: { presidio: 'PHONE_NUMBER', operator: 'replace', replacement: '[PHONE_NUMBER]' },
      PERSON: { presidio: 'PERSON', operator: 'replace', replacement: '[PERSON]' },
      CARD_NUMBER: { presidio: 'CREDIT_CARD', operator: 'replace', replacement: '[CARD_NUMBER]' },
      IBAN: { presidio: 'IBAN_CODE', operator: 'replace', replacement: '[IBAN]' },
      ACCOUNT_NUMBER: { presidio: 'US_BANK_NUMBER', operator: 'replace', replacement: '[ACCOUNT_NUMBER]' },
      QATAR_ID: { presidio: null, operator: 'replace', replacement: '[QATAR_ID]' },
    },
  },
  rules: [
    {
      id: 'BLADE-SECRETS-NEVER-DISCLOSE-TO-AI',
      action: 'block',
      when: { any_category: ['API_KEY', 'PRIVATE_KEY'] },
      reason: 'Secrets and private keys must never be sent to AI systems.',
    },
    {
      id: 'BLADE-TRANSFORM-SENSITIVE-BEFORE-AI',
      action: 'mask_and_allow',
      when: {
        boundary_type: ['external_ai_processor', 'cross_border_ai', 'external_ai_router'],
        any_category: ['QATAR_ID', 'IBAN', 'CARD_NUMBER', 'ACCOUNT_NUMBER', 'EMAIL', 'PHONE_NUMBER', 'PERSON'],
      },
      mask_categories: ['QATAR_ID', 'IBAN', 'CARD_NUMBER', 'ACCOUNT_NUMBER', 'EMAIL', 'PHONE_NUMBER', 'PERSON'],
      reason: 'Sensitive categories must be transformed locally before AI boundary crossing.',
    },
    {
      id: 'BLADE-ALLOW-WITH-RECEIPT',
      action: 'allow_with_receipt',
      when: { always: true },
      reason: 'No regulated category detected; still create disclosure evidence.',
    },
  ],
};
