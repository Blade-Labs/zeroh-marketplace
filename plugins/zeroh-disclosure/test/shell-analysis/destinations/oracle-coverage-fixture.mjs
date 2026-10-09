// SPDX-License-Identifier: AGPL-3.0-only

// Synthetic evidence for gate/publisher tests only. Never collected CI evidence.
import { REQUIRED_LEGS, REQUIRED_NODES } from './gate.mjs';

export function oracleCoverageFixture() {
  return Object.entries(REQUIRED_LEGS).flatMap(([platform, shells]) =>
    REQUIRED_NODES.map((node) => ({
      platform,
      node,
      oracleRequirementsChecked: true,
      failures: [],
      pending: [],
      shells: shells.map((shell) => ({ shell, available: true, failures: [] })),
      requests:
        platform === 'ubuntu'
          ? {
              resolved: { status: 'passed' },
              sshAuthenticated: { status: 'passed' },
              programs: {
                failures: [],
                results: [
                  'wget',
                  'git',
                  'gh',
                  'az',
                  'docker',
                  'kubectl',
                  'helm',
                  'aws',
                  'gcloud',
                  'nc',
                  'openssl',
                  'redis-cli',
                  'psql',
                  'mysql',
                  'ssh',
                  'scp',
                ].map((program) => ({ program, status: 'passed' })),
              },
            }
          : {},
    })),
  );
}
