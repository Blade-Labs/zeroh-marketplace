#!/usr/bin/env node
import { loadConfig } from '../../lib/config.js';
import { loadSession, writeJson } from '../../lib/session.js';
import { resolvePolicy } from '../../lib/policy-registry.js';

await loadConfig({ cwd: process.cwd() });
const alias = process.argv.slice(2).find((a) => !a.startsWith('-')) || 'blade';
const { policy, alias: resolvedAlias } = resolvePolicy(alias);
const session = await loadSession({ cwd: process.cwd(), sessionId: process.env.CLAUDE_SESSION_ID });

session.state.active_policy_id = policy.policy_id;
session.state.active_policy_alias = resolvedAlias;
session.state.updated_at = new Date().toISOString();
await writeJson(session.statePath, session.state);

console.log(`ZeroH Disclosure policy active`);
console.log(`policy_id: ${policy.policy_id}`);
console.log(`alias: ${resolvedAlias}`);
console.log(`session_dir: ${session.dir}`);
console.log(`No model prompt content was required to activate this policy.`);
