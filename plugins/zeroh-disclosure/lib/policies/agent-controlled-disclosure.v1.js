export const agentControlledDisclosurePolicyV1 = {
  policy_id: 'agent-controlled-disclosure-v1',
  aliases: ['agent'],
  name: 'Agent Controlled Disclosure Policy v1',
  jurisdiction: 'US',
  version: '0.1.0-poc',
  raw_content_seen_by_zeroh_saas: false,
  protection_engine: {
    preferred_engine: 'regex-local',
    fallback_engine: 'regex-local',
    default_mode: 'fail_closed',
    regulated_mode: 'fail_closed',
  },
  rules: [
    {
      id: 'AGENT-SECRETS-BLOCK',
      action: 'block',
      when: { any_category: ['API_KEY', 'PRIVATE_KEY'] },
      reason: 'Secrets must not cross agent or AI boundaries.',
    },
    {
      id: 'AGENT-SENSITIVE-MASK',
      action: 'mask_and_allow',
      when: { any_category: ['QATAR_ID', 'IBAN', 'CARD_NUMBER', 'ACCOUNT_NUMBER', 'EMAIL', 'PHONE_NUMBER'] },
      mask_categories: ['QATAR_ID', 'IBAN', 'CARD_NUMBER', 'ACCOUNT_NUMBER', 'EMAIL', 'PHONE_NUMBER'],
      reason: 'Sensitive values are tokenized locally before release.',
    },
    {
      id: 'AGENT-ALLOW-WITH-RECEIPT',
      action: 'allow_with_receipt',
      when: { always: true },
      reason: 'Allowed agent action still creates accountability evidence.',
    },
  ],
};
