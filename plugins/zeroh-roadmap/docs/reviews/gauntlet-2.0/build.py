"""Rebuild GAUNTLET-2.0.html from the repo:  python3 docs/reviews/gauntlet-2.0/build.py

gen-diff.py diffs the pre-diet tree against the landed phase-26 tree for the ten mapped bodies;
gen-eval.py reads DIET-PLAN-2026-09.md, DIET-TRIAL-2026-09.md, DIET-LEDGER.md and
GAUNTLET-2026-08.md; template.html is the page. Output: plugins/zeroh-roadmap/docs/reviews/GAUNTLET-2.0.html.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
subprocess.run([sys.executable, os.path.join(HERE, 'gen-diff.py')], check=True)
subprocess.run([sys.executable, os.path.join(HERE, 'gen-eval.py')], check=True)


def guard(text):
    return text.replace('</script', '<\\/script')


diff_json = guard(open(os.path.join(HERE, 'diff-data.json')).read())
eval_json = guard(open(os.path.join(HERE, 'eval-data.json')).read())
template = open(os.path.join(HERE, 'template.html')).read()
page = template.replace('__DATA__', diff_json).replace('__EVAL__', eval_json)
head, body = page.split('</style>', 1)
html = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + head + '</style>\n</head>\n<body>' + body + '\n</body>\n</html>\n'
)
out = os.path.abspath(os.path.join(HERE, '..', 'GAUNTLET-2.0.html'))
open(out, 'w').write(html)
for name in ('diff-data.json', 'eval-data.json'):
    os.remove(os.path.join(HERE, name))
print('wrote', out, len(html), 'bytes')
