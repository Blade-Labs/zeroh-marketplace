// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';

// A file name establishes its language, not arbitrary interpolation. In
// particular .env and YAML text remain literal unless a consumer is known.
export function fileDetectionOptions(file) {
  if (typeof file !== 'string') return { channel: 'prose', context: 'mixed' };
  const name = path.basename(file).toLowerCase();
  const extension = path.extname(name);
  if (/^(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/u.test(name))
    return {
      channel: 'config',
      context: { language: 'compose', interpolation: 'compose' },
    };
  if (/^\.env(?:\.|$)/u.test(name))
    return { channel: 'config', context: 'dotenv' };
  const config = {
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.ini': 'ini',
    '.properties': 'properties',
    '.env': 'dotenv',
  }[extension];
  if (config) return { channel: 'config', context: config };
  if (extension === '.sh' || extension === '.bash')
    return { channel: 'shell', context: 'bash' };
  const code = {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.go': 'go',
    '.java': 'java',
    '.rs': 'rust',
  }[extension];
  if (code) return { channel: 'code', context: code };
  if (extension === '.md' || extension === '.txt')
    return { channel: 'prose', context: 'markdown' };
  return { channel: 'prose', context: 'mixed' };
}
