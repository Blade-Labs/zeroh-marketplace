import re, json
import os
P = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
def cells(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]
def tables(path):
    """yield (heading, rows) for every markdown table under each heading"""
    cur = None; out = {}; buf = []
    for line in open(path):
        m = re.match(r'^#{2,3} (.+)', line)
        if m:
            cur = m.group(1).strip(); out.setdefault(cur, []); continue
        if cur is not None and line.startswith('|'):
            c = cells(line)
            if all(re.match(r'^:?-+:?$', x) for x in c): continue
            out[cur].append(c)
    return out
plan = tables(P + 'DIET-PLAN-2026-09.md')
trim = {}
for h, rows in plan.items():
    if h.startswith('plugins/'):
        name = h.replace('plugins/zeroh-roadmap/', '')
        body = [r for r in rows if r and r[0].isdigit() and len(r) >= 5]
        trim[name] = [{'n': int(r[0]), 'anchor': r[1], 'cls': r[2], 'disp': r[3], 'ev': r[4]} for r in body]
amend = [r for r in plan.get('Ratification', []) if len(r) >= 4 and not r[0].startswith('source row')]
amend = [{'row': r[0], 'cls': r[1], 'disp': r[2], 'why': r[3]} for r in amend]
base = [r for r in plan.get('Baseline', []) if len(r) >= 4 and r[0].isdigit()]
base = [{'phase': int(r[0]), 'driver': r[1], 'score': float(r[2]), 'failed': r[3]} for r in base]
trial = tables(P + 'DIET-TRIAL-2026-09.md')
res = [r for r in trial.get('Results', []) if len(r) >= 7 and r[0].isdigit()]
res = [{'phase': int(r[0]), 'driver': r[1], 'score': float(r[2]), 'failed': r[3], 'rounds': int(r[4]), 'findings': r[5], 'minPerTask': float(r[6])} for r in res]
ledger = tables(P + 'DIET-LEDGER.md')
restores = [r for r in ledger.get('Trial restores — trial/27-opus @ 7b237a9 gate run-000003', []) if len(r) >= 3 and not r[0].startswith('passage')]
restores = [{'passage': r[0], 'disp': r[1], 'ev': r[2]} for r in restores]
g1 = tables(P + 'GAUNTLET-2026-08.md')
verdicts = [r for r in g1.get('Verdicts', []) if len(r) >= 2 and r[0] != 'outcome']
verdicts = [{'outcome': r[0], 'skills': r[1]} for r in verdicts]
out = {'trim': trim, 'amend': amend, 'baseline': base, 'trial': res, 'restores': restores, 'g1': verdicts}
json.dump(out, open(os.path.join(os.path.dirname(__file__), 'eval-data.json'), 'w'))
print({k: (len(v) if not isinstance(v, dict) else {kk: len(vv) for kk, vv in v.items()}) for k, v in out.items()})
