export const qcbAiDisclosurePolicyV1 = {
  policy_id: 'qcb-ai-disclosure-v1',
  aliases: ['qcb'],
  name: 'QCB AI Disclosure Demo Policy v1',
  jurisdiction: 'QA',
  version: '0.1.0-mvp',
  raw_content_seen_by_zeroh_saas: false,
  rules: [
    {
      id: 'ZEROH-SECRETS-NEVER-DISCLOSE-TO-AI',
      action: 'block',
      when: { any_category: ['API_KEY', 'PRIVATE_KEY'] },
      reason: 'Secrets and private keys must never be sent to AI systems.',
    },
    {
      id: 'QCB-CROSS-BORDER-SENSITIVE-APPROVAL',
      action: 'approval_required',
      when: {
        boundary_type: ['external_ai_processor', 'cross_border_ai'],
        destination_jurisdiction_not: ['QA'],
        any_category: ['QATAR_ID', 'IBAN', 'CARD_NUMBER', 'ACCOUNT_NUMBER', 'EMAIL', 'PHONE_NUMBER', 'PERSON'],
        retention_not: ['zdr', 'none', 'customer_managed'],
      },
      reason: 'Sensitive data crossing a non-Qatar AI/cloud boundary without ZDR requires human approval.',
    },
    {
      id: 'QCB-MASK-SENSITIVE-BEFORE-AI',
      action: 'mask_and_allow',
      when: { any_category: ['QATAR_ID', 'IBAN', 'CARD_NUMBER', 'ACCOUNT_NUMBER', 'EMAIL', 'PHONE_NUMBER', 'PERSON'] },
      mask_categories: ['QATAR_ID', 'IBAN', 'CARD_NUMBER', 'ACCOUNT_NUMBER', 'EMAIL', 'PHONE_NUMBER', 'PERSON'],
      reason: 'Sensitive categories are masked locally before AI boundary crossing.',
    },
    {
      id: 'ZEROH-ALLOW-WITH-RECEIPT',
      action: 'allow_with_receipt',
      when: { always: true },
      reason: 'No regulated category detected; still create disclosure evidence.',
    },
  ],
};
