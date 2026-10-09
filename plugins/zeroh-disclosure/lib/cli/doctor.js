// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';

import { PUBLIC_MARKETPLACE_REPO } from '../../packages/zeroh-disclosure-core/product.js';
import {
  ProtectionState,
  ProtectionSurface,
  protectionWording,
} from '../../packages/zeroh-disclosure-core/protection-state.js';
import {
  formatProxyReport,
  listProxyReports,
} from '../../packages/local-proxy/proxy-report.js';
import { registeredProjectRoots } from '../../packages/zeroh-disclosure-core/report.js';
import {
  checkVaults,
  projectKey,
  resetVaults,
  zerohHome,
} from '../../packages/zeroh-disclosure-core/vault.js';
import { removeLegacyProjectFolders } from './legacy-projects.js';
import { authorized, PLUGIN_ROOT, print } from './shared.js';
import { sessionPredatesInstall } from '../statusline.js';
import {
  checkPublishedVersion,
  publishedVersionLine,
} from './published-version.js';

// Findings that doctor --fix cannot repair remain open after it.
const UNFIXABLE_FINDINGS = [
  'proxy-check-failed',
  'base-url-overridden',
  'base-url-shell',
  'base-url-credentials',
  'upstream-mismatch',
];

function doctorFinding(id) {
  return (
    {
      'settings-entry-dead':
        'Your Claude Code settings point at a ZeroH proxy that does not answer.',
      'unknown-zeroh-daemon':
        'A ZeroH proxy this install does not control is running (left by a deleted ~/.zeroh or an earlier build).',
      'files-from-an-earlier-build':
        'The proxy folder holds files from an earlier build.',
      'login-item-without-install':
        'A login item starts a proxy that no Claude Code settings file uses.',
      'proxy-check-failed': 'The proxy check itself failed.',
    }[id] || id
  );
}

// Doctor's line for an ANTHROPIC_BASE_URL set outside ZeroH: where it is
// set (packages/local-proxy/proxy-manager.js baseUrlOverrideSource) and that only removing it
// helps. Names the host, never the value.
function baseUrlOverriddenText({ host, file, providerManaged } = {}) {
  if (providerManaged) {
    return `ANTHROPIC_BASE_URL overridden: the Claude Code host manages the provider${host ? ` at ${host}` : ''}, so ZeroH cannot put this session through the local proxy and what you type is not masked (files and command output still are). Change the provider in the host, or leave it: typed prompts then go as typed, with a notice.`;
  }
  const where = file
    ? `in ${file}`
    : process.platform === 'win32'
      ? 'in the environment Claude Code started in (a Windows user or system environment variable: Settings > System > About > Advanced system settings > Environment Variables, or the terminal you started it from)'
      : 'in the environment Claude Code started in (your shell profile, or the terminal you started it from)';
  const state = protectionWording(ProtectionState.OVERRIDDEN, {
    surface: ProtectionSurface.DOCTOR,
  }).word;
  return `${state}: the value is set ${where}${host ? ` to ${host}` : ''}, so Claude Code sends there instead of through the local proxy and what you type is not masked (files and command output still are). doctor --fix can't change this: remove it and start Claude Code again. To use a gateway through ZeroH, put ANTHROPIC_BASE_URL in Claude Code's settings.json env; ZeroH records it as the original upstream and routes through it.`;
}

function baseUrlShellText({ host } = {}) {
  return `ANTHROPIC_BASE_URL comes from the environment Claude Code started in${host ? ` (${host})` : ''} and matches the default Anthropic upstream or the original upstream in Claude Code's settings.json env. ZeroH writes its local-proxy entry for the running session on the next prompt; the environment never chooses this install's upstream.`;
}

function baseUrlCredentialsText({ host } = {}) {
  return `ANTHROPIC_BASE_URL${host ? ` for ${host}` : ''} contains user:password credentials. ZeroH refuses that upstream because forwarding by origin would drop the credentials; remove them from the URL and use the provider's authorization settings instead.`;
}

function sessionBaseUrlSource({ file, providerManaged } = {}) {
  if (providerManaged) return 'the Claude Code host-managed provider';
  if (file) return file;
  return 'the environment Claude Code started in';
}

function installUpstreamSource({ kind, file } = {}) {
  if (kind === 'settings') return file || 'the managed Claude Code settings';
  if (kind === 'default') return "ZeroH's default Anthropic upstream";
  if (kind === 'environment') {
    return 'the environment that started the proxy install';
  }
  return "the proxy install's recorded source";
}

function baseUrlMismatchText(proxy) {
  const state = protectionWording(
    proxy.protectionState ?? ProtectionState.UPSTREAM_MISMATCH,
    { surface: ProtectionSurface.DOCTOR },
  ).word;
  return `${state}: this session's ANTHROPIC_BASE_URL comes from ${sessionBaseUrlSource(proxy.baseUrlSource)}; this install's upstream comes from ${installUpstreamSource(proxy.installUpstreamSource)}. Typed prompts are not masked in this session (files and command output still are). Put the gateway in Claude Code's settings.json env so ZeroH records it as the original upstream and routes through it; run /zeroh-disclosure:doctor --fix to reset a stale install, then start Claude Code again.`;
}

function oldSessionLines(startedBeforeZeroH) {
  if (!startedBeforeZeroH) return [];
  const wording = protectionWording(ProtectionState.STARTED_BEFORE_ZEROH, {
    surface: ProtectionSurface.DOCTOR,
  });
  return [`Session: ${wording.word} · ${wording.fix}`];
}

// The vault key and every project vault under ZEROH_HOME, whatever folder
// doctor runs in (RB-2): a lost key affects every project. Projects are
// named from the registry (and this folder); a vault of a project it does
// not know is named by its file.
async function doctorVaults({ fix, keepBackups, cwd }) {
  const known = [cwd, ...(await registeredProjectRoots().catch(() => []))];
  const vaultDir = path.join(path.resolve(zerohHome()), 'vault');
  const nameOf = (key) => {
    const root = known.find((candidate) => projectKey(candidate) === key);
    return root
      ? `the vault of ${root}`
      : `the vault ${path.join(vaultDir, `${key}.json`)} (a project ZeroH no longer lists)`;
  };
  const checked = checkVaults();
  const unreadable = checked.vaults.filter(
    (vault) => vault.state === 'unreadable',
  );
  const keyBroken = ['missing', 'damaged'].includes(checked.key);
  const open = [];
  const fixed = [];
  const next = [];
  if (checked.key === 'io') {
    open.push(
      `The vault key could not be read (${checked.code || 'error'}): check that ${path.join(path.resolve(zerohHome()), 'vault.key')} is readable for your account.`,
    );
  }
  if (keyBroken && !fix) {
    open.push(
      `The vault key is ${checked.key}, so none of the ${checked.vaults.length} project vault(s) can be read.`,
    );
  }
  if (!keyBroken && !fix) {
    for (const vault of unreadable) {
      open.push(`${capitalise(nameOf(vault.project))} cannot be read.`);
    }
  }
  for (const vault of checked.vaults) {
    if (vault.state === 'newer') {
      open.push(
        `${capitalise(nameOf(vault.project))} was written by a newer ZeroH Disclosure.`,
      );
    } else if (vault.state === 'io') {
      open.push(
        `${capitalise(nameOf(vault.project))} could not be read (${vault.code || 'error'}): another program may hold it, or your account can't read it. doctor --fix leaves it alone.`,
      );
    }
  }
  if (fix && (keyBroken || unreadable.length)) {
    const reset = resetVaults({ keepBackups });
    const kept = reset.backups.length
      ? ` The old files are kept at ${reset.backups.join(', ')} (readable only by you; they still hold the values, so delete them when you no longer need them).`
      : ' The old files were deleted (they held the values).';
    if (reset.key) {
      fixed.push(
        `The vault key was ${reset.key}, so no vault could be read: reset ${reset.reset.length} project vault(s) and made a new key.${kept} Tokens from earlier sessions stay tokens.`,
      );
    } else {
      for (const project of reset.reset) {
        fixed.push(
          `Reset ${nameOf(project)}: it could not be read, and a new, empty vault starts now.`,
        );
      }
      fixed.push(`${kept.trim()} Tokens from earlier sessions stay tokens.`);
    }
  }
  if (checked.vaults.some((vault) => vault.state === 'newer')) {
    next.push(
      'Update the ZeroH Disclosure plugin: a vault written by a newer version is left untouched.',
    );
  }
  if (!fix && (keyBroken || unreadable.length)) {
    next.push(
      '/zeroh-disclosure:doctor --fix resets every vault that cannot be read and starts a new one; tokens from earlier sessions then stay tokens.',
    );
  }
  return { checked, open, fixed, next };
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function currentSessionPredatesInstall(cwd) {
  return sessionPredatesInstall({
    root: cwd,
    sessionId:
      process.env.CLAUDE_CODE_SESSION_ID ||
      process.env.CLAUDE_SESSION_ID ||
      null,
    env: process.env,
  });
}

export async function cmdDoctor(
  args,
  cwd,
  { checkVersion = checkPublishedVersion } = {},
) {
  if (args.report) {
    // Paste-safe: rebuilt from the fixed schema, no values or paths.
    const reports = listProxyReports().slice(0, 3);
    print({ reports }, args.json, [
      reports.length
        ? reports.map(formatProxyReport).join('\n\n')
        : 'No local proxy reports.',
      '',
      `Nothing was sent. To ask for help, paste this into a GitHub issue at https://github.com/${PUBLIC_MARKETPLACE_REPO}/issues or an email to hello@bladelabs.io.`,
    ]);
    return;
  }
  const fix = Boolean(args.fix);
  if (fix && !(await authorized())) return;
  const publishedVersion = await checkVersion();
  const { baseUrlOverrideSource, diagnoseProxy } =
    await import('../../packages/local-proxy/proxy-manager.js');
  let proxy;
  try {
    proxy = await diagnoseProxy({ fix, retire: true });
  } catch (error) {
    proxy = {
      findings: ['proxy-check-failed'],
      error: error.code || error.message,
    };
  }
  const vaults = await doctorVaults({
    fix,
    keepBackups: Boolean(args['keep-backups']),
    cwd,
  });
  const startedBeforeZeroH = currentSessionPredatesInstall(cwd);
  // The plugin folders Claude Code runs (this one, and every one it
  // recorded for zeroh-disclosure, so a CLI running from ZEROH_HOME/bin
  // checks them too): the release it installed, or a folder an earlier build
  // left for that version, which `claude plugin update` keeps
  // (packages/zeroh-disclosure-core/plugin-integrity.js). Told, never removed here: a session's hooks
  // may run from it.
  const { checkPluginIntegrity, installedRoots, integrityLines } =
    await import('../../packages/zeroh-disclosure-core/plugin-integrity.js');
  const integrity = [
    ...new Set([path.resolve(PLUGIN_ROOT), ...installedRoots()]),
  ].map((pluginRoot) => checkPluginIntegrity({ pluginRoot }));
  const stale = integrity.filter(({ state }) => state === 'stale');
  const integrityFound = stale.map((result) => integrityLines(result)[0]);
  const integrityFix = stale.map((result) => integrityLines(result)[1]);
  // Receipts are never touched here (D-15): only an empty folder an earlier
  // build left inside a project goes; one that holds 0.1 receipts or keys
  // stays, and is named.
  const legacy = fix
    ? await removeLegacyProjectFolders()
    : { removed: [], held: [] };
  await renderDoctor({
    args,
    cwd,
    fix,
    proxy,
    vaults,
    integrity,
    stale,
    integrityFound,
    integrityFix,
    legacy,
    baseUrlOverrideSource,
    startedBeforeZeroH,
    publishedVersion,
  });
}

async function renderDoctor({
  args,
  cwd,
  fix,
  proxy,
  vaults,
  integrity,
  stale,
  integrityFound,
  integrityFix,
  legacy,
  baseUrlOverrideSource,
  startedBeforeZeroH,
  publishedVersion,
}) {
  const lines = [
    `ZeroH Disclosure doctor${fix ? ' --fix' : ''}`,
    `Checked: your Claude Code settings${proxy.settingsPath ? ` (${proxy.settingsPath})` : ''}, the plugin folders Claude Code runs, the local proxy and its login item, files left by earlier builds, and the vault key and every project vault in ${path.resolve(zerohHome())}.`,
  ];
  lines.push(...oldSessionLines(startedBeforeZeroH));
  lines.push(publishedVersionLine(publishedVersion));
  const fixedLines = doctorFixedLines({ fix, proxy, vaults, legacy });
  const legacyHeldLines = legacy.held.map(
    (scan) =>
      `Left ${scan.dir}: it holds files of ZeroH Disclosure 0.1${scan.receipts ? ` (${scan.receipts} signed receipt(s) and ProofPack(s))` : ''}. doctor never touches receipts; /zeroh-disclosure:uninstall keeps their public part.`,
  );
  const { loginItemFix, loginItemReason } =
    await import('../../packages/local-proxy/service-manager.js');
  const { staleMarketplaceName, staleMarketplaceText } =
    await import('../first-run.js');
  const staleMarketplace = staleMarketplaceName();
  const override = proxy.findings.includes('base-url-overridden')
    ? await baseUrlOverrideSource({ cwd })
    : null;
  const open = [
    ...proxy.findings
      .filter((finding) => !fix || UNFIXABLE_FINDINGS.includes(finding))
      .map((finding) =>
        finding === 'login-item-refused'
          ? `No login item: ${loginItemReason(proxy.loginItemRefused)}. The local proxy runs while Claude Code does (a new session starts it again, and what you type is masked), but nothing starts it after a restart. To fix: ${loginItemFix(proxy.loginItemRefused)}.`
          : finding === 'base-url-overridden'
            ? baseUrlOverriddenText(override)
            : finding === 'base-url-shell'
              ? baseUrlShellText(proxy.baseUrlSource)
              : finding === 'base-url-credentials'
                ? baseUrlCredentialsText(proxy.baseUrlSource)
                : finding === 'upstream-mismatch'
                  ? baseUrlMismatchText(proxy)
                  : doctorFinding(finding),
      ),
    ...integrityFound,
    ...(staleMarketplace ? [staleMarketplaceText(staleMarketplace)] : []),
    ...vaults.open,
  ];
  if (fix) {
    lines.push(
      ...(fixedLines.length
        ? ['Fixed:', ...fixedLines.map((line) => `  - ${line}`)]
        : ['Nothing to fix: the local proxy was not set up.']),
    );
  }
  if (legacyHeldLines.length) {
    lines.push('Kept:', ...legacyHeldLines.map((line) => `  - ${line}`));
  }
  if (open.length) {
    lines.push('Found:', ...open.map((finding) => `  - ${finding}`));
    if (proxy.error) lines.push(`    (${proxy.error})`);
  } else if (!fix) {
    lines.push('Nothing to fix.');
  }
  const next = [...integrityFix, ...vaults.next];
  if (
    !fix &&
    proxy.findings.some(
      (finding) =>
        ![
          'login-item-refused',
          'base-url-overridden',
          'base-url-shell',
          'base-url-credentials',
          'upstream-mismatch',
        ].includes(finding),
    )
  ) {
    next.push(
      '/zeroh-disclosure:doctor --fix resets the local proxy: it takes the ZeroH entry out of your Claude Code settings, retires this proxy (sessions still open keep working until you exit them) and keeps other daemons running when it cannot safely drain them. The next Claude Code session sets it up again.',
    );
  }
  if (fix && fixedLines.length) {
    next.push(
      'Start Claude Code again; the next session sets the proxy up again.',
    );
  }
  if (next.length) lines.push(`Next: ${next.join(' ')}`);
  print(
    {
      ...proxy,
      findings: [
        ...proxy.findings,
        ...(stale.length ? ['plugin-folder-stale'] : []),
        ...(staleMarketplace ? ['marketplace-old-name'] : []),
        ...vaults.open,
      ],
      plugin: integrity,
      publishedVersion,
      vault: vaults.checked,
      actions: fixedLines,
      ...(legacy.held.length
        ? { legacyKept: legacy.held.map((scan) => scan.dir) }
        : {}),
    },
    args.json,
    lines,
  );
}

export function doctorFixedLines({ fix, proxy, vaults, legacy }) {
  if (!fix) return [];
  return [
    ...(proxy.restored
      ? [
          'Took the ZeroH entry out of your Claude Code settings (your own ANTHROPIC_BASE_URL, if you had one, is back).',
        ]
      : []),
    ...(proxy.stopped
      ? [`Stopped ${proxy.stopped} ZeroH proxy process(es).`]
      : []),
    ...(proxy.drainUnavailable
      ? [
          `Left ${proxy.drainUnavailable} unowned local proxy daemon(s) running: ZeroH could not safely drain them. Sessions using them keep working.`,
        ]
      : []),
    ...(proxy.retired
      ? [
          'Retired the local proxy: Claude Code sessions still open keep working through it until you exit them (it masks only what it masked before), then it stops by itself.',
        ]
      : []),
    ...(proxy.loginItemRemoved ? ['Removed the login item.'] : []),
    ...(proxy.findings.includes('files-from-an-earlier-build')
      ? ['Removed files left by earlier builds.']
      : []),
    ...vaults.fixed,
    ...legacy.removed.map(
      (dir) => `Removed ${dir}, left empty by an earlier build.`,
    ),
  ];
}
