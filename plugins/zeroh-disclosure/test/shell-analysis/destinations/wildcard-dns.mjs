// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnFile } from '../parsers/process-files.mjs';
import { freshEnvironment } from './isolation.mjs';

export function wildcardFixtures() {
  return JSON.parse(
    readFileSync(new URL('./wildcard-fixtures.json', import.meta.url)),
  );
}

export async function wildcardDnsEffects() {
  const sources = JSON.parse(
    readFileSync(new URL('./vendor/SOURCE.json', import.meta.url)),
  );
  for (const source of sources)
    for (const file of source.files) {
      const bytes = readFileSync(
        new URL(`./vendor/${file.path}`, import.meta.url),
      );
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        file.sha256,
        'upstream source integrity',
      );
    }
  const go = readFileSync(
    new URL('./vendor/sslip/xip/xip.go', import.meta.url),
    'utf8',
  );
  // Evaluate the immutable upstream regexps, in its documented precedence.
  // This is a semantic expression fixture; it does not pretend to run Go.
  const expression = (name) => {
    const match = go.match(
      new RegExp(`${name}\\s*=\\s*regexp.MustCompile\\(\x60([^\x60]+)\x60\\)`),
    );
    assert.ok(match, 'pinned Go expression absent');
    return new RegExp(match[1].replaceAll('[[:xdigit:]]', '[a-fA-F0-9]'));
  };
  assert.match(go, /range \[\]\*regexp\.Regexp\{ipv4REDashes, ipv4REDots\}/u);
  const extract = (host) => {
    for (const name of ['ipv4REDashes', 'ipv4REDots']) {
      const m = expression(name).exec(host);
      if (m) return m[2].replaceAll('-', '.');
    }
    const hex = expression('ipv4REHex').exec(host)?.[2];
    return hex ? [...Buffer.from(hex, 'hex')].join('.') : null;
  };
  const extract6 = (host) => {
    const ipv6 = expression('ipv6RE').exec(host)?.[2];
    const full = expression('ipv6REHex').exec(host)?.[2];
    const address = ipv6
      ? ipv6.replaceAll('-', ':')
      : full
        ? full.match(/.{4}/gu).join(':')
        : null;
    return address
      ? new URL(`http://[${address}]/`).hostname.slice(1, -1)
      : null;
  };
  const fixture = freshEnvironment('wildcard');
  try {
    for (const row of wildcardFixtures()) {
      assert.equal(
        extract(row.sslipHost),
        row.sslipAddress,
        `${row.id}: sslip source expression`,
      );
      assert.equal(
        extract6(row.sslipHost),
        row.sslipIPv6 ?? null,
        `${row.id}: sslip IPv6 expression`,
      );
      const source = fileURLToPath(
        new URL('./vendor/nip/nipio/backend.py', import.meta.url),
      );
      const result = await spawnFile(
        'python3',
        [
          '-B',
          '-c',
          `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('upstream',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
b=m.DynamicBackend();b.domain='nip.io'
found=[]
b.handle_resolved=lambda address,name: found.append(str(address))
b.handle_invalid_ip=lambda name: None
b.handle_subdomains('A',sys.argv[2])
print(json.dumps(found))`,
          source,
          row.nipHost,
        ],
        { env: fixture.env, cwd: fixture.root, timeout: 10000 },
      );
      assert.equal(result.status, 0, 'pinned nip backend execution');
      assert.deepEqual(
        JSON.parse(result.stdout),
        row.nipAddress ? [row.nipAddress] : [],
        `${row.id}: nip upstream backend`,
      );
    }
    return {
      checked: true,
      cases: wildcardFixtures().length,
      sslip: 'pinned Go regexp expressions; Go binary not executed',
      nip: 'unmodified pinned Python backend',
      pins: sources.map(({ name, commit, license }) => ({
        name,
        commit,
        license,
      })),
    };
  } finally {
    fixture.cleanup();
  }
}
