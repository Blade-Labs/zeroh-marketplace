import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkRoadmapImports } from './check-roadmap-imports.mjs';
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
    cpSync(existsSync(join(sourceRoot,'lib/schema.ts'))?join(sourceRoot,'lib/schema.ts'):join(repo,'lib/roadmap/schema.ts'),join(root,'schema-source.ts'));
    mkdirSync(join(root,'lib')); cpSync(join(root,'schema-source.ts'),join(root,'lib/schema.ts'));
    symlinkSync(join(repo,'node_modules'),join(scratch,'node_modules'),'dir');
    // Simulate only the declared import transformation, preserving all payloads.
    for(const dir of ['arcs','phases']) for(const name of readdirSync(join(root,dir))) {
      if(!name.endsWith('.ts')) continue;
      const file=join(root,dir,name);
      writeFileSync(file,readFileSync(file,'utf8').replace(/from ['"](?:@\/lib\/roadmap\/schema|\.\.\/\.\.\/lib\/roadmap\/schema|\.\.\/lib\/schema)['"]/g,"from '../lib/schema'"));
    }
    const files=checkRoadmapImports(root); assert.ok(files.length>=40);
    const script=join(scratch,'load.mjs');
    writeFileSync(script,`for (const file of ${JSON.stringify(files)}) await import(file); console.log('loaded '+${files.length});`);
    const result=spawnSync(process.execPath,['--import',join(repo,'node_modules/tsx/dist/loader.mjs'),script],{cwd:scratch,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const victim=files[0],original=readFileSync(victim,'utf8');
    for(const bad of ['../../lib/roadmap/schema','@/lib/roadmap/schema','../wrong/schema']) {
      writeFileSync(victim,original.replace('../lib/schema',bad));
      assert.throws(()=>checkRoadmapImports(root),/invalid schema import/);
    }
    writeFileSync(victim,original);
    rmSync(join(root,'lib/schema.ts')); assert.throws(()=>checkRoadmapImports(root),/missing root-local schema/);
    cpSync(join(root,'schema-source.ts'),join(root,'lib/schema.ts'));
    rmSync(join(root,'arcs'),{recursive:true}); mkdirSync(join(root,'arcs'));
    assert.throws(()=>checkRoadmapImports(root),/empty arcs/);
  } finally { rmSync(scratch,{recursive:true,force:true}); }
});
