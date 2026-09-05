"""Run an explicitly specified native fixture invocation with independent disk events."""
import ctypes, hashlib, json, os, pathlib, select, struct, subprocess, sys, time
request = json.loads(pathlib.Path(sys.argv[1]).read_text())
root = pathlib.Path(request['scratch']).resolve()
outdir = pathlib.Path(request['evidence']).resolve()
outdir.mkdir(parents=True, exist_ok=False)
def current_source():
    if not request.get('sourceRoot'): return None
    helper = pathlib.Path(request['sourceRoot'])/'plugins/zeroh-roadmap/test/fixture-consumer/greenfield-evidence-source.mjs'
    return json.loads(subprocess.check_output(['node', str(helper), request['sourceRoot']], text=True))
source = current_source()
if source:
    if request.get('sourceSnapshotSha256') != source['sourceSnapshotSha256']:
        raise RuntimeError('Source snapshot changed before native launch')
    if request.get('invocationBaseCommit') != source['invocationBaseCommit']:
        raise RuntimeError('Invocation base changed before native launch')
    (outdir/'source-snapshot.json').write_text(json.dumps(source, indent=2))
libc = ctypes.CDLL(None, use_errno=True)
fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
if fd < 0: raise OSError(ctypes.get_errno(), 'inotify_init1')
# Every write/attribute/create/delete/move event, including ephemeral create/delete.
mask = 0x2 | 0x4 | 0x8 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800
watches = {}
def watch(path):
    wd = libc.inotify_add_watch(fd, os.fsencode(path), mask)
    if wd < 0: raise OSError(ctypes.get_errno(), str(path))
    watches[wd] = pathlib.Path(path)
    for child in pathlib.Path(path).iterdir():
        if child.is_dir() and not child.is_symlink(): watch(child)
watch(root)
def snapshot():
    result = {}
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink(): result[relative] = {'symlink': os.readlink(path)}
        elif path.is_file(): result[relative] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'mode': path.stat().st_mode}
        elif path.is_dir(): result[relative] = {'directory': True, 'mode': path.stat().st_mode}
    return result
(outdir/'before.json').write_text(json.dumps(snapshot(), sort_keys=True, indent=2))
(outdir/'request.json').write_text(json.dumps(request, indent=2))
env=os.environ.copy();env['CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS']='0'
# Keep read-only git status from taking an optional index refresh lock.
env['GIT_OPTIONAL_LOCKS']='0'
# A bound capbuild envelope uses its reviewed defaults, never ambient overrides.
cleared_host_overrides = ['CAPBUILD_SLICE', 'CAPBUILD_PASS_ENV', 'NODE_OPTIONS', 'FORCE_BARE', 'ITEST_FILES', 'AUDIT_LEDGER_ENABLED', 'TEST_CONCURRENCY', 'E2E_PROJECT', 'ALLURE']
for name in cleared_host_overrides: env.pop(name, None)
start=time.monotonic(); events=[]; overflow=False
with (outdir/'stdout.jsonl').open('w') as stdout, (outdir/'stderr.txt').open('w') as stderr:
    process=subprocess.Popen(request['argv'], cwd=root, env=env, stdout=stdout, stderr=stderr)
    (outdir/'pid').write_text(str(process.pid))
    while True:
        if select.select([fd], [], [], .1)[0]:
            data=os.read(fd, 1024*1024); offset=0
            while offset<len(data):
                wd, flags, cookie, size=struct.unpack_from('iIII', data, offset); offset+=16
                name=data[offset:offset+size].split(b'\0')[0].decode();offset+=size
                if flags & 0x4000: overflow=True
                parent=watches.get(wd)
                path=parent/name if parent else root
                events.append({'elapsed':time.monotonic()-start,'path':str(path.relative_to(root)), 'mask':flags, 'cookie':cookie})
                if flags & 0x40000000 and flags & (0x100|0x80) and path.exists(): watch(path)
        if process.poll() is not None: break
        if time.monotonic()-start > request.get('timeout', 900):
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill();process.wait()
            break
os.close(fd)
(outdir/'events.json').write_text(json.dumps({'overflow':overflow,'events':events},indent=2))
(outdir/'after.json').write_text(json.dumps(snapshot(),sort_keys=True,indent=2))
result={'clearedHostOverrides':cleared_host_overrides,'exit':process.returncode,'elapsed':time.monotonic()-start,'eventCount':len(events),'overflow':overflow,'stdoutSha256':hashlib.sha256((outdir/'stdout.jsonl').read_bytes()).hexdigest()}
if source:
    result['sourceSnapshotSha256'] = current_source()['sourceSnapshotSha256']
(outdir/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
