import re

brands = {
    'ali': {
        'primary': '#1F5B46',
        'primary_light': '#F2F7F4',
        'primary_name': 'Forest Green',
        'note': 'Ali uses a single solid primary colour across all surfaces. No gradient. The forest green applies equally to app UI buttons, links, the sidebar, and marketing CTAs.',
        'token': 'var(--primary) = var(--brand-600) = #1F5B46',
        'insert_before': '<!-- =========================================================\n         4. SPACING',
    },
    'zeroh': {
        'primary': '#0E8F3C',
        'primary_light': '#F0FDF4',
        'primary_name': 'Fresh Green',
        'note': 'Zeroh GRC uses a single solid primary colour across all surfaces. No gradient. The fresh green applies equally to app UI buttons, links, highlights, and marketing CTAs.',
        'token': 'var(--primary) = hsl(147 91% 33%) = #0E8F3C',
        'insert_before': '<!-- =========================================================\n         4. SPACING',
    },
}

for brand, cfg in brands.items():
    path = rf'C:\Users\pheeh\Desktop\ui-design-skill\themes\{brand}\preview.html'
    with open(path, encoding='utf-8') as f:
        html = f.read()

    if 'Brand Color' in html:
        print(f'{brand}: already has Brand Color section, skipping')
        continue

    # find the insert point — look for the spacing section comment
    m = re.search(r'([ \t]*)<!--[^\n]*\n[^\n]*4\.\s*SPACING[^\n]*-->', html)
    if not m:
        # fallback: find section with Spacing label
        m2 = re.search(r'(<section>[\s\S]{0,200}(?:Spacing\s*[&amp;]*\s*Radius|spacing-scale))', html)
        if m2:
            insert_pos = m2.start()
        else:
            print(f'{brand}: WARNING - could not find insert point')
            continue
    else:
        insert_pos = m.start()

    section = f"""    <!-- =========================================================
         BRAND COLOR
    ========================================================= -->
    <section>
      <div class="section-label">Brand Color</div>
      <p style="font-size:13px;color:var(--muted-foreground);margin-bottom:24px;">
        {cfg['note']}
      </p>

      <h2>Primary colour</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
        <div style="border-radius:12px;overflow:hidden;">
          <div style="background:{cfg['primary']};height:80px;display:flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:12px;font-weight:600;letter-spacing:0.08em;opacity:0.9;">{cfg['primary']}</span>
          </div>
          <div style="background:var(--card);border:1px solid var(--border);border-top:none;padding:10px 12px;">
            <code style="font-size:11px;color:var(--muted-foreground);font-family:'DM Mono',monospace;">{cfg['token']}</code>
          </div>
        </div>
        <div style="border-radius:12px;overflow:hidden;">
          <div style="background:{cfg['primary_light']};height:80px;display:flex;align-items:center;justify-content:center;">
            <span style="color:{cfg['primary']};font-size:12px;font-weight:600;letter-spacing:0.08em;">{cfg['primary_name']} on light surface</span>
          </div>
          <div style="background:var(--card);border:1px solid var(--border);border-top:none;padding:10px 12px;">
            <code style="font-size:11px;color:var(--muted-foreground);font-family:'DM Mono',monospace;">color: var(--primary) on var(--secondary)</code>
          </div>
        </div>
      </div>

      <h2>Approved uses</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px;display:flex;flex-direction:column;gap:12px;align-items:flex-start;">
          <span style="font-size:11px;font-weight:600;letter-spacing:0.08em;color:var(--muted-foreground);">APP BUTTON</span>
          <button style="background:{cfg['primary']};color:#fff;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:500;border:none;cursor:pointer;">Get Started</button>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px;display:flex;flex-direction:column;gap:12px;align-items:flex-start;">
          <span style="font-size:11px;font-weight:600;letter-spacing:0.08em;color:var(--muted-foreground);">LINK / INLINE</span>
          <a href="#" style="color:{cfg['primary']};font-size:13px;font-weight:500;text-decoration:underline;text-underline-offset:3px;">Learn more &#8594;</a>
        </div>
        <div style="background:{cfg['primary']};border-radius:10px;padding:20px;display:flex;flex-direction:column;gap:12px;align-items:flex-start;">
          <span style="font-size:11px;font-weight:600;letter-spacing:0.08em;color:rgba(255,255,255,0.7);">MARKETING CTA</span>
          <button style="background:rgba(255,255,255,0.2);color:#fff;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:500;border:1px solid rgba(255,255,255,0.3);cursor:pointer;">Schedule Demo &#8594;</button>
        </div>
      </div>
    </section>

"""
    html = html[:insert_pos] + section + html[insert_pos:]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'{brand}: Brand Color section added, file size {len(html)}')

print('All done.')
