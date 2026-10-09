// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  spawnFile,
  spawnFileSync,
  captureCommandDiagnostics,
  safeDiagnosticText,
} from '../parsers/process-files.mjs';
import { freshEnvironment } from './isolation.mjs';
import { VALUE } from './corpus.mjs';

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
const rejectedNormally = (result) => {
  assert.ok(
    Number.isInteger(result.status) && result.status !== 0,
    'rejected client must exit normally with nonzero status',
  );
  assert.equal(result.signal, null, 'rejection must not be a killed client');
};

// These clients pay substantial Python imports or Go runtime/TLS startup on
// hosted VMs. Budget each invocation, including Azure's local rejection probe.
export const CLIENT_TIMEOUTS = { az: 60000, kubectl: 30000, helm: 30000 };

export async function runProgramEffects() {
  const fixture = freshEnvironment('program-effects');
  const diagnostics = [];
  const results = [],
    failures = [],
    servers = [],
    sockets = new Set();
  const run = (program, args, extra = {}) =>
    spawnFile(program, args, {
      cwd: fixture.root,
      env: { ...fixture.env, ...extra.env },
      timeout: extra.timeout ?? CLIENT_TIMEOUTS[program] ?? 10000,
      input: extra.input,
    });
  const installed = (program) =>
    spawnFileSync('/bin/sh', ['-c', `command -v ${program}`], {
      env: fixture.env,
      cwd: fixture.root,
      timeout: 3000,
    }).status === 0;
  const add = async (program, id, check) => {
    if (!installed(program)) {
      results.push({
        program,
        id,
        status: 'ci-required',
        reason: 'program not installed',
      });
      return;
    }
    const captured = await captureCommandDiagnostics(check);
    try {
      if (captured.error) throw captured.error;
      const detail = captured.result;
      results.push({ program, id, status: 'passed', ...detail });
    } catch (error) {
      diagnostics.push({
        oracle: 'programs',
        shell: program,
        caseIds: [id],
        message: safeDiagnosticText(error.message),
        commands: captured.commands,
      });
      results.push({
        program,
        id,
        status: 'failed',
        failureKind: error.code || error.name,
      });
      failures.push(`${program}/${id}: independent effect assertion failed`);
    }
  };
  const keep = async (server) => {
    servers.push(server);
    server.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    await listen(server);
    return server.address().port;
  };
  try {
    if (process.platform === 'linux' && installed('cc')) {
      const guard = path.join(fixture.root, 'loopback.so');
      const built = await run('cc', [
        '-shared',
        '-fPIC',
        '-o',
        guard,
        fileURLToPath(new URL('./loopback-guard.c', import.meta.url)),
        '-ldl',
      ]);
      assert.equal(built.status, 0, 'loopback resolver build');
      fixture.env.LD_PRELOAD = guard;
    } else
      return {
        results: [],
        failures: [],
        pending: [
          'program-effects: Linux fixture resolver requires Linux and cc; run this fixture in Ubuntu CI',
        ],
      };
    Object.assign(fixture.env, {
      GH_NO_UPDATE_NOTIFIER: '1',
      GH_PROMPT_DISABLED: '1',
      AZURE_CORE_COLLECT_TELEMETRY: 'false',
      AZURE_EXTENSION_USE_DYNAMIC_INSTALL: 'no',
      AZURE_CONFIG_DIR: path.join(fixture.env.HOME, 'azure'),
      AWS_EC2_METADATA_DISABLED: 'true',
      AWS_MAX_ATTEMPTS: '1',
      CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: 'true',
      CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: 'true',
      KUBECONFIG: path.join(fixture.root, 'empty-kubeconfig'),
      HELM_CONFIG_HOME: path.join(fixture.env.HOME, 'helm-config'),
      HELM_CACHE_HOME: path.join(fixture.env.HOME, 'helm-cache'),
      HELM_DATA_HOME: path.join(fixture.env.HOME, 'helm-data'),
      HELM_KUBEAPISERVER: '',
      HELM_KUBETOKEN: '',
      HELM_PLUGINS: path.join(fixture.env.HOME, 'helm-plugins'),
    });
    mkdirSync(fixture.env.AZURE_CONFIG_DIR);
    writeFileSync(
      path.join(fixture.env.AZURE_CONFIG_DIR, 'config'),
      '[core]\ncollect_telemetry = no\n[extension]\nuse_dynamic_install = no\n',
    );
    const requests = [];
    const handler = (req, res) => {
      let body = '';
      req.on('data', (b) => (body += b));
      req.on('end', () => {
        requests.push({
          atMs: performance.now(),
          host: req.headers.host,
          path: req.url,
          headers: req.headers,
          body,
        });
        if (req.url === '/_ping') {
          res.setHeader('API-Version', '1.45');
          res.end('OK');
          return;
        }
        if (req.url === '/version') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({ ApiVersion: '1.45', MinAPIVersion: '1.24' }),
          );
          return;
        }
        if (req.url.endsWith('/auth')) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ Status: 'Login Succeeded' }));
          return;
        }
        if (req.url.startsWith('/v2/') && !req.headers.authorization) {
          res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fixture"' });
          res.end('{}');
          return;
        }
        if (req.url.includes('info/refs')) {
          res.writeHead(404);
          res.end('fixture');
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end('{}');
      });
    };
    const hp = await keep(http.createServer(handler));
    const key = path.join(fixture.root, 'server-key'),
      cert = path.join(fixture.root, 'server-cert');
    assert.equal(
      (
        await run('openssl', [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          key,
          '-out',
          cert,
          '-subj',
          '/CN=fixture.example.com',
          '-addext',
          'subjectAltName=DNS:fixture.example.com,DNS:github.example.com,IP:127.0.0.1',
          '-days',
          '1',
        ])
      ).status,
      0,
      'fixture certificate',
    );
    const tlsServer = https.createServer(
      {
        key: readFileSync(key),
        cert: readFileSync(cert),
        requestCert: true,
        rejectUnauthorized: false,
      },
      handler,
    );
    const sni = [];
    const peerSubjects = [];
    tlsServer.on('secureConnection', (socket) => {
      sni.push(socket.servername);
      peerSubjects.push(socket.getPeerCertificate().subject?.CN);
    });
    const tp = await keep(tlsServer);
    const proxy = http.createServer(handler);
    proxy.on('connect', (req, client, head) => {
      // All CONNECT targets terminate at our own TLS listener. No forwarding or DNS.
      const upstream = net.connect(tp, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      sockets.add(upstream);
      upstream.on('close', () => sockets.delete(upstream));
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
    const pp = await keep(proxy);
    fixture.env.HTTPS_PROXY = `http://127.0.0.1:${pp}`;
    fixture.env.HTTP_PROXY = fixture.env.HTTPS_PROXY;
    fixture.env.https_proxy = fixture.env.HTTPS_PROXY;
    fixture.env.http_proxy = fixture.env.HTTPS_PROXY;
    fixture.env.NO_PROXY = '127.0.0.1,::1,localhost';
    fixture.env.no_proxy = fixture.env.NO_PROXY;
    fixture.env.SSL_CERT_FILE = cert;
    fixture.env.REQUESTS_CA_BUNDLE = cert;
    const delivered = async (program, args, test, extra = {}) => {
      const before = requests.length;
      const started = performance.now();
      const r = await run(program, args, extra);
      const received = requests.slice(before);
      assert.ok(
        Number.isInteger(r.status) && r.signal === null,
        'effect client must terminate normally',
      );
      if (program === 'docker')
        writeFileSync(
          path.join(fixture.root, 'docker-summary.json'),
          JSON.stringify({
            status: r.status,
            requests: received.map((x) => ({
              path: x.path,
              hasAuth: !!x.headers.authorization,
              bodyLength: x.body.length,
            })),
            connectionError: /connect|daemon|TLS|certificate|Error/u.test(
              r.stderr,
            ),
          }),
        );
      assert.ok(received.length, 'no loopback request');
      assert.ok(test(received), 'delivered bytes mismatch');
      return {
        exitStatus: r.status,
        requests: received.length,
        delivered: true,
        elapsedMs: r.elapsedMs,
        firstRequestMs: Math.round(received[0].atMs - started),
      };
    };
    await add('wget', 'post-config-rejection', async () => {
      const rc = path.join(fixture.root, 'wgetrc');
      writeFileSync(rc, `header = X-Oracle: ${VALUE}\n`);
      const result = await delivered(
        'wget',
        [
          '--config',
          rc,
          '--timeout=3',
          '--tries=1',
          '--post-data',
          VALUE,
          '-O',
          '/dev/null',
          `http://wget.example.com:${hp}/data`,
        ],
        (rs) =>
          rs.some((r) => r.body === VALUE && r.headers['x-oracle'] === VALUE),
      );
      const before = requests.length;
      const bad = await run('wget', [
        '--zeroh-invalid-option',
        `http://wget.example.com:${hp}/reject`,
      ]);
      rejectedNormally(bad);
      assert.equal(requests.length, before);
      return { ...result, rejectedBeforeNetwork: true };
    });
    await add('git', 'http-header-and-fetch', async () => {
      const result = await delivered(
        'git',
        [
          '-c',
          `http.extraHeader=X-Oracle: ${VALUE}`,
          'ls-remote',
          `http://git.example.com:${hp}/r.git`,
        ],
        (rs) => rs.some((r) => r.headers['x-oracle'] === VALUE),
      );
      assert.equal((await run('git', ['init', '--quiet'])).status, 0);
      const remote = await delivered(
        'git',
        [
          'remote',
          'add',
          '-f',
          'probe',
          `http://git.example.com:${hp}/${VALUE}.git`,
        ],
        (rs) => rs.some((r) => r.path.includes(VALUE)),
      );
      return { ...result, remoteFetchDelivered: remote.delivered };
    });
    await add('gh', 'api-header', () =>
      delivered(
        'gh',
        [
          'api',
          '--hostname',
          'github.example.com',
          '/oracle',
          '-H',
          `X-Oracle: ${VALUE}`,
        ],
        (rs) => rs.some((r) => r.headers['x-oracle'] === VALUE),
        { env: { GH_TOKEN: 'ZEROHFAKEauth' } },
      ),
    );
    await add('az', 'rest-header-and-local-sku-rejection', async () => {
      const result = await delivered(
        'az',
        [
          'rest',
          '--skip-authorization-header',
          '--url',
          `http://127.0.0.1:${hp}/azure`,
          '--headers',
          `X-Oracle=${VALUE}`,
        ],
        (rs) => rs.some((r) => r.headers['x-oracle'] === VALUE),
      );
      const before = requests.length;
      const rejected = await run('az', [
        'rest',
        '--skip-authorization-header',
        '--url',
        `http://127.0.0.1:${hp}/azure`,
        '--sku.name',
        VALUE,
      ]);
      rejectedNormally(rejected);
      assert.equal(requests.length, before);
      return { ...result, skuOptionRejectedBeforeNetwork: true };
    });
    await add('docker', 'registry-login', async () => {
      const authReceived = (records, server) =>
        records.some((record) => {
          try {
            const auth = JSON.parse(record.body);
            return auth.password === VALUE && auth.serveraddress === server;
          } catch {
            return false;
          }
        });
      const env = { DOCKER_HOST: `tcp://127.0.0.1:${hp}` };
      const config = path.join(fixture.env.HOME, 'docker');
      const registry = `registry.example.com:${hp}`;
      const privateLogin = await delivered(
        'docker',
        [
          '--config',
          config,
          'login',
          registry,
          '-u',
          'fixture',
          '--password-stdin',
        ],
        (records) => authReceived(records, registry),
        { input: VALUE + '\n', env },
      );
      const hub = await delivered(
        'docker',
        ['--config', config, 'login', '-u', 'fixture', '--password-stdin'],
        (records) => authReceived(records, 'https://index.docker.io/v1/'),
        { input: VALUE + '\n', env },
      );
      return {
        ...privateLogin,
        defaultRegistryAddressRecorded: hub.delivered,
        privateRegistryAddressRecorded: true,
        proof: 'real Docker CLI Engine authentication requests',
      };
    });
    // Explicit kubeconfig paths are required to exist, even with CLI overrides.
    writeFileSync(
      path.join(fixture.root, 'empty-kubeconfig'),
      'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n',
    );
    await add('kubectl', 'api-token', () =>
      delivered(
        'kubectl',
        [
          '--kubeconfig',
          path.join(fixture.root, 'empty-kubeconfig'),
          '--server',
          `https://127.0.0.1:${tp}`,
          '--insecure-skip-tls-verify',
          '--token',
          VALUE,
          '--cache-dir',
          path.join(fixture.env.HOME, 'kube-cache'),
          '--request-timeout=5s',
          'get',
          '--raw=/oracle',
        ],
        (rs) => rs.some((r) => r.headers.authorization === 'Bearer ' + VALUE),
      ),
    );
    await add('helm', 'kube-token', () =>
      delivered(
        'helm',
        [
          '--kubeconfig',
          path.join(fixture.root, 'empty-kubeconfig'),
          '--kube-apiserver',
          `https://127.0.0.1:${tp}`,
          '--kube-insecure-skip-tls-verify',
          '--kube-token',
          VALUE,
          'list',
        ],
        (rs) => rs.some((r) => r.headers.authorization === 'Bearer ' + VALUE),
      ),
    );
    await add('aws', 's3-endpoint', () =>
      delivered(
        'aws',
        [
          '--endpoint-url',
          `http://127.0.0.1:${hp}`,
          '--no-sign-request',
          's3api',
          'list-objects-v2',
          '--bucket',
          VALUE,
        ],
        (rs) => rs.some((r) => r.path.includes(VALUE)),
        {
          env: {
            AWS_CONFIG_FILE: path.join(fixture.root, 'aws-config'),
            AWS_SHARED_CREDENTIALS_FILE: path.join(
              fixture.root,
              'aws-credentials',
            ),
            AWS_DEFAULT_REGION: 'us-east-1',
          },
        },
      ),
    );
    await add('gcloud', 'storage-endpoint', () =>
      delivered(
        'gcloud',
        [
          '--quiet',
          'storage',
          'buckets',
          'describe',
          `gs://${VALUE.toLowerCase()}`,
        ],
        (rs) =>
          rs.some((r) => r.path.toLowerCase().includes(VALUE.toLowerCase())),
        {
          env: {
            CLOUDSDK_CONFIG: path.join(fixture.env.HOME, 'gcloud'),
            CLOUDSDK_AUTH_DISABLE_CREDENTIALS: 'true',
            CLOUDSDK_CORE_MAX_RETRIES: '0',
            CLOUDSDK_API_ENDPOINT_OVERRIDES_STORAGE: `http://127.0.0.1:${hp}/`,
          },
          timeout: 30000,
        },
      ),
    );
    // Byte receiver for netcat and OpenSSL. It is a real TLS endpoint for s_client.
    const raw = [];
    const tcp = net.createServer((s) => {
      let bytes = Buffer.alloc(0);
      s.on('data', (b) => {
        bytes = Buffer.concat([bytes, b]);
        if (bytes.includes(Buffer.from(VALUE))) {
          raw.push(bytes);
          s.end();
        }
      });
    });
    const np = await keep(tcp);
    await add('nc', 'stdin-and-rejection', async () => {
      const before = raw.length;
      const r = await run(
        'nc',
        ['-N', '-w', '2', 'nc.example.com', String(np)],
        { input: VALUE },
      );
      assert.ok(
        Number.isInteger(r.status) && r.signal === null,
        'nc must terminate normally',
      );
      assert.ok(raw.slice(before).some((b) => b.toString() === VALUE));
      const bad = await run('nc', ['--zeroh-invalid-option']);
      rejectedNormally(bad);
      return { exitStatus: r.status, delivered: true, rejected: true };
    });
    await add('openssl', 'tls-input-local-passphrase-and-sni', async () => {
      const result = await delivered(
        'openssl',
        [
          's_client',
          '-quiet',
          '-connect',
          `127.0.0.1:${tp}`,
          '-servername',
          VALUE + '.example.com',
          '-pass',
          'pass:' + VALUE,
        ],
        (rs) => rs.some((r) => r.body === VALUE),
        {
          input: `POST /openssl HTTP/1.1\r\nHost: fixture.example.com\r\nContent-Length: ${VALUE.length}\r\nConnection: close\r\n\r\n${VALUE}`,
        },
      );
      // The passphrase option is local: a second request without that value has no bytes of it.
      const clientKey = path.join(fixture.root, 'encrypted-client-key');
      const clientCert = path.join(fixture.root, 'client-cert');
      assert.equal(
        (
          await run('openssl', [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-keyout',
            clientKey,
            '-out',
            clientCert,
            '-passout',
            'pass:' + VALUE,
            '-subj',
            '/CN=client.example.com',
            '-days',
            '1',
          ])
        ).status,
        0,
        'encrypted local key generation',
      );
      const local = await delivered(
        'openssl',
        [
          's_client',
          '-quiet',
          '-connect',
          `127.0.0.1:${tp}`,
          '-servername',
          'fixture.example.com',
          '-cert',
          clientCert,
          '-key',
          clientKey,
          '-pass',
          'pass:' + VALUE,
        ],
        (rs) => rs.every((r) => !JSON.stringify(r).includes(VALUE)),
        {
          input:
            'GET /local-key HTTP/1.1\r\nHost: fixture.example.com\r\nConnection: close\r\n\r\n',
        },
      );
      assert.ok(sni.includes(VALUE + '.example.com'), 'SNI not delivered');
      assert.ok(
        peerSubjects.includes('client.example.com'),
        'encrypted client key was not used',
      );
      const beforeWrong = requests.length;
      const wrong = await run('openssl', [
        's_client',
        '-connect',
        `127.0.0.1:${tp}`,
        '-cert',
        clientCert,
        '-key',
        clientKey,
        '-pass',
        'pass:ZEROHFAKEwrong',
      ]);
      rejectedNormally(wrong);
      assert.equal(
        requests.length,
        beforeWrong,
        'wrong passphrase reached HTTP',
      );
      return {
        ...result,
        passphraseLocal: local.delivered,
        sniDelivered: true,
        encryptedKeyUsed: true,
        wrongPassphraseRejected: true,
      };
    });
    // Database protocol fixtures send just enough handshake to observe authentication.
    await add('redis-cli', 'auth', async () => {
      const wire = [];
      const p = await keep(
        net.createServer((s) => {
          s.on('data', (b) => {
            wire.push(b);
            s.write('+OK\r\n');
          });
        }),
      );
      const r = await run('redis-cli', [
        '-h',
        '127.0.0.1',
        '-p',
        String(p),
        '-a',
        VALUE,
        'ping',
      ]);
      assert.ok(Buffer.concat(wire).includes(Buffer.from(VALUE)));
      assert.ok(
        Number.isInteger(r.status) && r.signal === null,
        'raw effect client must terminate normally',
      );
      return { exitStatus: r.status, delivered: true };
    });
    await add('psql', 'password', async () => {
      const wire = [];
      const p = await keep(
        net.createServer((s) => {
          let startup = true;
          s.on('data', (b) => {
            wire.push(b);
            if (startup) {
              startup = false;
              s.write(Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 3]));
            } else s.end();
          });
        }),
      );
      const r = await run(
        'psql',
        [
          '-X',
          '-h',
          '127.0.0.1',
          '-p',
          String(p),
          '-U',
          'fixture',
          '-d',
          'fixture',
          '-c',
          'select 1',
        ],
        {
          env: {
            PGPASSWORD: VALUE,
            PGSSLMODE: 'disable',
            PGCONNECT_TIMEOUT: '3',
            PGPASSFILE: path.join(fixture.root, 'pgpass'),
          },
        },
      );
      assert.ok(Buffer.concat(wire).includes(Buffer.from(VALUE)));
      assert.ok(
        Number.isInteger(r.status) && r.signal === null,
        'database client must terminate normally',
      );
      return { exitStatus: r.status, passwordDelivered: true };
    });
    await add('mysql', 'hashed-password', async () => {
      const wire = [];
      const p = await keep(
        net.createServer((s) => {
          const caps = 0x00088201;
          const greeting = Buffer.concat([
            Buffer.from([10]),
            Buffer.from('8.0-fixture\0'),
            Buffer.from([1, 0, 0, 0]),
            Buffer.from('12345678\0'),
            Buffer.from([
              caps & 255,
              (caps >>> 8) & 255,
              33,
              2,
              0,
              (caps >>> 16) & 255,
              (caps >>> 24) & 255,
              21,
            ]),
            Buffer.alloc(10),
            Buffer.from('901234567890\0mysql_native_password\0'),
          ]);
          const header = Buffer.alloc(4);
          header.writeUIntLE(greeting.length, 0, 3);
          s.write(Buffer.concat([header, greeting]));
          s.on('data', (b) => {
            wire.push(b);
            s.end();
          });
        }),
      );
      const r = await run(
        'mysql',
        [
          '--no-defaults',
          '--protocol=TCP',
          '-h',
          '127.0.0.1',
          '-P',
          String(p),
          '-u',
          'fixture',
          '--password=' + VALUE,
          '--connect-timeout=3',
          '-e',
          'select 1',
        ],
        {
          env: {
            MYSQL_TEST_LOGIN_FILE: path.join(
              fixture.root,
              'absent-mylogin.cnf',
            ),
          },
        },
      );
      assert.ok(wire.length);
      const packet = Buffer.concat(wire);
      const payload = packet.subarray(4);
      const userEnd = payload.indexOf(0, 32);
      assert.ok(userEnd >= 32, 'MySQL auth username');
      const auth = payload.subarray(
        userEnd + 2,
        userEnd + 2 + payload[userEnd + 1],
      );
      const sha1 = (b) => createHash('sha1').update(b).digest();
      const stage1 = sha1(VALUE),
        stage2 = sha1(stage1);
      const digest = sha1(
        Buffer.concat([Buffer.from('12345678901234567890'), stage2]),
      );
      const expected = Buffer.from(
        stage1.map((byte, index) => byte ^ digest[index]),
      );
      assert.deepEqual(auth, expected, 'password-derived MySQL auth bytes');
      assert.ok(!packet.includes(Buffer.from(VALUE)));
      assert.ok(
        Number.isInteger(r.status) && r.signal === null,
        'database client must terminate normally',
      );
      return {
        exitStatus: r.status,
        handshakeObserved: true,
        passwordDerivedAuthDelivered: true,
        plaintextPasswordAbsent: true,
      };
    });
    const ssh = await sshEffects(fixture, run, installed, keep);
    results.push(...ssh.results);
    failures.push(...ssh.failures);
    return {
      results,
      failures,
      diagnostics,
      pending: results
        .filter((r) => r.status !== 'passed')
        .map((r) => `${r.program}/${r.id}: ${r.status}`),
      resolver:
        'fixture-owned LD_PRELOAD; static Go clients use loopback proxy or IP endpoints',
    };
  } finally {
    for (const s of sockets) s.destroy();
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    fixture.cleanup();
  }
}

async function sshEffects(fixture, run, installed, keep) {
  const results = [],
    failures = [];
  const wire = [];
  let connections = 0;
  const port = await keep(
    net.createServer((socket) => {
      connections++;
      socket.write('SSH-2.0-ZeroHFixture\r\n');
      socket.on('data', (b) => {
        wire.push(b);
        socket.end();
      });
    }),
  );
  const common = [
    '-F',
    '/dev/null',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=2',
    '-o',
    'IdentityAgent=none',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'IdentityFile=/dev/null',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'GlobalKnownHostsFile=/dev/null',
  ];
  for (const program of ['ssh', 'scp']) {
    if (!installed(program)) {
      results.push({
        program,
        id: 'loopback-handshake',
        status: 'ci-required',
        reason: 'program not installed',
      });
      continue;
    }
    try {
      const before = wire.length;
      const args =
        program === 'ssh'
          ? [
              ...common,
              '-p',
              String(port),
              '-o',
              'SendEnv=' + VALUE,
              '-l',
              'fixture',
              'ssh.example.com',
              'true',
            ]
          : [
              ...common,
              '-P',
              String(port),
              '-O',
              path.join(fixture.root, 'input'),
              'ssh.example.com:' + VALUE,
            ];
      writeFileSync(path.join(fixture.root, 'input'), VALUE);
      const r = await run(program, args);
      rejectedNormally(r);
      assert.ok(wire.length > before, 'SSH banner not delivered');
      assert.ok(
        !Buffer.concat(wire.slice(before)).includes(Buffer.from(VALUE)),
        'local option sent before authentication',
      );
      const beforeRejected = connections;
      const rejected = await run(program, [
        ...common,
        '-o',
        'ZeroHInvalidOption=yes',
        ...(program === 'ssh'
          ? ['-p', String(port), '127.0.0.1', 'true']
          : [
              '-P',
              String(port),
              path.join(fixture.root, 'input'),
              `127.0.0.1:${VALUE}`,
            ]),
      ]);
      rejectedNormally(rejected);
      assert.equal(
        connections,
        beforeRejected,
        'rejected SSH option reached network',
      );
      results.push({
        program,
        id: 'loopback-handshake',
        status: 'passed',
        exitStatus: r.status,
        handshakeObserved: true,
        valueAbsentBeforeAuthentication: true,
        rejected: true,
      });
      results.push({
        program,
        id: 'authenticated-delivery',
        status: 'ci-required',
        reason:
          'disposable account and real SSH server required; no real user home may be opened',
      });
    } catch {
      results.push({ program, id: 'loopback-handshake', status: 'failed' });
      failures.push(program + ': loopback handshake assertion failed');
    }
  }
  return { results, failures };
}
