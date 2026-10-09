// SPDX-License-Identifier: AGPL-3.0-only

// CI-only effects whose isolation needs a disposable system service/account.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import {
  closeSync,
  openSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
  readlinkSync,
  existsSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnFile, safeDiagnosticText } from '../parsers/process-files.mjs';
import { freshEnvironment, TEST_ROOT } from './isolation.mjs';
import { VALUE } from './corpus.mjs';

const q = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
export async function runSshAuthenticatedFixture() {
  const username = process.env.ZEROH_SSH_FIXTURE_USER;
  const home = process.env.ZEROH_SSH_FIXTURE_HOME;
  if (!username || !home)
    return {
      status: 'ci-required',
      reason: 'preprovisioned disposable SSH account required',
    };
  assert.match(username, /^zerohfixture[a-z0-9]*$/u, 'disposable SSH username');
  assert.ok(
    path.resolve(home).startsWith(TEST_ROOT + path.sep),
    'SSH account home must be isolated',
  );
  const account = readFileSync('/etc/passwd', 'utf8')
    .split('\n')
    .find((line) => line.startsWith(username + ':'))
    ?.split(':');
  assert.equal(account?.[5], home, 'refuse real account home');
  assert.equal(account?.[6], '/bin/bash', 'fixture account shell must be Bash');
  const f = freshEnvironment('ssh-auth');
  chmodSync(f.root, 0o755);
  const run = (program, args, extra = {}) =>
    spawnFile(program, args, {
      cwd: f.root,
      env: { ...f.env, ...extra },
      timeout: 10000,
    });
  let daemon, fd;
  try {
    const key = path.join(f.root, 'clientkey'),
      host = path.join(f.root, 'hostkey');
    for (const file of [key, host])
      assert.equal(
        (await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', file]))
          .status,
        0,
        'fixture key generation',
      );
    // sshd reads authorized keys as the disposable user. Put the public key
    // in that user's traversable home, not in runner-private parent directories.
    const authorized = path.join(home, 'authorized_keys');
    writeFileSync(authorized, readFileSync(key + '.pub'), { mode: 0o644 });
    chmodSync(authorized, 0o644);
    assert.equal(
      (await run('sudo', ['-n', '-u', username, 'test', '-r', authorized]))
        .status,
      0,
      'disposable account must be able to read its authorized key',
    );
    const reserve = net.createServer();
    await listen(reserve);
    const port = reserve.address().port;
    await new Promise((r) => reserve.close(r));
    const config = path.join(f.root, 'sshd_config');
    writeFileSync(
      config,
      `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${host}\nPidFile ${f.root}/sshd.pid\nAuthorizedKeysFile ${authorized}\nStrictModes no\nUsePAM no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nPermitUserRC no\nAllowUsers ${username}\nAcceptEnv ZEROH_ORACLE\nLogLevel VERBOSE\nSubsystem sftp internal-sftp\n`,
    );
    const located = await run('/bin/sh', ['-c', 'command -v sshd']);
    assert.equal(located.status, 0, 'sshd required');
    fd = openSync(path.join(f.root, 'sshd.log'), 'w');
    daemon = spawn(
      'sudo',
      ['-n', located.stdout.trim(), '-D', '-e', '-f', config],
      {
        env: f.env,
        stdio: ['ignore', fd, fd],
      },
    );
    const ready = await new Promise((resolve) => {
      const deadline = Date.now() + 3000;
      const probe = () => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => {
          socket.destroy();
          if (Date.now() < deadline) setTimeout(probe, 30);
          else resolve(false);
        });
      };
      probe();
    });
    assert.equal(ready, true, 'disposable SSH listener');
    const common = [
      '-F',
      '/dev/null',
      '-i',
      key,
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentityAgent=none',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'GlobalKnownHostsFile=/dev/null',
    ];
    const out = path.join(home, 'ssh-received');
    const sent = await run(
      'ssh',
      [
        ...common,
        '-o',
        'SendEnv=ZEROH_ORACLE',
        '-p',
        String(port),
        '-l',
        username,
        '127.0.0.1',
        `printf %s "$ZEROH_ORACLE" > ${q(out)}`,
      ],
      { ZEROH_ORACLE: VALUE },
    );
    assert.equal(sent.status, 0, 'SSH authenticated delivery');
    assert.equal(readFileSync(out, 'utf8'), VALUE);
    const input = path.join(f.root, 'input');
    writeFileSync(input, VALUE);
    const remote = path.join(home, 'scp-received');
    const copied = await run('scp', [
      ...common,
      '-o',
      `User=${username}`,
      '-P',
      String(port),
      '-O',
      input,
      `127.0.0.1:${remote}`,
    ]);
    assert.equal(copied.status, 0, 'SCP authenticated transfer');
    assert.equal(readFileSync(remote, 'utf8'), VALUE);
    return {
      status: 'passed',
      sshDelivered: true,
      scpDelivered: true,
      sshExitStatus: sent.status,
      scpExitStatus: copied.status,
    };
  } catch (error) {
    const log = path.join(f.root, 'sshd.log');
    if (existsSync(log))
      error.oracleCommands = [
        {
          program: 'sshd',
          status: daemon?.exitCode ?? null,
          stderr: safeDiagnosticText(readFileSync(log, 'utf8')),
        },
      ];
    throw error;
  } finally {
    if (daemon) {
      daemon.kill();
      await new Promise((r) => {
        if (daemon.exitCode !== null || daemon.signalCode !== null) r();
        else daemon.once('exit', r);
      });
    }
    if (fd !== undefined) closeSync(fd);
    for (const name of ['ssh-received', 'scp-received', 'authorized_keys'])
      rmSync(path.join(home, name), { force: true });
    f.cleanup();
  }
}

export async function runResolvedSearchFixture() {
  if (process.env.ZEROH_DISPOSABLE_RESOLVED !== '1')
    return {
      status: 'ci-required',
      reason:
        'root-owned disposable systemd-resolved namespace required; never attempted on developer host',
    };
  if (process.env.ZEROH_RESOLVED_NAMESPACE_READY !== '1') {
    const fixture = freshEnvironment('resolved-namespace');
    try {
      const result = await spawnFile(
        'sudo',
        [
          '-n',
          '--preserve-env=TMPDIR,HOME',
          'unshare',
          '--net',
          '--mount',
          '--pid',
          '--fork',
          '--mount-proc',
          '--kill-child',
          '/bin/bash',
          fileURLToPath(new URL('./resolved-namespace.sh', import.meta.url)),
          process.execPath,
        ],
        { env: fixture.env, cwd: fixture.root, timeout: 60000 },
      );
      assert.equal(result.status, 0, 'disposable resolved namespace fixture');
      return JSON.parse(result.stdout);
    } finally {
      fixture.cleanup();
    }
  }
  // Provisioning owns the service and its resolver configuration in the disposable
  // namespace; this function only queries it and records our loopback DNS wire.
  const f = freshEnvironment('resolved-search');
  let socket;
  try {
    assert.deepEqual(
      Object.keys(os.networkInterfaces()).sort(),
      ['lo', 'zeroh-dns0'],
      'resolver namespace must have only loopback and its unconnected dummy',
    );
    const dummy = os.networkInterfaces()['zeroh-dns0'];
    assert.deepEqual(
      dummy
        .filter((address) => address.family === 'IPv4')
        .map((address) => address.cidr),
      ['192.0.2.1/32'],
      'dummy must have only its documentation address',
    );
    const links = await spawnFile('ip', ['-json', '-details', 'link', 'show'], {
      env: f.env,
      cwd: f.root,
      timeout: 5000,
    });
    assert.equal(links.status, 0, 'namespace link inspection');
    assert.equal(
      JSON.parse(links.stdout).find((link) => link.ifname === 'zeroh-dns0')
        ?.linkinfo?.info_kind,
      'dummy',
      'fixture link must discard traffic, never have a peer',
    );
    for (const family of ['-4', '-6']) {
      const routes = await spawnFile(
        'ip',
        [family, 'route', 'show', 'table', 'main'],
        {
          env: f.env,
          cwd: f.root,
          timeout: 5000,
        },
      );
      assert.equal(routes.status, 0, 'namespace route inspection');
      assert.ok(
        routes.stdout
          .split('\n')
          .every(
            (route) =>
              !route.trim() ||
              (family === '-6' && /^fe80::\/64 dev zeroh-dns0 /u.test(route)),
          ),
        'namespace must have no route beyond loopback or dummy link-local',
      );
    }
    const run = (args) =>
      spawnFile('resolvectl', args, { env: f.env, cwd: f.root, timeout: 5000 });
    const pids = await spawnFile('pgrep', ['-x', 'systemd-resolve'], {
      env: f.env,
      cwd: f.root,
      timeout: 5000,
    });
    assert.equal(
      pids.status,
      0,
      'disposable systemd-resolved process required',
    );
    for (const pid of pids.stdout.trim().split(/\s+/u))
      assert.equal(
        readlinkSync(`/proc/${pid}/ns/net`),
        readlinkSync('/proc/self/ns/net'),
        'resolver must share isolated namespace',
      );
    const dns = await run(['dns']),
      domains = await run(['domain']),
      status = await run(['status']);
    assert.equal(dns.status, 0);
    assert.equal(domains.status, 0);
    assert.equal(status.status, 0);
    const addresses = dns.stdout.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu) ?? [];
    assert.deepEqual(
      [...new Set(addresses)],
      ['127.0.0.1'],
      'resolver upstream must be our listener',
    );
    assert.ok(
      domains.stdout
        .toLowerCase()
        .includes(VALUE.toLowerCase() + '.example.com'),
      'search suffix provisioning',
    );
    assert.ok(
      !/Fallback DNS Servers:/u.test(status.stdout),
      'fallback DNS must be disabled',
    );
    socket = dgram.createSocket('udp4');
    const queries = [];
    socket.on('message', (packet, peer) => {
      let at = 12;
      const parts = [];
      while (packet[at]) {
        const n = packet[at++];
        parts.push(packet.subarray(at, at + n).toString('ascii'));
        at += n;
      }
      queries.push(parts.join('.'));
      const response = Buffer.from(packet.subarray(0, at + 5));
      response.writeUInt16BE(0x8183, 2);
      response.writeUInt16BE(0, 6);
      response.writeUInt16BE(0, 8);
      response.writeUInt16BE(0, 10);
      socket.send(response, peer.port, peer.address);
    });
    await new Promise((r, j) => {
      socket.once('error', j);
      socket.bind(53, '127.0.0.1', r);
    });
    const result = await spawnFile(
      'resolvectl',
      ['--search=yes', 'query', 'probe'],
      { env: f.env, cwd: f.root, timeout: 10000 },
    );
    if (
      !queries.some(
        (q) => q.toLowerCase() === `probe.${VALUE.toLowerCase()}.example.com`,
      )
    ) {
      throw Object.assign(
        new Error('systemd-resolved composed query missing'),
        {
          oracleCommands: [
            {
              program: 'resolvectl',
              status: result.status,
              stderr: safeDiagnosticText(result.stderr || result.error?.code),
            },
          ],
        },
      );
    }
    return {
      status: 'passed',
      searchComposed: true,
      exitStatus: result.status,
    };
  } finally {
    try {
      socket?.close();
    } catch {}
    f.cleanup();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv[2] !== '--resolved-namespace-fixture')
    throw new Error('explicit resolved namespace fixture mode required');
  try {
    console.log(JSON.stringify(await runResolvedSearchFixture()));
  } catch (error) {
    // Keep the actual query failure ahead of any stack frames in the collector's
    // bounded diagnostics. Query names and fake restored values are redacted.
    console.error(safeDiagnosticText(error.message));
    for (const command of error.oracleCommands ?? [])
      console.error(
        `${command.program} exit=${command.status}: ${command.stderr}`,
      );
    process.exitCode = 1;
  }
}
