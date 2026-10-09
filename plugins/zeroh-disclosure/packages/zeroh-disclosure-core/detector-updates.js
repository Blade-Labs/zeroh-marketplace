// SPDX-License-Identifier: AGPL-3.0-only

// Phase 54.7's compatibility watcher calls this with its fetch/cache adapters.
// Pure comparison, no networking, task creation or publication side effects.
export function detectorUpdates({
  currentCatalog,
  nextCatalog,
  overlay,
  release,
  announcements = [],
}) {
  const reports = announcements
    .filter((item) => item.kind === 'token-format' && item.id && item.source)
    .map(({ id, provider, source }) => ({
      kind: 'token-format',
      id,
      provider,
      source,
    }));
  if (!release || release.version === currentCatalog.generatedFrom.version)
    return reports;
  const references = new Set([
    ...overlay.rules.map((rule) => rule.id),
    ...overlay.gaps.map((rule) => rule.fillsGapOf).filter(Boolean),
  ]);
  const current = new Map(currentCatalog.rules.map((rule) => [rule.id, rule]));
  const next = new Map(
    (nextCatalog?.rules ?? []).map((rule) => [rule.id, rule]),
  );
  const changedRules = nextCatalog
    ? [...references].filter(
        (id) =>
          JSON.stringify(current.get(id)) !== JSON.stringify(next.get(id)),
      )
    : [];
  if (
    nextCatalog &&
    JSON.stringify(currentCatalog.globalAllowlist) !==
      JSON.stringify(nextCatalog.globalAllowlist)
  )
    changedRules.push('global-allowlist');
  reports.push({
    kind: 'gitleaks-release',
    version: release.version,
    source: release.source,
    changedRules,
    needsUpdateTask: changedRules.length > 0,
    comparisonPending: !nextCatalog,
  });
  return reports;
}
