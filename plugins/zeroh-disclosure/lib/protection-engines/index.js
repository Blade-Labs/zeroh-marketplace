import { canonicalJson, sha256B64u } from '../crypto.js';
import { regexLocalProtectionEngine } from './regex-local.js';
import { presidioHttpProtectionEngine } from './presidio-http.js';

const ENGINES = new Map([
  [regexLocalProtectionEngine.id, regexLocalProtectionEngine],
  [presidioHttpProtectionEngine.id, presidioHttpProtectionEngine],
]);

export function getProtectionEngine(id) {
  const engine = ENGINES.get(id);
  if (!engine) {
    throw new Error(`Unknown protection engine "${id}". Known engines: ${[...ENGINES.keys()].join(', ')}`);
  }
  return engine;
}

export function listProtectionEngines() {
  return [...ENGINES.keys()];
}

export async function resolveProtectionEngine({ policy, requestedEngineId = null, boundary = {}, mode = null } = {}) {
  const protection = policy?.protection_engine ?? {};
  const requested = requestedEngineId || process.env.ZEROH_PROTECTION_ENGINE || protection.preferred_engine || 'regex-local';
  const policyMode = mode || process.env.ZEROH_POLICY_MODE || protection.default_mode || 'fallback_with_receipt';
  const fallbackId = protection.fallback_engine || 'regex-local';
  const primary = getProtectionEngine(requested);
  const primaryHealth = await primary.health({ policy, boundary });
  if (primaryHealth.ok) {
    return buildEngineContext({
      engine: primary,
      policy,
      boundary,
      requested,
      selected: primary.id,
      status: 'selected',
      fallback: false,
      fallbackMode: policyMode,
    });
  }

  const failClosed = policyMode === 'fail_closed' || policyMode === protection.regulated_mode;
  if (failClosed || fallbackId === requested) {
    throw new Error(`Protection engine ${requested} unavailable: ${primaryHealth.error || 'health check failed'}`);
  }

  const fallback = getProtectionEngine(fallbackId);
  const fallbackHealth = await fallback.health({ policy, boundary });
  if (!fallbackHealth.ok) {
    throw new Error(
      `Protection engine ${requested} unavailable (${primaryHealth.error || 'health check failed'}); fallback ${fallbackId} unavailable (${fallbackHealth.error || 'health check failed'})`,
    );
  }
  return buildEngineContext({
    engine: fallback,
    policy,
    boundary,
    requested,
    selected: fallback.id,
    status: 'fallback',
    fallback: true,
    fallbackMode: policyMode,
    reason: primaryHealth.error || 'preferred engine health check failed',
  });
}

export async function engineHash(manifest) {
  return sha256B64u(canonicalJson(manifest));
}

async function buildEngineContext({ engine, policy, boundary, requested, selected, status, fallback, fallbackMode, reason = null }) {
  const manifest = await engine.manifest({ policy, boundary });
  return {
    engine,
    manifest,
    hash: await engineHash(manifest),
    resolution: {
      requested_engine_id: requested,
      selected_engine_id: selected,
      status,
      fallback,
      fallback_mode: fallbackMode,
      reason,
    },
  };
}
