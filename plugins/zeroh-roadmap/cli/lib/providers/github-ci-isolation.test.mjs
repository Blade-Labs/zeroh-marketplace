import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runIsolated} from './github-ci-evidence.mjs'

const roots=[]
process.on('exit',()=>roots.forEach(root=>rmSync(root,{recursive:true,force:true})))
function repo(){
 const root=mkdtempSync(join(tmpdir(),'zr-ci-runner-'));roots.push(root)
 const git=(...args)=>execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=f@example.test',...args],{encoding:'utf8'}).trim()
 git('init','-q');writeFileSync(join(root,'value.txt'),'source\n');git('add','.');git('commit','-qm','source')
 return {root,head:git('rev-parse','HEAD')}
}
const tempClones=()=>new Set(readdirSync(tmpdir()).filter(name=>name.startsWith('zeroh-ci-isolated-')))

test('runIsolated bounds a runaway process and removes its owned checkout',()=>{
 const f=repo(),scratch=mkdtempSync(join(tmpdir(),'zr-ci-private-scratch-')),previous=process.env.TMPDIR
 roots.push(scratch);process.env.TMPDIR=scratch
 try{
  const before=tempClones(),started=Date.now()
  const out=runIsolated({root:f.root,headSha:f.head,command:{file:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:2000},deadlineMs:Date.now()+10000})
  assert.equal(out.status,'held');assert.match(out.reason,/timed out|deadline|completion/i);assert.ok(Date.now()-started<5000,`runaway took ${Date.now()-started}ms`)
  assert.deepEqual(tempClones(),before)
 }finally{if(previous===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previous}
})

test('runIsolated passes shell metacharacters literally and cannot modify the live checkout',()=>{
 const f=repo(),marker=join(f.root,'shell-expanded'),args=['space value','$(touch '+marker+')','semi;colon',`quote'value`]
 const script="const fs=require('fs');fs.writeFileSync('clone-only','x');process.stdout.write(JSON.stringify(process.argv.slice(1)))"
 const out=runIsolated({root:f.root,headSha:f.head,command:{file:process.execPath,args:['-e',script,...args],timeoutMs:5000},deadlineMs:Date.now()+15000})
 assert.equal(out.status,'completed',out.reason);assert.equal(out.execution.exitCode,0);assert.deepEqual(JSON.parse(out.execution.output.slice(0,out.execution.output.indexOf(']')+1)),args)
 assert.deepEqual(readdirSync(f.root).sort(),['.git','value.txt']);assert.equal(readFileSync(join(f.root,'value.txt'),'utf8'),'source\n')
})

test('runIsolated refuses a temporary directory inside the live consumer', {concurrency:false},()=>{
 const f=repo(),inside=join(f.root,'tmp');mkdirSync(inside);const previous=process.env.TMPDIR;process.env.TMPDIR=inside
 try{
  const out=runIsolated({root:f.root,headSha:f.head,command:{file:process.execPath,args:['-e','process.exit(0)'],timeoutMs:2000},deadlineMs:Date.now()+10000})
  assert.equal(out.status,'held');assert.match(out.reason,/temporary|live|source|consumer/i);assert.deepEqual(readdirSync(inside),[])
 }finally{if(previous===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previous}
})

test('runIsolated treats an in-consumer ..cache directory as nested scratch and refuses before writing', {concurrency:false},()=>{
 const f=repo(),inside=join(f.root,'..cache');mkdirSync(inside);const previous=process.env.TMPDIR;process.env.TMPDIR=inside
 try{
  const out=runIsolated({root:f.root,headSha:f.head,command:{file:process.execPath,args:['-e','process.exit(0)'],timeoutMs:2000},deadlineMs:Date.now()+10000})
  assert.equal(out.status,'held');assert.match(out.reason,/temporary|live|source|consumer/i);assert.deepEqual(readdirSync(inside),[])
 }finally{if(previous===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previous}
})
