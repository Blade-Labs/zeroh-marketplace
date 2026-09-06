import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export function checkRoadmapImports(root) {
  if (!existsSync(join(root, 'lib/schema.ts'))) throw new Error('missing root-local schema');
  const files=[];
  for (const dir of ['arcs','phases']) {
    const walk = path => { for(const entry of readdirSync(path)) {
      const file=join(path,entry);
      if(statSync(file).isDirectory()) walk(file); else if(file.endsWith('.ts')) files.push(file);
    }};
    walk(join(root,dir));
    if(!files.some(f=>f.startsWith(join(root,dir)+'/'))) throw new Error('empty '+dir);
  }
  for(const file of files) {
    const source=readFileSync(file,'utf8');
    const imports=[...source.matchAll(/^import\s+[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/gm)].map(m=>m[1]);
    if(!imports.includes('../lib/schema') || imports.some(x=>x.includes('lib/roadmap/schema')))
      throw new Error('invalid schema import: '+file);
  }
  return files;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log('valid imports: '+checkRoadmapImports(resolve(process.argv[2]??'docs/roadmap')).length); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
