#!/usr/bin/env bash
# reviews/build-dashboard.sh — Rebuild reviews/dashboard/index.html
# Embeds all v*.json review files from reviews/releases/ as inline data.
# Run after adding a new review JSON: bash reviews/build-dashboard.sh
# Output: reviews/dashboard/index.html (self-contained, no CDN except Chart.js)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASES_DIR="$SCRIPT_DIR/releases"
OUTPUT="$SCRIPT_DIR/dashboard/index.html"

mkdir -p "$SCRIPT_DIR/dashboard"

# Collect all v*.json files into a JSON array using Python
REVIEWS_JSON=$(python3 - "$RELEASES_DIR" <<'PYEOF'
import sys, json, os, glob

releases_dir = sys.argv[1]
files = sorted(glob.glob(os.path.join(releases_dir, 'v*-review.json')))
data = []
for f in files:
    with open(f) as fh:
        data.append(json.load(fh))
print(json.dumps(data, separators=(',', ':')))
PYEOF
)

FILE_COUNT=$(echo "$REVIEWS_JSON" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))')

# Write the HTML using Python to avoid shell escaping issues with JS template literals
python3 - "$OUTPUT" "$REVIEWS_JSON" <<'PYEOF'
import sys, json

output_path = sys.argv[1]
reviews_json = sys.argv[2]

html = r"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Review Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    :root {
      --bg: #0a1a14;
      --surface: #0f2419;
      --surface2: #163020;
      --border: #1e4030;
      --accent: #2d7a4e;
      --accent2: #3a9e63;
      --text: #e8f5ee;
      --text2: #8db8a0;
      --passed: #27ae60;
      --failed: #e74c3c;
      --critical: #e74c3c;
      --high: #e67e22;
      --medium: #f1c40f;
      --low: #3498db;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.5;
    }
    header {
      background: #0D261F;
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
    }
    header h1 { font-size: 1.25rem; font-weight: 600; color: var(--text); }
    header .subtitle { font-size: 0.85rem; color: var(--text2); margin-top: 0.2rem; }
    main { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .charts-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .chart-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
    }
    .chart-card h3 {
      font-size: 0.9rem;
      color: var(--text2);
      margin-bottom: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .chart-wrapper { position: relative; height: 220px; }
    .versions-section h2 {
      font-size: 1rem;
      color: var(--text2);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }
    .version-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 1rem;
      overflow: hidden;
    }
    .version-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem 1.25rem;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    .version-header:hover { background: var(--surface2); }
    .verdict-badge {
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      letter-spacing: 0.05em;
    }
    .verdict-badge.passed { background: rgba(39,174,96,0.2); color: var(--passed); border: 1px solid var(--passed); }
    .verdict-badge.failed { background: rgba(231,76,60,0.2); color: var(--failed); border: 1px solid var(--failed); }
    .version-title { font-weight: 600; font-size: 1rem; }
    .version-meta { color: var(--text2); font-size: 0.85rem; margin-left: auto; }
    .chevron { color: var(--text2); transition: transform 0.2s; font-size: 1.1rem; }
    .version-card.open .chevron { transform: rotate(90deg); }
    .version-body { display: none; padding: 0 1.25rem 1.25rem; border-top: 1px solid var(--border); }
    .version-card.open .version-body { display: block; }
    .gate-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 0.5rem;
      margin: 1rem 0;
    }
    .gate-item {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem;
    }
    .gate-label { color: var(--text2); font-size: 0.75rem; }
    .gate-value { font-weight: 600; margin-top: 0.2rem; }
    .gate-value.clean { color: var(--passed); }
    .gate-value.unknown { color: var(--text2); }
    .phases-list { margin-top: 1rem; }
    .phases-list h4 { font-size: 0.8rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .phase-row {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.4rem 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.85rem;
    }
    .phase-row:last-child { border-bottom: none; }
    .phase-num { color: var(--text2); min-width: 2.5rem; font-size: 0.8rem; }
    .findings-section { margin-top: 1rem; }
    .findings-section h4 { font-size: 0.8rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .finding {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      font-size: 0.85rem;
    }
    .finding-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; flex-wrap: wrap; }
    .severity-badge {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.15rem 0.45rem;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .severity-badge.critical { background: rgba(231,76,60,0.2); color: var(--critical); }
    .severity-badge.high { background: rgba(230,126,34,0.2); color: var(--high); }
    .severity-badge.medium { background: rgba(241,196,15,0.2); color: var(--medium); }
    .severity-badge.low { background: rgba(52,152,219,0.2); color: var(--low); }
    .finding-meta { font-size: 0.75rem; color: var(--text2); }
    .finding-desc { color: var(--text); }
    .finding-resolution { color: var(--text2); font-size: 0.8rem; margin-top: 0.3rem; }
    .no-data { color: var(--text2); font-size: 0.85rem; padding: 0.5rem 0; }
    .rounds-section { margin-top: 1rem; }
    .rounds-section h4 { font-size: 0.8rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .round-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.85rem;
      padding: 0.3rem 0;
      border-bottom: 1px solid var(--border);
    }
    .round-row:last-child { border-bottom: none; }
    .round-label { color: var(--text2); min-width: 6rem; font-size: 0.8rem; }
    .round-verdict { font-size: 0.82rem; color: var(--passed); }
    .round-verdict.has-findings { color: var(--high); }
    @media (max-width: 768px) {
      .charts-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
<header>
  <h1>Code Review Dashboard</h1>
  <div class="subtitle">Release audit trail — validation gate results per version</div>
</header>
<main>
  <div class="charts-row">
    <div class="chart-card">
      <h3>Test Count Growth</h3>
      <div class="chart-wrapper"><canvas id="testChart"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>Findings per Version</h3>
      <div class="chart-wrapper"><canvas id="findingsChart"></canvas></div>
    </div>
  </div>
  <div class="versions-section">
    <h2>Version Timeline</h2>
    <div id="versions-container"></div>
  </div>
</main>
<script>
/* AUTO-GENERATED by reviews/build-dashboard.sh — do not edit manually */
const REVIEW_DATA = """ + reviews_json + r""";

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDashboard(data) {
  const sorted = [...data].sort((a, b) => b.version.localeCompare(a.version));
  const labels = [...sorted].reverse().map(r => 'v' + r.version);
  const unitCounts  = [...sorted].reverse().map(r => r.gate && r.gate.unitTests && r.gate.unitTests.passed != null ? r.gate.unitTests.passed : 0);
  const integCounts = [...sorted].reverse().map(r => r.gate && r.gate.integrationTests && r.gate.integrationTests.passed != null ? r.gate.integrationTests.passed : 0);
  const e2eCounts   = [...sorted].reverse().map(r => r.gate && r.gate.e2eTests && r.gate.e2eTests.passed != null ? r.gate.e2eTests.passed : 0);
  const totalFound    = [...sorted].reverse().map(r => (r.findings || []).length);
  const totalResolved = [...sorted].reverse().map(r => (r.findings || []).filter(f => f.resolution).length);

  const baseScales = {
    x: { ticks: { color: '#8db8a0' }, grid: { color: 'rgba(30,64,48,0.5)' } },
    y: { ticks: { color: '#8db8a0' }, grid: { color: 'rgba(30,64,48,0.5)' } }
  };
  const baseLegend = { labels: { color: '#8db8a0', font: { size: 11 } } };

  new Chart(document.getElementById('testChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Unit',        data: unitCounts,  borderColor: '#3a9e63', backgroundColor: 'rgba(58,158,99,0.15)',  fill: true, tension: 0.3, yAxisID: 'y' },
        { label: 'Integration', data: integCounts, borderColor: '#f1c40f', backgroundColor: 'rgba(241,196,15,0.1)', fill: true, tension: 0.3, yAxisID: 'y1' },
        { label: 'E2E',         data: e2eCounts,   borderColor: '#3498db', backgroundColor: 'rgba(52,152,219,0.1)', fill: true, tension: 0.3, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: baseLegend },
      scales: {
        x: { ticks: { color: '#8db8a0' }, grid: { color: 'rgba(30,64,48,0.5)' } },
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Unit Tests', color: '#3a9e63', font: { size: 11 } },
          ticks: { color: '#3a9e63' },
          grid: { color: 'rgba(30,64,48,0.5)' }
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Integration + E2E', color: '#3498db', font: { size: 11 } },
          ticks: { color: '#3498db' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  new Chart(document.getElementById('findingsChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Found',    data: totalFound,    backgroundColor: 'rgba(230,126,34,0.6)', borderColor: '#e67e22', borderWidth: 1 },
        { label: 'Resolved', data: totalResolved, backgroundColor: 'rgba(39,174,96,0.6)',  borderColor: '#27ae60', borderWidth: 1 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: baseLegend }, scales: baseScales }
  });

  const container = document.getElementById('versions-container');

  sorted.forEach(function(review) {
    const card = document.createElement('div');
    card.className = 'version-card';

    const verdict = (review.verdict || 'PASSED').toUpperCase();
    const phaseCount   = (review.phases || []).length;
    const findingCount = (review.findings || []).length;
    const verdictClass = (verdict === 'PASSED' || verdict === 'RELEASED') ? 'passed' : 'failed';

    const meta = [
      review.date,
      phaseCount  ? phaseCount  + ' phase'   + (phaseCount  !== 1 ? 's' : '') : null,
      findingCount ? findingCount + ' finding' + (findingCount !== 1 ? 's' : '') : null
    ].filter(Boolean).join(' · ');

    const header = document.createElement('div');
    header.className = 'version-header';
    header.innerHTML =
      '<span class="verdict-badge ' + verdictClass + '">' + verdict + '</span>' +
      '<span class="version-title">v' + esc(review.version) + '</span>' +
      '<span class="version-meta">' + esc(meta) + '</span>' +
      '<span class="chevron">&#x203A;</span>';

    const body = document.createElement('div');
    body.className = 'version-body';

    // Gate results
    const gate = review.gate || {};
    function gateItem(label, value) {
      if (value == null) return '<div class="gate-item"><div class="gate-label">' + esc(label) + '</div><div class="gate-value unknown">\u2014</div></div>';
      const s = String(value);
      const isGreen = s === 'clean' || /^\d+\/\d+$/.test(s);
      return '<div class="gate-item"><div class="gate-label">' + esc(label) + '</div><div class="gate-value' + (isGreen ? ' clean' : '') + '">' + esc(s) + '</div></div>';
    }
    function testsLabel(obj) {
      if (!obj) return null;
      if (obj.passed != null) return obj.passed + '/' + obj.total;
      return null;
    }

    let html = '<div class="gate-grid">';
    html += gateItem('Lint', gate.lint);
    html += gateItem('Type Check', gate.typeCheck);
    html += gateItem('Unit Tests', testsLabel(gate.unitTests));
    html += gateItem('Integration', testsLabel(gate.integrationTests));
    html += gateItem('E2E Tests', testsLabel(gate.e2eTests));
    html += gateItem('Build', gate.build);
    html += '</div>';

    if (review.notes) {
      html += '<p style="font-size:0.82rem;color:var(--text2);margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);">' + esc(review.notes) + '</p>';
    }

    // Review rounds
    if (review.rounds && review.rounds.length > 0) {
      html += '<div class="rounds-section"><h4>Review Rounds</h4>';
      review.rounds.forEach(function(r) {
        const totalF = (r.agents || []).reduce(function(s, a) { return s + (a.findings || 0); }, 0);
        const vClass = totalF === 0 ? '' : ' has-findings';
        const phaseLabel = r.phase ? ' (phase ' + r.phase + ')' : '';
        const agentSummary = (r.agents || []).map(function(a) { return a.name + ': ' + a.findings; }).join(', ');
        html += '<div class="round-row">';
        html += '<span class="round-label">Round ' + r.round + esc(phaseLabel) + '</span>';
        html += '<span class="round-verdict' + vClass + '">' + esc(r.verdict || agentSummary) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Phases
    if (review.phases && review.phases.length > 0) {
      html += '<div class="phases-list"><h4>Phases Included</h4>';
      review.phases.forEach(function(p) {
        html += '<div class="phase-row"><span class="phase-num">#' + p.number + '</span><span>' + esc(p.name) + '</span></div>';
      });
      html += '</div>';
    }

    // Findings
    if (review.findings && review.findings.length > 0) {
      html += '<div class="findings-section"><h4>Findings (' + review.findings.length + ')</h4>';
      review.findings.forEach(function(f) {
        const sev = (f.severity || 'LOW').toLowerCase();
        const parts = [f.agent || ''];
        if (f.phase) parts.push('phase ' + f.phase);
        if (f.round !== undefined && f.round !== null) parts.push('round ' + f.round);
        html += '<div class="finding">';
        html += '<div class="finding-header">';
        html += '<span class="severity-badge ' + sev + '">' + esc(f.severity || 'LOW') + '</span>';
        html += '<span class="finding-meta">' + esc(parts.join(' · ')) + '</span>';
        html += '</div>';
        html += '<div class="finding-desc">' + esc(f.description || '') + '</div>';
        if (f.resolution) {
          html += '<div class="finding-resolution">Resolution: ' + esc(f.resolution) + '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    } else if (phaseCount > 0) {
      html += '<p class="no-data" style="margin-top:0.75rem;">No findings recorded for this version.</p>';
    }

    body.innerHTML = html;
    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);

    header.addEventListener('click', function() { card.classList.toggle('open'); });
  });

  // Auto-open newest version
  const firstCard = container.querySelector('.version-card');
  if (firstCard) firstCard.classList.add('open');
}

renderDashboard(REVIEW_DATA);
</script>
</body>
</html>"""

with open(output_path, 'w') as fh:
    fh.write(html)
PYEOF

echo "Dashboard written to $OUTPUT"
echo "Embedded $FILE_COUNT review file(s)"
