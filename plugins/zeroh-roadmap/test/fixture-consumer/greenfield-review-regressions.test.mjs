import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roadmapRoot, resetRoadmapRootCache } from '../../cli/lib/roadmap-root.mjs';
import { resolveSlot } from '../../cli/lib/slots.mjs';
const plugin = fileURLToPath(new URL('../../../zeroh-greenfield/', import.meta.url));
const read = p => readFileSync(join(plugin, p), 'utf8');
const pointer = 'skills/greenfield-init/references/pointers.md';
const audit = 'skills/brownfield-audit/SKILL.md';
function validBindings(text) {
  assert.doesNotMatch(text, /\| placeholder /);
  assert.match(text, /Execute every non-`none` gate/);
  assert.match(text, /declared absent/);
  for (const name of ['web','flutter','android','expo','nx-monorepo','library-cli']) {
    const block = text.split('### '+name+'\n')[1]?.split('### ')[0];
    assert.ok(block, name);
    const rows = [...block.matchAll(/^\| (lint|types|unit|integration|build|e2e|emit) \| ([^|]+) \|/gm)];
    assert.equal(new Set(rows.map(x=>x[1])).size, 7, name);
    for (const [, slot, command] of rows) {
      const result = resolveSlot({ gateCommands: { [slot]: command.trim() } }, slot);
      assert.ok(!result.refused, name+': '+slot);
      if (command.trim()==='none') assert.equal(result.declaredAbsent, true);
    }
  }
}
test('six gate tables are executable bindings or explicit absences; placeholder mutation fails',()=>{
  const text=read(pointer); validBindings(text);
  assert.throws(()=>validBindings(text.replace('| lint |', '| lint | placeholder lint |')));
});
const homes=['PRD','Tech-stack ADR','Design-system ADR','CODE-STYLE','Architecture index','UX canon'];
function completeOracle(text) {
  for (const home of homes) assert.match(text, new RegExp('^\\| '+home+' \\| missing \\|','m'));
}
test('oracle independently accounts for every promised missing home; deletion fails',()=>{
  const text=read('fixtures/README.md'); completeOracle(text);
  for (const home of homes) assert.throws(()=>completeOracle(text.split('\n').filter(l=>!l.startsWith('| '+home+' |')).join('\n')));
});
test('design absence is conditional on Blade handoff',()=>{
  const text=read(audit);
  assert.match(text, /Only when an approved Blade handoff requires it: zeroh-design absent/);
  assert.throws(()=>assert.match(text.replace('Only when an approved Blade handoff requires it: ',''), /Only when an approved Blade handoff requires it: zeroh-design absent/));
  assert.doesNotMatch(text, /^- zeroh-design absent/m);
});
test('canonical root discovery preserves migrated and overridden homes and refuses ambiguity',()=>{
  const root=mkdtempSync(join(tmpdir(),'greenfield-root-'));
  const previous=process.env.ROADMAP_ROOT;
  delete process.env.ROADMAP_ROOT;
  try {
    mkdirSync(join(root,'docs/roadmap'),{recursive:true});
    writeFileSync(join(root,'docs/roadmap/roadmap.config.json'),'{}');
    assert.equal(roadmapRoot(root),join(root,'docs/roadmap'));
    mkdirSync(join(root,'roadmap/phases'),{recursive:true}); resetRoadmapRootCache();
    assert.throws(()=>roadmapRoot(root), e=>e.kind==='ambiguous');
    process.env.ROADMAP_ROOT='docs/roadmap'; resetRoadmapRootCache();
    assert.equal(roadmapRoot(root),join(root,'docs/roadmap'));
    const markers=read('skills/brownfield-audit/references/marker-table.md');
    assert.match(markers,/docs\/roadmap\/roadmap.config.json/);
    assert.match(markers,/roadmap-root.mjs/);
    assert.match(read(pointer),/resolved root/);
  } finally {
    if(previous===undefined) delete process.env.ROADMAP_ROOT; else process.env.ROADMAP_ROOT=previous;
    resetRoadmapRootCache(); rmSync(root,{recursive:true,force:true});
  }
});
