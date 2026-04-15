"""
Adds --brand-gradient to Ali and Zeroh globals.css,
and replaces their Brand Colour section with a full gradient section
matching the Corporate preview style.
"""
import re

# ─── 1. globals.css updates ──────────────────────────────────────────────────

ali_gradient_block = """
  /* --- Brand gradient --- */
  --brand-gradient-start: #6FA28F;
  --brand-gradient-end:   #1F5B46;
  --brand-gradient: linear-gradient(to right, #6FA28F, #1F5B46);
"""

zeroh_gradient_block = """
  /* --- Brand gradient --- */
  --brand-gradient-start: #00bc7d;
  --brand-gradient-end:   #009966;
  --brand-gradient: linear-gradient(to right, #00bc7d, #009966);
"""

for brand, block in [('ali', ali_gradient_block), ('zeroh', zeroh_gradient_block)]:
    path = rf'C:\Users\pheeh\Desktop\ui-design-skill\skills\frontend-design\references\{brand}\globals.css'
    with open(path, encoding='utf-8') as f:
        css = f.read()
    if '--brand-gradient' not in css:
        # Insert before /* --- L2 Semantics
        css = css.replace('  /* --- L2 Semantics', block + '  /* --- L2 Semantics', 1)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(css)
        print(f'{brand} globals.css: gradient added')
    else:
        print(f'{brand} globals.css: gradient already present')

# ─── 2. Preview HTML updates ──────────────────────────────────────────────────

configs = {
    'ali': {
        'gradient_start': '#6FA28F',
        'gradient_end': '#1F5B46',
        'gradient_css': 'linear-gradient(to right, #6FA28F, #1F5B46)',
        'primary': '#1F5B46',
        'primary_token': '--primary = var(--brand-600) = #1F5B46',
        'primary_label': 'Forest Green — solid primary',
        'hero_cta': 'Explore Ali',
        'banner_headline': 'Knowledge as a<br>Competitive Edge',
        'font': "'Crimson Pro', serif",
        'section_label': 'Brand Gradient',
    },
    'zeroh': {
        'gradient_start': '#00bc7d',
        'gradient_end': '#009966',
        'gradient_css': 'linear-gradient(to right, #00bc7d, #009966)',
        'primary': '#0E8F3C',
        'primary_token': '--primary = hsl(147 91% 33%) = #0E8F3C',
        'primary_label': 'Fresh Green — solid primary',
        'hero_cta': 'Start Your Journey',
        'banner_headline': 'Wellness Starts<br>with Clarity',
        'font': "'Quicksand', sans-serif",
        'section_label': 'Brand Gradient',
    },
}

for brand, cfg in configs.items():
    path = rf'C:\Users\pheeh\Desktop\ui-design-skill\themes\{brand}\preview.html'
    with open(path, encoding='utf-8') as f:
        html = f.read()

    # Add --brand-gradient to the :root CSS block in the preview
    if '--brand-gradient' not in html:
        # Find :root block and add after first property
        html = re.sub(
            r'(:root\s*\{)',
            r'\1\n      --brand-gradient: ' + cfg['gradient_css'] + ';',
            html, count=1
        )

    # Build the new gradient section (matching Corporate style)
    new_section = f"""    <section class="section">
      <h2 class="section-title">Brand Gradient</h2>
      <p class="section-subtitle">
        The gradient is the brand's signature on marketing surfaces — hero sections, landing page CTAs, announcement banners. Use the solid primary for all app UI buttons, links, and interactive elements.
      </p>

      <div class="lup-subsection">
        <p class="lup-subsection-title">Gradient swatch</p>
        <div style="border-radius:12px;overflow:hidden;margin-bottom:24px;">
          <div style="background:{cfg['gradient_css']};height:80px;display:flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:12px;font-weight:600;letter-spacing:0.08em;opacity:0.9;">{cfg['gradient_css']}</span>
          </div>
          <div style="background:var(--card);border:1px solid var(--border);border-top:none;padding:10px 12px;">
            <code style="font-size:11px;color:var(--muted-foreground);">background: var(--brand-gradient)</code>
          </div>
        </div>

        <p class="lup-subsection-title">Approved uses</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
          <div style="border-radius:10px;overflow:hidden;">
            <div style="background:{cfg['gradient_css']};padding:32px 24px;display:flex;flex-direction:column;gap:12px;">
              <span style="color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;letter-spacing:0.1em;">HERO SECTION CTA</span>
              <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,0.15);backdrop-filter:blur(4px);color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500;width:fit-content;">
                {cfg['hero_cta']} &rarr;
              </div>
            </div>
            <div style="background:var(--card);border:1px solid var(--border);border-top:none;padding:10px 12px;">
              <code style="font-size:11px;color:var(--muted-foreground);">background: var(--brand-gradient)</code>
            </div>
          </div>
          <div style="border-radius:10px;overflow:hidden;">
            <div style="background:{cfg['gradient_css']};padding:32px 24px;">
              <span style="color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;letter-spacing:0.1em;">MARKETING BANNER</span>
              <p style="color:#fff;font-size:16px;font-weight:700;margin-top:8px;line-height:1.4;">{cfg['banner_headline']}</p>
            </div>
            <div style="background:var(--card);border:1px solid var(--border);border-top:none;padding:10px 12px;">
              <code style="font-size:11px;color:var(--muted-foreground);">background: var(--brand-gradient)</code>
            </div>
          </div>
        </div>

        <p class="lup-subsection-title">Solid primary — app UI</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div style="border-radius:10px;overflow:hidden;">
            <div style="background:var(--card);border:1px solid var(--border);padding:32px 24px;display:flex;gap:8px;align-items:center;">
              <button style="background:var(--primary);color:var(--primary-foreground);padding:8px 18px;border-radius:10px;font-size:13px;font-weight:500;border:none;cursor:pointer;">Get Started</button>
              <button style="background:transparent;color:var(--primary);border:1px solid var(--border);padding:8px 18px;border-radius:10px;font-size:13px;font-weight:500;cursor:pointer;">Learn More</button>
            </div>
            <div style="background:var(--muted);border:1px solid var(--border);border-top:none;padding:10px 12px;">
              <code style="font-size:11px;color:var(--muted-foreground);">{cfg['primary_token']}</code>
            </div>
          </div>
          <div style="padding:16px;background:var(--accent);border-radius:10px;border:1px solid var(--border);">
            <p style="font-size:12px;font-weight:600;color:var(--foreground);margin-bottom:8px;">Usage rule</p>
            <p style="font-size:12px;color:var(--muted-foreground);line-height:1.7;">
              <strong style="color:var(--foreground)">Marketing surfaces</strong> (hero, landing CTA, banners) &rarr; <code style="font-size:11px;">var(--brand-gradient)</code><br>
              <strong style="color:var(--foreground)">App UI</strong> (buttons, links, badges) &rarr; <code style="font-size:11px;">var(--primary)</code>
            </p>
          </div>
        </div>
      </div>
    </section>

"""

    # Find and remove the old Brand Colour section, replace with new gradient section
    # The old section starts with <section class="section"> containing "Brand Colour"
    # and ends before the next <section class="section">
    old_section_pattern = re.compile(
        r'    <section class="section">\s*\n\s*<h2 class="section-title">Brand Colou?r</h2>.*?</section>\s*\n\n',
        re.DOTALL
    )

    if old_section_pattern.search(html):
        html = old_section_pattern.sub(new_section, html, count=1)
        print(f'{brand}: Brand Colour section replaced with gradient section')
    else:
        # Try to find any Brand Colour/Color section
        if 'Brand Colo' in html:
            print(f'{brand}: WARNING - found Brand Colo but pattern did not match, trying simpler approach')
            # Find the section manually
            idx = html.find('<section class="section">\n      <h2 class="section-title">Brand Colour')
            if idx == -1:
                idx = html.find('<section class="section">\n      <h2 class="section-title">Brand Color')
            if idx != -1:
                # Find the end of this section
                end_idx = html.find('    <section class="section">', idx + 100)
                if end_idx != -1:
                    html = html[:idx] + new_section + html[end_idx:]
                    print(f'{brand}: replaced via manual index')
        else:
            print(f'{brand}: No Brand Colour section found, inserting before Spacing')
            spacing_marker = '    <section class="section">\n    <h2 class="section-title">Spac'
            if spacing_marker in html:
                html = html.replace(spacing_marker, new_section + spacing_marker, 1)
                print(f'{brand}: inserted before Spacing')

    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'{brand}: preview saved, size {len(html)}')

print('\nAll done.')
