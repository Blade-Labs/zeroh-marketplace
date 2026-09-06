import { readFileSync, writeFileSync } from 'node:fs';

if (process.cwd() !== '/tmp/greenfield-r0-pilot-px9y6380/project') throw new Error('Unexpected consumer root');

const configPath = 'roadmap/roadmap.config.json';
const prdPath = 'docs/PRD.md';
const adrPath = 'docs/adr/0001-tech-stack.md';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const prd = readFileSync(prdPath, 'utf8');
const adr = readFileSync(adrPath, 'utf8');
const oldPrd = 'The product packet supplies the scope. Stack rationale is in [the stack record](adr/0001-tech-stack.md). Consumer execution requires explicit approval. The actual approval response and approved scope must be recorded here after it arrives; none has been received during proposal preparation.';
const oldAdr = 'This is a proposed ruling pending foundation approval.';
if (prd.split(oldPrd).length !== 2 || adr.split(oldAdr).length !== 2) throw new Error('Unexpected approval-record state');
if (config.configVersion !== 1 || config.designHomes || config.testConventions) throw new Error('Unexpected configuration state');

config.gateCommands = {
  lint: 'none',
  types: 'none',
  unit: 'node --test',
  integration: 'node src/cli.js --help',
  build: 'none',
  e2e: 'none',
  emit: 'none'
};
config.designHomes = {
  architecture: {
    home: 'docs/architecture.md',
    extendProtocol: 'docs/architecture.md'
  },
  ux: {
    canon: ['docs/ux-canon.md'],
    copyRules: 'docs/ux-canon.md',
    bindingDesignSystem: 'docs/adr/0002-design-system.md'
  }
};
config.testConventions = [
  'Use Node.js built-in node:test and node:assert/strict; run node --test.',
  'Keep tests in test/*.test.js; test the pure greeting function without mocks or fixture files.',
  'Run node src/cli.js --help separately for CLI wiring; this is a smoke check, not full CLI branch coverage.',
  'See docs/TEST-STRATEGY.md for test boundaries and absent-gate reasons.'
];

const newPrd = `The product packet supplies the scope. Stack rationale is in [the stack record](adr/0001-tech-stack.md).

### Foundation approval
The fixture owner responded:

> APPROVE GREENFIELD PLAN
>
> Fixture-owner ruling: approve the plain-JavaScript adaptation and exactly the listed foundation scope.

Approved scope: package.json, src/index.js, src/cli.js, test/greet.test.js, README.md, docs/PRD.md, docs/adr/0001-tech-stack.md, docs/adr/0002-design-system.md, docs/architecture.md, docs/ux-canon.md, docs/TEST-STRATEGY.md, AGENTS.md, CLAUDE.md, scripts/check-readme-catalog.mjs and roadmap/roadmap.config.json.

The ruling authorizes config-only initialization, the reviewed foundation writer, the checker copy and prototype/test/help/catalog checks. The dependent config merge and this approval-record update require separate review before execution. Config validation follows application of the reviewed bindings. This record does not grant that dependent execution approval.

CI/release setup and cloud delivery remain deferred. No plugin-source edits, commits, deployments, subagents or other external product writes are authorized.`;

const outputs = new Map([
  [configPath, JSON.stringify(config, null, 2) + '\n'],
  [prdPath, prd.replace(oldPrd, newPrd)],
  [adrPath, adr.replace(oldAdr, 'The fixture owner approved this plain-JavaScript adaptation with the foundation scope; see [the approval record](../PRD.md#foundation-approval).')]
]);
for (const [path, content] of outputs) writeFileSync(path, content);
