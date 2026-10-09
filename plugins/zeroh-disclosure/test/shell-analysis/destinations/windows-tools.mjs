// SPDX-License-Identifier: AGPL-3.0-only

// Native fixture tools are compiled once per collection, never once per row.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_ROOT } from './isolation.mjs';
import { safeDiagnosticText } from '../parsers/process-files.mjs';

let native;
let compilationFailure;
export function windowsFixtureTool(name = 'native-argv') {
  if (process.platform !== 'win32') throw new Error('Windows fixture only');
  if (compilationFailure) throw compilationFailure;
  const root = path.join(TEST_ROOT, 'native-tools');
  mkdirSync(root, { recursive: true });
  if (!native) {
    const target = path.join(root, 'native-argv.exe');
    const framework = path.join(
      process.env.SystemRoot,
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
    );
    const references = path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Reference Assemblies',
      'Microsoft',
      'Framework',
      '.NETFramework',
    );
    const reference = [
      path.join(framework, 'System.Web.Extensions.dll'),
      ...['v4.8', 'v4.8.1', 'v4.7.2'].map((version) =>
        path.join(references, version, 'System.Web.Extensions.dll'),
      ),
    ].find(existsSync);
    if (!reference)
      throw new Error('Required .NET Framework fixture reference missing');
    // Windows PowerShell 5.1 ships its engine assembly in the global assembly
    // cache, not beside powershell.exe.
    const engineCache = path.join(
      process.env.SystemRoot,
      'Microsoft.NET',
      'assembly',
      'GAC_MSIL',
      'System.Management.Automation',
    );
    const engine = (existsSync(engineCache) ? readdirSync(engineCache) : [])
      .filter((version) => version.startsWith('v4.0_'))
      .sort()
      .map((version) =>
        path.join(engineCache, version, 'System.Management.Automation.dll'),
      )
      .findLast(existsSync);
    if (!engine)
      throw new Error('Required Windows PowerShell engine reference missing');
    const result = spawnSync(
      path.join(framework, 'csc.exe'),
      [
        '/nologo',
        '/target:exe',
        `/out:${target}`,
        `/reference:${reference}`,
        `/reference:${engine}`,
        fileURLToPath(new URL('./native-argv.cs', import.meta.url)),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 },
    );
    if (result.error || result.status !== 0 || !existsSync(target)) {
      // The first compiler error reaches the job log; the full text stays in
      // the bounded diagnostics below.
      const compiler = String(
        result.stdout?.toString() ||
          result.stderr?.toString() ||
          result.error?.code ||
          '',
      )
        .split(/\r?\n/u)
        .find((line) => /error/iu.test(line));
      compilationFailure = Object.assign(
        new Error(
          'Windows native fixture compilation failed' +
            (compiler ? ': ' + safeDiagnosticText(compiler.trim()) : ''),
        ),
        {
          oracleCommands: [
            {
              program: 'csc.exe',
              status: result.status ?? null,
              stderr: safeDiagnosticText(
                result.stderr?.toString() ||
                  result.stdout?.toString() ||
                  result.error?.code,
              ),
            },
          ],
        },
      );
      throw compilationFailure;
    }
    native = target;
  }
  const target = path.join(root, `${name}.exe`);
  if (target !== native && !existsSync(target)) copyFileSync(native, target);
  return target;
}
