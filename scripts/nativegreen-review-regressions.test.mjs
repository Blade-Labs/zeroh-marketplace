import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRoadmapImports, validateRoadmapImports } from './check-roadmap-imports.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const sourceRoot=resolve(repo,process.env.NATIVEGREEN_REVIEW_ROOT??(existsSync(join(repo,'docs/roadmap/roadmap.config.json'))?'docs/roadmap':'roadmap'));
function validatePendingPaths(text) {
  assert.doesNotMatch(text, /(?<![\w/.-])roadmap\/(?:phases|arcs)\//);
}
test('pending phases use post-migration paths; stale path mutation fails',()=>{
  for(let phase=40;phase<=45;phase++) validatePendingPaths(readFileSync(join(sourceRoot,`phases/phase-${phase}.phase.ts`),'utf8'));
  const phase45=readFileSync(join(sourceRoot,'phases/phase-45.phase.ts'),'utf8');
  assert.throws(()=>validatePendingPaths(phase45.replaceAll('docs/roadmap/','roadmap/')));
  const phase41=readFileSync(join(sourceRoot,'phases/phase-41.phase.ts'),'utf8');
  assert.match(phase41,/RequiredChecksEvidenceShape/);
  const phase42=readFileSync(join(sourceRoot,'phases/phase-42.phase.ts'),'utf8');
  assert.doesNotMatch(phase42,/produces: \['ArcDeliveryShape', 'PullRequestReceiptShape'\]/);
});
test('migrated real artifacts import through tsx/Zod; wrong imports and missing schema fail',()=>{
  const scratch=mkdtempSync(join(tmpdir(),'nativegreen-migration-'));
  try {
    const root=join(scratch,'docs/roadmap'); mkdirSync(root,{recursive:true});
    cpSync(join(sourceRoot,'arcs'),join(root,'arcs'),{recursive:true});
    cpSync(join(sourceRoot,'phases'),join(root,'phases'),{recursive:true});
    cpSync(join(sourceRoot,'backlog.ts'),join(root,'backlog.ts'));
    mkdirSync(join(root,'lib')); cpSync(join(sourceRoot,'lib/schema.ts'),join(root,'lib/schema.ts'));
    symlinkSync(join(repo,'node_modules'),join(scratch,'node_modules'),'dir');
    // Copy the actual migrated bytes; the fixture must not repair wrong imports.
    const files=checkRoadmapImports(root); assert.ok(files.length>=40);
    assert.equal(validateRoadmapImports(root,{consumerRoot:scratch}).length,files.length);
    for (const file of [join(root,'backlog.ts'),files.find(f=>f.endsWith('.arc.ts')),files.find(f=>f.endsWith('.phase.ts'))]) {
      const before=readFileSync(file,'utf8');
      const wrong=file.endsWith('backlog.ts')?before.replace("from './lib/schema'","from '../lib/schema'"):before.replace("from '../lib/schema'","from './lib/schema'");
      assert.notEqual(wrong,before); writeFileSync(file,wrong);
      assert.throws(()=>checkRoadmapImports(root),/invalid schema import/); writeFileSync(file,before);
    }
    const victim=files.find(f=>f.endsWith('.phase.ts')),original=readFileSync(victim,'utf8');
    for(const bad of ['../../lib/roadmap/schema','@/lib/roadmap/schema','../wrong/schema']) {
      writeFileSync(victim,original.replace('../lib/schema',bad));
      assert.throws(()=>checkRoadmapImports(root),/invalid schema import/);
    }
    writeFileSync(victim,original);
    writeFileSync(victim,"import { PhaseShape } from '../lib/schema'\nexport default { phase: 3903 }\n");
    assert.throws(()=>validateRoadmapImports(root,{consumerRoot:scratch}),/typed record validation failed/);
    writeFileSync(victim,original);
    rmSync(join(root,'lib/schema.ts')); assert.throws(()=>checkRoadmapImports(root),/missing root-local schema/);
    cpSync(join(sourceRoot,'lib/schema.ts'),join(root,'lib/schema.ts'));
    const backlogBytes=readFileSync(join(root,'backlog.ts')); rmSync(join(root,'backlog.ts'));
    assert.throws(()=>checkRoadmapImports(root),/missing backlog/); writeFileSync(join(root,'backlog.ts'),backlogBytes);
    const phaseDir=join(root,'phases'); const savedPhases=join(scratch,'saved-phases'); cpSync(phaseDir,savedPhases,{recursive:true});
    rmSync(phaseDir,{recursive:true}); mkdirSync(phaseDir); assert.throws(()=>checkRoadmapImports(root),/empty phases/); cpSync(savedPhases,phaseDir,{recursive:true});
    rmSync(join(root,'arcs'),{recursive:true}); mkdirSync(join(root,'arcs'));
    assert.throws(()=>checkRoadmapImports(root),/empty arcs/);
  } finally { rmSync(scratch,{recursive:true,force:true}); }
});
