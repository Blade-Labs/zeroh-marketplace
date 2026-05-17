import { hmacSha256B64u } from '../crypto.js';

const DEFAULT_ANALYZER_URL = 'http://localhost:5002/analyze';
const DEFAULT_ANONYMIZER_URL = 'http://localhost:5001/anonymize';

const DEFAULT_ENTITY_MAP = {
  EMAIL: { presidio: 'EMAIL_ADDRESS', replacement: '[EMAIL]' },
  PHONE_NUMBER: { presidio: 'PHONE_NUMBER', replacement: '[PHONE_NUMBER]' },
  PERSON: { presidio: 'PERSON', replacement: '[PERSON]' },
  CARD_NUMBER: { presidio: 'CREDIT_CARD', replacement: '[CARD_NUMBER]' },
  IBAN: { presidio: 'IBAN_CODE', replacement: '[IBAN]' },
  ACCOUNT_NUMBER: { presidio: 'US_BANK_NUMBER', replacement: '[ACCOUNT_NUMBER]' },
};

export const presidioHttpProtectionEngine = {
  id: 'presidio-http',

  async health({ policy } = {}) {
    const analyzerUrl = analyzerEndpoint();
    try {
      await postJson(analyzerUrl, {
        text: 'health check alice@example.com',
        language: 'en',
        entities: presidioEntities(policy),
      }, Number(process.env.PRESIDIO_HEALTH_TIMEOUT_MS || 800));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  },

  async analyze({ text, policy }) {
    const rows = await postJson(analyzerEndpoint(), {
      text,
      language: process.env.PRESIDIO_LANGUAGE || 'en',
      entities: presidioEntities(policy),
      score_threshold: Number(process.env.PRESIDIO_SCORE_THRESHOLD || 0.35),
    });
    const reverse = reverseEntityMap(policy);
    return rows
      .map((r) => {
        const type = reverse.get(r.entity_type);
        if (!type) return null;
        return {
          type,
          source_entity_type: r.entity_type,
          risk: riskFor(type),
          start: r.start,
          end: r.end,
          length: Math.max(0, r.end - r.start),
          confidence: typeof r.score === 'number' ? r.score : 0.5,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start || b.end - a.end);
  },

  async transform({ text, findings, hmacKeyBytes, categoriesToMask, policy }) {
    const maskSet = categoriesToMask ? new Set(categoriesToMask) : null;
    const map = entityMap(policy);
    const analyzerResults = findings
      .filter((f) => (!maskSet || maskSet.has(f.type)) && map[f.type]?.presidio)
      .map((f) => ({
        start: f.start,
        end: f.end,
        score: f.confidence,
        entity_type: map[f.type].presidio,
      }));
    const anonymizers = { DEFAULT: { type: 'replace', new_value: '[REDACTED]' } };
    for (const [type, cfg] of Object.entries(map)) {
      if (!cfg.presidio) continue;
      anonymizers[cfg.presidio] = {
        type: cfg.operator || 'replace',
        new_value: cfg.replacement || `[${type}]`,
      };
    }
    const result = analyzerResults.length === 0
      ? { text }
      : await postJson(anonymizerEndpoint(), {
          text,
          analyzer_results: analyzerResults,
          anonymizers,
        });
    const replacements = [];
    for (const f of findings) {
      if (maskSet && !maskSet.has(f.type)) continue;
      const raw = text.slice(f.start, f.end);
      const replacement = map[f.type]?.replacement || `[${f.type}]`;
      replacements.push({
        entity_type: f.type,
        source_entity_type: f.source_entity_type || map[f.type]?.presidio || null,
        risk: f.risk,
        start: f.start,
        end: f.end,
        original_length: raw.length,
        replacement,
        value_commitment: await hmacSha256B64u(hmacKeyBytes, { type: f.type, value: raw }),
      });
    }
    return {
      sanitized_text: result.text ?? text,
      replacements,
      masked_categories: [...new Set(replacements.map((r) => r.entity_type))],
    };
  },

  async manifest({ policy } = {}) {
    return {
      id: 'presidio-http',
      interface_version: 'zeroh-protection-engine/v1',
      provider: 'microsoft-presidio',
      engine: 'presidio-http-sidecar',
      cloud_calls: false,
      analyzer_url: analyzerEndpoint(),
      anonymizer_url: anonymizerEndpoint(),
      language: process.env.PRESIDIO_LANGUAGE || 'en',
      score_threshold: Number(process.env.PRESIDIO_SCORE_THRESHOLD || 0.35),
      entity_map: entityMap(policy),
    };
  },
};

function analyzerEndpoint() {
  return process.env.PRESIDIO_ANALYZER_URL || DEFAULT_ANALYZER_URL;
}

function anonymizerEndpoint() {
  return process.env.PRESIDIO_ANONYMIZER_URL || DEFAULT_ANONYMIZER_URL;
}

function entityMap(policy) {
  return { ...DEFAULT_ENTITY_MAP, ...(policy?.protection_engine?.entities ?? {}) };
}

function presidioEntities(policy) {
  return [...new Set(Object.values(entityMap(policy)).map((v) => v.presidio).filter(Boolean))];
}

function reverseEntityMap(policy) {
  const out = new Map();
  for (const [type, cfg] of Object.entries(entityMap(policy))) {
    if (cfg.presidio) out.set(cfg.presidio, type);
  }
  return out;
}

function riskFor(type) {
  if (['CARD_NUMBER', 'IBAN', 'ACCOUNT_NUMBER', 'QATAR_ID'].includes(type)) return 'high';
  return 'medium';
}

async function postJson(url, body, timeoutMs = Number(process.env.PRESIDIO_TIMEOUT_MS || 5000)) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${url} ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}
