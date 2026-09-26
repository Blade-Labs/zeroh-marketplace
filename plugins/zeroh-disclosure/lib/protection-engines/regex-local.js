// SPDX-License-Identifier: AGPL-3.0-only

// The default engine: ZeroH's pattern detector, run locally.
import { detectSensitiveData, detectorManifest } from '../detector.js';
import { maskText } from '../mask.js';

export const regexLocalProtectionEngine = {
  id: 'regex-local',

  async health() {
    return { ok: true };
  },

  async analyze({ text }) {
    return detectSensitiveData(text);
  },

  async transform({ text, findings, hmacKeyBytes, categoriesToMask }) {
    return maskText(text, findings, { hmacKeyBytes, categoriesToMask });
  },

  async manifest() {
    return {
      ...detectorManifest(),
      id: 'regex-local',
      interface_version: 'zeroh-protection-engine/v1',
      provider: 'zeroh-reference',
      engine: 'regex-local',
      cloud_calls: false,
    };
  },
};
