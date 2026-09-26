// SPDX-License-Identifier: AGPL-3.0-only

// Starts the proxy daemon at login: a launchd agent on macOS, a systemd user
// unit on Linux, a per-user scheduled task on Windows.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { windowsSystemTool, writePrivateFile } from './private-fs.js';
import { proxyPaths } from './proxy-state.js';

export const SERVICE_ID = 'zeroh-disclosure-proxy';
const LAUNCH_LABEL = `com.bladelabs.${SERVICE_ID}`;
const TASK_NAME = 'ZeroH Disclosure Proxy';

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function quoted(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

// One argument quoted for a Windows command line (CommandLineToArgvW rules):
// backslashes are literal except before a quote, so only a run of them that
// precedes a `"` or the closing quote is doubled.
export function windowsArgument(value) {
  const text = String(value);
  if (text && !/[\s"]/u.test(text)) return text;
  let out = '"';
  let slashes = 0;
  for (const char of text) {
    if (char === '\\') {
      slashes += 1;
      continue;
    }
    if (char === '"') {
      out += '\\'.repeat(slashes * 2 + 1) + '"';
    } else {
      out += '\\'.repeat(slashes) + char;
    }
    slashes = 0;
  }
  return `${out}${'\\'.repeat(slashes * 2)}"`;
}

// The scheduled task runs a console program at logon. Started directly,
// node.exe would open a console window, and closing it would stop the proxy.
// conhost.exe --headless (Windows 10 1809 and later) gives it a console that
// is never shown.
export function windowsHeadlessCommand(command, env = process.env) {
  return {
    executable: windowsSystemTool('conhost.exe', env),
    args: ['--headless', command.executable, ...command.args],
  };
}

function realpathOr(file) {
  try {
    return realpathSync(file);
  } catch {
    return null;
  }
}

// The Node the login item starts: the `node` on the registering PATH that is
// this very binary, so a stable link (/opt/homebrew/bin/node,
// /usr/local/bin/node, C:\Program Files\nodejs\node.exe as nvm-windows
// links it) is kept rather than a versioned path that `brew cleanup` or
// `nvm uninstall` removes (LP-B7). Else this process's own binary.
export function stableNodePath({
  env = process.env,
  platform = process.platform,
  execPath = process.execPath,
  realpath = realpathOr,
} = {}) {
  const pathImpl = platform === 'win32' ? path.win32 : path.posix;
  const binary = realpath(execPath);
  const names = platform === 'win32' ? ['node.exe'] : ['node'];
  const entries = String(env.PATH || env.Path || '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean);
  for (const entry of entries) {
    for (const name of names) {
      const candidate = pathImpl.join(entry.replace(/^"|"$/gu, ''), name);
      if (binary && realpath(candidate) === binary) return candidate;
    }
  }
  return execPath;
}

function commandFor({ runtime, config, nodePath = stableNodePath() }) {
  return {
    executable: nodePath,
    args: [path.join(runtime, 'bin', 'proxy-daemon.mjs'), config],
  };
}

// A login item can only run where something starts it: on Linux a systemd
// user manager, or else a desktop session that reads XDG autostart files.
// A console, SSH or container session has neither, and WSL runs no
// autostart (LP-B3).
export function graphicalSession(env = process.env) {
  if (isWsl(env)) return false;
  return Boolean(
    env.XDG_CURRENT_DESKTOP ||
    env.DESKTOP_SESSION ||
    env.WAYLAND_DISPLAY ||
    env.DISPLAY,
  );
}

function isWsl(env) {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    return /microsoft/iu.test(
      readFileSync('/proc/sys/kernel/osrelease', 'utf8'),
    );
  } catch {
    return false;
  }
}

// A command that starts nothing: its Node binary is gone.
function nodeGone(executable) {
  try {
    return !statSync(executable).isFile();
  } catch {
    return true;
  }
}

function definitionPaths({ env, home, definitionRoot }) {
  if (definitionRoot) {
    return {
      systemd: path.join(definitionRoot, `${SERVICE_ID}.service`),
      desktop: path.join(definitionRoot, `${SERVICE_ID}.desktop`),
      launchAgent: path.join(
        definitionRoot,
        `com.bladelabs.${SERVICE_ID}.plist`,
      ),
      task: path.join(definitionRoot, `${SERVICE_ID}.xml`),
    };
  }
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return {
    systemd: path.join(configHome, 'systemd', 'user', `${SERVICE_ID}.service`),
    desktop: path.join(configHome, 'autostart', `${SERVICE_ID}.desktop`),
    launchAgent: path.join(
      home,
      'Library',
      'LaunchAgents',
      `com.bladelabs.${SERVICE_ID}.plist`,
    ),
    task: path.join(proxyPaths(env).directory, `${SERVICE_ID}.xml`),
  };
}

function systemdDefinition(command) {
  return `[Unit]\nDescription=ZeroH Disclosure local masking proxy\n\n[Service]\nType=simple\nExecStart=${[command.executable, ...command.args].map(quoted).join(' ')}\nRestart=on-failure\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`;
}

function desktopDefinition(command) {
  return `[Desktop Entry]\nType=Application\nName=ZeroH Disclosure Proxy\nComment=Starts the local ZeroH Disclosure masking proxy\nExec=${[command.executable, ...command.args].map(quoted).join(' ')}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
}

function launchAgentDefinition(command) {
  const argumentsXml = [command.executable, ...command.args]
    .map((argument) => `    <string>${xml(argument)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key>\n  <string>com.bladelabs.${SERVICE_ID}</string>\n  <key>ProgramArguments</key>\n  <array>\n${argumentsXml}\n  </array>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>\n</dict>\n</plist>\n`;
}

function windowsUserId(env) {
  const user = env.USERNAME || os.userInfo().username;
  return env.USERDOMAIN ? `${env.USERDOMAIN}\\${user}` : user;
}

// Per-user logon task: runs as the signed-in user without elevation, keeps
// running on battery and has no 72-hour execution limit.
export function windowsTaskDefinition(command, { userId }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo><Description>ZeroH Disclosure local masking proxy</Description></RegistrationInfo>',
    `  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(userId)}</UserId></LogonTrigger></Triggers>`,
    `  <Principals><Principal id="Author"><UserId>${xml(userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`,
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>',
    '  </Settings>',
    `  <Actions Context="Author"><Exec><Command>${xml(command.executable)}</Command><Arguments>${xml(command.args.map(windowsArgument).join(' '))}</Arguments></Exec></Actions>`,
    '</Task>',
    '',
  ].join('\n');
}

function safeUnlink(file) {
  try {
    unlinkSync(file);
  } catch {
    // Missing definitions are already unregistered.
  }
}

// Registers the login item and tells which kind it is. The definition file on
// disk is the only record: `isRegistered()` is "a definition exists".
export function createServiceManager({
  env = process.env,
  platform = process.platform,
  home = platform === 'win32'
    ? env.USERPROFILE || os.homedir()
    : env.HOME || os.homedir(),
  uid = process.getuid?.(),
  definitionRoot = env.ZEROH_SERVICE_MANAGER_DIR,
  executeCommands = !definitionRoot,
  execute = execFileSync,
  // Where XDG autostart files are read (tests set it).
  desktop = graphicalSession(env),
  nodePath = stableNodePath({ env, platform }),
} = {}) {
  const paths = definitionPaths({ env, home, definitionRoot });

  function run(file, args) {
    if (!executeCommands) return;
    execute(file, args, { stdio: 'ignore', env });
  }

  function tryRun(file, args) {
    try {
      run(file, args);
      return true;
    } catch {
      return false;
    }
  }

  function writeDefinition(file, contents) {
    writePrivateFile(file, contents);
  }

  // Throws when the OS refuses the login item; the caller treats that as a
  // warning (the proxy still runs for this session).
  function register({ runtime, config }) {
    const command = commandFor({ runtime, config, nodePath });
    let kind;
    let definition;
    if (platform === 'darwin') {
      kind = 'launch-agent';
      definition = paths.launchAgent;
      writeDefinition(definition, launchAgentDefinition(command));
      // A job left loaded by an earlier cleanup makes bootstrap fail.
      tryRun('launchctl', ['bootout', `gui/${uid}/${LAUNCH_LABEL}`]);
      try {
        run('launchctl', ['enable', `gui/${uid}/${LAUNCH_LABEL}`]);
        run('launchctl', ['bootstrap', `gui/${uid}`, definition]);
      } catch (error) {
        safeUnlink(definition);
        throw error;
      }
    } else if (platform === 'win32') {
      kind = 'scheduled-task';
      definition = paths.task;
      writeDefinition(
        definition,
        windowsTaskDefinition(windowsHeadlessCommand(command, env), {
          userId: windowsUserId(env),
        }),
      );
      try {
        run(windowsSystemTool('schtasks.exe', env), [
          '/Create',
          '/TN',
          TASK_NAME,
          '/XML',
          definition,
          '/F',
        ]);
      } catch (error) {
        safeUnlink(definition);
        throw error;
      }
    } else {
      kind = 'systemd';
      definition = paths.systemd;
      writeDefinition(definition, systemdDefinition(command));
      try {
        run('systemctl', ['--user', 'daemon-reload']);
        run('systemctl', [
          '--user',
          'enable',
          '--now',
          `${SERVICE_ID}.service`,
        ]);
      } catch (error) {
        safeUnlink(definition);
        if (!desktop) {
          // Nothing would start it: no systemd user manager, no desktop.
          const refused = new Error(
            'no systemd user session and no desktop session to start the proxy at login',
          );
          refused.code = 'ENOLOGINITEM';
          refused.cause = error;
          throw refused;
        }
        kind = 'xdg-autostart';
        definition = paths.desktop;
        writeDefinition(definition, desktopDefinition(command));
      }
    }
    return { kind, definition, command };
  }

  function registeredKind() {
    if (existsSync(paths.launchAgent)) return 'launch-agent';
    if (existsSync(paths.task)) return 'scheduled-task';
    if (existsSync(paths.systemd)) return 'systemd';
    if (existsSync(paths.desktop)) return 'xdg-autostart';
    return null;
  }

  function unregister({ stop = true } = {}) {
    const kind = registeredKind();
    if (kind === 'launch-agent') {
      // Definitions first: bootout ends the calling daemon during orphan
      // cleanup. bootout before disable, so a later bootstrap works.
      for (const file of Object.values(paths)) safeUnlink(file);
      tryRun('launchctl', ['bootout', `gui/${uid}/${LAUNCH_LABEL}`]);
      if (!stop) tryRun('launchctl', ['disable', `gui/${uid}/${LAUNCH_LABEL}`]);
      return { removed: true, kind };
    }
    if (kind === 'systemd') {
      tryRun('systemctl', [
        '--user',
        'disable',
        ...(stop ? ['--now'] : []),
        `${SERVICE_ID}.service`,
      ]);
      tryRun('systemctl', ['--user', 'daemon-reload']);
    } else if (kind === 'scheduled-task') {
      tryRun(windowsSystemTool('schtasks.exe', env), [
        '/Delete',
        '/TN',
        TASK_NAME,
        '/F',
      ]);
    }
    // Removing the definition alone keeps the next login from starting it.
    for (const file of Object.values(paths)) safeUnlink(file);
    return { removed: Boolean(kind), kind };
  }

  // What register() writes for this runtime and configuration.
  function expectedDefinition(kind, target, node = nodePath) {
    const command = commandFor({ ...target, nodePath: node });
    if (kind === 'launch-agent') return launchAgentDefinition(command);
    if (kind === 'systemd') return systemdDefinition(command);
    if (kind === 'xdg-autostart') return desktopDefinition(command);
    return windowsTaskDefinition(windowsHeadlessCommand(command, env), {
      userId: windowsUserId(env),
    });
  }

  // The Node binary a definition written by register() starts, or null when
  // the definition is not ours for this runtime and configuration.
  function recordedNode(kind, target, text) {
    const MARK = 'ZEROHNODEPATHMARKER';
    const template = expectedDefinition(kind, target, MARK);
    const [before, after] = template.split(MARK);
    if (
      template.split(MARK).length !== 2 ||
      !text.startsWith(before) ||
      !text.endsWith(after) ||
      text.length < before.length + after.length
    ) {
      return null;
    }
    const encoded = text.slice(before.length, text.length - after.length);
    if (kind === 'systemd' || kind === 'xdg-autostart') {
      return encoded.replace(/\\(["\\])/gu, '$1');
    }
    const plain = encoded
      .replaceAll('&apos;', "'")
      .replaceAll('&quot;', '"')
      .replaceAll('&gt;', '>')
      .replaceAll('&lt;', '<')
      .replaceAll('&amp;', '&');
    return kind === 'scheduled-task' ? plain.replace(/^"|"$/gu, '') : plain;
  }

  // Registered means the definition exists, starts this runtime with a Node
  // binary that still exists (a changed Node only counts when the recorded
  // one is gone, so alternating nvm versions never re-register it), an XDG
  // file has a desktop to read it, and the OS still has the job loaded:
  // `launchctl bootout`, `systemctl --user disable` or a deleted task leave
  // the file behind, and SessionStart then registers it again (T-26).
  function isRegistered(target = null) {
    const kind = registeredKind();
    if (!kind) return false;
    if (kind === 'xdg-autostart' && !desktop) return false;
    if (target) {
      const file = {
        'launch-agent': paths.launchAgent,
        systemd: paths.systemd,
        'xdg-autostart': paths.desktop,
        'scheduled-task': paths.task,
      }[kind];
      let node;
      try {
        node = recordedNode(kind, target, readFileSync(file, 'utf8'));
      } catch {
        return false;
      }
      if (!node || nodeGone(node)) return false;
    }
    if (!executeCommands) return true;
    if (kind === 'launch-agent') {
      return tryRun('launchctl', ['print', `gui/${uid}/${LAUNCH_LABEL}`]);
    }
    if (kind === 'systemd') {
      return tryRun('systemctl', [
        '--user',
        'is-enabled',
        '--quiet',
        `${SERVICE_ID}.service`,
      ]);
    }
    if (kind === 'scheduled-task') {
      return tryRun(windowsSystemTool('schtasks.exe', env), [
        '/Query',
        '/TN',
        TASK_NAME,
      ]);
    }
    return true;
  }

  return { paths, register, unregister, registeredKind, isRegistered };
}
