const RULES = [
  {
    type: 'PRIVATE_KEY',
    risk: 'critical',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    confidence: 0.99,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\b(?:sk|pk|rk|api)[-_]?(?:live|test|prod)?[-_][A-Za-z0-9_\-]{12,}\b/g,
    confidence: 0.94,
  },
  {
    type: 'IBAN',
    risk: 'high',
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    confidence: 0.91,
    validate: (s) => /^[A-Z]{2}\d{2}/.test(s) && s.length >= 15 && s.length <= 34,
  },
  { type: 'QATAR_ID', risk: 'high', pattern: /\b[23]\d{10}\b/g, confidence: 0.88 },
  {
    type: 'CARD_NUMBER',
    risk: 'high',
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    confidence: 0.82,
    validate: (s) => luhn(s.replace(/\D/g, '')),
  },
  {
    type: 'EMAIL',
    risk: 'medium',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    confidence: 0.86,
  },
  {
    type: 'PHONE_NUMBER',
    risk: 'medium',
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{3,4}/g,
    confidence: 0.7,
    validate: (s) => s.replace(/\D/g, '').length >= 8,
  },
  {
    type: 'ACCOUNT_NUMBER',
    risk: 'medium',
    pattern: /\b(?:account|acct|customer|client|cif)[\s:#-]*(\d{6,18})\b/gi,
    confidence: 0.78,
  },
  {
    type: 'PERSON',
    risk: 'medium',
    pattern: /\b([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+-[A-Z][a-z]+|bin|bint|al|Al|Abdul|[A-Z][a-z]+)){1,4})\b/g,
    confidence: 0.58,
    validate: (s) => !/^(Summarize|Analyze|Review|Use|Customer|Client|QID|IBAN|API|OpenRouter|ZeroH)\b/.test(s),
  },
];

function luhn(value) {
  if (!/^\d{13,19}$/.test(value)) return false;
  let sum = 0,
    d = false;
  for (let i = value.length - 1; i >= 0; i--) {
    let n = +value[i];
    if (d) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    d = !d;
  }
  return sum % 10 === 0;
}

function score(f) {
  return ({ critical: 100, high: 50, medium: 25, low: 10 }[f.risk] ?? 0) + f.confidence * 10 + f.length / 100;
}

function dedupe(fs) {
  const out = [];
  for (const f of fs) {
    const o = out.find((x) => f.start < x.end && x.start < f.end);
    if (!o) out.push(f);
    else if (score(f) > score(o)) out[out.indexOf(o)] = f;
  }
  return out.sort((a, b) => a.start - b.start);
}

export function detectSensitiveData(text, { enabledTypes = null } = {}) {
  const findings = [];
  for (const rule of RULES) {
    if (enabledTypes && !enabledTypes.includes(rule.type)) continue;
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const value = match[1] && rule.type === 'ACCOUNT_NUMBER' ? match[1] : match[0];
      const start = rule.type === 'ACCOUNT_NUMBER' ? match.index + match[0].lastIndexOf(value) : match.index;
      const end = start + value.length;
      if (rule.validate && !rule.validate(value)) continue;
      findings.push({ type: rule.type, risk: rule.risk, start, end, length: value.length, confidence: rule.confidence });
    }
  }
  return dedupe(findings.sort((a, b) => a.start - b.start || b.end - a.end));
}

export function detectorManifest() {
  return {
    id: 'zeroh-mask-plugin-detector-v1',
    engine: 'regex-local',
    cloud_calls: false,
    categories: RULES.map((r) => ({ type: r.type, risk: r.risk, confidence: r.confidence })),
  };
}
