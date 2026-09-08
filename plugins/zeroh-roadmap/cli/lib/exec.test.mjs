import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {chmodSync,mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const launcher=fileURLToPath(new URL('./exec.mjs',import.meta.url)),roots=[]
process.on('exit',()=>roots.forEach(root=>rmSync(root,{recursive:true,force:true})))
const run=(argv,input=JSON.stringify(argv))=>spawnSync(process.execPath,[launcher,'--argv-stdin'],{input,encoding:'utf8',timeout:5000,maxBuffer:2*1024*1024})

test('argv-stdin forwards dollar, backtick, whitespace, newline and empty arguments without an interpreter',()=>{
 const root=mkdtempSync(join(tmpdir(),'zr-argv-'));roots.push(root);const marker=join(root,'expanded')
 const values=['$(touch '+marker+')','`touch '+marker+'`','space value','line one\nline two','']
 const script='process.stdout.write(JSON.stringify(process.argv.slice(1)))'
 const out=run([process.execPath,'-e',script,...values])
 assert.equal(out.status,0,out.stderr);assert.equal(out.signal,null);assert.deepEqual(JSON.parse(out.stdout),values);assert.equal(existsSync(marker),false)
})

test('argv-stdin rejects malformed, oversized and NUL-bearing input before starting a child',()=>{
 const root=mkdtempSync(join(tmpdir(),'zr-argv-invalid-'));roots.push(root);const marker=join(root,'child-ran')
 const child=[process.execPath,'-e',`require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`]
 for(const input of ['{',JSON.stringify(child)+' '.repeat(1024*1024),JSON.stringify([...child,'bad\0arg']),JSON.stringify([]),JSON.stringify(['  '])]){
  const out=run([],input);assert.equal(out.status,125,`input was not refused: ${out.stderr}`);assert.equal(out.signal,null);assert.equal(existsSync(marker),false)
 }
})

test('argv-stdin preserves a real child exit and reserves spawn failure exit codes',()=>{
 const exited=run([process.execPath,'-e','process.exit(7)']);assert.equal(exited.status,7);assert.equal(exited.signal,null)
 const missing=run(['/definitely/missing/zeroh-command']);assert.equal(missing.status,127);assert.match(missing.stderr,/ENOENT|not found|missing/i)
 const root=mkdtempSync(join(tmpdir(),'zr-argv-eacces-'));roots.push(root);const denied=join(root,'denied');writeFileSync(denied,'#!/bin/sh\nexit 0\n');chmodSync(denied,0o644)
 const inaccessible=run([denied]);assert.equal(inaccessible.status,126);assert.match(inaccessible.stderr,/EACCES|permission/i)
})

test('argv-stdin surfaces a child signal distinctly and terminates with that signal',()=>{
 const out=run([process.execPath,'-e',"process.kill(process.pid,'SIGTERM')"])
 assert.equal(out.status,null);assert.equal(out.signal,'SIGTERM');assert.match(out.stderr,/child signal: SIGTERM/i)
})
