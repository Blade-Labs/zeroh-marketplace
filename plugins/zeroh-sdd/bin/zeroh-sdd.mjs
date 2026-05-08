#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const VERSION = '1.0.8';
const STATE_DIR = ['.specify', 'workflows'];
const ACTIVE_STAGE = 'active-stage.json';
const HOOK_STATE = 'hook-state.json';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  enforcementMode: 'balanced',
  jitMode: 'async-rewake',
  shapeWatch: true,
  maxShapeContext: 12,
  doctorOnFinish: true,
});
const WINDOWS_CMD_PREFERRED = Object.freeze(['pnpm', 'npm', 'npx', 'biome', 'vitest', 'tsc']);

const AP = {
  CONTRACT_DRIFT: 'AP_CONTRACT_DRIFT',
  DUMB_REQUIREMENT: 'AP_DUMB_REQUIREMENT',
  CEREMONY: 'AP_CEREMONY',
  SHORTCUT: 'AP_SHORTCUT',
  PARSE_BOUNDARY: 'AP_PARSE_BOUNDARY',
  SILENT_FAIL: 'AP_SILENT_FAIL',
  TEST_CAPITULATION: 'AP_TEST_CAPITULATION',
  HARDCODED_DATA: 'AP_HARDCODED_DATA',
};

const FINDING_SCOPES = Object.freeze(['edited-file', 'active-stage', 'proof-command', 'repo-background']);
const BASELINE_STATUSES = Object.freeze(['current-edit', 'pre-existing', 'unknown']);
const OWNER_ACTIONS = Object.freeze(['fix-now', 'receipt-note', 'replan', 'branch-health-followup']);
const HOOK_ADAPTERS = Object.freeze(['claude', 'codex']);
let CURRENT_HOOK_ADAPTER = 'claude';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    switch (command) {
      case 'check':
        return cliCheck(args);
      case 'doctor':
        return cliDoctor(args);
      case 'stage':
        return cliStage(args);
      case 'jit':
        return cliJit(args);
      case 'hook':
        return cliHook(args);
      case 'self-test':
        return cliSelfTest(args);
      case '--version':
      case '-v':
        console.log(VERSION);
        return;
      case '--help':
      case '-h':
      case undefined:
        printHelp();
        return;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(helpText());
}

function helpText(topic = 'root') {
  const topics = {
    root: `zeroh-sdd ${VERSION}

Usage:
  zeroh-sdd check --plan <path>
  zeroh-sdd doctor --plan <path>
  zeroh-sdd stage set --stage <name> --step-id <id> --plan <path> --allow exact:<path> --proof-command <cmd> --stop-rule <rule>
  zeroh-sdd stage finish --status passed|failed|blocked --proof-result <text> [--changed <path>] [--opened <id>] [--closed <id>] [--next-adjustment <text>]
  zeroh-sdd stage status
  zeroh-sdd stage clear
  zeroh-sdd jit --file <path>
  zeroh-sdd hook <event> [--adapter claude|codex]
  zeroh-sdd self-test

Run zeroh-sdd <command> --help for command details.`,
    check: `zeroh-sdd check --plan <path>

Validate that a plan has exactly one fenced sdd YAML block and that the v1 schema is structurally complete.`,
    doctor: `zeroh-sdd doctor --plan <path>

Run repo-truth checks on an execution spec: declared surfaces, validation commands, receipts, tracker bridge, and shape gates.`,
    stage: `zeroh-sdd stage set|status|finish|clear

Manage .specify/workflows/active-stage.json.

Use:
  zeroh-sdd stage set --stage <name> --step-id <id> --plan <path> --allow exact:<path> --proof-command <cmd> --stop-rule <rule>
  zeroh-sdd stage finish --status passed|failed|blocked --proof-result <text> [--changed <path>] [--opened <id>] [--closed <id>] [--next-adjustment <text>]
  zeroh-sdd stage status
  zeroh-sdd stage clear`,
    'stage set': `zeroh-sdd stage set --stage <name> --step-id <id> --plan <path> --allow exact:<path>|prefix:<path> --proof-command <cmd> --stop-rule <rule>

Open one active execution gate. Hooks block writes outside the allowed surface until a receipt closes the stage.`,
    'stage finish': `zeroh-sdd stage finish --status passed|failed|blocked --proof-result <text> [--changed <path>] [--opened <id>] [--closed <id>] [--next-adjustment <text>]

Write the execution receipt into the active plan and clear the active stage.

Failed or blocked receipts require --next-adjustment so the next step is an explicit replan, not drift from memory.`,
    'stage status': `zeroh-sdd stage status

Print active-stage.json when a stage is open, or "sdd-stage: inactive" when no gate is active.`,
    'stage clear': `zeroh-sdd stage clear

Clear the active stage without writing a receipt. Use only when explicitly abandoning or replanning the gate.`,
    jit: `zeroh-sdd jit --file <path>

Classify an edited surface and run the smallest deterministic check currently selected by the runtime.`,
    hook: `zeroh-sdd hook <event> [--adapter claude|codex]

LLM-agent hook entrypoint. Claude Code normally calls this through hooks/hooks.json and CLAUDE_PLUGIN_ROOT. Codex adapter support is explicit with --adapter codex until Codex hook wiring is enabled.`,
    'self-test': `zeroh-sdd self-test [name]

Run bundled runtime self-tests. Pass a specific test name such as skill-content to run one test.`,
  };
  return topics[topic] || topics.root;
}

function cliCheck(args) {
  if (wantsHelp(args)) {
    console.log(helpText('check'));
    return;
  }
  const plan = requireFlag(args, '--plan');
  const result = checkPlan({ repoRoot: projectRoot(), planPath: plan });
  printSddReport('sdd-check', result);
  if (!result.ok) process.exitCode = 1;
}

function cliDoctor(args) {
  if (wantsHelp(args)) {
    console.log(helpText('doctor'));
    return;
  }
  const plan = requireFlag(args, '--plan');
  const result = doctorPlan({ repoRoot: projectRoot(), planPath: plan });
  printSddReport('sdd-doctor', result);
  if (!result.ok) process.exitCode = 1;
}

function cliStage(args) {
  const subcommand = args[0];
  const repoRoot = projectRoot();
  if (wantsHelp(args)) {
    const topic = subcommand && !subcommand.startsWith('-') ? `stage ${subcommand}` : 'stage';
    console.log(helpText(topic));
    return;
  }
  if (subcommand === 'set') {
    const state = setActiveStage({
      repoRoot,
      stage: requireFlag(args, '--stage'),
      stepId: flagValue(args, '--step-id') || requireFlag(args, '--stage'),
      planPath: requireFlag(args, '--plan'),
      allow: flagValues(args, '--allow'),
      proofCommand: flagValue(args, '--proof-command') || '',
      stopRule: flagValue(args, '--stop-rule') || '',
    });
    console.log(`sdd-stage: set ${state.stage} (${state.allowedPaths.length} allowed path(s))`);
    return;
  }
  if (subcommand === 'status') {
    const state = readActiveStage(repoRoot);
    if (!state) {
      console.log('sdd-stage: inactive');
      return;
    }
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (subcommand === 'clear') {
    clearActiveStage(repoRoot);
    console.log('sdd-stage: cleared');
    return;
  }
  if (subcommand === 'finish') {
    const config = runtimeConfig();
    const result = finishActiveStage({
      repoRoot,
      status: flagValue(args, '--status') || 'passed',
      changed: flagValues(args, '--changed'),
      proofResult: requireFlag(args, '--proof-result'),
      opened: flagValues(args, '--opened'),
      closed: flagValues(args, '--closed'),
      nextAdjustment: flagValue(args, '--next-adjustment') || '',
      runDoctor: !hasFlag(args, '--skip-doctor') && config.doctorOnFinish,
    });
    console.log(`sdd-stage: finished ${result.stepId} (${result.status})`);
    if (result.status !== 'passed') {
      console.log('sdd-stage: failed or blocked gate closed; start a new execution-spec before editing further.');
    }
    return;
  }
  throw new Error('sdd:stage requires set, status, finish, or clear.');
}

function cliJit(args) {
  if (wantsHelp(args)) {
    console.log(helpText('jit'));
    return;
  }
  const file = requireFlag(args, '--file');
  const result = runRelevantChecks({ repoRoot: projectRoot(), filePath: file, writeState: true });
  const context = renderJitContext(result);
  if (context) {
    console.log(context);
    process.exitCode = 1;
    return;
  }
  console.log(`sdd-jit: ${result.status} (${result.lastCheck})`);
}

function cliHook(args) {
  if (wantsHelp(args)) {
    console.log(helpText('hook'));
    return;
  }
  const event = hookEventArg(args);
  if (!event) throw new Error('zeroh-sdd hook requires an event name.');
  const adapter = detectHookAdapter(args);
  const input = readJsonStdin();
  const output = withHookAdapter(adapter, () => handleHook(event, input, projectRoot()));
  emitHookResult(output);
}

function cliSelfTest(args) {
  if (wantsHelp(args)) {
    console.log(helpText('self-test'));
    return;
  }
  const suite = flagValue(args, '--suite') || args[0] || 'all';
  runSelfTests(suite);
}

function checkPlan({ repoRoot, planPath }) {
  const absolutePlan = resolve(repoRoot, planPath);
  const findings = [];
  if (!existsSync(absolutePlan)) {
    return {
      ok: false,
      planPath: absolutePlan,
      findings: [finding('P0', 'SDD000', AP.CONTRACT_DRIFT, `Plan file does not exist: ${planPath}`)],
    };
  }
  const markdown = readFileSync(absolutePlan, 'utf8');
  const fences = extractSddFences(markdown);
  if (fences.length !== 1) {
    findings.push(finding(
      'P0',
      'SDD001',
      AP.DUMB_REQUIREMENT,
      `Expected exactly one fenced sdd YAML block; found ${fences.length}.`,
      ['Add one ```sdd fenced YAML block with a top-level sdd object.'],
    ));
    return { ok: false, planPath: absolutePlan, markdown, findings };
  }

  let parsed;
  try {
    parsed = parseSimpleYaml(fences[0]);
  } catch (error) {
    findings.push(finding(
      'P0',
      'SDD002',
      AP.DUMB_REQUIREMENT,
      `SDD YAML did not parse: ${error instanceof Error ? error.message : String(error)}`,
      ['Fix the fenced sdd block before implementation begins.'],
    ));
    return { ok: false, planPath: absolutePlan, markdown, findings };
  }

  validateSddDocument(parsed, findings);
  return {
    ok: !hasP0(findings),
    planPath: absolutePlan,
    markdown,
    document: parsed,
    findings,
  };
}

function doctorPlan({ repoRoot, planPath, skipGit = false }) {
  const result = checkPlan({ repoRoot, planPath });
  const findings = [...result.findings];
  const doc = result.document?.sdd;
  const markdown = result.markdown || '';

  if (!doc) return { ...result, findings, ok: false };

  if (!skipGit) {
    const behind = headBehindPrimaryRemote(repoRoot);
    if (behind > 0) {
      findings.push(finding(
        'P1',
        'SDD010',
        AP.CONTRACT_DRIFT,
        `Branch is ${behind} commit(s) behind its primary remote.`,
        ['Rebase or explicitly record why stale branch state is acceptable for this stage.'],
      ));
    }
  }

  const gate = doc.stage_gate;
  if (gate) {
    validateStageSurfaces(repoRoot, gate, markdown, findings);
    validateCodeRowsAgainstSurfaces(gate, markdown, findings);
    validateValidationCommands(repoRoot, doc.validation?.commands || [], findings);
  }

  validateReceiptDiscipline(markdown, findings);
  validateShapeGate(repoRoot, doc.shape_gate, findings);
  validateTrackerBridge(repoRoot, doc.tracker, findings);

  return {
    ...result,
    findings,
    ok: !hasP0(findings),
  };
}

function validateSddDocument(root, findings) {
  const sdd = root?.sdd;
  if (!isObject(sdd)) {
    findings.push(finding('P0', 'SDD003', AP.DUMB_REQUIREMENT, 'SDD block must contain a top-level sdd object.'));
    return;
  }
  if (sdd.version !== 1) {
    findings.push(finding('P0', 'SDD004', AP.CONTRACT_DRIFT, 'sdd.version must be 1.'));
  }
  requireString(sdd, 'id', findings, 'SDD005', AP.DUMB_REQUIREMENT, 'sdd.id is required.');
  if (!['draft', 'ready', 'executing', 'closed'].includes(String(sdd.status || ''))) {
    findings.push(finding('P0', 'SDD006', AP.DUMB_REQUIREMENT, 'sdd.status must be draft, ready, executing, or closed.'));
  }

  requireObject(sdd, 'requirement', findings, 'SDD007', AP.DUMB_REQUIREMENT, 'sdd.requirement is required.');
  requireString(sdd.requirement, 'owner', findings, 'SDD008', AP.DUMB_REQUIREMENT, 'requirement.owner is required.');
  requireNonEmptyArray(sdd.requirement, 'evidence', findings, 'SDD009', AP.DUMB_REQUIREMENT, 'requirement.evidence must cite proof inputs.');
  requireString(sdd.requirement, 'why_now', findings, 'SDD010', AP.DUMB_REQUIREMENT, 'requirement.why_now is required.');

  requireObject(sdd, 'change', findings, 'SDD011', AP.DUMB_REQUIREMENT, 'sdd.change is required.');
  requireString(sdd.change, 'intent', findings, 'SDD012', AP.DUMB_REQUIREMENT, 'change.intent is required.');
  requireArray(sdd.change, 'adds', findings, 'SDD013', AP.CEREMONY, 'change.adds must be an array.');
  requireArray(sdd.change, 'deletes_or_subsumes', findings, 'SDD014', AP.CEREMONY, 'change.deletes_or_subsumes must be an array.');
  if ((sdd.change?.adds || []).length > 0 && (sdd.change?.deletes_or_subsumes || []).length === 0 && !sdd.change?.deletion_exception) {
    findings.push(finding('P0', 'SDD015', AP.CEREMONY, 'Adds require a deletion/subsumption story or deletion_exception.'));
  }

  requireObject(sdd, 'source_authority', findings, 'SDD016', AP.DUMB_REQUIREMENT, 'sdd.source_authority is required.');
  requireArray(sdd.source_authority, 'official_sources', findings, 'SDD017', AP.DUMB_REQUIREMENT, 'source_authority.official_sources must be an array.');
  requireArray(sdd.source_authority, 'local_extensions', findings, 'SDD018', AP.DUMB_REQUIREMENT, 'source_authority.local_extensions must be an array.');
  requireArray(sdd.source_authority, 'prohibited_shortcuts', findings, 'SDD019', AP.SHORTCUT, 'source_authority.prohibited_shortcuts must be an array.');

  requireObject(sdd, 'simplification_proof', findings, 'SDD020', AP.CEREMONY, 'sdd.simplification_proof is required.');
  requireNonEmptyArray(sdd.simplification_proof, 'preserves', findings, 'SDD021', AP.CEREMONY, 'simplification_proof.preserves must list preserved invariants.');

  requireObject(sdd, 'validation', findings, 'SDD022', AP.DUMB_REQUIREMENT, 'sdd.validation is required.');
  requireNonEmptyArray(sdd.validation, 'commands', findings, 'SDD023', AP.DUMB_REQUIREMENT, 'validation.commands must be runnable command strings.');
  requireArray(sdd.validation, 'proof_tiers', findings, 'SDD024', AP.DUMB_REQUIREMENT, 'validation.proof_tiers must be an array.');

  requireObject(sdd, 'stage_gate', findings, 'SDD025', AP.DUMB_REQUIREMENT, 'sdd.stage_gate is required for v1 execution specs.');
  if (isObject(sdd.stage_gate)) {
    for (const key of ['next_gate', 'first_executable_slice', 'proof_command', 'stop_rule', 'replan_trigger']) {
      requireString(sdd.stage_gate, key, findings, 'SDD026', AP.DUMB_REQUIREMENT, `stage_gate.${key} is required.`);
    }
    requireObject(sdd.stage_gate, 'surfaces', findings, 'SDD027', AP.CONTRACT_DRIFT, 'stage_gate.surfaces is required.');
    for (const key of ['existing', 'creates', 'future']) {
      requireArray(sdd.stage_gate.surfaces, key, findings, 'SDD028', AP.CONTRACT_DRIFT, `stage_gate.surfaces.${key} must be an array.`);
    }
  }

  if (sdd.shape_gate !== undefined) {
    requireObject(sdd, 'shape_gate', findings, 'SDD029', AP.PARSE_BOUNDARY, 'sdd.shape_gate must be an object when present.');
    requireArray(sdd.shape_gate, 'required_shapes', findings, 'SDD030', AP.PARSE_BOUNDARY, 'shape_gate.required_shapes must be an array.');
    requireArray(sdd.shape_gate, 'parse_boundaries', findings, 'SDD031', AP.PARSE_BOUNDARY, 'shape_gate.parse_boundaries must be an array.');
    if (sdd.shape_gate?.status && !['red', 'green', 'blocked', 'not-started'].includes(String(sdd.shape_gate.status))) {
      findings.push(finding('P0', 'SDD032', AP.PARSE_BOUNDARY, 'shape_gate.status must be red, green, blocked, or not-started.'));
    }
  }

  if (sdd.tracker !== undefined) {
    requireObject(sdd, 'tracker', findings, 'SDD044', AP.CONTRACT_DRIFT, 'sdd.tracker must be an object when present.');
    requireString(sdd.tracker, 'kind', findings, 'SDD045', AP.CONTRACT_DRIFT, 'tracker.kind is required.');
    requireString(sdd.tracker, 'path', findings, 'SDD046', AP.CONTRACT_DRIFT, 'tracker.path is required.');
    requireString(sdd.tracker, 'phase_id', findings, 'SDD047', AP.CONTRACT_DRIFT, 'tracker.phase_id is required.');
    requireString(sdd.tracker, 'item_id', findings, 'SDD048', AP.CONTRACT_DRIFT, 'tracker.item_id is required.');
    requireString(sdd.tracker, 'todo_policy', findings, 'SDD049', AP.CONTRACT_DRIFT, 'tracker.todo_policy is required.');
    if (isObject(sdd.tracker)) {
      if (sdd.tracker.kind !== 'epic') {
        findings.push(finding('P0', 'SDD050', AP.CONTRACT_DRIFT, 'tracker.kind must be epic in v1.'));
      }
      if (sdd.tracker.todo_policy !== 'mirror-current-slice') {
        findings.push(finding('P0', 'SDD051', AP.CONTRACT_DRIFT, 'tracker.todo_policy must be mirror-current-slice in v1.'));
      }
    }
  }
}

function validateStageSurfaces(repoRoot, gate, markdown, findings) {
  for (const surface of gate.surfaces?.existing || []) {
    if (!surfaceExists(repoRoot, surface)) {
      findings.push(finding('P0', 'SDD033', AP.CONTRACT_DRIFT, `stage_gate.surfaces.existing does not exist: ${surface}`));
    }
  }
  for (const surface of gate.surfaces?.creates || []) {
    if (surfaceExists(repoRoot, surface)) {
      findings.push(finding('P0', 'SDD034', AP.CONTRACT_DRIFT, `stage_gate.surfaces.creates already exists: ${surface}`));
    }
  }
  for (const surface of gate.surfaces?.future || []) {
    const escaped = escapeRegExp(surface);
    if (new RegExp(`\\b${escaped}\\b`).test(markdown) && /(?:implement|edit|change|add|write|test)/i.test(markdown)) {
      findings.push(finding('P1', 'SDD035', AP.CEREMONY, `Future surface is mentioned in executable prose: ${surface}`));
    }
  }
}

function validateCodeRowsAgainstSurfaces(gate, markdown, findings) {
  const declared = [
    ...(gate.surfaces?.existing || []),
    ...(gate.surfaces?.creates || []),
    ...(gate.surfaces?.future || []),
  ];
  const surfaces = extractCodeSurfaces(markdown);
  for (const surface of surfaces) {
    if (!isDeclaredSurface(surface, declared)) {
      findings.push(finding(
        'P0',
        'SDD036',
        AP.CONTRACT_DRIFT,
        `Code-bearing row references a surface not listed in stage_gate.surfaces: ${surface}`,
        ['Add the surface to existing/creates/future, or remove the executable row.'],
      ));
    }
  }
}

function validateValidationCommands(repoRoot, commands, findings) {
  for (const command of commands) {
    if (!/\b(test|check|typecheck|doctor|build|lint)\b/i.test(command)) {
      findings.push(finding('P1', 'SDD037', AP.DUMB_REQUIREMENT, `Validation command does not look like a proof command: ${command}`));
    }
    const packageMatch = command.match(/--filter[=\s]+(@?[-\w./]+\/[-\w.]+|@?[-\w.]+)/);
    if (packageMatch && !packageNameExists(repoRoot, packageMatch[1])) {
      findings.push(finding('P0', 'SDD038', AP.CONTRACT_DRIFT, `Validation command targets unknown package: ${packageMatch[1]}`));
    }
  }
}

function validateReceiptDiscipline(markdown, findings) {
  const mentionsLaterStep = /\bStep\s+2\b|\bfollow-?on\b|\bnext gate\b/i.test(markdown);
  const hasStepOneReceipt = /\|\s*Step\s+1\s*\|\s*(passed|failed|blocked)/i.test(markdown);
  if (mentionsLaterStep && !hasStepOneReceipt) {
    findings.push(finding(
      'P1',
      'SDD039',
      AP.CONTRACT_DRIFT,
      'Plan mentions later work before a Step 1 execution receipt exists.',
      ['Execute the current proof gate, write the receipt, then replan the next slice.'],
    ));
  }

  const receiptRows = markdown.split(/\r?\n/).filter((line) => /^\|\s*Step\s+\d+\s*\|/i.test(line));
  for (const row of receiptRows) {
    if (/\|\s*(failed|blocked)\s*\|/i.test(row) && !/\|[^|]*(replan|adjust|next|abandon)[^|]*\|\s*$/i.test(row)) {
      findings.push(finding('P0', 'SDD040', AP.SHORTCUT, 'Failed or blocked receipt row must include a next adjustment.'));
    }
  }
}

function validateShapeGate(repoRoot, shapeGate, findings) {
  if (!isObject(shapeGate)) return;
  const registry = discoverShapes(repoRoot);
  const shapeNames = new Set(registry.shapes.map((shape) => shape.name));
  for (const required of shapeGate.required_shapes || []) {
    if (!shapeNames.has(required)) {
      findings.push(finding('P0', 'SDD041', AP.PARSE_BOUNDARY, `shape_gate.required_shapes not found in repo: ${required}`));
    }
  }
  for (const boundary of shapeGate.parse_boundaries || []) {
    const file = resolve(repoRoot, boundary);
    if (!existsSync(file)) {
      findings.push(finding('P0', 'SDD042', AP.PARSE_BOUNDARY, `shape_gate.parse_boundaries file does not exist: ${boundary}`));
      continue;
    }
    const text = readFileSync(file, 'utf8');
    if (!/\b(validatedParse|safeParse|parse)\s*\(/.test(text)) {
      findings.push(finding('P0', 'SDD043', AP.PARSE_BOUNDARY, `Parse boundary does not call parse/safeParse: ${boundary}`));
    }
  }
}

function validateTrackerBridge(repoRoot, tracker, findings) {
  if (!isObject(tracker)) return;
  const trackerPath = String(tracker.path || '').trim();
  if (!trackerPath) return;
  const file = resolve(repoRoot, trackerPath);
  if (!existsSync(file)) {
    findings.push(finding('P0', 'SDD052', AP.CONTRACT_DRIFT, `tracker.path does not exist: ${trackerPath}`));
    return;
  }
  const text = readFileSync(file, 'utf8');
  if (tracker.kind !== 'epic') return;
  if (!text.includes('progress_summary:') || !text.includes('phases:') || !text.includes('stories:')) {
    findings.push(finding('P0', 'SDD053', AP.CONTRACT_DRIFT, `Epic tracker is missing progress_summary, phases, or stories: ${trackerPath}`));
  }
  if (!yamlIdExists(text, tracker.phase_id)) {
    findings.push(finding('P0', 'SDD054', AP.CONTRACT_DRIFT, `Epic tracker phase not found: ${tracker.phase_id}`));
  }
  const itemBlock = yamlItemBlock(text, tracker.item_id);
  if (!itemBlock) {
    findings.push(finding('P0', 'SDD055', AP.CONTRACT_DRIFT, `Epic tracker item not found: ${tracker.item_id}`));
    return;
  }
  if (!/\bstatus:\s*(NOT_STARTED|IN_PROGRESS|PARTIAL|COMPLETE|BLOCKED)\b/.test(itemBlock)) {
    findings.push(finding('P0', 'SDD056', AP.CONTRACT_DRIFT, `Epic tracker item is missing a valid status: ${tracker.item_id}`));
  }
  if (!/\bproof:\s*/.test(itemBlock) || !/\bverify_cmd:\s*/.test(itemBlock) || !/\bpassed:\s*/.test(itemBlock)) {
    findings.push(finding('P0', 'SDD057', AP.CONTRACT_DRIFT, `Epic tracker item is missing proof.verify_cmd or proof.passed: ${tracker.item_id}`));
  }
}

function setActiveStage({ repoRoot, stage, stepId, planPath, allow, proofCommand, stopRule }) {
  if (!stage.trim()) throw new Error('sdd stage set requires --stage.');
  if (!planPath.trim()) throw new Error('sdd stage set requires --plan.');
  if (allow.length === 0) throw new Error('sdd stage set requires at least one --allow exact:<path>|prefix:<path>.');
  const checkedPlan = existsSync(resolve(repoRoot, planPath)) ? checkPlan({ repoRoot, planPath }) : undefined;
  const state = {
    version: 1,
    stage,
    stepId,
    planPath: normalizeRepoPath(planPath),
    allowedPaths: allow.map((entry) => parseAllowRule(repoRoot, entry)),
    proofCommand,
    stopRule,
    receiptRequired: true,
    openFindings: [],
    ...(checkedPlan?.document?.sdd?.id ? { sddId: checkedPlan.document.sdd.id } : {}),
    ...(checkedPlan?.document?.sdd?.shape_gate ? { shapeGate: checkedPlan.document.sdd.shape_gate } : {}),
    ...(checkedPlan?.document?.sdd?.tracker ? { tracker: normalizeTrackerBridge(checkedPlan.document.sdd.tracker) } : {}),
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dirname(activeStagePath(repoRoot)), { recursive: true });
  writeFileSync(activeStagePath(repoRoot), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state;
}

function readActiveStage(repoRoot) {
  const file = activeStagePath(repoRoot);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function clearActiveStage(repoRoot) {
  rmSync(activeStagePath(repoRoot), { force: true });
}

function finishActiveStage({ repoRoot, status, changed, proofResult, opened, closed, nextAdjustment, runDoctor }) {
  const state = readActiveStage(repoRoot);
  if (!state) throw new Error('No active stage to finish.');
  if (!['passed', 'failed', 'blocked'].includes(status)) throw new Error('--status must be passed, failed, or blocked.');
  if (!proofResult.trim()) throw new Error('sdd stage finish requires --proof-result.');
  if ((opened.length > 0 || status !== 'passed') && !nextAdjustment.trim()) {
    throw new Error('sdd stage finish requires --next-adjustment when findings opened or status is not passed.');
  }
  if (state.tracker && !nextAdjustment.trim()) {
    throw new Error('sdd stage finish requires --next-adjustment when an epic tracker bridge is active.');
  }
  const planPath = resolve(repoRoot, state.planPath);
  if (!existsSync(planPath)) throw new Error(`Active stage plan does not exist: ${state.planPath}`);
  const markdown = readFileSync(planPath, 'utf8');
  const nextMarkdown = upsertReceipt(markdown, {
    stepId: state.stepId || state.stage,
    status,
    changed,
    proofResult,
    opened,
    closed,
    nextAdjustment,
    tracker: state.tracker,
  });
  writeFileSync(planPath, nextMarkdown, 'utf8');
  if (runDoctor) {
    const doctor = doctorPlan({ repoRoot, planPath: state.planPath });
    if (!doctor.ok) {
      throw new Error(`sdd doctor failed after receipt write; active stage remains set.\n${formatFindings(doctor.findings)}`);
    }
  }
  clearActiveStage(repoRoot);
  return { stepId: state.stepId || state.stage, status };
}

function runRelevantChecks({ repoRoot, filePath, writeState = false }) {
  const surface = classifySurface(repoRoot, filePath);
  const checks = checksForSurface(repoRoot, surface);
  const results = checks.map((check) => runCheck(repoRoot, check));
  const ok = results.every((result) => result.exitCode === 0);
  const previousState = writeState ? readHookState(repoRoot) : undefined;
  const previousAdvisoryCount = previousState?.status === 'advisory' && previousState.lastEditedFile === surface.repoRelativePath
    ? previousState.activeApFindingCount || 0
    : 0;
  const failedCheckCount = results.filter((result) => result.exitCode !== 0).length;
  const toolFailureCount = results.filter((result) => result.failureCode).length;
  const baseSummary = checks.length === 0
    ? 'No deterministic check selected for this surface.'
    : ok
      ? 'Selected checks passed.'
      : toolFailureCount > 0
        ? 'Selected check could not run because required tooling was missing or unrunnable.'
        : 'Selected checks failed.';
  const state = {
    version: 1,
    lastEditedFile: surface.repoRelativePath,
    lastCheck: checks.length === 0 ? '(none)' : checks.map((check) => check.label).join(', '),
    status: checks.length === 0 ? 'skipped' : ok ? 'passed' : 'failed',
    activeApFindingCount: previousAdvisoryCount + failedCheckCount,
    summary: previousAdvisoryCount > 0 && ok
      ? `${baseSummary} ${previousAdvisoryCount} advisory AP finding(s) remain.`
      : baseSummary,
    findings: results.filter((result) => result.exitCode !== 0).map((result) => deterministicFinding(repoRoot, surface, result)),
    timestamp: new Date().toISOString(),
  };
  if (writeState) writeHookState(repoRoot, state);
  return { surface, checks, results, ok, ...state };
}

function classifySurface(repoRoot, filePath) {
  const absolute = resolve(repoRoot, filePath);
  const repoRelativePath = normalizeRepoPath(relative(repoRoot, absolute));
  const ext = extname(repoRelativePath);
  let kind = 'other';
  if (/^docs\/build-log\/.*\.md$/i.test(repoRelativePath) || /execution-spec.*\.md$/i.test(repoRelativePath)) {
    kind = 'plan';
  } else if (/\/?hooks\//.test(repoRelativePath)) {
    kind = 'hook';
  } else if (/\/?skills\/[^/]+\/SKILL\.md$/.test(repoRelativePath)) {
    kind = 'skill';
  } else if (repoRelativePath === 'package.json' || repoRelativePath.endsWith('/package.json') || repoRelativePath.endsWith('settings.json') || repoRelativePath.endsWith('hooks.json')) {
    kind = repoRelativePath.endsWith('/package.json') ? 'package-manifest' : 'settings';
  } else if (/\.(schema|shape)\.(json|yaml|yml|ts)$/.test(repoRelativePath)) {
    kind = 'schema';
  } else if (/^data\/.*\.(json|jsonld|ttl|yaml|yml)$/.test(repoRelativePath)) {
    kind = 'data-bundle';
  } else if (/\.(test|spec)\.[tj]sx?$/.test(repoRelativePath)) {
    kind = 'typescript-test';
  } else if (/\.[tj]sx?$/.test(repoRelativePath)) {
    kind = 'typescript-source';
  }
  return { absolute, repoRelativePath, kind, packageName: nearestPackageName(repoRoot, absolute) };
}

function checksForSurface(repoRoot, surface) {
  const self = currentScriptPath();
  if (surface.kind === 'plan') {
    return [{
      label: 'sdd:doctor',
      apClass: AP.CONTRACT_DRIFT,
      command: process.execPath,
      args: [self, 'doctor', '--plan', surface.repoRelativePath],
      timeout: DEFAULT_TIMEOUT_MS,
    }];
  }
  if (surface.kind === 'typescript-test') {
    if (surface.packageName) {
      return [{ label: 'package test', apClass: AP.SHORTCUT, command: 'pnpm', args: ['--silent', '--filter', surface.packageName, 'test'], timeout: DEFAULT_TIMEOUT_MS }];
    }
    return [];
  }
  if (surface.kind === 'typescript-source') {
    if (surface.packageName) {
      return [{ label: 'package tsc', apClass: AP.PARSE_BOUNDARY, command: 'pnpm', args: ['--silent', '--filter', surface.packageName, 'exec', 'tsc', '--noEmit'], timeout: DEFAULT_TIMEOUT_MS }];
    }
    return [];
  }
  if (['package-manifest', 'hook', 'skill', 'settings', 'schema', 'data-bundle'].includes(surface.kind)) {
    return [{
      label: 'zeroh-sdd self-test',
      apClass: surface.kind === 'hook' ? AP.CEREMONY : AP.CONTRACT_DRIFT,
      command: process.execPath,
      args: [self, 'self-test'],
      timeout: DEFAULT_TIMEOUT_MS,
    }];
  }
  return [];
}

function handleHook(event, input, repoRoot) {
  switch (event) {
    case 'setup':
      initPluginData(repoRoot);
      saveShapeRegistry(repoRoot);
      return '';
    case 'session-start':
      initPluginData(repoRoot);
      saveShapeRegistry(repoRoot);
      return hookContext('SessionStart', renderSessionContext(repoRoot));
    case 'user-prompt-submit':
      return activeStageContext(repoRoot, 'UserPromptSubmit');
    case 'pre-tool-write':
      return handlePreToolWrite(input, repoRoot);
    case 'pre-tool-bash':
      return handlePreToolBash(input, repoRoot);
    case 'post-tool-write':
      return handlePostToolWrite(input, repoRoot);
    case 'post-tool-write-jit':
      return handlePostToolWriteJit(input, repoRoot);
    case 'post-tool-bash':
      return handlePostToolBash(input, repoRoot);
    case 'post-tool-failure':
      return handlePostToolFailure(input, repoRoot);
    case 'post-tool-batch':
      return renderPostBatch(repoRoot);
    case 'task-completed':
      return blockIfActiveStage(repoRoot, 'TaskCompleted', { exitCodeBlock: true });
    case 'stop':
      return blockIfActiveStage(repoRoot, 'Stop', { stopHookActive: Boolean(input?.stop_hook_active) });
    case 'pre-compact':
      return hookContext('PreCompact', renderCompactContext(repoRoot, 'PreCompact'));
    case 'post-compact':
      return hookContext('PostCompact', renderCompactContext(repoRoot, 'PostCompact'));
    case 'config-change':
      return handleConfigChange(input, repoRoot);
    case 'cwd-changed':
      return handleCwdChanged(repoRoot);
    case 'file-changed':
      return handleFileChanged(input, repoRoot);
    case 'permission-denied':
      return handlePermissionDenied(input, repoRoot);
    case 'session-end':
      return '';
    default:
      throw new Error(`Unknown hook event: ${event}`);
  }
}

function handlePreToolWrite(input, repoRoot) {
  const filePath = toolFilePath(input);
  if (!filePath) return '';
  const config = runtimeConfig();
  const stage = readActiveStage(repoRoot);
  if (stage) {
    const decision = allowedByStage(repoRoot, stage, filePath);
    if (!decision.allowed) {
      const message = [
        '# Active stage write blocked',
        '',
        `Stage: ${stage.stage}`,
        `Step: ${stage.stepId}`,
        `Plan: ${stage.planPath}`,
        `Proof command: ${stage.proofCommand || '(none)'}`,
        `Stop rule: ${stage.stopRule || '(none)'}`,
        '',
        `Attempted path: ${decision.relativePath}`,
        '',
        'Allowed paths:',
        ...stage.allowedPaths.map((rule) => `- ${rule.mode}: ${rule.path}`),
        '',
        'Finish the active proof gate, write the receipt, or explicitly clear/replan the stage before editing outside this surface.',
      ].join('\n');
      if (!shouldBlockHardGate(config)) return preToolContext('PreToolUse', message);
      return preToolContext('PreToolUse', message, 'deny', `Write blocked by active stage guard (${stage.stage}).`);
    }
  }
  const shapeContext = relevantShapeContext(repoRoot, filePath);
  return shapeContext ? preToolContext('PreToolUse', shapeContext) : '';
}

function handlePreToolBash(input, repoRoot) {
  const command = toolCommand(input);
  if (!command) return '';
  const config = runtimeConfig();
  const stage = readActiveStage(repoRoot);
  if (!stage) return '';
  if (/\bzeroh-sdd\s+stage\s+(finish|status|clear)\b|\bsdd:stage\s+(finish|status|clear)\b/.test(command)) {
    return '';
  }
  if (/(^|[;&|()\s])(git\s+(commit|push|merge)\b|(?:node\s+\S*zeroh-sdd\.mjs\s+)?(?:zeroh-sdd\s+)?stage\s+set\b|zeroh-sdd\s+stage\s+set\b|sdd:stage\s+set\b)/.test(command)) {
    const message = [
      '# Active stage advance blocked',
      '',
      `Stage: ${stage.stage}`,
      `Step: ${stage.stepId}`,
      `Plan: ${stage.planPath}`,
      `Proof command: ${stage.proofCommand || '(none)'}`,
      `Stop rule: ${stage.stopRule || '(none)'}`,
      '',
      `Blocked command: ${command}`,
      '',
      `Run the proof command and finish with \`${runtimeCli()} stage finish ...\`, or explicitly clear/replan the stage.`,
    ].join('\n');
    if (!shouldBlockHardGate(config)) return preToolContext('PreToolUse', message);
    return preToolContext('PreToolUse', message, 'deny', 'Active execution stage must finish before stage advance, commit, merge, or push.');
  }
  return '';
}

function handlePostToolWrite(input, repoRoot) {
  const filePath = toolFilePath(input);
  if (!filePath) return '';
  const config = runtimeConfig();
  const contexts = [];
  const apFindings = detectApFindings(repoRoot, filePath);
  for (const apFinding of apFindings) {
    contexts.push(renderApContext(apFinding));
  }
  if (isShapeFile(filePath)) saveShapeRegistry(repoRoot);
  if (config.jitMode === 'sync') {
    const jit = runRelevantChecks({ repoRoot, filePath, writeState: true });
    const jitContext = renderJitContext(jit);
    if (jitContext) contexts.push(jitContext);
  }
  if (apFindings.length > 0) {
    const state = readHookState(repoRoot) || {};
    const surface = classifySurface(repoRoot, filePath);
    const currentFindings = apFindings.filter((item) => item.introducedByCurrentEdit);
    const baselineFindings = apFindings.filter((item) => !item.introducedByCurrentEdit);
    writeHookState(repoRoot, {
      ...state,
      lastEditedFile: surface.repoRelativePath,
      lastCheck: state.lastCheck || 'AP detectors',
      status: 'advisory',
      activeApFindingCount: currentFindings.length,
      baselineFindingCount: baselineFindings.length,
      findings: apFindings.map(toHookStateFinding),
      summary: summarizeAttributedFindings(currentFindings.length, baselineFindings.length),
      timestamp: new Date().toISOString(),
    });
  }
  return contexts.length > 0 ? hookContext('PostToolUse', contexts.join('\n\n')) : '';
}

function handlePostToolWriteJit(input, repoRoot) {
  const config = runtimeConfig();
  if (config.jitMode !== 'async-rewake') return '';
  const filePath = toolFilePath(input);
  if (!filePath) return '';
  const jit = runRelevantChecks({ repoRoot, filePath, writeState: true });
  const jitContext = renderJitContext(jit);
  if (!jitContext) return '';
  return hookExit(2, jitContext);
}

function receiptCommandExamples(mode = 'both') {
  const passed = [
    'If the proof passed:',
    '',
    '```bash',
    `${runtimeCli()} stage finish --status passed \\`,
    '  --proof-result "<command => pass>" \\',
    '  --changed "<path>" \\',
    '  --closed "<finding-id>" \\',
    '  --next-adjustment "Proceed to the next executable proof gate."',
    '```',
  ].join('\n');
  const failed = [
    'If the proof failed or required tooling was unavailable:',
    '',
    '```bash',
    `${runtimeCli()} stage finish --status failed \\`,
    '  --proof-result "<command => fail: <reason>>" \\',
    '  --changed "<path>" \\',
    '  --opened "TOOL_MISSING" \\',
    '  --next-adjustment "Replan: make the proof command runnable before editing further."',
    '```',
  ].join('\n');
  if (mode === 'passed') return passed;
  if (mode === 'failed') return failed;
  return `${passed}\n\n${failed}`;
}

function handlePostToolBash(input, repoRoot) {
  const command = toolCommand(input);
  const stage = readActiveStage(repoRoot);
  if (!command || !stage?.proofCommand) return '';
  if (!command.includes(stage.proofCommand) && !stage.proofCommand.includes(command)) return '';
  const message = [
    '# Active proof command ran',
    '',
    `Stage: ${stage.stage}`,
    `Step: ${stage.stepId}`,
    `Plan: ${stage.planPath}`,
    `Proof command: ${stage.proofCommand}`,
    '',
    'Do not move to the next step from memory. Write the execution receipt now. Choose the receipt status from the actual proof result:',
    '',
    receiptCommandExamples('both'),
  ].join('\n');
  return hookContext('PostToolUse', message);
}

function handlePostToolFailure(input, repoRoot) {
  const command = toolCommand(input) || input?.tool_name || '(unknown tool)';
  const stage = readActiveStage(repoRoot);
  const proofFailure = Boolean(stage?.proofCommand && commandMatchesProof(command, stage.proofCommand));
  const scopedFinding = {
    code: 'TOOL_FAILURE',
    surface: proofFailure ? 'hook.proof-command.failure' : 'hook.tool.failure',
    filePath: '(command)',
    hits: command,
    scope: proofFailure ? 'proof-command' : 'repo-background',
    baselineStatus: 'unknown',
    introducedByCurrentEdit: false,
    ownerAction: proofFailure ? 'replan' : 'branch-health-followup',
  };
  writeHookState(repoRoot, {
    version: 1,
    lastEditedFile: '(none)',
    lastCheck: command,
    status: 'failed',
    activeApFindingCount: 1,
    findings: [scopedFinding],
    summary: proofFailure
      ? 'Active proof command failed; capture it in the execution receipt and replan or mark blocked.'
      : 'Tool failure recorded as background context; fix directly or capture it in the active stage receipt if it affects the gate.',
    timestamp: new Date().toISOString(),
  });
  const receiptHelp = proofFailure ? ['', receiptCommandExamples('failed')].join('\n') : '';
  return hookContext('PostToolUseFailure', [
    proofFailure ? '# Active proof command failed' : '# Tool failure recorded',
    '',
    `Failed command/tool: ${command}`,
    `Scope: ${scopedFinding.scope}`,
    `Owner action: ${scopedFinding.ownerAction}`,
    '',
    'Fix the failure before advancing the stage. If it changes scope, record the finding in the execution receipt and replan.',
    receiptHelp,
  ].join('\n'));
}

function renderPostBatch(repoRoot) {
  const stage = readActiveStage(repoRoot);
  const hookState = readHookState(repoRoot);
  if (!stage && (!hookState || hookState.status !== 'failed')) return '';
  const message = [
    '# zeroh-sdd batch summary',
    '',
    `Active stage: ${stage ? stage.stage : '(none)'}`,
    `Step: ${stage ? stage.stepId : '(none)'}`,
    `Plan: ${stage ? stage.planPath : '(none)'}`,
    `Proof command: ${stage?.proofCommand || '(none)'}`,
    '',
    `Last edited file: ${hookState?.lastEditedFile || '(none)'}`,
    `Last deterministic check: ${hookState?.lastCheck || '(none)'}`,
    `Check status: ${hookState?.status || '(none)'}`,
    `AP finding count: ${hookState?.activeApFindingCount || 0}`,
    `Baseline finding count: ${hookState?.baselineFindingCount || 0}`,
    `Summary: ${hookState?.summary || '(none)'}`,
    ...(hookState?.findings || []).slice(0, 3).map((finding) => `Finding: ${finding.code} / ${finding.scope} / ${finding.baselineStatus} / ${finding.ownerAction}`),
    '',
    stage ? `If the proof command already ran, finish the stage with \`${runtimeCli()} stage finish ...\` before advancing.` : '',
  ].filter(Boolean).join('\n');
  return hookContext('PostToolBatch', message);
}

function blockIfActiveStage(repoRoot, event, options = {}) {
  const stage = readActiveStage(repoRoot);
  if (!stage) return '';
  if (event === 'Stop' && options.stopHookActive) return '';
  const shapeIssues = evaluateActiveShapeGate(repoRoot, stage);
  const reason = [
    `Active execution stage is still open: ${stage.stage}.`,
    `Step: ${stage.stepId}.`,
    `Plan: ${stage.planPath}.`,
    `Proof: ${stage.proofCommand || '(none)'}.`,
    shapeIssues.length > 0 ? `Shape gate issues: ${shapeIssues.join('; ')}` : '',
    `Run the proof, write the receipt with \`${runtimeCli()} stage finish ...\`, or explicitly clear/replan before completing.`,
  ].filter(Boolean).join(' ');
  if (!shouldBlockHardGate(runtimeConfig())) return hookContext(event, reason);
  if (options.exitCodeBlock) return hookExit(2, reason);
  return JSON.stringify({ decision: 'block', reason });
}

function handleConfigChange(input, repoRoot) {
  const stage = readActiveStage(repoRoot);
  if (!stage || input?.source === 'policy_settings') return '';
  const filePath = input?.file_path ? fromPortablePath(input.file_path) : '(unknown file)';
  const reason = [
    'zeroh-sdd active-stage runtime configuration changed during an open proof gate.',
    `Stage: ${stage.stage}.`,
    `Step: ${stage.stepId}.`,
    `Source: ${input?.source || '(unknown)'}.`,
    `File: ${filePath}.`,
    'Finish the receipt, or explicitly clear/replan the stage before changing hook/runtime configuration.',
  ].join(' ');
  if (!shouldBlockHardGate(runtimeConfig())) return hookContext('ConfigChange', reason);
  return JSON.stringify({ decision: 'block', reason });
}

function handleCwdChanged(repoRoot) {
  initPluginData(repoRoot);
  if (runtimeConfig().shapeWatch) saveShapeRegistry(repoRoot);
  return watchPathsContext(repoRoot);
}

function handleFileChanged(input, repoRoot) {
  const changedPath = fromPortablePath(input?.file_path || '');
  const rel = changedPath ? normalizeRepoPath(relative(repoRoot, changedPath)) : '';
  const contexts = [];
  let registry = readShapeRegistry(repoRoot) || discoverShapes(repoRoot);

  if (!changedPath) return watchPathsContext(repoRoot);
  if (runtimeConfig().shapeWatch && isShapeFile(changedPath)) {
    registry = saveShapeRegistry(repoRoot);
    contexts.push([
      '# zeroh-sdd shape registry refreshed',
      '',
      `Changed file: ${rel || changedPath}`,
      `Discovered shapes: ${registry.shapes.length}`,
    ].join('\n'));
  }

  const stage = readActiveStage(repoRoot);
  const activePlan = stage?.planPath ? resolve(repoRoot, stage.planPath) : '';
  if (samePath(changedPath, activeStagePath(repoRoot)) || samePath(changedPath, hookStatePath(repoRoot)) || (activePlan && samePath(changedPath, activePlan))) {
    contexts.push([
      '# zeroh-sdd execution state changed on disk',
      '',
      `Changed file: ${rel || changedPath}`,
      stage ? `Active stage: ${stage.stage} / ${stage.stepId}` : 'Active stage: (none)',
    ].join('\n'));
  }

  return watchPathsContext(repoRoot, contexts.join('\n\n'), 'FileChanged');
}

function handlePermissionDenied(input, repoRoot) {
  const command = toolCommand(input);
  const stage = readActiveStage(repoRoot);
  const retry = input?.tool_name === 'Bash' && isRetrySafeDeniedCommand(command, stage);
  writeHookState(repoRoot, {
    version: 1,
    lastEditedFile: '(none)',
    lastCheck: input?.tool_name || '(unknown tool)',
    status: 'permission-denied',
    activeApFindingCount: 0,
    summary: retry
      ? 'Safe SDD/proof command denied by auto mode; Claude may retry.'
      : 'Permission denial recorded; choose a safer proof path or ask for approval.',
    timestamp: new Date().toISOString(),
  });
  if (!retry) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionDenied', retry: true } });
}

function activeStageContext(repoRoot, event) {
  const stage = readActiveStage(repoRoot);
  if (!stage) return '';
  return hookContext(event, [
    '# Active zeroh-sdd execution stage',
    '',
    `Stage: ${stage.stage}`,
    `Step: ${stage.stepId}`,
    `Plan: ${stage.planPath}`,
    `Proof command: ${stage.proofCommand || '(none)'}`,
    `Stop rule: ${stage.stopRule || '(none)'}`,
    '',
    'Work only inside the allowed stage surface until the proof receipt closes this stage.',
  ].join('\n'));
}

function renderSessionContext(repoRoot) {
  const config = runtimeConfig();
  const stage = readActiveStage(repoRoot);
  const hookState = readHookState(repoRoot);
  const registry = readShapeRegistry(repoRoot) || discoverShapes(repoRoot);
  return [
    '# zeroh-sdd v1 runtime context',
    '',
    `Branch: ${git(repoRoot, ['branch', '--show-current']).trim() || '(none)'}`,
    `Dirty files: ${git(repoRoot, ['status', '--short']).split(/\r?\n/).filter(Boolean).length}`,
    `Last commit: ${git(repoRoot, ['log', '-1', '--oneline']).trim() || '(none)'}`,
    `Latest plan: ${latestPlan(repoRoot) || '(none)'}`,
    '',
    '## Active Stage',
    stage ? [
      `Stage: ${stage.stage}`,
      `Step: ${stage.stepId}`,
      `Plan: ${stage.planPath}`,
      `Proof command: ${stage.proofCommand || '(none)'}`,
      `Allowed paths: ${stage.allowedPaths.map((rule) => `${rule.mode}:${rule.path}`).join(', ')}`,
    ].join('\n') : '(none)',
    '',
    '## Last Hook State',
    hookState ? `${hookState.status}: ${hookState.summary}` : '(none)',
    '',
    '## Shape Registry',
    `${registry.shapes.length} shape(s) discovered.`,
    registry.shapes.slice(0, config.maxShapeContext).map((shape) => `- ${shape.name} (${shape.path})`).join('\n'),
  ].filter((part) => part !== '').join('\n');
}

function renderCompactContext(repoRoot, event) {
  const stage = readActiveStage(repoRoot);
  const hookState = readHookState(repoRoot);
  return [
    `# zeroh-sdd ${event} context`,
    '',
    'Preserve the execution loop through compaction: active stage, proof command, receipt requirement, hook-state, and shape-gate status.',
    '',
    stage ? `Active stage: ${stage.stage} / ${stage.stepId} / ${stage.planPath} / proof: ${stage.proofCommand || '(none)'}` : 'Active stage: (none)',
    hookState ? `Hook state: ${hookState.status} / ${hookState.summary}` : 'Hook state: (none)',
  ].join('\n');
}

function detectApFindings(repoRoot, filePath) {
  const absolute = resolve(repoRoot, filePath);
  if (!existsSync(absolute) || statSync(absolute).isDirectory()) return [];
  const rel = normalizeRepoPath(relative(repoRoot, absolute));
  const text = readFileSync(absolute, 'utf8');
  const findings = [];

  if (/\.[tj]sx?$/.test(rel) && !rel.endsWith('.d.ts')) {
    if (/^\s*import\s+.*\b[A-Za-z0-9_]*(Schema|Shape)\b/m.test(text) && !/\b(validatedParse|safeParse|parse)\s*\(/.test(text)) {
      findings.push(apFinding(AP.PARSE_BOUNDARY, 'hook.schema-parse-boundary.file', rel, 'Schema/Shape import found without parse/safeParse/validatedParse.', [
        '# AP-PARSE-BOUNDARY - schema imported without boundary parse',
        '',
        `File: ${rel}`,
        '',
        'A schema import is an enforcement claim. Call parse/safeParse/validatedParse at the boundary, or convert the import to a type-only import.',
      ].join('\n')));
    }
    const cwaHits = [];
    if (/\?\?\s*(["'`{[]|\d|DEFAULT_|fallback|nullish)/i.test(text)) cwaHits.push('non-boolean nullish default');
    if (/catch\s*\([^)]*\)\s*\{\s*\}|catch\s*\{\s*\}/.test(text)) cwaHits.push('bare catch block');
    if (/(model|provider|fallback).*\[.*(claude|gpt|openai|anthropic|local)/is.test(text)) cwaHits.push('provider/model fallback chain');
    if (/SELECT\s+\?s\s+\?p\s+\?o/i.test(text)) cwaHits.push('wildcard SPARQL read');
    if (cwaHits.length > 0) {
      findings.push(apFinding(AP.SILENT_FAIL, 'hook.cwa-fallback.file', rel, cwaHits.join('; '), [
        '# AP-SILENT-FAIL - implicit fallback detected',
        '',
        `File: ${rel}`,
        '',
        'Closed-world SDD code should halt or branch through a declared alternative when a contract fails. Replace silent fallbacks with typed failures or explicit decision-doc-backed alternatives.',
      ].join('\n')));
    }
    const iriCount = (text.match(/["'`](?:urn:|https?:\/\/|[a-z]+:[A-Za-z])[A-Za-z0-9_:/#.\-]+["'`]/g) || []).length;
    if (/^\s*const\s+[A-Za-z_][A-Za-z0-9_]*\s*[:=]/m.test(text) && iriCount >= 2) {
      findings.push(apFinding(AP.HARDCODED_DATA, 'hook.hardcoded-data.file', rel, `${iriCount} IRI-shaped literals in const data`, [
        '# AP-HARDCODED-DATA - domain data duplicated in code',
        '',
        `File: ${rel}`,
        '',
        'Move domain identifiers, ontology terms, and authority lists into a declared data contract or schema consumed by runtime code.',
      ].join('\n')));
    }
  }

  if (/\.(test|spec)\.[tj]sx?$/.test(rel)) {
    const diff = git(repoRoot, ['diff', '-U0', '--', rel]);
    const hits = [];
    if (/^-.*toThrow\(/m.test(diff) && /^\+.*toBe(Undefined|Truthy|Falsy|Null)\(/m.test(diff)) hits.push('weakened assertion');
    if (/^\+.*\b(it|test)\.skip\(/m.test(diff) || /^\+.*\b(xit|xtest)\(/m.test(diff)) hits.push('skip introduced');
    const removed = (diff.match(/^-.*\b(it|test)\(/g) || []).length;
    const added = (diff.match(/^\+.*\b(it|test)\(/g) || []).length;
    if (removed > 0 && added < removed) hits.push(`net test-count drop: removed ${removed}, added ${added}`);
    if (hits.length > 0) {
      findings.push(apFinding(AP.TEST_CAPITULATION, 'hook.test-capitulation.file', rel, hits.join('; '), [
        '# AP-TEST-CAPITULATION - weakened, skipped, or deleted test detected',
        '',
        `File: ${rel}`,
        '',
        'Fix the implementation or explicitly re-scope the stage. Do not turn RED evidence green by weakening the proof.',
      ].join('\n')));
    }
  }
  return findings.map((item) => withFindingAttribution(repoRoot, rel, item));
}

function discoverShapes(repoRoot) {
  const shapes = [];
  for (const file of walkFiles(repoRoot)) {
    if (!/\.[tj]sx?$/.test(file)) continue;
    const rel = normalizeRepoPath(relative(repoRoot, file));
    const text = safeRead(file);
    if (!/\bz\.(object|strictObject|discriminatedUnion|union|enum|array|record)\b/.test(text) && !/\b(Shape|Schema)\b/.test(text)) continue;
    const regex = /export\s+const\s+([A-Za-z0-9_]*(?:Shape|Schema))\s*=\s*z\.(object|strictObject|discriminatedUnion|union|enum|array|record)/g;
    let match;
    while ((match = regex.exec(text))) {
      shapes.push({
        name: match[1],
        kind: match[2],
        path: rel,
        fields: extractShapeFields(text.slice(match.index, match.index + 2000)),
      });
    }
  }
  return { version: 1, generatedAt: new Date().toISOString(), repoRoot, shapes };
}

function saveShapeRegistry(repoRoot) {
  const registry = discoverShapes(repoRoot);
  const dataDir = pluginDataDir(repoRoot);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'shape-registry.json'), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  const cache = { version: 1, updatedAt: new Date().toISOString(), shapeCount: registry.shapes.length };
  writeFileSync(join(dataDir, 'runtime-cache.json'), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return registry;
}

function readShapeRegistry(repoRoot) {
  const file = join(pluginDataDir(repoRoot), 'shape-registry.json');
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function relevantShapeContext(repoRoot, filePath) {
  const config = runtimeConfig();
  const absolute = resolve(repoRoot, filePath);
  const rel = normalizeRepoPath(relative(repoRoot, absolute));
  const registry = readShapeRegistry(repoRoot) || discoverShapes(repoRoot);
  const text = existsSync(absolute) ? safeRead(absolute) : '';
  const relevant = registry.shapes.filter((shape) => shape.path === rel || text.includes(shape.name));
  if (relevant.length === 0 && !/\.(ts|tsx)$/.test(rel)) return '';
  const shapes = relevant.length > 0 ? relevant : registry.shapes.slice(0, config.maxShapeContext);
  if (shapes.length === 0) return '';
  return [
    '# zeroh-sdd shape context',
    '',
    `Target file: ${rel}`,
    '',
    'Relevant shapes:',
    ...shapes.map((shape) => `- ${shape.name} (${shape.path})${shape.fields.length ? ` fields: ${shape.fields.join(', ')}` : ''}`),
    '',
    'If this edit crosses a boundary, call parse/safeParse/validatedParse and keep the shape as the executable acceptance criterion.',
  ].join('\n');
}

function evaluateActiveShapeGate(repoRoot, stage) {
  if (!stage.shapeGate) return [];
  const findings = [];
  validateShapeGate(repoRoot, stage.shapeGate, findings);
  return findings.filter((item) => item.severity === 'P0').map((item) => item.message);
}

function renderApContext(finding) {
  if (finding.introducedByCurrentEdit) return renderEnvelope(finding);
  return [
    '# Existing AP finding in edited surface',
    '',
    `File: ${finding.filePath}`,
    `Code: ${finding.code}`,
    `Scope: ${finding.scope}`,
    `Baseline: ${finding.baselineStatus}`,
    `Owner action: ${finding.ownerAction}`,
    '',
    'This finding was detected in the edited surface but was not introduced by the current diff. Keep the execution spec on track: fix it only if it is part of the active proof gate, otherwise record it in the receipt or branch-health follow-up.',
  ].join('\n');
}

function renderEnvelope({ code, surface, filePath, hits, prose, metadata = {} }) {
  const bucket = 'contract';
  const envelope = {
    type: `urn:zeroh-sdd:error:${code}`,
    code,
    bucket,
    title: `${code} detected at ${filePath}`,
    surface,
    metadata: { filePath, hits: String(hits).slice(0, 500), ...metadata },
    scope: metadata.scope || 'edited-file',
    baselineStatus: metadata.baselineStatus || 'current-edit',
    introducedByCurrentEdit: metadata.introducedByCurrentEdit !== false,
    ownerAction: metadata.ownerAction || 'fix-now',
    remediation: prose.slice(0, 300),
    _fix: {
      surface: 'hook',
      detail: `${code} - see remediation`,
      prompt: [
        `Fix: ${surface} returned ${code} (${bucket})`,
        '',
        `What happened: ${code} pattern detected at ${filePath}`,
        '',
        'Steps to fix:',
        prose,
      ].join('\n'),
      metadata: { code, bucket },
    },
  };
  return `${prose}\n\n---\n<!-- envelope:\n${JSON.stringify(envelope)}\n-->`;
}

function renderJitContext(result) {
  const failing = result.results.filter((check) => check.exitCode !== 0);
  if (failing.length === 0) return '';
  const findingSummary = (result.findings || []).map((finding) => `${finding.code} / ${finding.scope} / ${finding.ownerAction}`).join('; ') || '(none)';
  return [
    '# JIT execution-spec check failed',
    '',
    `Edited file: \`${result.surface.repoRelativePath}\``,
    `Surface: \`${result.surface.kind}\``,
    `Finding scope: \`${findingSummary}\``,
    '',
    'The hook ran the smallest deterministic check it could select from the edited surface. Fix current-gate failures before moving to the next stage; record background drift in the execution receipt or branch-health follow-up instead of treating it as caused by this edit.',
    '',
    ...failing.flatMap((check) => [
      `## ${check.label} (${check.apClass})`,
      '',
      `Command: \`${[check.command, ...check.args].join(' ')}\``,
      check.resolvedCommand && check.resolvedCommand !== check.command ? `Resolved command: \`${check.resolvedCommand}\`` : '',
      check.failureCode ? `Failure code: \`${check.failureCode}\`` : '',
      `Exit code: \`${check.exitCode}\``,
      '',
      '```',
      trim(check.output, 4000),
      '```',
      '',
    ].filter(Boolean)),
  ].join('\n');
}

function parseSimpleYaml(text) {
  const lines = text.replace(/\t/g, '  ').split(/\r?\n/)
    .map((raw, index) => ({ raw, index, indent: raw.match(/^ */)?.[0].length || 0, text: raw.trim() }))
    .filter((line) => line.text && !line.text.startsWith('#'));
  if (lines.length === 0) return {};
  const [value] = parseYamlNode(lines, 0, lines[0].indent);
  return value;
}

function parseYamlNode(lines, index, indent) {
  if (index >= lines.length) return [{}, index];
  if (lines[index].text.startsWith('- ')) return parseYamlArray(lines, index, indent);
  return parseYamlObject(lines, index, indent);
}

function parseYamlObject(lines, index, indent) {
  const object = {};
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new Error(`Unexpected indentation at line ${line.index + 1}`);
    if (line.text.startsWith('- ')) break;
    const [key, rawValue] = splitYamlKeyValue(line.text, line.index);
    if (rawValue === '') {
      const next = lines[index + 1];
      if (next && next.indent > indent) {
        const [child, nextIndex] = parseYamlNode(lines, index + 1, next.indent);
        object[key] = child;
        index = nextIndex;
      } else {
        object[key] = {};
        index += 1;
      }
    } else {
      object[key] = parseYamlScalar(rawValue);
      index += 1;
    }
  }
  return [object, index];
}

function parseYamlArray(lines, index, indent) {
  const array = [];
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.text.startsWith('- ')) break;
    const itemText = line.text.slice(2).trim();
    if (itemText === '') {
      const next = lines[index + 1];
      if (next && next.indent > indent) {
        const [child, nextIndex] = parseYamlNode(lines, index + 1, next.indent);
        array.push(child);
        index = nextIndex;
      } else {
        array.push(null);
        index += 1;
      }
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(itemText)) {
      const [key, rawValue] = splitYamlKeyValue(itemText, line.index);
      let item = { [key]: rawValue === '' ? {} : parseYamlScalar(rawValue) };
      const next = lines[index + 1];
      if (next && next.indent > indent) {
        const [child, nextIndex] = parseYamlNode(lines, index + 1, next.indent);
        if (isObject(child)) item = { ...item, ...child };
        index = nextIndex;
      } else {
        index += 1;
      }
      array.push(item);
      continue;
    }
    array.push(parseYamlScalar(itemText));
    index += 1;
  }
  return [array, index];
}

function splitYamlKeyValue(text, lineIndex) {
  const colon = text.indexOf(':');
  if (colon < 0) throw new Error(`Expected key: value at line ${lineIndex + 1}`);
  return [text.slice(0, colon).trim(), text.slice(colon + 1).trim()];
}

function parseYamlScalar(value) {
  const text = stripYamlComment(value.trim());
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    return splitInlineArray(inner).map(parseYamlScalar);
  }
  return text;
}

function stripYamlComment(value) {
  let quoted = false;
  let quote = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if ((char === '"' || char === "'") && value[i - 1] !== '\\') {
      if (!quoted) {
        quoted = true;
        quote = char;
      } else if (quote === char) {
        quoted = false;
      }
    }
    if (!quoted && char === '#' && /\s/.test(value[i - 1] || '')) return value.slice(0, i).trim();
  }
  return value;
}

function splitInlineArray(text) {
  const parts = [];
  let current = '';
  let quoted = false;
  let quote = '';
  for (const char of text) {
    if ((char === '"' || char === "'") && !quoted) {
      quoted = true;
      quote = char;
    } else if (quoted && char === quote) {
      quoted = false;
    }
    if (!quoted && char === ',') {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function runSelfTests(suite) {
  const root = mkdtempSync(join(tmpdir(), 'zeroh-sdd-test-'));
  const pluginRoot = resolve(dirname(fromPortablePath(process.argv[1] || 'bin/zeroh-sdd.mjs')), '..');
  try {
    mkdirSync(join(root, 'docs', 'build-log'), { recursive: true });
    mkdirSync(join(root, 'docs', 'epics'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0' }, null, 2), 'utf8');
    writeFileSync(join(root, 'src', 'policy.shape.ts'), 'import { z } from "zod";\nexport const PolicyShape = z.object({ id: z.string(), title: z.string() });\n', 'utf8');
    writeFileSync(join(root, 'src', 'route.ts'), 'import { PolicyShape } from "./policy.shape";\nexport function handle(x: unknown) { return PolicyShape.safeParse(x); }\n', 'utf8');
    writeFileSync(join(root, 'docs', 'epics', 'EPIC-fixture.md'), validEpicMarkdown(), 'utf8');
    const plan = join(root, 'docs', 'build-log', 'fixture-execution-spec.md');
    writeFileSync(plan, validPlanMarkdown(), 'utf8');
    const missing = join(root, 'docs', 'build-log', 'missing.md');
    writeFileSync(missing, '# Missing\n', 'utf8');
    const multi = join(root, 'docs', 'build-log', 'multi.md');
    writeFileSync(multi, `${validPlanMarkdown()}\n\n\`\`\`sdd\nsdd:\n  version: 1\n\`\`\`\n`, 'utf8');

    const checks = [];
    const add = (name, fn) => checks.push({ name, fn });
    add('sdd-self-test', () => {
      assert(checkPlan({ repoRoot: root, planPath: relative(root, plan) }).ok, 'valid plan should pass check');
      assert(!checkPlan({ repoRoot: root, planPath: relative(root, missing) }).ok, 'missing fence should fail');
      assert(!checkPlan({ repoRoot: root, planPath: relative(root, multi) }).ok, 'multiple fences should fail');
    });
    add('sdd-doctor-self-test', () => {
      const doctor = doctorPlan({ repoRoot: root, planPath: relative(root, plan), skipGit: true });
      assert(doctor.ok, formatFindings(doctor.findings));
    });
    add('sdd-tracker-self-test', () => {
      const checked = checkPlan({ repoRoot: root, planPath: relative(root, plan) });
      assert(checked.ok && checked.document.sdd.tracker.item_id === 'S1', 'sdd tracker bridge should pass check');
      const missingItem = join(root, 'docs', 'build-log', 'missing-tracker-item.md');
      writeFileSync(missingItem, validPlanMarkdown().replace('item_id: S1', 'item_id: S404'), 'utf8');
      const doctor = doctorPlan({ repoRoot: root, planPath: relative(root, missingItem), skipGit: true });
      assert(!doctor.ok && formatFindings(doctor.findings).includes('Epic tracker item not found: S404'), 'doctor should fail when declared tracker item is missing');
    });
    add('sdd-stage-self-test', () => {
      const state = setActiveStage({
        repoRoot: root,
        stage: 'Step 1 - fixture',
        stepId: 'Step 1',
        planPath: relative(root, plan),
        allow: ['exact:docs/build-log/fixture-execution-spec.md', 'prefix:src'],
        proofCommand: 'node --version',
        stopRule: 'Stop after receipt.',
      });
      assert(state.allowedPaths.length === 2, 'allowed path count');
      assert(state.tracker?.item_id === 'S1', 'stage state should preserve tracker bridge metadata');
      const allowed = allowedByStage(root, state, join(root, 'src', 'route.ts'));
      assert(allowed.allowed, 'src route should be allowed');
      const blocked = allowedByStage(root, state, join(root, 'README.md'));
      assert(!blocked.allowed, 'README should be blocked');
      finishActiveStage({
        repoRoot: root,
        status: 'passed',
        changed: ['src/route.ts'],
        proofResult: 'node --version => pass',
        opened: [],
        closed: ['fixture'],
        nextAdjustment: 'Proceed to Step 2.',
        runDoctor: false,
      });
      assert(readFileSync(plan, 'utf8').includes('tracker epic:docs/epics/EPIC-fixture.md#P1/S1'), 'receipt should include tracker item context');
      assert(!readActiveStage(root), 'stage should clear after finish');
      setActiveStage({
        repoRoot: root,
        stage: 'Step 1 - failed fixture',
        stepId: 'Step 1 failed',
        planPath: relative(root, plan),
        allow: ['exact:src/route.ts'],
        proofCommand: 'node missing.js',
        stopRule: 'Replan on failed proof.',
      });
      let failedWithoutAdjustment = false;
      try {
        finishActiveStage({
          repoRoot: root,
          status: 'failed',
          changed: ['src/route.ts'],
          proofResult: 'node missing.js => fail',
          opened: ['TOOL_MISSING'],
          closed: [],
          nextAdjustment: '',
          runDoctor: false,
        });
      } catch {
        failedWithoutAdjustment = true;
      }
      assert(failedWithoutAdjustment, 'failed receipt should require next adjustment');
      finishActiveStage({
        repoRoot: root,
        status: 'failed',
        changed: ['src/route.ts'],
        proofResult: 'node missing.js => fail',
        opened: ['TOOL_MISSING'],
        closed: [],
        nextAdjustment: 'Replan: make the proof command runnable.',
        runDoctor: false,
      });
      assert(!readActiveStage(root), 'failed receipt with replan should clear stage');
    });
    add('jit-router-self-test', () => {
      const surface = classifySurface(root, plan);
      assert(surface.kind === 'plan', `expected plan surface, got ${surface.kind}`);
      const source = classifySurface(root, join(root, 'src', 'route.ts'));
      assert(source.kind === 'typescript-source', `expected source surface, got ${source.kind}`);
    });
    add('command-runner-self-test', () => {
      const localBin = join(root, 'node_modules', '.bin');
      mkdirSync(localBin, { recursive: true });
      writeFileSync(join(localBin, 'fixture-tool'), 'extensionless shim\n', 'utf8');
      writeFileSync(join(localBin, 'fixture-tool.cmd'), '@echo off\r\necho local-fixture-tool\r\n', 'utf8');
      const pathTool = join(root, 'path-fixture-tool.cmd');
      writeFileSync(pathTool, '@echo off\r\necho path-fixture-tool\r\n', 'utf8');
      const chosen = chooseCommandCandidate('pnpm', [join(root, 'pnpm'), join(root, 'pnpm.cmd')], 'win32');
      assert(chosen.endsWith('pnpm.cmd'), 'Windows command candidate should prefer .cmd');
      const resolved = resolveCommand(root, 'fixture-tool', { platform: 'win32', pathCandidates: [pathTool] });
      assert(resolved.ok && samePath(resolved.executable, join(localBin, 'fixture-tool.cmd')), 'local node_modules/.bin .cmd should win before PATH');
      const missingCheck = runCheck(root, {
        label: 'missing fixture tool',
        apClass: AP.CONTRACT_DRIFT,
        command: 'definitely-missing-zeroh-sdd-tool',
        args: [],
        timeout: 1000,
      });
      assert(missingCheck.failureCode === 'TOOL_MISSING', 'missing tool should produce TOOL_MISSING');
      assert(inferToolFailureCode("'tsc' is not recognized as an internal or external command") === 'TOOL_MISSING', 'missing nested tool output should produce TOOL_MISSING');
      const missingFinding = deterministicFinding(root, classifySurface(root, join(root, 'src', 'route.ts')), missingCheck);
      assert(missingFinding.code === 'TOOL_MISSING' && missingFinding.scope === 'proof-command' && missingFinding.ownerAction === 'replan', 'missing tool should be proof-command/replan context');
      if (process.platform === 'win32') {
        const runnable = runCheck(root, {
          label: 'local fixture tool',
          apClass: AP.CONTRACT_DRIFT,
          command: 'fixture-tool',
          args: [],
          timeout: 1000,
        });
        assert(runnable.resolvedCommand.endsWith('fixture-tool.cmd'), 'runCheck should use the resolved .cmd command');
        assert(runnable.exitCode === 0 && runnable.output.includes('local-fixture-tool'), 'resolved .cmd command should run through cmd.exe');
      }
      assert(helpText('stage finish').includes('--proof-result') && helpText('stage finish').includes('--next-adjustment'), 'stage finish help should document receipt flags');
      assert(helpText('jit').includes('zeroh-sdd jit --file'), 'jit help should be available');
    });
    add('hook-runtime-self-test', () => {
      setActiveStage({
        repoRoot: root,
        stage: 'Step 1 - fixture',
        stepId: 'Step 1',
        planPath: relative(root, plan),
        allow: ['exact:src/route.ts'],
        proofCommand: 'node --version',
        stopRule: 'Stop after receipt.',
      });
      const denied = handlePreToolWrite({ tool_input: { file_path: join(root, 'README.md') } }, root);
      assert(denied.includes('"permissionDecision":"deny"'), 'write outside stage should deny');
      const commitDenied = handlePreToolBash({ tool_input: { command: 'git commit -m fixture' } }, root);
      assert(commitDenied.includes('"permissionDecision":"deny"'), 'commit should deny while stage open');
      const reminder = handlePostToolBash({ tool_input: { command: 'node --version' } }, root);
      assert(reminder.includes('Active proof command ran'), 'proof command should remind receipt');
      const reminderContext = JSON.parse(reminder).hookSpecificOutput.additionalContext;
      assert(reminderContext.includes('node "') && reminderContext.includes('zeroh-sdd.mjs" stage finish'), 'receipt reminder should include runnable runtime path');
      assert(reminderContext.includes('--status passed') && reminderContext.includes('--status failed'), 'receipt reminder should include passed and failed forms');
      const stop = blockIfActiveStage(root, 'Stop');
      const stopJson = JSON.parse(stop);
      assert(stopJson.decision === 'block' && !('hookSpecificOutput' in stopJson), 'stop should block with the event-specific JSON shape');
      const repeatedStop = handleHook('stop', { stop_hook_active: true }, root);
      assert(repeatedStop === '', 'stop hook should not re-block its own continuation loop');
      const taskCompleted = blockIfActiveStage(root, 'TaskCompleted', { exitCodeBlock: true });
      assert(taskCompleted.exitCode === 2 && taskCompleted.stderr.includes('Active execution stage'), 'task completion should block with exit code 2');
      const configChange = handleConfigChange({ source: 'project_settings', file_path: join(root, '.claude', 'settings.json') }, root);
      const configChangeJson = JSON.parse(configChange);
      assert(configChangeJson.decision === 'block' && !('hookSpecificOutput' in configChangeJson), 'config change should block with the event-specific JSON shape');
      const policyChange = handleConfigChange({ source: 'policy_settings' }, root);
      assert(policyChange === '', 'policy settings changes cannot be blocked');
      const retry = handlePermissionDenied({ tool_name: 'Bash', tool_input: { command: 'node --version' }, reason: 'fixture' }, root);
      assert(retry.includes('"retry":true'), 'safe proof command denial should allow retry');
      const unsafeRetry = handlePermissionDenied({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, reason: 'fixture' }, root);
      assert(unsafeRetry === '', 'unsafe denied command should not retry');
      const proofFailure = handlePostToolFailure({ tool_name: 'Bash', tool_input: { command: 'node --version' } }, root);
      const proofState = readHookState(root);
      assert(proofFailure.includes('Scope: proof-command'), 'proof failure context should name proof-command scope');
      assert(proofFailure.includes('--status failed'), 'proof failure context should include failed receipt form');
      assert(proofState.findings[0].scope === 'proof-command', 'proof command failure should be scoped to proof-command');
      clearActiveStage(root);
      const inactiveConfigChange = handleConfigChange({ source: 'project_settings' }, root);
      assert(inactiveConfigChange === '', 'config change should be silent when no stage is active');
    });
    add('hook-watch-self-test', () => {
      saveShapeRegistry(root);
      const cwd = JSON.parse(handleCwdChanged(root));
      assert(Array.isArray(cwd.watchPaths) && cwd.watchPaths.some((item) => samePath(item, join(root, 'src', 'policy.shape.ts'))), 'cwd changed should watch discovered shape files');
      writeFileSync(join(root, 'src', 'extra.shape.ts'), 'import { z } from "zod";\nexport const ExtraShape = z.object({ ok: z.boolean() });\n', 'utf8');
      const changed = JSON.parse(handleFileChanged({ file_path: join(root, 'src', 'extra.shape.ts'), event: 'add' }, root));
      assert(Array.isArray(changed.watchPaths), 'file changed should return updated watch paths');
      const registry = readShapeRegistry(root);
      assert(registry.shapes.some((shape) => shape.name === 'ExtraShape'), 'file changed should refresh shape registry');
    });
    add('async-jit-self-test', () => {
      writeHookState(root, {
        version: 1,
        lastEditedFile: 'docs/build-log/fixture-execution-spec.md',
        lastCheck: 'AP detectors',
        status: 'advisory',
        activeApFindingCount: 2,
        summary: 'fixture AP findings',
        timestamp: new Date().toISOString(),
      });
      const success = handlePostToolWriteJit({ tool_input: { file_path: plan } }, root);
      assert(success === '', 'async JIT success should stay quiet');
      assert((readHookState(root)?.activeApFindingCount || 0) >= 2, 'async JIT success should preserve same-file AP count');
      const failure = handlePostToolWriteJit({ tool_input: { file_path: missing } }, root);
      assert(failure.exitCode === 2 && failure.stderr.includes('JIT execution-spec check failed'), 'async JIT failure should wake with compact context');
    });
    add('runtime-config-self-test', () => {
      const previousJit = process.env.CLAUDE_PLUGIN_OPTION_JIT_MODE;
      const previousShapeContext = process.env.CLAUDE_PLUGIN_OPTION_MAX_SHAPE_CONTEXT;
      const previousPortableJit = process.env.ZEROH_SDD_OPTION_JIT_MODE;
      const previousProjectDir = process.env.ZEROH_SDD_PROJECT_DIR;
      const previousClaudeProjectDir = process.env.CLAUDE_PROJECT_DIR;
      const previousDataDir = process.env.ZEROH_SDD_PLUGIN_DATA;
      try {
        process.env.CLAUDE_PLUGIN_OPTION_JIT_MODE = 'sync';
        process.env.CLAUDE_PLUGIN_OPTION_MAX_SHAPE_CONTEXT = '2';
        assert(runtimeConfig().jitMode === 'sync', 'jit_mode env should override default');
        assert(runtimeConfig().maxShapeContext === 2, 'max_shape_context env should override default');
        process.env.ZEROH_SDD_OPTION_JIT_MODE = 'off';
        assert(runtimeConfig().jitMode === 'off', 'portable ZEROH_SDD_OPTION env should override platform-specific env');
        process.env.CLAUDE_PLUGIN_OPTION_JIT_MODE = 'nonsense';
        process.env.CLAUDE_PLUGIN_OPTION_MAX_SHAPE_CONTEXT = '999';
        delete process.env.ZEROH_SDD_OPTION_JIT_MODE;
        assert(runtimeConfig().jitMode === 'async-rewake', 'invalid jit_mode should fall back');
        assert(runtimeConfig().maxShapeContext === 50, 'max_shape_context should clamp to max');
        process.env.CLAUDE_PROJECT_DIR = join(root, 'claude-root');
        process.env.ZEROH_SDD_PROJECT_DIR = root;
        assert(samePath(projectRoot(), root), 'portable project root should override platform-specific project root');
        process.env.ZEROH_SDD_PLUGIN_DATA = join(root, 'portable-data');
        assert(samePath(pluginDataDir(root), join(root, 'portable-data')), 'portable plugin data should override platform-specific plugin data');
      } finally {
        restoreEnv('CLAUDE_PLUGIN_OPTION_JIT_MODE', previousJit);
        restoreEnv('CLAUDE_PLUGIN_OPTION_MAX_SHAPE_CONTEXT', previousShapeContext);
        restoreEnv('ZEROH_SDD_OPTION_JIT_MODE', previousPortableJit);
        restoreEnv('ZEROH_SDD_PROJECT_DIR', previousProjectDir);
        restoreEnv('CLAUDE_PROJECT_DIR', previousClaudeProjectDir);
        restoreEnv('ZEROH_SDD_PLUGIN_DATA', previousDataDir);
      }
    });
    add('codex-adapter', () => {
      const manifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json');
      assert(existsSync(manifestPath), 'Codex plugin manifest should exist');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert(manifest.name === 'zeroh-sdd', 'Codex manifest should name zeroh-sdd');
      assert(manifest.version === VERSION, 'Codex manifest version should match runtime version');
      assert(manifest.skills === './skills/', 'Codex manifest should expose shared skills');
      assert(!('hooks' in manifest), 'Codex first gate should not wire hooks before hook IO probe');
      assert(Array.isArray(manifest.interface?.defaultPrompt) && manifest.interface.defaultPrompt.some((prompt) => prompt.includes('sdd-planning')), 'Codex manifest should include sdd-planning starter prompt');
      assert(detectHookAdapter(['session-start', '--adapter', 'codex']) === 'codex', 'explicit codex adapter should be accepted');
      assert(hookEventArg(['--adapter', 'codex', 'session-start']) === 'session-start', 'hook event parser should allow adapter flag before event');
      const context = JSON.parse(withHookAdapter('codex', () => hookContext('SessionStart', 'fixture context')));
      assert(context.hookSpecificOutput.additionalContext === 'fixture context', 'Codex context output should use additionalContext where supported');
      const preTool = JSON.parse(withHookAdapter('codex', () => preToolContext('PreToolUse', 'shape context')));
      assert(preTool.systemMessage === 'shape context', 'Codex PreToolUse advisory context should use systemMessage');
      const denied = JSON.parse(withHookAdapter('codex', () => preToolContext('PreToolUse', 'blocked', 'deny', 'reason')));
      assert(denied.hookSpecificOutput.permissionDecision === 'deny' && denied.systemMessage === 'blocked', 'Codex deny output should preserve permissionDecision and message');
      const patch = '*** Begin Patch\n*** Update File: src/route.ts\n@@\n-old\n+new\n*** Add File: src/added.ts\n+export {};\n*** End Patch\n';
      const paths = patchFilePaths(patch).map(normalizeRepoPath);
      assert(paths.includes('src/route.ts') && paths.includes('src/added.ts'), 'Codex apply_patch paths should be extracted');
      const first = toolFilePath({ tool_name: 'apply_patch', tool_input: { command: patch } });
      assert(normalizeRepoPath(first) === 'src/route.ts', 'toolFilePath should expose first apply_patch path for adapter-normalized hooks');
    });
    add('llm-agnostic', () => {
      const claudeManifest = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
      const codexManifest = JSON.parse(readFileSync(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
      const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'));
      assert(claudeManifest.version === VERSION && codexManifest.version === VERSION && pkg.version === VERSION, 'all plugin metadata versions should match runtime version');
      assert(claudeManifest.description.includes('LLM-agent') && pkg.description.includes('LLM-agent'), 'shared metadata should describe the LLM-agent runtime');
      assert(readFileSync(join(pluginRoot, 'README.md'), 'utf8').includes('Codex'), 'README should document Codex support');
      assert(readFileSync(join(pluginRoot, 'docs', 'v1-runtime.md'), 'utf8').includes('Claude/Codex adapters'), 'runtime docs should name Claude/Codex adapters');
      assert(existsSync(join(pluginRoot, 'docs', 'codex', 'AGENTS.template.md')), 'Codex AGENTS template should exist');
      assert(existsSync(join(pluginRoot, 'scripts', 'codex-hook-discovery.mjs')), 'Codex hook discovery script should exist');
      assert(pkg.scripts?.['codex:hook-discovery'] === 'node scripts/codex-hook-discovery.mjs', 'package script should expose Codex hook discovery');
      const marketplacePath = join(pluginRoot, '..', '..', '.agents', 'plugins', 'marketplace.json');
      if (existsSync(marketplacePath)) {
        const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
        assert(marketplace.plugins?.some((plugin) => plugin.name === 'zeroh-sdd' && plugin.source?.path === './plugins/zeroh-sdd'), 'Codex marketplace should list zeroh-sdd source path');
      }
    });
    add('shape-registry-self-test', () => {
      const registry = saveShapeRegistry(root);
      assert(registry.shapes.some((shape) => shape.name === 'PolicyShape'), 'PolicyShape should be discovered');
      const aps = detectApFindings(root, join(root, 'src', 'route.ts'));
      assert(aps.length === 0, 'parsed route should not emit AP parse warning');
      writeFileSync(join(root, 'src', 'bad.ts'), 'import { PolicyShape } from "./policy.shape";\nexport const x = 1;\n', 'utf8');
      const bad = detectApFindings(root, join(root, 'src', 'bad.ts'));
      assert(bad.some((item) => item.code === AP.PARSE_BOUNDARY), 'missing parse should emit AP_PARSE_BOUNDARY');
      assert(bad[0].introducedByCurrentEdit === true && bad[0].baselineStatus === 'current-edit', 'untracked bad file should be current-edit');
      const currentContext = handlePostToolWrite({ tool_input: { file_path: join(root, 'src', 'bad.ts') } }, root);
      assert(currentContext.includes('_fix') && currentContext.includes('AP_PARSE_BOUNDARY'), 'current-edit AP should emit _fix.prompt envelope');
      spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
      spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      spawnSync('git', ['-c', 'user.name=zeroh-sdd', '-c', 'user.email=sdd@example.com', 'commit', '-m', 'baseline'], { cwd: root, encoding: 'utf8' });
      const baseline = handlePostToolWrite({ tool_input: { file_path: join(root, 'src', 'bad.ts') } }, root);
      const baselineState = readHookState(root);
      assert(baseline.includes('Baseline: pre-existing'), 'pre-existing same-file AP should be labeled baseline');
      assert(!baseline.includes('_fix'), 'pre-existing AP should not emit _fix.prompt');
      assert(baselineState.findings[0].baselineStatus === 'pre-existing', 'hook-state should record pre-existing baseline status');
      writeFileSync(join(root, 'src', 'clean.ts'), 'export const clean = true;\n', 'utf8');
      const cleanContext = handlePostToolWrite({ tool_input: { file_path: join(root, 'src', 'clean.ts') } }, root);
      assert(!cleanContext.includes('bad.ts') && !cleanContext.includes('AP_PARSE_BOUNDARY'), 'unrelated AP file should not be emitted during clean edit');
    });
    add('skill-content', () => {
      const readSkill = (name) => readFileSync(join(pluginRoot, 'skills', name, 'SKILL.md'), 'utf8');
      const requireTerms = (label, text, terms) => {
        for (const term of terms) assert(text.includes(term), `${label} should mention ${term}`);
      };
      requireTerms('sdd-planning skill', readSkill('sdd-planning'), [
        'canonical user-facing planning skill',
        'staged-doc-drafting',
        'epic-planning',
        'execution-spec',
        'live session tracking',
        'Codex task/progress tracking',
        'active-stage',
        'receipt',
        'tracker:',
        'exactly one fenced `sdd` block',
        'only skill that authors the fenced `sdd` block',
        'non-execution artifact',
        'Tool Availability First',
        'TOOL_MISSING',
      ]);
      requireTerms('execution-spec skill', readSkill('execution-spec'), [
        'Plan only to the next executable proof gate',
        'sdd-planning',
        'staged-doc-drafting',
        'epic-planning',
        'live session tracking',
        'Codex task/progress tracking',
        'tracker:',
        'Stage 0 - Repo Triangulation',
        'Stage 0.5 - Executability Classification',
        'Stage 0.6 - Open-Finding Closure Map',
        'exactly one fenced `sdd`',
        'zeroh-sdd check --plan',
        'zeroh-sdd doctor --plan',
        'zeroh-sdd stage set',
        'zeroh-sdd stage finish',
        'Only the current proof gate owns blocking truth',
        'receipt',
        'replan',
      ]);
      requireTerms('staged-doc-drafting skill', readSkill('staged-doc-drafting'), [
        'supporting methodology skill',
        'sdd-planning',
        'Stops at Stage 4',
        'Stage 0',
        'Stage 1',
        'Stage 2',
        'Stage 3',
        'Stage 4',
        'execution-spec',
        'zeroh-sdd check',
        'live session tracking',
      ]);
      requireTerms('epic-planning skill', readSkill('epic-planning'), [
        'supporting skill',
        'sdd-planning',
        'macro planning',
        'runtime authority remains `.specify/workflows/active-stage.json`',
        'progress_summary',
        'phases',
        'stories',
        'proof',
        'live session tracking',
        'execution-spec',
      ]);
      requireTerms('shapes skill', readSkill('shapes'), [
        '.describe()',
        '.meta()',
        'provenance',
        'acceptance criteria',
        'refinements',
        'parse',
        'safeParse',
        'validatedParse',
        'shape_gate.status',
      ]);
      requireTerms('implement skill', readSkill('implement'), [
        'active-stage',
        'Step N.0',
        'allowedPaths',
        'parse untrusted inputs',
        '_fix.prompt',
        'RFC-style problem details',
        'branch-baseline findings',
        'zeroh-sdd stage finish',
        '--status failed',
        'TOOL_UNRUNNABLE',
      ]);
      requireTerms('ap-taxonomy skill', readSkill('ap-taxonomy'), [
        'Close-The-Loop Rule',
        'execution-spec',
        'sdd doctor',
        'cheap hook',
        'current execution gate',
        '_fix.prompt',
        'Hard gates',
      ]);
    });
    add('hook-manifest-self-test', () => {
      const supportedEvents = new Set([
        'PreToolUse',
        'PostToolUse',
        'PostToolUseFailure',
        'Notification',
        'UserPromptSubmit',
        'SessionStart',
        'SessionEnd',
        'Stop',
        'SubagentStart',
        'SubagentStop',
        'PreCompact',
        'PermissionRequest',
        'Setup',
        'TeammateIdle',
        'TaskCompleted',
        'ConfigChange',
        'WorktreeCreate',
        'WorktreeRemove',
      ]);
      const manifest = JSON.parse(readFileSync(join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
      const invalid = Object.keys(manifest.hooks || {}).filter((eventName) => !supportedEvents.has(eventName));
      assert(invalid.length === 0, `unsupported hook event(s): ${invalid.join(', ')}`);
    });
    add('docs-ux-self-test', () => {
      const readPluginDoc = (path) => readFileSync(join(pluginRoot, path), 'utf8');
      const readOptionalRepoDoc = (path) => {
        const candidate = join(pluginRoot, '..', '..', path);
        return existsSync(candidate) ? readFileSync(candidate, 'utf8') : '';
      };
      const readme = readPluginDoc('README.md');
      const runtimeDoc = readPluginDoc(join('docs', 'v1-runtime.md'));
      const changelog = readPluginDoc('CHANGELOG.md');
      const rootReadme = readOptionalRepoDoc('README.md');
      const manifest = JSON.parse(readFileSync(join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
      const wiredEvents = Object.keys(manifest.hooks || {});
      const wiredSection = sectionBetween(readme, '### Wired In Current Claude Build', '### Runtime-Supported But Not Currently Wired');
      const unwiredSection = sectionBetween(readme, '### Runtime-Supported But Not Currently Wired', '## Configuration');
      const runtimeOnlyEvents = ['PostToolBatch', 'PostCompact', 'CwdChanged', 'FileChanged', 'PermissionDenied'];

      assert(readme.includes('Use zeroh-sdd sdd-planning for this upgrade'), 'README should point non-trivial work to the sdd-planning front door');
      assert(readme.includes('Use zeroh-sdd execution-spec for this change'), 'README should preserve a copy-paste execution-spec fast-path prompt');
      assert(readme.includes('staged-doc-drafting` only as the supporting Stage 0-4 long-form method'), 'README should frame staged-doc-drafting as supporting method');
      assert(readme.includes('epic-planning` only as the supporting macro tracker method'), 'README should frame epic-planning as supporting method');
      assert(readme.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-sdd.mjs" hook <event>'), 'README should document the direct node hook launcher');
      assert(!readme.includes('bash "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-sdd" hook <event>'), 'README should not document the stale nested Bash launcher');
      assert(readme.includes('/plugin marketplace update zeroh-marketplace') && readme.includes('/plugin update zeroh-sdd@zeroh-marketplace'), 'README should include marketplace update commands');
      assert(readme.includes('restart Claude Code or start a fresh Claude session'), 'README should mention restart/new-session after install or update');
      assert(readme.includes('Codex packaging currently ships the same skills') && readme.includes('codex plugin marketplace'), 'README should document Codex first-gate packaging and install path');
      assert(readme.includes('npm run codex:hook-discovery'), 'README should document Codex hook discovery probe');
      assert(readme.includes('edited-file') && readme.includes('proof-command') && readme.includes('repo-background'), 'README should explain finding attribution');
      assert(readme.includes('ZEROH_SDD_OPTION_*') && readme.includes('does not expose `userConfig`'), 'README should frame config as portable env-backed advanced knobs');
      assert(wiredSection, 'README should have a wired hook section');
      assert(unwiredSection, 'README should have an unwired runtime handler section');
      for (const eventName of wiredEvents) assert(wiredSection.includes(eventName), `README wired hook section should mention ${eventName}`);
      for (const eventName of runtimeOnlyEvents) {
        assert(!wiredSection.includes(eventName), `README wired hook section should not list runtime-only event ${eventName}`);
        assert(unwiredSection.includes(eventName), `README should label ${eventName} as runtime-supported but unwired`);
      }
      assert(runtimeDoc.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-sdd.mjs" hook <event>'), 'runtime doc should document the direct node hook launcher');
      assert(runtimeDoc.includes('.codex-plugin/plugin.json') && runtimeDoc.includes('Codex hook wiring should be added only after a probe'), 'runtime doc should explain Codex packaging and hook probe gate');
      assert(runtimeDoc.includes('npm run codex:hook-discovery'), 'runtime doc should document Codex hook discovery probe');
      assert(runtimeDoc.includes('runtime-supported but not live'), 'runtime doc should tell maintainers to label unwired handlers');
      assert(changelog.includes('## 1.0.6') && changelog.includes('Added `sdd-planning` as the canonical planning front door'), 'changelog should record the canonical planning front-door upgrade');
      assert(changelog.includes('## 1.0.3') && changelog.includes('Corrected hook documentation'), 'changelog should record the UX remediation');
      assert(!changelog.includes('PostToolBatch, TaskCompleted, Stop, compact, config-change, cwd/file-change, and permission-denial events through the runtime'), 'changelog should not preserve the stale live-hook claim');
      if (rootReadme) {
        assert(rootReadme.includes('execution-spec control plane') && rootReadme.includes('branch-baseline noise'), 'root README should describe zeroh-sdd as scoped execution control, not generic hook noise');
      }
    });

    const selected = suite === 'all' ? checks : checks.filter((check) => check.name === suite);
    if (selected.length === 0) throw new Error(`Unknown self-test suite: ${suite}`);
    for (const check of selected) {
      check.fn();
      console.log(`${check.name}: OK`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function validPlanMarkdown() {
  return `# Fixture Execution Spec

## Step 1

Edit \`src/route.ts\` and prove the shape boundary.

\`\`\`sdd
sdd:
  version: 1
  id: fixture-execution-spec
  status: ready
  requirement:
    owner: "tests"
    evidence:
      - "src/route.ts"
    why_now: "Prove the v1 runtime loop."
  change:
    intent: "Wire the route through the policy shape."
    adds:
      - "shape proof"
    deletes_or_subsumes:
      - "unvalidated boundary"
  source_authority:
    official_sources:
      - "fixture"
    local_extensions: []
    prohibited_shortcuts:
      - "skip parse"
  simplification_proof:
    preserves:
      - "validation"
    rejected_simpler_options:
      - option: "trust TypeScript"
        reason: "runtime inputs are unknown"
  validation:
    commands:
      - "node --version"
    proof_tiers:
      - "unit"
  stage_gate:
    next_gate: "Step 1 receipt"
    first_executable_slice: "Validate route boundary"
    proof_command: "node --version"
    stop_rule: "Stop after receipt."
    replan_trigger: "Proof fails."
    surfaces:
      existing:
        - "src/route.ts"
      creates: []
      future: []
  shape_gate:
    required_shapes:
      - "PolicyShape"
    parse_boundaries:
      - "src/route.ts"
    status: red
  tracker:
    kind: epic
    path: "docs/epics/EPIC-fixture.md"
    phase_id: P1
    item_id: S1
    todo_policy: mirror-current-slice
\`\`\`
`;
}

function validEpicMarkdown() {
  return `---
epic:
  id: "E0.fixture"
  name: "Fixture Epic"
  status: "EXECUTION"

progress_summary:
  stories: { total: 1, complete: 0, in_progress: 0, partial: 0, blocked: 0, not_started: 1 }
  phases: { total: 1, complete: 0 }

blocking_gate:
  rule: "Fixture ready"
  check: "node --version"
  status: "CLEAR"

phases:
  - id: P1
    name: "Fixture Phase"
    stories: [S1]
    gate: "Route boundary proves shape parse"
    verify_command: "node --version"
    status: PENDING
    gate_passed: null

stories:
  - id: S1
    name: "Route boundary"
    status: NOT_STARTED
    deps: []
    deliverable: "src/route.ts"
    completed_at: null
    commit: null
    note: null
    implements_adrs: []
    proof:
      verify_cmd: "node --version"
      expected: "exit 0"
      actual: null
      passed: null
      remediation: null
---
`;
}

function extractSddFences(markdown) {
  const fences = [];
  const regex = /```sdd\s*\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(markdown))) fences.push(match[1]);
  return fences;
}

function requireObject(parent, key, findings, code, apClass, message) {
  if (!isObject(parent?.[key])) findings.push(finding('P0', code, apClass, message));
}

function requireString(parent, key, findings, code, apClass, message) {
  if (typeof parent?.[key] !== 'string' || parent[key].trim() === '') findings.push(finding('P0', code, apClass, message));
}

function requireArray(parent, key, findings, code, apClass, message) {
  if (!Array.isArray(parent?.[key])) findings.push(finding('P0', code, apClass, message));
}

function requireNonEmptyArray(parent, key, findings, code, apClass, message) {
  if (!Array.isArray(parent?.[key]) || parent[key].length === 0) findings.push(finding('P0', code, apClass, message));
}

function finding(severity, code, apClass, message, remediation = []) {
  return { severity, code, apClass, message, remediation };
}

function apFinding(code, surface, filePath, hits, prose, metadata = {}) {
  return { code, surface, filePath, hits, prose, metadata };
}

function withFindingAttribution(repoRoot, rel, item) {
  const introducedByCurrentEdit = findingIntroducedByCurrentEdit(repoRoot, rel, item);
  const baselineStatus = introducedByCurrentEdit ? 'current-edit' : 'pre-existing';
  const ownerAction = introducedByCurrentEdit ? 'fix-now' : 'receipt-note';
  return {
    ...item,
    scope: 'edited-file',
    baselineStatus,
    introducedByCurrentEdit,
    ownerAction,
    metadata: {
      ...item.metadata,
      scope: 'edited-file',
      baselineStatus,
      introducedByCurrentEdit,
      ownerAction,
    },
  };
}

function findingIntroducedByCurrentEdit(repoRoot, rel, item) {
  if (!isGitTracked(repoRoot, rel)) return true;
  const diff = git(repoRoot, ['diff', '-U0', '--', rel]);
  if (!diff.trim()) return false;
  const added = diffLines(diff, '+');
  const removed = diffLines(diff, '-');
  if (item.code === AP.TEST_CAPITULATION) return true;
  if (item.code === AP.PARSE_BOUNDARY) {
    return added.some((line) => /\b[A-Za-z0-9_]*(Schema|Shape)\b/.test(line)) || removed.some((line) => /\b(validatedParse|safeParse|parse)\s*\(/.test(line));
  }
  if (item.code === AP.SILENT_FAIL) {
    return added.some((line) => /\?\?\s*(["'`{[]|\d|DEFAULT_|fallback|nullish)/i.test(line)
      || /catch\s*\([^)]*\)\s*\{\s*\}|catch\s*\{\s*\}/.test(line)
      || /(model|provider|fallback).*\[.*(claude|gpt|openai|anthropic|local)/i.test(line)
      || /SELECT\s+\?s\s+\?p\s+\?o/i.test(line));
  }
  if (item.code === AP.HARDCODED_DATA) {
    const iriCount = (added.join('\n').match(/["'`](?:urn:|https?:\/\/|[a-z]+:[A-Za-z])[A-Za-z0-9_:/#.\-]+["'`]/g) || []).length;
    return iriCount > 0 || added.some((line) => /^\s*const\s+[A-Za-z_][A-Za-z0-9_]*\s*[:=]/.test(line));
  }
  return added.length > 0 || removed.length > 0;
}

function isGitTracked(repoRoot, rel) {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', rel], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0;
}

function diffLines(diff, marker) {
  return diff.split(/\r?\n/)
    .filter((line) => line.startsWith(marker) && !line.startsWith(`${marker}${marker}${marker}`))
    .map((line) => line.slice(1));
}

function deterministicFinding(repoRoot, surface, result) {
  const stage = readActiveStage(repoRoot);
  const command = [result.command, ...result.args].join(' ');
  const proofScoped = Boolean(result.failureCode || (stage?.proofCommand && commandMatchesProof(command, stage.proofCommand)));
  const activeScoped = Boolean(stage && allowedByStage(repoRoot, stage, surface.absolute).allowed);
  const scope = proofScoped ? 'proof-command' : activeScoped ? 'active-stage' : 'edited-file';
  return normalizeHookFinding({
    code: result.failureCode || result.apClass,
    surface: result.failureCode ? 'runtime.command-runner' : result.label,
    filePath: surface.repoRelativePath,
    hits: result.failureCode ? `${result.label} could not run: ${trim(result.output, 300)}` : `${result.label} failed`,
    scope,
    baselineStatus: proofScoped ? 'unknown' : 'current-edit',
    introducedByCurrentEdit: false,
    ownerAction: proofScoped ? 'replan' : 'receipt-note',
  });
}

function normalizeHookFinding(item) {
  const scope = FINDING_SCOPES.includes(item.scope) ? item.scope : 'repo-background';
  const baselineStatus = BASELINE_STATUSES.includes(item.baselineStatus) ? item.baselineStatus : 'unknown';
  const ownerAction = OWNER_ACTIONS.includes(item.ownerAction) ? item.ownerAction : 'receipt-note';
  return {
    code: item.code,
    surface: item.surface,
    filePath: item.filePath,
    hits: String(item.hits || '').slice(0, 500),
    scope,
    baselineStatus,
    introducedByCurrentEdit: Boolean(item.introducedByCurrentEdit),
    ownerAction,
  };
}

function toHookStateFinding(item) {
  return normalizeHookFinding(item);
}

function summarizeAttributedFindings(currentCount, baselineCount) {
  const parts = [];
  if (currentCount > 0) parts.push(`${currentCount} current-edit AP finding(s) emitted as JIT context`);
  if (baselineCount > 0) parts.push(`${baselineCount} pre-existing AP finding(s) labeled as baseline`);
  return parts.length > 0 ? `${parts.join('; ')}.` : 'No AP findings.';
}

function hasP0(findings) {
  return findings.some((item) => item.severity === 'P0');
}

function printSddReport(label, result) {
  console.log(`${label}: ${result.ok ? 'OK' : 'FAIL'}`);
  console.log(`plan: ${result.planPath}`);
  if (result.document?.sdd?.id) console.log(`id: ${result.document.sdd.id}`);
  if (result.findings.length > 0) console.log(formatFindings(result.findings));
}

function formatFindings(findings) {
  return findings.map((item) => [
    `${item.severity} ${item.code} ${item.apClass}`,
    item.message,
    ...(item.remediation || []).map((line) => `  - ${line}`),
  ].join('\n')).join('\n\n');
}

function extractCodeSurfaces(markdown) {
  const surfaces = new Set();
  const regex = /`((?:src|apps|packages|tests|tools|plugins|data)\/[^`\s|]+)`/g;
  let match;
  while ((match = regex.exec(markdown))) {
    const surface = match[1].replace(/[.,;:)]+$/, '');
    if (!surface.endsWith('.md')) surfaces.add(surface);
  }
  return [...surfaces];
}

function isDeclaredSurface(surface, declared) {
  return declared.some((entry) => {
    const normalized = normalizeRepoPath(entry);
    return surface === normalized || surface.startsWith(`${normalized.replace(/\/$/, '')}/`);
  });
}

function parseAllowRule(repoRoot, entry) {
  const [mode, ...rest] = entry.split(':');
  const rawPath = rest.join(':');
  if (!['exact', 'prefix'].includes(mode) || !rawPath) throw new Error(`Invalid allow rule: ${entry}`);
  return { mode, path: toRepoRelative(repoRoot, rawPath) };
}

function allowedByStage(repoRoot, stage, filePath) {
  const relativePath = toRepoRelative(repoRoot, filePath);
  const allowed = (stage.allowedPaths || []).some((rule) => {
    const rulePath = normalizeRepoPath(rule.path);
    if (rule.mode === 'prefix') return relativePath === rulePath || relativePath.startsWith(`${rulePath.replace(/\/$/, '')}/`);
    return relativePath === rulePath;
  });
  return { allowed, relativePath };
}

function upsertReceipt(markdown, receipt) {
  const trackerNote = receipt.tracker ? `tracker ${trackerLabel(receipt.tracker)}; ` : '';
  const nextAdjustment = receipt.nextAdjustment ? `${trackerNote}${receipt.nextAdjustment}` : trackerNote ? `${trackerNote}update tracker before next gate` : '(none)';
  const row = `| ${receipt.stepId} | ${receipt.status} | ${receipt.changed.join(', ') || '(none)'} | ${receipt.proofResult} | ${receipt.opened.join(', ') || '(none)'} | ${receipt.closed.join(', ') || '(none)'} | ${nextAdjustment} |`;
  const tableHeader = [
    '## Execution Receipts',
    '',
    '| Step | Status | Changed files | Proof result | Opened findings | Closed findings | Next adjustment |',
    '|---|---|---|---|---|---|---|',
  ].join('\n');
  if (!/## Execution Receipts/i.test(markdown)) {
    return `${markdown.trimEnd()}\n\n${tableHeader}\n${row}\n`;
  }
  const lines = markdown.split(/\r?\n/);
  const existingIndex = lines.findIndex((line) => line.startsWith(`| ${receipt.stepId} |`));
  if (existingIndex >= 0) lines[existingIndex] = row;
  else lines.push(row);
  return `${lines.join('\n').trimEnd()}\n`;
}

function normalizeTrackerBridge(tracker) {
  return {
    kind: String(tracker.kind || ''),
    path: normalizeRepoPath(tracker.path || ''),
    phase_id: String(tracker.phase_id || ''),
    item_id: String(tracker.item_id || ''),
    todo_policy: String(tracker.todo_policy || ''),
  };
}

function trackerLabel(tracker) {
  const normalized = normalizeTrackerBridge(tracker);
  return `${normalized.kind}:${normalized.path}#${normalized.phase_id}/${normalized.item_id}`;
}

function yamlIdExists(text, id) {
  if (!id) return false;
  return new RegExp(`\\bid:\\s*["']?${escapeRegExp(id)}["']?\\b`).test(text);
}

function yamlItemBlock(text, id) {
  if (!id) return '';
  const start = text.search(new RegExp(`(^|\\n)\\s*-\\s+id:\\s*["']?${escapeRegExp(id)}["']?\\b`));
  if (start < 0) return '';
  const rest = text.slice(start);
  const next = rest.slice(1).search(/\n\s*-\s+id:\s*["']?[-A-Za-z0-9_]+["']?\b/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function writeHookState(repoRoot, state) {
  const file = hookStatePath(repoRoot);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function readHookState(repoRoot) {
  const file = hookStatePath(repoRoot);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function initPluginData(repoRoot) {
  const dataDir = pluginDataDir(repoRoot);
  mkdirSync(dataDir, { recursive: true });
  const cache = join(dataDir, 'runtime-cache.json');
  if (!existsSync(cache)) writeFileSync(cache, `${JSON.stringify({ version: 1, initializedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
}

function walkFiles(root) {
  const out = [];
  const excluded = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '.turbo']);
  const visit = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(full);
      if (out.length > 5000) return;
    }
  };
  visit(root);
  return out;
}

function extractShapeFields(text) {
  const fields = new Set();
  const match = text.match(/z\.(?:object|strictObject)\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!match) return [];
  const regex = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*z\./g;
  let field;
  while ((field = regex.exec(match[1]))) fields.add(field[1]);
  return [...fields];
}

function isShapeFile(filePath) {
  return /\.(shape|schema)\.[tj]sx?$/.test(filePath) || /(?:Shape|Schema)\.[tj]sx?$/.test(filePath);
}

function latestPlan(repoRoot) {
  const dir = join(repoRoot, 'docs', 'build-log');
  if (!existsSync(dir)) return '';
  const plans = readdirSync(dir).filter((file) => file.endsWith('.md')).map((file) => {
    const full = join(dir, file);
    return { file: normalizeRepoPath(relative(repoRoot, full)), mtime: statSync(full).mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime);
  return plans[0]?.file || '';
}

function headBehindPrimaryRemote(repoRoot) {
  for (const remoteRef of ['origin/main', 'origin/develop']) {
    const result = spawnSync('git', ['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`], { cwd: repoRoot, encoding: 'utf8' });
    if (result.status === 0) {
      const [, behind] = result.stdout.trim().split(/\s+/).map(Number);
      return Number.isFinite(behind) ? behind : 0;
    }
  }
  return 0;
}

function packageNameExists(repoRoot, packageName) {
  for (const file of walkFiles(repoRoot)) {
    if (!file.endsWith(`${sep}package.json`)) continue;
    try {
      const json = JSON.parse(readFileSync(file, 'utf8'));
      if (json.name === packageName) return true;
    } catch {
      // ignore invalid package manifests for this cheap doctor check
    }
  }
  return false;
}

function nearestPackageName(repoRoot, filePath) {
  let dir = statSync(filePath).isDirectory() ? filePath : dirname(filePath);
  while (dir.startsWith(repoRoot)) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        return JSON.parse(readFileSync(pkg, 'utf8')).name || undefined;
      } catch {
        return undefined;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function runCheck(repoRoot, check) {
  const resolved = resolveCommand(repoRoot, check.command);
  if (!resolved.ok) {
    return {
      ...check,
      resolvedCommand: '',
      exitCode: 1,
      failureCode: 'TOOL_MISSING',
      output: `TOOL_MISSING: ${check.command} was not found in local node_modules/.bin or PATH.`,
    };
  }
  const result = spawnResolvedCommand(repoRoot, resolved.executable, check.args, check.timeout);
  const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? result.error.message : ''}`;
  const failureCode = result.error
    ? result.error.code === 'ENOENT'
      ? 'TOOL_MISSING'
      : 'TOOL_UNRUNNABLE'
    : result.status && result.status !== 0
      ? inferToolFailureCode(output)
      : undefined;
  return {
    ...check,
    resolvedCommand: resolved.executable,
    exitCode: result.status ?? (result.error ? 1 : 0),
    failureCode,
    output,
  };
}

function spawnResolvedCommand(repoRoot, executable, args, timeout) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [executable, ...args].map(quoteCmdArg).join(' ')], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout,
      shell: false,
    });
  }
  return spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout,
    shell: false,
  });
}

function resolveCommand(repoRoot, command, options = {}) {
  const platform = options.platform || process.platform;
  const normalizedCommand = fromPortablePath(command);
  if (isCommandPath(normalizedCommand)) {
    const absolute = isAbsolute(normalizedCommand) ? normalizedCommand : resolve(repoRoot, normalizedCommand);
    return existsSync(absolute)
      ? { ok: true, command, executable: absolute, source: 'path' }
      : { ok: false, command, reason: 'path-missing' };
  }

  const localCandidates = localBinCandidates(repoRoot, normalizedCommand, platform).filter((candidate) => existsSync(candidate));
  const local = chooseCommandCandidate(normalizedCommand, localCandidates, platform);
  if (local) return { ok: true, command, executable: local, source: 'local-bin' };

  const pathCandidates = options.pathCandidates || findCommandOnPath(normalizedCommand, platform);
  const pathMatch = chooseCommandCandidate(normalizedCommand, pathCandidates, platform);
  if (pathMatch) return { ok: true, command, executable: pathMatch, source: 'path' };
  return { ok: false, command, reason: 'not-found' };
}

function localBinCandidates(repoRoot, command, platform = process.platform) {
  const candidates = [];
  let dir = resolve(repoRoot);
  while (true) {
    const binDir = join(dir, 'node_modules', '.bin');
    for (const name of commandNames(command, platform)) candidates.push(join(binDir, name));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return candidates;
}

function findCommandOnPath(command, platform = process.platform) {
  if (platform === 'win32') {
    const result = spawnSync('where.exe', [command], { shell: false, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  }
  const result = spawnSync('command', ['-v', command], { shell: true, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

function commandNames(command, platform = process.platform) {
  if (platform !== 'win32' || extname(command)) return [command];
  return [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command, `${command}.ps1`];
}

function chooseCommandCandidate(command, candidates, platform = process.platform) {
  const list = [...new Set((candidates || []).map((candidate) => fromPortablePath(candidate)).filter(Boolean))];
  if (list.length === 0) return '';
  if (platform !== 'win32') return list[0];
  const commandName = filename(command).toLowerCase();
  const exactCmd = list.find((candidate) => filename(candidate).toLowerCase() === `${commandName}.cmd`);
  if (WINDOWS_CMD_PREFERRED.includes(commandName) && exactCmd) return exactCmd;
  const nonPs1 = list.find((candidate) => !filename(candidate).toLowerCase().endsWith('.ps1'));
  return nonPs1 || list[0];
}

function isCommandPath(command) {
  return isAbsolute(command) || /[\\/]/.test(command);
}

function filename(value) {
  return String(value || '').replace(/\\/g, '/').split('/').pop() || '';
}

function quoteCmdArg(value) {
  const text = String(value);
  if (text === '') return '""';
  if (!/[ \t&()^|<>"]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function inferToolFailureCode(output) {
  const text = String(output || '');
  if (/is not recognized as an internal or external command/i.test(text)) return 'TOOL_MISSING';
  if (/\bcommand not found\b/i.test(text)) return 'TOOL_MISSING';
  if (/\bCommand ".*" not found\b/i.test(text)) return 'TOOL_MISSING';
  if (/could not determine executable to run/i.test(text)) return 'TOOL_MISSING';
  if (/\b(EACCES|permission denied)\b/i.test(text)) return 'TOOL_UNRUNNABLE';
  return undefined;
}

function surfaceExists(repoRoot, surface) {
  return existsSync(resolve(repoRoot, surface));
}

function safeRead(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function git(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout : '';
}

function emitHookResult(result) {
  if (!result) return;
  if (typeof result === 'string') {
    process.stdout.write(`${result}\n`);
    return;
  }
  if (result.stdout) process.stdout.write(`${result.stdout.trimEnd()}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr.trimEnd()}\n`);
  if (Number.isInteger(result.exitCode)) process.exitCode = result.exitCode;
}

function hookExit(exitCode, stderr = '', stdout = '') {
  return { exitCode, stderr, stdout };
}

function hookContext(event, additionalContext) {
  if (!additionalContext) return '';
  if (CURRENT_HOOK_ADAPTER === 'codex') {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } });
  }
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } });
}

function watchPathsContext(repoRoot, additionalContext = '', event = 'CwdChanged') {
  const output = { watchPaths: buildWatchPaths(repoRoot) };
  if (additionalContext) {
    output.hookSpecificOutput = { hookEventName: event, additionalContext };
  }
  return JSON.stringify(output);
}

function preToolContext(event, additionalContext, permissionDecision, permissionDecisionReason) {
  if (CURRENT_HOOK_ADAPTER === 'codex' && !permissionDecision) {
    return JSON.stringify({ systemMessage: additionalContext });
  }
  const hookSpecificOutput = { hookEventName: event, additionalContext };
  if (permissionDecision) hookSpecificOutput.permissionDecision = permissionDecision;
  if (permissionDecisionReason) hookSpecificOutput.permissionDecisionReason = permissionDecisionReason;
  if (CURRENT_HOOK_ADAPTER === 'codex' && additionalContext) {
    return JSON.stringify({ systemMessage: additionalContext, hookSpecificOutput });
  }
  return JSON.stringify({ hookSpecificOutput });
}

function toolFilePath(input) {
  return toolFilePaths(input)[0] || '';
}

function toolFilePaths(input) {
  const explicit = input?.tool_input?.file_path || input?.tool_input?.path;
  if (explicit) return [fromPortablePath(explicit)];
  if (input?.tool_name === 'apply_patch' || input?.tool_input?.command?.includes('*** Begin Patch')) {
    return patchFilePaths(input?.tool_input?.command || '');
  }
  return [];
}

function patchFilePaths(command) {
  const paths = [];
  const patterns = [
    /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm,
    /^\*\*\* Move to: (.+)$/gm,
  ];
  for (const pattern of patterns) {
    for (const match of String(command || '').matchAll(pattern)) {
      const path = match[1]?.trim();
      if (path) paths.push(fromPortablePath(path));
    }
  }
  return [...new Set(paths)];
}

function toolCommand(input) {
  return input?.tool_input?.command || '';
}

function buildWatchPaths(repoRoot) {
  const paths = new Set([
    activeStagePath(repoRoot),
    hookStatePath(repoRoot),
  ]);
  const stage = readActiveStage(repoRoot);
  if (stage?.planPath) paths.add(resolve(repoRoot, stage.planPath));
  const latest = latestPlan(repoRoot);
  if (latest) paths.add(resolve(repoRoot, latest));
  if (runtimeConfig().shapeWatch) {
    const registry = readShapeRegistry(repoRoot) || discoverShapes(repoRoot);
    for (const shape of registry.shapes) paths.add(resolve(repoRoot, shape.path));
  }
  return [...paths];
}

function samePath(left, right) {
  const a = normalizeRepoPath(resolve(fromPortablePath(left)));
  const b = normalizeRepoPath(resolve(fromPortablePath(right)));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isRetrySafeDeniedCommand(command, stage) {
  if (!command) return false;
  if (/\bzeroh-sdd\s+stage\s+(status|finish)\b|\bsdd:stage\s+(status|finish)\b/.test(command)) return true;
  if (!stage?.proofCommand) return false;
  return command.includes(stage.proofCommand) || stage.proofCommand.includes(command);
}

function shouldBlockHardGate(config = runtimeConfig()) {
  return config.enforcementMode !== 'advisory';
}

function runtimeConfig() {
  return {
    enforcementMode: enumOption('enforcement_mode', ['advisory', 'balanced', 'strict'], DEFAULT_RUNTIME_CONFIG.enforcementMode),
    jitMode: enumOption('jit_mode', ['off', 'sync', 'async-rewake'], DEFAULT_RUNTIME_CONFIG.jitMode),
    shapeWatch: booleanOption('shape_watch', DEFAULT_RUNTIME_CONFIG.shapeWatch),
    maxShapeContext: numberOption('max_shape_context', DEFAULT_RUNTIME_CONFIG.maxShapeContext, 1, 50),
    doctorOnFinish: booleanOption('doctor_on_finish', DEFAULT_RUNTIME_CONFIG.doctorOnFinish),
  };
}

function enumOption(key, allowed, fallback) {
  const value = pluginOption(key);
  return allowed.includes(value) ? value : fallback;
}

function booleanOption(key, fallback) {
  const value = pluginOption(key);
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (/^(1|true|yes|on)$/i.test(String(value))) return true;
  if (/^(0|false|no|off)$/i.test(String(value))) return false;
  return fallback;
}

function numberOption(key, fallback, min, max) {
  const value = Number(pluginOption(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function pluginOption(key) {
  return envOption('ZEROH_SDD_OPTION', key)
    ?? envOption('CLAUDE_PLUGIN_OPTION', key)
    ?? envOption('CODEX_PLUGIN_OPTION', key);
}

function envOption(prefix, key) {
  return process.env[`${prefix}_${key}`]
    ?? process.env[`${prefix}_${key.toUpperCase()}`]
    ?? process.env[`${prefix}_${key.replace(/_/g, '').toUpperCase()}`];
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function readJsonStdin() {
  const text = readFileSync(0, 'utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function requireFlag(args, name) {
  const value = flagValue(args, name);
  if (!value) throw new Error(`Missing required flag ${name}.`);
  return value;
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  return args[index + 1] || '';
}

function flagValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values.flatMap((value) => value.includes(',') ? value.split(',').map((item) => item.trim()).filter(Boolean) : [value]);
}

function hasFlag(args, name) {
  return args.includes(name);
}

function wantsHelp(args) {
  return args.includes('--help') || args.includes('-h');
}

function hookEventArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--adapter') {
      index += 1;
      continue;
    }
    if (!value.startsWith('-')) return value;
  }
  return '';
}

function detectHookAdapter(args = []) {
  const explicit = flagValue(args, '--adapter');
  if (explicit) {
    if (!HOOK_ADAPTERS.includes(explicit)) throw new Error(`Unsupported hook adapter: ${explicit}. Expected ${HOOK_ADAPTERS.join(' or ')}.`);
    return explicit;
  }
  if (process.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDE_PROJECT_DIR) return 'claude';
  if (process.env.CODEX_HOME || process.env.CODEX_PROJECT_DIR || process.env.CODEX_PLUGIN_DATA) return 'codex';
  return 'claude';
}

function withHookAdapter(adapter, fn) {
  const previous = CURRENT_HOOK_ADAPTER;
  CURRENT_HOOK_ADAPTER = adapter;
  try {
    return fn();
  } finally {
    CURRENT_HOOK_ADAPTER = previous;
  }
}

function projectRoot() {
  return resolve(fromPortablePath(
    process.env.ZEROH_SDD_PROJECT_DIR
    || process.env.CLAUDE_PROJECT_DIR
    || process.env.CODEX_PROJECT_DIR
    || process.cwd(),
  ));
}

function pluginDataDir(repoRoot) {
  return resolve(fromPortablePath(
    process.env.ZEROH_SDD_PLUGIN_DATA
    || process.env.CLAUDE_PLUGIN_DATA
    || process.env.CODEX_PLUGIN_DATA
    || join(repoRoot, '.specify', 'workflows', '.zeroh-sdd-plugin-data'),
  ));
}

function activeStagePath(repoRoot) {
  return join(repoRoot, ...STATE_DIR, ACTIVE_STAGE);
}

function hookStatePath(repoRoot) {
  return join(repoRoot, ...STATE_DIR, HOOK_STATE);
}

function currentScriptPath() {
  return process.argv[1] ? resolve(process.argv[1]) : new URL(import.meta.url).pathname;
}

function runtimeCli() {
  return `node "${normalizeRepoPath(currentScriptPath())}"`;
}

function commandMatchesProof(command, proofCommand) {
  if (!command || !proofCommand) return false;
  return command.includes(proofCommand) || proofCommand.includes(command);
}

function toRepoRelative(repoRoot, candidate) {
  const normalized = normalizeRepoPath(fromPortablePath(candidate));
  const absolute = resolve(repoRoot, normalized);
  if (absolute.startsWith(resolve(repoRoot))) return normalizeRepoPath(relative(repoRoot, absolute));
  return normalized;
}

function fromPortablePath(value) {
  const text = String(value || '');
  if (process.platform === 'win32') {
    const mnt = text.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (mnt) return `${mnt[1].toUpperCase()}:/${mnt[2]}`;
    const gitBash = text.match(/^\/([a-zA-Z])\/(.*)$/);
    if (gitBash) return `${gitBash[1].toUpperCase()}:/${gitBash[2]}`;
  }
  return text;
}

function normalizeRepoPath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function trim(value, max) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}\n... truncated ...` : text;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sectionBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = text.indexOf(endMarker, start + startMarker.length);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}

export {
  checkPlan,
  doctorPlan,
  setActiveStage,
  finishActiveStage,
  clearActiveStage,
  readActiveStage,
  runRelevantChecks,
  classifySurface,
  handleHook,
  discoverShapes,
};
