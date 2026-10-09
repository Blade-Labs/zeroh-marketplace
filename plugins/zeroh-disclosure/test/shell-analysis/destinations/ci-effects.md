# Remaining destination-effect CI legs

Run `oracles.test.mjs` on the required Ubuntu/macOS/Windows and Node 22/26 legs.
No local availability result substitutes for one of those complete jobs. New
program fixtures are executable in `program-effects.mjs`; absent clients return
`ci-required`, and installed clients must satisfy received-byte assertions.
The Linux fixture compiles `loopback-guard.c` with the installed C compiler.
No dependency is installed by the harness. Static Go clients use only our
loopback proxy or literal loopback endpoints; the proxy never forwards upstream.

The current Linux effect fixtures cover wget post/config/rejection; Git HTTP
headers and remote-fetch URL bytes; gh API headers; Azure REST headers and invalid
SKU-option rejection; Docker's Engine login request (including registry address
and password, without a real engine/registry); nc stdin; OpenSSL application bytes,
SNI and local passphrase; SSH/SCP handshake and option rejection. Redis AUTH,
PostgreSQL cleartext-password challenge and MySQL native-password challenge
fixtures are authored but need installed clients. Kubernetes and Helm API bearer
headers, AWS unsigned S3 endpoint paths and gcloud's storage endpoint path are
also authored and await clients. MySQL disables default/login configuration;
Git ignores system/global configuration outside the isolated home. Successful
receipt of a request is distinct from a successful application operation: Git
and database fixtures intentionally stop after enough protocol to observe bytes.

Exact standalone invocation, inside the outer isolated environment:

```sh
node --input-type=module -e 'import {runProgramEffects} from "./apps/zeroh-marketplace/plugins/zeroh-disclosure/test/shell-analysis/destinations/program-effects.mjs"; const r=await runProgramEffects(); console.log(JSON.stringify(r)); process.exitCode=r.failures.length?1:0'
```

These fixtures establish the named effects, not every possible subcommand or
option spelling. Linux uses executable upstream nip.io Python, plus sslip.io
regexps extracted from its immutable Go source. No Go executable ran here. A Go
CI semantic leg should execute the vendored String2IPv4/NameToAAAA implementations
with only their standard-library/existing pinned dependencies. No DNS service
from the public internet is queried. New source-semantic corpus rows carry the
fixture ID and the independently established selected address.

## Authenticated SSH/SCP

`ci-effects.mjs` contains the real client/server fixture. The Ubuntu destination job provisions Bash, OpenSSH client/server and a disposable
fake account on its hosted runner. The fixture starts its own loopback-only sshd
through sudo; it does not use the runner's SSH service or any real account. Its fake account must be named `zerohfixture` (or a suffix of lowercase
letters/digits), have `/bin/bash` as its shell, and have its HOME below
`${TMPDIR}/zeroh-destination-tests/`. It must have no real user startup files, no
system SSH rc scripts, an unlocked fake account, and `/run/sshd` provided by the job. The fake home is owned by the fixture user
and the runner's group with mode 2770, so both delivery and received-file cleanup
work. Run only in the disposable CI job. Do not create an account or service on
a developer host.

The destination workflow provisions `zerohfixture` with HOME
`${TMPDIR}/zeroh-destination-tests/ssh-account/home` before starting the test. The
fixture reads that fake account's passwd record and refuses another HOME or
shell. It generates both keys locally, starts sshd using only its generated
config, disables PAM, password/interactive authentication and user rc scripts,
then asserts received SSH environment bytes and SCP file bytes. Client config,
identity agent, identities and known-host files are explicit. Received files
are removed in finally; delete the disposable account and home at job teardown.

```sh
ZEROH_SSH_FIXTURE_USER=zerohfixture \
ZEROH_SSH_FIXTURE_HOME=${TMPDIR}/zeroh-destination-tests/ssh-account/home \
node --input-type=module -e 'import {runSshAuthenticatedFixture} from "./apps/zeroh-marketplace/plugins/zeroh-disclosure/test/shell-analysis/destinations/ci-effects.mjs"; const r=await runSshAuthenticatedFixture(); console.log(JSON.stringify(r)); process.exitCode=r.status==="passed"?0:1'
```

Local handshake proof does not establish authenticated command or path delivery.
Actual authenticated runner evidence remains required; provisioning alone is not a pass.

## systemd-resolved search domain

This is root-owned disposable CI work and is never attempted locally. With
`ZEROH_DISPOSABLE_RESOLVED=1`, `ci-effects.mjs` enters `resolved-namespace.sh`
through sudo/unshare, creating private network, mount and PID namespaces. Its
links are loopback and `zeroh-dns0`, an unconnected dummy with `192.0.2.1/32`
and `noprefixroute`. systemd 255 regards a global DNS scope as offline without
an addressed, non-loopback link; the dummy supplies that state without a peer,
uplink, or external route. A private tmpfs `/run` holds the namespace's own D-Bus and
systemd-resolved; the host bus and resolver sockets are hidden. The fixture-owned
resolver configuration is bind-mounted only inside that mount namespace, with
`DNS=127.0.0.1`, empty `FallbackDNS=`, and `Domains` set to the fake corpus value
followed by `.example.com`. DNSSEC, DNS over TLS, LLMNR, multicast DNS and caching
are disabled, as are host `/etc/hosts` lookups; image drop-ins are hidden in the namespace. No host resolver file
or host service is changed. All namespace processes disappear at exit.

The executable fixture starts the authoritative NXDOMAIN UDP receiver on
127.0.0.1:53. Before querying it, it checks the exact interface set, dummy type
and address, no IPv4 main-table routes, and no IPv6 routes except dummy link-local.
It checks the service's network namespace against its own, the effective
upstream/search domain and absence of fallback DNS. It runs real
`resolvectl --search=yes query probe` through the private D-Bus and
asserts the composed query at the receiver. NXDOMAIN is an expected application
failure after successful destination delivery. The namespace startup and `--search` execution still need actual GitHub runner
validation; the fixture is not claimed as a local pass.

This query uses resolved's `ResolveHostname` API. It does not pass through libc,
nsswitch, or the `/etc/resolv.conf` stub path. The round 1 runner reached and
validated the configured DNS/search domain, then resolved's global scope rejected
the loopback-only network as offline before a packet was sent. Query failures now
report sanitized `resolvectl` stderr before stack frames can hide it.

```sh
ZEROH_DISPOSABLE_RESOLVED=1 node --input-type=module -e 'import {runResolvedSearchFixture} from "./apps/zeroh-marketplace/plugins/zeroh-disclosure/test/shell-analysis/destinations/ci-effects.mjs"; const r=await runResolvedSearchFixture(); console.log(JSON.stringify(r)); process.exitCode=r.status==="passed"?0:1'
```

The fixture tears down its namespaces and isolated home. Ubuntu records pending
unless explicit provisioning is supplied. macOS and Windows mark Linux program
effects, authenticated SSH/SCP and resolved as not applicable; their absence is
not a pending oracle. Their own required shell and wire oracles still apply.

## Hosted runner fixture repairs (2026-10-06)

No applicability or expected-effect rules changed in this repair. Ubuntu still
requires every installed client effect, authenticated SSH/SCP, and resolved.
macOS and Windows retain their existing Linux-only exclusions.

- Kubernetes/Helm use an existing minimal kubeconfig, with CLI endpoint and
  bearer overrides. An explicit nonexistent kubeconfig fails before a request.
- MySQL 8.0 does not implement `--no-login-paths` (introduced in 8.2). The fixture
  keeps `--no-defaults` and sets `MYSQL_TEST_LOGIN_FILE` to a nonexistent file
  inside its own isolated root. The native-password greeting and SHA-1 challenge
  assertion remain unchanged. The gcloud fixture disables retries and permits
  30 seconds for cold SDK startup; it still requires the loopback request.
- The resolved runtime directory is owned by `systemd-resolve`, matching the
  daemon's privilege drop. Failed readiness prints the private service log.
- SSH uses a readable public key in the disposable account's home and verbose
  private daemon logs. The disposable account joins the runner group to traverse
  runner-owned temporary ancestors; the fixture verifies key readability as that
  account before starting sshd. Provisioning supplies an invalid, non-locking fake password
  field; password and interactive authentication remain disabled. Both host and
  client keys are generated per fixture, and authenticated delivery is required.
- Windows runs `Git/usr/bin/bash.exe` directly. The `Git/bin/bash.exe` launcher
  prepends Git directories to PATH, which hid the fixture curl behind real curl.
  Native argv fixtures disable MSYS path conversion (`MSYS_NO_PATHCONV=1` and
  `MSYS2_ARG_CONV_EXCL=*`), preserving literal slash/colon arguments. Batch source
  uses CRLF and a quoted script path with verbatim cmd arguments, avoiding Node's
  CRT escaping of cmd command text. POSIX scripts keep LF.
- Native Windows ripgrep requires a PE preprocessor, so its fixture substitutes
  the absolute native path to `pre.exe` for `pre.sh`, with identical protected-write effect and obfuscated
  `--pre` spellings. No protection expectation is relaxed.
  Ripgrep 14's Windows executable resolver searches PATH for relative paths,
  including `./pre.exe`; adding the extension alone did not locate our program.
- `windows-tools.mjs` compiles the fixture console executable once with the
  preinstalled .NET Framework compiler. Windows PowerShell 5.1 is invoked through
  a native bridge when a fixture uses regular-file descriptors. The bridge now
  explicitly decodes Node's input as UTF-8, carries command source in UTF-8 BOM script files and gives the parser a
  private payload file read directly by `parse.ps1`. The child receives
  a closed stdin pipe; startup keeps `-NoProfile`, `-NonInteractive` and a
  process-only execution-policy bypass. The real edition/version is still probed first. Cold
  parser/hook timing includes bridge overhead; sample counts and limits stay fixed.
  The bridge also supplies missing application-data directories under isolated HOME.
  A Windows job object owns the bridge and descendants before child startup,
  so timing out the bridge terminates PowerShell and its native children too.
  Cleanup permits bounded retries while those handles close, without changing
  directory ACLs or permissions. This addresses the stranded child/cwd path
  likely responsible for the Node 26 cleanup EPERM. The Windows-only regression requires the
  actual child to start, be killed on timeout, and release the private root.
- PowerShell restoration uses the native curl wrapper on Windows. Its pinned
  loopback arguments are supplied directly to curl, preserving the empty proxy
  argument that Windows PowerShell 5.1 drops during native argument binding.
- If printer setup fails after HTTP/TLS listeners open, the request fixture closes
  both listeners before rethrowing. This fixes the Windows Node 22 post-failure
  cancellation at the job limit; the constructor-failure regression checks cleanup.
- The collector explicitly selects four differential workers on every platform,
  logs oracle stages and collection durations, and stores collection timings in
  the report. Cold benchmarks finish before the worker pool starts. Windows
  recompilation and accidental real-client DNS retries are removed; a complete
  hosted timing remains required to confirm the estimated duration.

`hosted-fixtures.test.mjs` exercises kubeconfig/login-file setup using loopback
client stubs on Linux. It is fixture-logic evidence, not installed-client proof.
Its Windows native quoting/stdin checks run only on Windows. No root service or
disposable account is provisioned on a developer machine.

Round 2 regressions also exercise both ripgrep protected writes, real 5.1 parser
stdin, Unicode/quotes, spaced script paths, explicit command/script exit status,
and timeout child cleanup. These still require hosted Windows execution. A
Linux skip is not evidence that they pass. No gate threshold or sample count changes.

Round 4 adds PID-tagged native stdin stages and AST statement offsets before/after
each top-level PowerShell statement when `ZEROH_ORACLE_BRIDGE_DIAGNOSTICS` is set.
This includes the alias-removal prelude and the dot-sourced parser/corpus body;
diagnostics contain no source or argument values. The bridge snapshots only its
child tree on timeout and kills it before the caller's timeout (a cleanup
margin of `min(10000, callerTimeout / 2)` milliseconds, with a minimum child
budget of 100 milliseconds). Explicit command exits and the original final command status
remain authoritative. The current PowerShell fixture bodies do not inspect
intermediate `$?`; native `$LASTEXITCODE` markers remain untouched.

Printers read real UTF-8 stdin from redirected files/pipes, and record empty stdin
for an unredirected console. Every PowerShell argv corpus row expects empty
stdin; the stdin-bearing nc and heredoc cases belong to bash/zsh. Additional
Windows regressions require both a bare native printer and a native printer fed
by a PowerShell pipeline to complete, so skipping console input cannot erase
actual pipeline bytes. Parser stdin has already reached the bridge (440 decoded
characters in both round 4 parser logs); reading the payload directly removes
the dependency on ConsoleHost retaining a substituted `Console.In` reader.

Sources: [runner image from the Ubuntu logs](https://github.com/actions/runner-images/blob/ubuntu24/20260927.320/images/ubuntu/Ubuntu2404-Readme.md),
[runner image from the Windows logs](https://github.com/actions/runner-images/blob/win22/20260927.320/images/windows/Windows2022-Readme.md),
[Git launcher behavior](https://gitforwindows.org/git-wrapper.html),
[MSYS argument conversion](https://www.msys2.org/docs/filesystem-paths/),
[MySQL option introduction](https://dev.mysql.com/blog-archive/new-client-option-no-login-paths-turn-off-login-path-file-processing/),
[MySQL login-file override](https://dev.mysql.com/doc/refman/8.0/en/environment-variables.html),
and [systemd 255 resolved startup](https://github.com/systemd/systemd/blob/v255/src/resolve/resolved.c).
Round 2 references: [global-scope network check](https://github.com/systemd/systemd/blob/v255/src/resolve/resolved-dns-scope.c),
[loopback exclusion](https://github.com/systemd/systemd/blob/v255/src/resolve/resolved-link.c),
[ripgrep 14 executable resolution](https://github.com/BurntSushi/ripgrep/blob/14.1.0/crates/cli/src/decompress.rs),
[Windows PowerShell CLI](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1),
[PowerShell script encoding](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-5.1),
and [Windows job lifetime](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
