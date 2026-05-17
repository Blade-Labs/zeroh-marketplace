import { promises as fs } from 'node:fs';
import path from 'node:path';
import { qcbAiDisclosurePolicyV1 } from './policies/qcb-ai-disclosure.v1.js';
import { bladeAiDisclosurePolicyV1 } from './policies/blade-ai-disclosure.v1.js';
import { agentControlledDisclosurePolicyV1 } from './policies/agent-controlled-disclosure.v1.js';

const POLICIES = [qcbAiDisclosurePolicyV1, bladeAiDisclosurePolicyV1, agentControlledDisclosurePolicyV1];

export function listPolicies() {
  return POLICIES.map((policy) => ({
    policy_id: policy.policy_id,
    aliases: policy.aliases ?? [],
    name: policy.name,
    version: policy.version,
  }));
}

export function resolvePolicy(value = null) {
  const key = normalizePolicyKey(value || process.env.ZEROH_POLICY || 'qcb');
  const policy = POLICIES.find((p) =>
    normalizePolicyKey(p.policy_id) === key ||
    normalizePolicyKey(p.name) === key ||
    (p.aliases ?? []).some((a) => normalizePolicyKey(a) === key)
  );
  if (!policy) {
    const allowed = POLICIES.flatMap((p) => [p.policy_id, ...(p.aliases ?? [])]).join(', ');
    throw new Error(`Unknown ZeroH policy "${value}". Known policies: ${allowed}`);
  }
  const alias = (policy.aliases ?? []).find((a) => normalizePolicyKey(a) === key) ?? policy.policy_id;
  return { policy, alias };
}

export async function resolveActivePolicy({ cwd = process.cwd(), sessionState = {}, explicit = null } = {}) {
  if (explicit) return resolvePolicy(explicit);
  if (process.env.ZEROH_POLICY) return resolvePolicy(process.env.ZEROH_POLICY);
  if (sessionState.active_policy_id) return resolvePolicy(sessionState.active_policy_id);
  if (sessionState.active_policy_alias) return resolvePolicy(sessionState.active_policy_alias);
  const filePolicy = await readProjectPolicy(cwd);
  if (filePolicy) return resolvePolicy(filePolicy);
  return resolvePolicy('qcb');
}

export async function readProjectPolicy(cwd = process.cwd()) {
  try {
    const raw = await fs.readFile(path.join(cwd, '.zeroh.policy'), 'utf8');
    const value = raw.trim();
    if (!value) return null;
    if (value.startsWith('{')) {
      const parsed = JSON.parse(value);
      return parsed.policy || parsed.policy_id || parsed.alias || null;
    }
    return value.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith('#'))?.trim() ?? null;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export function activationFromPrompt(prompt) {
  const text = String(prompt ?? '').trim();
  const match = text.match(/^(?:hi\s+\w+[,\s]+)?apply\s+([A-Za-z0-9_-]+)\s+policy\.?$/i);
  if (!match) return null;
  return resolvePolicy(match[1]);
}

export function normalizePolicyKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}
