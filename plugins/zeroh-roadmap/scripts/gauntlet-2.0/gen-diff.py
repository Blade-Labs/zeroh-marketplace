import subprocess, json, difflib, html
import os
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
BEFORE, AFTER = 'c1c4edf', '189599e'
P = 'plugins/zeroh-roadmap/'
FILES = [
    ('skills/do-phase/SKILL.md', 'do-phase', 'skill'),
    ('skills/do-arc/SKILL.md', 'do-arc', 'skill'),
    ('agents/phase-executor.md', 'phase-executor', 'card'),
    ('agents/code-reviewer.md', 'code-reviewer', 'card'),
    ('agents/software-architect.md', 'software-architect', 'card'),
    ('agents/quality-pass.md', 'quality-pass', 'card'),
    ('skills/arc-sweep/SKILL.md', 'arc-sweep', 'skill'),
    ('skills/validate-arc/SKILL.md', 'validate-arc', 'skill'),
    ('skills/release-sweep/SKILL.md', 'release-sweep', 'skill'),
    ('skills/test-strategy/SKILL.md', 'test-strategy', 'skill'),
]
def show(rev, path):
    return subprocess.run(['git', '-C', REPO, 'show', f'{rev}:{P}{path}'], capture_output=True, text=True, check=True).stdout
data = []
for path, name, kind in FILES:
    a, b = show(BEFORE, path), show(AFTER, path)
    al, bl = a.splitlines(), b.splitlines()
    sm = difflib.SequenceMatcher(None, al, bl, autojunk=False)
    ops = [[t, i1, i2, j1, j2] for t, i1, i2, j1, j2 in sm.get_opcodes()]
    data.append({'path': P + path, 'name': name, 'kind': kind,
                 'bytesBefore': len(a.encode()), 'bytesAfter': len(b.encode()),
                 'linesBefore': len(al), 'linesAfter': len(bl),
                 'a': al, 'b': bl, 'ops': ops,
                 'removed': sum(i2 - i1 for t, i1, i2, j1, j2 in ops if t in ('delete', 'replace')),
                 'added': sum(j2 - j1 for t, i1, i2, j1, j2 in ops if t in ('insert', 'replace'))})
out = os.path.join(os.path.dirname(__file__), 'diff-data.json')
json.dump(data, open(out, 'w'))
print(sum(d['bytesBefore'] for d in data), sum(d['bytesAfter'] for d in data), len(json.dumps(data)))
