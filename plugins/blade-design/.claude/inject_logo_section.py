import re, sys

brands = {
    'ali': {
        'light_bg': '#F7F6F3', 'light_logo_color': '#1F5B46',
        'dark_bg':  '#174437', 'dark_logo_color':  '#F5EAD0',
        'primary_bg': '#1F5B46', 'primary_logo_color': '#F5EAD0',
        'light_label': 'Light — Parchment', 'dark_label': 'Dark — Sidebar Green', 'primary_label': 'Brand Primary',
        'primary_token': 'var(--brand-600)',
    },
    'zeroh': {
        'light_bg': '#FFFFFF', 'light_logo_color': '#0E8F3C',
        'dark_bg':  '#0D1F14', 'dark_logo_color':  '#FFFFFF',
        'primary_bg': '#0E8F3C', 'primary_logo_color': '#FFFFFF',
        'light_label': 'Light — White', 'dark_label': 'Dark Surface', 'primary_label': 'Brand Primary',
        'primary_token': 'hsl(var(--primary))',
    },
    'grc': {
        'light_bg': '#F5F3F0', 'light_logo_color': '#92400E',
        'dark_bg':  '#1C1410', 'dark_logo_color':  '#FFFFFF',
        'primary_bg': '#92400E', 'primary_logo_color': '#FFFFFF',
        'light_label': 'Light — Warm Off-White', 'dark_label': 'Dark Surface', 'primary_label': 'Brand Primary',
        'primary_token': 'var(--amber-800)',
    },
}

CSS_BLOCK = """
    /* Logo & Icon Usage section */
    .lup-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px; }
    .lup-asset-card { border:1px solid var(--border, #e5e7eb); border-radius:12px; overflow:hidden; }
    .lup-asset-preview { display:flex; align-items:center; justify-content:center; padding:32px 24px; min-height:88px; }
    .lup-asset-meta { padding:12px 16px; border-top:1px solid var(--border, #e5e7eb); }
    .lup-asset-name { font-family:'DM Mono',monospace; font-size:12px; opacity:0.6; display:block; margin-bottom:2px; }
    .lup-asset-use  { font-size:12px; opacity:0.5; }
    .lup-panels { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-top:16px; border-radius:10px; overflow:hidden; }
    .lup-panel { display:flex; flex-direction:column; align-items:flex-start; justify-content:flex-end; padding:20px; gap:8px; min-height:80px; }
    .lup-panel-label { font-size:11px; font-family:'DM Mono',monospace; letter-spacing:0.03em; }
    .lup-sizes { display:flex; align-items:flex-end; gap:32px; margin-top:20px; padding:24px; background:var(--muted,#f5f5f5); border-radius:10px; flex-wrap:wrap; }
    .lup-size-item { display:flex; flex-direction:column; gap:10px; }
    .lup-size-label { font-size:11px; font-family:'DM Mono',monospace; opacity:0.6; }
    .lup-size-ruler { display:flex; align-items:center; gap:6px; font-size:11px; font-family:'DM Mono',monospace; opacity:0.5; }
    .lup-size-ruler-bar { height:2px; background:currentColor; opacity:0.4; }
    .lup-clearspace { display:inline-flex; border:1.5px dashed currentColor; border-radius:4px; padding:16px; opacity:0.6; margin-top:12px; }
    .lup-clearspace-inner { border:1px solid currentColor; opacity:0.5; display:flex; align-items:center; justify-content:center; padding:8px 12px; border-radius:2px; }
    .lup-code { background:#1a1a1a; color:#e5e5e5; border-radius:10px; padding:20px 24px; font-family:'DM Mono',monospace; font-size:12.5px; line-height:1.7; overflow-x:auto; margin-top:16px; white-space:pre; }
    .lup-code .c { color:#6b7280; }
    .lup-code .t { color:#93c5fd; }
    .lup-code .v { color:#86efac; }
    .lup-donts { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-top:16px; }
    .lup-dont { display:flex; flex-direction:column; gap:8px; }
    .lup-dont-visual { border-radius:8px; padding:16px; display:flex; align-items:center; justify-content:center; min-height:72px; overflow:hidden; }
    .lup-dont-label { font-size:11px; color:#ef4444; font-family:'DM Mono',monospace; }
    .lup-subsection { margin-top:28px; }
    .lup-subsection-title { font-size:11px; text-transform:uppercase; letter-spacing:0.08em; opacity:0.45; margin-bottom:0; font-weight:600; }
"""

def sized_svg(svg_raw, h, w='auto'):
    style = f'height:{h}px;width:{w if w != "auto" else "auto"};display:block;'
    return re.sub(r'(<svg)([^>]*)(>)', rf'\1\2 style="{style}"\3', svg_raw, count=1)

def placement_panel(bg, logo_color, label, svg_raw, extra=''):
    svg = sized_svg(svg_raw, 28)
    return (
        f'<div class="lup-panel" style="background:{bg};{extra}">'
        f'<div style="color:{logo_color}">{svg}</div>'
        f'<span class="lup-panel-label" style="color:{logo_color};opacity:0.7">{label}</span>'
        f'</div>'
    )

def dont_item(label, transform_css, logo_color, bg, svg_raw):
    svg = sized_svg(svg_raw, 22)
    return (
        f'<div class="lup-dont">'
        f'<div class="lup-dont-visual" style="background:{bg}">'
        f'<div style="color:{logo_color};{transform_css}">{svg}</div>'
        f'</div>'
        f'<span class="lup-dont-label">&#x2715; {label}</span>'
        f'</div>'
    )

BASE = r'C:\Users\pheeh\Desktop\ui-design-skill'

for brand, cfg in brands.items():
    with open(f'{BASE}/themes/{brand}/assets/Logo.svg', encoding='utf-8') as f:
        logo_raw = f.read().strip()
    with open(f'{BASE}/themes/{brand}/assets/Icon.svg', encoding='utf-8') as f:
        icon_raw = f.read().strip()

    lc = cfg['light_logo_color']
    lb = cfg['light_bg']

    logo_panels = (
        placement_panel(cfg['light_bg'],   cfg['light_logo_color'],   cfg['light_label'],   logo_raw) +
        placement_panel(cfg['dark_bg'],    cfg['dark_logo_color'],    cfg['dark_label'],    logo_raw) +
        placement_panel(cfg['primary_bg'], cfg['primary_logo_color'], cfg['primary_label'], logo_raw)
    )
    icon_panels = (
        placement_panel(cfg['light_bg'],   cfg['light_logo_color'],   cfg['light_label'],   icon_raw, 'justify-content:center;align-items:center;min-height:100px;') +
        placement_panel(cfg['dark_bg'],    cfg['dark_logo_color'],    cfg['dark_label'],    icon_raw, 'justify-content:center;align-items:center;min-height:100px;') +
        placement_panel(cfg['primary_bg'], cfg['primary_logo_color'], cfg['primary_label'], icon_raw, 'justify-content:center;align-items:center;min-height:100px;')
    )

    donts = (
        dont_item('Stretched',     'transform:scaleX(1.6);transform-origin:center;', lc, lb, logo_raw) +
        dont_item('Rotated',       'transform:rotate(20deg);', lc, lb, logo_raw) +
        dont_item('Low contrast',  'opacity:0.12;', lc, lb, logo_raw) +
        dont_item('Effects added', 'filter:drop-shadow(3px 3px 8px rgba(0,0,0,0.6));', lc, lb, logo_raw)
    )

    pt = cfg['primary_token']
    code_example = (
        '<span class="c">&lt;!-- Color via CSS `color` — no SVG edits needed --&gt;</span>\n'
        f'<span class="t">&lt;div</span> <span class="v">style=&quot;color: {pt}&quot;</span><span class="t">&gt;</span>\n'
        '  <span class="c">&lt;!-- paste Logo.svg or Icon.svg here --&gt;</span>\n'
        '<span class="t">&lt;/div&gt;</span>\n\n'
        '<span class="c">&lt;!-- On dark surface --&gt;</span>\n'
        '<span class="t">&lt;div</span> <span class="v">style=&quot;color: #ffffff&quot;</span><span class="t">&gt;</span>\n'
        '  <span class="c">&lt;!-- paste Logo.svg or Icon.svg here --&gt;</span>\n'
        '<span class="t">&lt;/div&gt;</span>'
    )

    section = f"""
  <section class="section" id="logo-usage">
    <h2 class="section-title">Logo &amp; Icon Usage</h2>
    <p class="section-subtitle">Asset rules for designers and developers. Both files use <code style="font-family:'DM Mono',monospace;font-size:0.9em;opacity:0.7">currentColor</code> &mdash; color is set entirely through CSS, no SVG edits needed.</p>

    <div class="lup-subsection">
      <p class="lup-subsection-title">Asset inventory</p>
      <div class="lup-grid">
        <div class="lup-asset-card">
          <div class="lup-asset-preview" style="background:{lb}">
            <div style="color:{lc}">{sized_svg(logo_raw, 32)}</div>
          </div>
          <div class="lup-asset-meta">
            <span class="lup-asset-name">Logo.svg</span>
            <span class="lup-asset-use">Full wordmark &mdash; nav bars, headers, login screens, marketing materials</span>
          </div>
        </div>
        <div class="lup-asset-card">
          <div class="lup-asset-preview" style="background:{lb}">
            <div style="color:{lc}">{sized_svg(icon_raw, 48, '48')}</div>
          </div>
          <div class="lup-asset-meta">
            <span class="lup-asset-name">Icon.svg</span>
            <span class="lup-asset-use">Compact mark &mdash; favicon, app icon, avatar, mobile nav, small contexts</span>
          </div>
        </div>
      </div>
    </div>

    <div class="lup-subsection">
      <p class="lup-subsection-title">Logo on approved backgrounds</p>
      <div class="lup-panels">{logo_panels}</div>
    </div>

    <div class="lup-subsection">
      <p class="lup-subsection-title">Icon on approved backgrounds</p>
      <div class="lup-panels">{icon_panels}</div>
    </div>

    <div class="lup-subsection">
      <p class="lup-subsection-title">Minimum sizes</p>
      <div class="lup-sizes" style="color:{lc}">
        <div class="lup-size-item">
          <div style="color:{lc};width:80px;overflow:hidden">{sized_svg(logo_raw, 20)}</div>
          <div class="lup-size-ruler"><div class="lup-size-ruler-bar" style="width:80px"></div> 80px min width</div>
          <span class="lup-size-label">Logo &mdash; minimum width</span>
        </div>
        <div class="lup-size-item">
          <div style="color:{lc}">{sized_svg(icon_raw, 16, '16')}</div>
          <div class="lup-size-ruler"><div class="lup-size-ruler-bar" style="width:16px"></div> 16px</div>
          <span class="lup-size-label">Icon &mdash; minimum (favicon floor)</span>
        </div>
        <div class="lup-size-item">
          <div style="color:{lc}">{sized_svg(icon_raw, 32, '32')}</div>
          <div class="lup-size-ruler"><div class="lup-size-ruler-bar" style="width:32px"></div> 32px</div>
          <span class="lup-size-label">Icon &mdash; typical UI (nav, avatar)</span>
        </div>
      </div>
    </div>

    <div class="lup-subsection">
      <p class="lup-subsection-title">Clear space</p>
      <p style="font-size:13px;opacity:0.6;margin:8px 0 4px">Keep padding equal to the logo height on all sides. Never crowd with other elements or crop.</p>
      <div style="color:{lc}">
        <div class="lup-clearspace">
          <div class="lup-clearspace-inner">{sized_svg(logo_raw, 20)}</div>
        </div>
      </div>
    </div>

    <div class="lup-subsection">
      <p class="lup-subsection-title">Developer implementation</p>
      <div class="lup-code">{code_example}</div>
    </div>

    <div class="lup-subsection">
      <p class="lup-subsection-title">Incorrect usage</p>
      <div class="lup-donts">{donts}</div>
    </div>
  </section>
"""

    with open(f'{BASE}/themes/{brand}/preview.html', encoding='utf-8') as f:
        html = f.read()

    html = html.replace('</style>', CSS_BLOCK + '\n  </style>', 1)
    html = html.replace('</header>', '</header>\n' + section, 1)

    with open(f'{BASE}/themes/{brand}/preview.html', 'w', encoding='utf-8') as f:
        f.write(html)

    print(f'{brand}: OK ({len(html):,} bytes)')
