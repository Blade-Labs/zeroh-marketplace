import re

with open(r'C:\Users\pheeh\Desktop\ui-design-skill\themes\grc\preview.html', encoding='utf-8') as f:
    html = f.read()

# 1. CSS badge/dot classes
html = html.replace(
    '    .badge-amber     { background: var(--amber-100);   color: var(--amber-800); }',
    '    .badge-indigo    { background: var(--indigo-100);  color: var(--indigo-700); }'
)
html = html.replace(
    '    .badge-warning   { background: var(--amber-100);   color: var(--amber-700); }',
    '    .badge-warning   { background: #FEF9C3;             color: #854D0E; }'
)
html = html.replace(
    '    .badge-neutral   { background: var(--stone-200);   color: var(--stone-700); }',
    '    .badge-neutral   { background: var(--slate-200);   color: var(--slate-700); }'
)
html = html.replace(
    '    .dot-pending   { background: var(--amber-500); }',
    '    .dot-pending   { background: #F59E0B; }'
)
html = html.replace(
    '    .dot-inactive  { background: var(--stone-400); }',
    '    .dot-inactive  { background: var(--slate-400); }'
)

# 2. Palette section titles
html = re.sub(r'Stone\s*[\u2605\u2014\-\u00b7\u2022\ufffd]+\s*neutrals', 'Slate \u2014 neutrals', html)
html = re.sub(r'Amber\s*[\u2605\u2014\-\u00b7\u2022\ufffd]+\s*brand accent', 'Indigo \u2014 primary', html)

# 3. Slate palette row (replace old stone hex stops)
stone_stops = [
    ('#FAFAF9', '#f8fafc'),
    ('#F5F5F4', '#f1f5f9'),
    ('#E7E5E4', '#e2e8f0'),
    ('#D6D3D1', '#cbd5e1'),
    ('#A8A29E', '#90a1b9'),
    ('#78716C', '#62748e'),
    ('#57534E', '#45556c'),
    ('#44403C', '#314158'),
    ('#292524', '#1d293d'),
    ('#1C1917', '#0f172b'),
    ('#0C0A09', '#020817'),
]
for old, new in stone_stops:
    html = html.replace(
        f'<div class="palette-color" style="background:{old};"></div>',
        f'<div class="palette-color" style="background:{new};"></div>'
    )

# 4. Indigo palette row (replace old amber hex stops)
amber_stops = [
    ('#FFFBEB', '#eef2ff'),
    ('#FEF3C7', '#e0e7ff'),
    ('#FDE68A', '#c7d2fe'),
    ('#FCD34D', '#a5b4fc'),
    ('#FBBF24', '#818cf8'),
    ('#F59E0B', '#6366f1'),
    ('#D97706', '#4f39f6'),
    ('#B45309', '#4338ca'),
    ('#92400E', '#3730a3'),
    ('#78350F', '#312e81'),
    ('#451A03', '#1e1b4b'),
]
for old, new in amber_stops:
    html = html.replace(
        f'<div class="palette-color" style="background:{old};"></div>',
        f'<div class="palette-color" style="background:{new};"></div>'
    )

# 5. Token table: old var names in <code> tags
token_map = {
    '--warm-50':   '--background',
    '--warm-100':  '--slate-100',
    '--warm-200':  '--slate-200',
    '--warm-300':  '--slate-300',
    '--stone-900': '--slate-950',
    '--stone-800': '--slate-800',
    '--stone-700': '--slate-700',
    '--stone-600': '--slate-600',
    '--stone-500': '--slate-500',
    '--stone-400': '--slate-400',
    '--stone-200': '--slate-200',
    '--amber-800': '--indigo-600',
    '--amber-700': '--indigo-700',
    '--amber-600': '--indigo-600',
    '--amber-500': '--indigo-400',
    '--amber-100': '--indigo-100',
    '--amber-900': '--indigo-950',
}
for old, new in token_map.items():
    html = html.replace(f'<code>{old}</code>', f'<code>{new}</code>')

# 6. Inline code / quoted var references
html = html.replace('var(--amber-800)&quot', 'var(--primary)&quot')
html = html.replace('color: var(--amber-800)', 'color: var(--primary)')
html = html.replace('var(--amber-800)', 'var(--primary)')

# 7. Badge HTML instance
html = html.replace('class="badge badge-amber">Amber', 'class="badge badge-indigo">Indigo')

# 8. Semantic swatch background inline styles and value labels
swatch_map = {
    '#F5F3F0': '#ffffff',
    '#1C1917': '#020817',
    '#92400E': '#4f39f6',
    '#FEF3C7': '#e0e7ff',
    '#EEEBE6': '#f1f5f9',
    '#DDD9D3': '#e2e8f0',
    '#78716C': '#62748e',
    '#D97706': '#4f39f6',
    '#FEF2F2': '#fee2e2',
}
for old, new in swatch_map.items():
    html = html.replace(f'<div class="swatch-value">{old}</div>', f'<div class="swatch-value">{new}</div>')
    html = html.replace(f'style="background:{old}"', f'style="background:{new}"')
    html = html.replace(f'style="background: {old}"', f'style="background: {new}"')
    html = html.replace(f'background:{old};', f'background:{new};')

# 9. Header meta text
html = html.replace('Amber Brown', 'Indigo')
html = html.replace('Off-White', 'White')
html = html.replace('DM Sans', 'Inter')

# 10. Swatch usage/label text with old color names
html = re.sub(r'(warm|amber|stone)[-\s]', lambda m: {'warm': 'slate-', 'amber': 'indigo-', 'stone': 'slate-'}[m.group(1).lower()], html, flags=re.IGNORECASE)

with open(r'C:\Users\pheeh\Desktop\ui-design-skill\themes\grc\preview.html', 'w', encoding='utf-8') as f:
    f.write(html)

# Report remaining
print('Done. File size:', len(html))
for pat in ['--amber-', '--stone-', '--warm-']:
    found = re.findall(pat + r'[^;\s"<}]+', html)
    if found:
        print(f'REMAINING {pat}: {sorted(set(found))}')
    else:
        print(f'CLEAN: {pat}')
