// SPDX-License-Identifier: AGPL-3.0-only

// Keep the default Anthropic URL intact while every connection stays on
// loopback: a throwaway trusted certificate and a fake CONNECT proxy.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';

export const HAS_OPENSSL =
  spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;

export async function fakeDefaultUpstream(t, root) {
  const directory = path.join(root, 'default-tls');
  mkdirSync(directory, { recursive: true });
  const certificate = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-subj',
      '/CN=api.anthropic.com',
      '-addext',
      'subjectAltName=DNS:api.anthropic.com',
      '-keyout',
      path.join(directory, 'server.key'),
      '-out',
      path.join(directory, 'server.pem'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(certificate.status, 0, 'fake TLS certificate generation failed');
  const seen = [];
  const sockets = new Set();
  const track = (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  };
  const upstream = https.createServer(
    {
      key: readFileSync(path.join(directory, 'server.key')),
      cert: readFileSync(path.join(directory, 'server.pem')),
    },
    (request, response) => {
      request.resume();
      request.on('end', () => {
        seen.push(request.url);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
      });
    },
  );
  const proxy = http.createServer((_request, response) => {
    response.writeHead(405);
    response.end();
  });
  upstream.on('connection', track);
  proxy.on('connection', track);
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    upstream.close();
    proxy.close();
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  proxy.on('connect', (request, socket, head) => {
    if (request.url !== 'api.anthropic.com:443') {
      socket.destroy();
      return;
    }
    const target = net.connect(upstream.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      target.write(head);
      target.pipe(socket);
      socket.pipe(target);
    });
    track(target);
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  return {
    seen,
    environment: {
      HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`,
      NO_PROXY: 'localhost,127.0.0.1',
      NODE_EXTRA_CA_CERTS: path.join(directory, 'server.pem'),
    },
  };
}
