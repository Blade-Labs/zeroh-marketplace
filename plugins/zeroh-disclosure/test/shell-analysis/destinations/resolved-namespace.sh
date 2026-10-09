#!/bin/bash
# Entered only by the Ubuntu CI fixture through sudo/unshare. /run and the
# resolver configuration exist only in this private mount/network/PID namespace.
set -euo pipefail
node_executable="$1"
fixture_dir="$(cd "$(dirname "$0")" && pwd)"
mount --make-rprivate /
mount -t tmpfs tmpfs /run
mkdir -p /run/dbus /run/systemd/resolve
# The daemon drops to systemd-resolve; a hand-created /run lacks systemd's
# RuntimeDirectory ownership. It must be writable by that service account.
chown systemd-resolve:systemd-resolve /run/systemd/resolve
ip link set lo up
# resolved's global DNS scope treats a namespace with only lo as offline.
# A dummy link has carrier and a documentation address but no peer or uplink.
# No main-table routes are installed; every DNS packet still goes to loopback.
ip link add zeroh-dns0 type dummy
ip address add 192.0.2.1/32 dev zeroh-dns0 noprefixroute
ip link set zeroh-dns0 up
test -z "$(ip -4 route show table main)"
test -z "$(ip -6 route show default)"
dbus-daemon --system --fork --nopidfile
"$node_executable" --input-type=module - "$fixture_dir/corpus.mjs" <<'NODE' > /run/resolved.conf
import { pathToFileURL } from 'node:url';
const { VALUE } = await import(pathToFileURL(process.argv[2]));
console.log(`[Resolve]\nDNS=127.0.0.1\nFallbackDNS=\nDomains=${VALUE.toLowerCase()}.example.com\nDNSSEC=no\nDNSOverTLS=no\nLLMNR=no\nMulticastDNS=no\nCache=no\nReadEtcHosts=no`);
NODE
mount --bind /run/resolved.conf /etc/systemd/resolved.conf
# Prevent image-owned drop-ins from supplying an external upstream.
for directory in /etc/systemd/resolved.conf.d /usr/lib/systemd/resolved.conf.d /usr/local/lib/systemd/resolved.conf.d; do
  if [ -d "$directory" ]; then mount -t tmpfs tmpfs "$directory"; fi
done
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket
export ZEROH_DISPOSABLE_RESOLVED=1 ZEROH_RESOLVED_NAMESPACE_READY=1
/usr/lib/systemd/systemd-resolved > /run/resolved.log 2>&1 &
resolver_pid=$!
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    # Startup logs are fixture-owned and contain no query or credential values.
    head -n 5 /run/resolved.log >&2
  fi
  kill "$resolver_pid" 2>/dev/null || true
  wait "$resolver_pid" 2>/dev/null || true
}
trap cleanup EXIT
ready=false
for attempt in {1..100}; do
  if resolvectl status >/dev/null 2>&1; then ready=true; break; fi
  sleep 0.1
done
test "$ready" = true
"$node_executable" "$fixture_dir/ci-effects.mjs" --resolved-namespace-fixture
