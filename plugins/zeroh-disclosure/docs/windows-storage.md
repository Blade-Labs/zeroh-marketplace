# Windows storage permissions

Windows `ZEROH_HOME` ACL hardening is a known gap. ZeroH makes one bounded,
synchronous best-effort attempt in loader preflight, before any worker exists.
If it cannot confirm the permissions, private writes, ordinary prompts,
sensitive prompts, tool calls and tool output continue as in 1.0, under the
configured uncertainty policy. ACL failure adds no content refusal.

SessionStart shows one concise notice per session, including across `/compact`
and resume. Prompt hooks do not repeat it. An unwritable session cannot retain
notice history across separate processes.

> ZeroH could not confirm its storage folder permissions on Windows (known limitation); private storage and masking continue as in 1.0.

`/zeroh-disclosure:status` distinguishes **not yet checked**, **not confirmed**,
**root secured; children may still carry earlier permissions**, and
**secured with Windows permissions**. The root-secured status confirms only
the root DACL after interrupted propagation, not every existing child's ACL.
A missing or old marker alone means
not yet checked. `.acl-status.json` records a directory-bound unsuccessful check
for status only; it never delays or suppresses another process's attempt.
Only verified read-back can create the directory-bound v3 `.acl-protected`
marker. Replacing the folder invalidates copied markers and diagnostic records.

The total preflight budget is at most 1.8 seconds and at most one third of the
remaining hook decision deadline. Each ACL child gets at most
500 ms and the remaining total budget. If the budget expires, ZeroH kills the
child, including a restore still propagating permissions. A root read-back does
not prove that every existing child finished inheriting permissions. Interrupted
propagation, reboot or logoff can leave children with earlier inherited entries;
this is part of the accepted known gap. There is no background or detached
apply, apply stamp, cross-process refusal backoff, or retained restore input.
Every transaction cleans up its `zeroh-acl-*` temporary directory.

ZeroH resolves `whoami.exe` and `icacls.exe` under System32 and gives both children
System32 as their working directory. It reads the current SID, saves the DACL,
and, if necessary, restores a UTF-16LE descriptor containing the folder basename,
CRLF, `D:P(A;OICI;FA;;;<SID>)(A;OICI;FA;;;SY)` and CRLF. It preserves the installed
`icacls /save` BOM convention. Restore replaces the root DACL without a
reset-first window. Read-back requires the protected flag and exactly the
current user and SYSTEM with inheritable full control.

`LA` and `LG` aliases require a local `S-1-5-21-…` account SID with RID 500 or
501 respectively and a matching local account authority. Where available,
`COMPUTERNAME` supplies the NetBIOS spelling. If it differs from the OS-reported
hostname, ZeroH cross-checks it with the OS through the static PowerShell
expression `[Environment]::MachineName`, within the same budget and neutral cwd.
If that query fails or times out, ZeroH cannot verify `LA`/`LG` aliases; it
can still restore and verify permissions using the exact numeric user SID.
An arbitrary environment value cannot authorize a domain account. Service aliases match only their exact
well-known user SIDs; group and domain-relative aliases cannot replace the user.

Workers never run ACL subprocesses. An unconfirmed home still receives private
writes. An uncreatable or offline home keeps the ordinary not-writable fallback:
an in-memory key, ephemeral sessions and the configured uncertainty policy.
Windows temporary sessions stay in memory without trying another ACL command.
Uninstall heartbeat and cleanup can continue even when home confirmation fails.

Optional hook subprocesses use a private host started before workers, lazily
for SessionStart, UserPromptSubmit, or PDF extraction with `pdftotext`. The host
and proxy daemon use `%SystemRoot%`, or the user's home, as a neutral working
directory. Runtime, configuration and file arguments are resolved explicitly.
Host loss or absence produces ENOSYS/dead-host handling and an optional-work
notice; an ordinary command error does not mean the host is unavailable.
Unix retains its existing subprocess and loader paths.

The owner's direction is to move the ZeroH folder outside the model sandbox
when using OpenClaw with zeroh-policy, so model access to private storage is
excluded by the sandbox design. Until that design is implemented, Windows
folder ACL confirmation remains best effort and is not a security guarantee.

The descriptor format follows the Microsoft NTFS backup/restore format and
`icacls /save` and parent-relative `/restore` conventions. Native Windows CI
remains the check of the installed tool's bytes, permission propagation and
Node crash behavior.

## Known limitation: Node 26 on Windows

Node 26 on Windows can rarely crash inside V8 (about 0.2% of hook calls in
the WIN11 probe). That hook call is lost: the hook process itself ends, so
Claude Code continues without ZeroH's check for that event. Nothing is
masked, no "not protected" notice is shown, and `uncertain block` does not
apply to it. Observed exits include
`0xC0000005` and `0x80000003`, with a V8 JIT failure
(`V8_Fatal: Check failed: is_int8(disp)`). This is an accepted known gap;
the product does not retry the call or work around V8. Recommend **Node 22
LTS on Windows**; the same probes observed no crashes on Node 22.
