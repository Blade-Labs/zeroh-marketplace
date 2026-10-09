// SPDX-License-Identifier: AGPL-3.0-only

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { windowsFixtureTool } from './windows-tools.mjs';
import { cleanupDirectory } from '../parsers/process-files.mjs';

export const TEST_ROOT = path.join(
  process.env.TMPDIR || os.tmpdir(),
  'zeroh-destination-tests',
);
export const POWERSHELL_MODULE_CACHE = path.join(
  TEST_ROOT,
  'powershell-module-analysis.cache',
);
export function freshEnvironment(label = 'oracle') {
  mkdirSync(TEST_ROOT, { recursive: true });
  const root = mkdtempSync(path.join(TEST_ROOT, `${label}-`));
  for (const dir of [
    'home',
    'zeroh',
    'credentials',
    'claude',
    'services',
    'bin',
    'tmp',
    'appdata',
    'localappdata',
  ])
    mkdirSync(path.join(root, dir));
  const bin = path.join(root, 'bin');
  const fakeClaude = path.join(bin, 'claude');
  writeFileSync(fakeClaude, '#!/bin/sh\nexit 0\n');
  chmodSync(fakeClaude, 0o700);
  writeFileSync(path.join(bin, 'claude.cmd'), '@exit /b 0\r\n');
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    HOME: path.join(root, 'home'),
    USERPROFILE: path.join(root, 'home'),
    ZEROH_HOME: path.join(root, 'zeroh'),
    ZEROH_CREDENTIAL_HOME: path.join(root, 'credentials'),
    CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
    ZEROH_CLAUDE_SETTINGS: path.join(root, 'claude', 'settings.json'),
    ZEROH_SERVICE_MANAGER_DIR: path.join(root, 'services'),
    TMPDIR: root,
    TMP: root,
    TEMP: root,
    APPDATA: path.join(root, 'appdata'),
    LOCALAPPDATA: path.join(root, 'localappdata'),
    PYTHONDONTWRITEBYTECODE: '1',
    LC_ALL: 'C',
    LANG: 'C',
    // Keep this metadata-only cache under TEST_ROOT. Hosted 5.1 still pays
    // 11–30 s per process; deadlines and batching must not depend on the cache.
    PSModuleAnalysisCachePath: POWERSHELL_MODULE_CACHE,
    POWERSHELL_TELEMETRY_OPTOUT: '1',
    POWERSHELL_UPDATECHECK: 'Off',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    NPM_CONFIG_USERCONFIG: path.join(root, 'home', 'npmrc'),
    XDG_CONFIG_HOME: path.join(root, 'home', '.config'),
    XDG_DATA_HOME: path.join(root, 'home', '.local/share'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(root, 'home', 'gitconfig'),
    GIT_TERMINAL_PROMPT: '0',
  };
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'ZEROH_ORACLE_BRIDGE_DIAGNOSTICS',
  ])
    if (process.env[key]) env[key] = process.env[key];
  if (process.platform === 'win32') {
    env.MSYS_NO_PATHCONV = '1';
    env.MSYS2_ARG_CONV_EXCL = '*';
  }
  return {
    root,
    bin,
    env,
    cleanup: () => cleanupDirectory(root),
  };
}

export function shellDeadline(shell, ordinary = 12000) {
  return shellKind(shell) === 'powershell'
    ? Math.max(60000, ordinary)
    : ordinary;
}

export function shellKind(shell) {
  if (shell === 'git-bash' || shell === 'bash-3.2') return 'bash';
  if (shell === 'powershell-5.1' || shell === 'powershell') return 'powershell';
  return shell;
}

export function shellArguments(shell, command) {
  switch (shellKind(shell)) {
    case 'bash':
      return ['--noprofile', '--norc', '-c', command];
    case 'zsh':
      return ['-f', '-c', command];
    case 'pwsh':
    case 'powershell':
      return ['-NoProfile', '-NonInteractive', '-Command', command];
    case 'cmd':
      return ['/d', '/s', '/c', command];
    default:
      throw new Error('unknown oracle shell');
  }
}

export function shellExecutable(shell, executables = {}) {
  // The 5.1 bridge uses BOM-marked script files, a private payload for parser
  // input, and owns descendants so timeouts cannot strand a private fixture cwd.
  if (process.platform === 'win32' && shellKind(shell) === 'powershell')
    return windowsFixtureTool('fixture-powershell');
  if (executables[shell]) return executables[shell];
  switch (shell) {
    case 'bash-3.2':
      return '/bin/bash';
    case 'git-bash':
      return 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';
    case 'powershell':
    case 'powershell-5.1':
      return 'powershell.exe';
    default:
      return shell;
  }
}
