// SPDX-License-Identifier: AGPL-3.0-only

// Starts the proxy daemon at login: a launchd agent on macOS, a systemd user
// unit on Linux, a per-user scheduled task on Windows.
import { execFileSync } from '../zeroh-disclosure-core/child-process.js';
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  windowsSystemTool,
  writePrivateFile,
} from '../zeroh-disclosure-core/private-fs.js';
import { PUBLIC_PLUGIN_ID } from '../zeroh-disclosure-core/product.js';
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
// running on battery and has no 72-hour execution limit. It declares UTF-16:
// the file is written as UTF-16LE with a byte order mark (encodeWindowsTask),
// the only form `schtasks /Create /XML` accepts ("The task XML is malformed
// ... unable to switch the encoding" for a UTF-8 file; Windows 11 re-test).
export function windowsTaskDefinition(command, { userId }) {
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
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

const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);

// The bytes schtasks reads: a UTF-16LE byte order mark, then the text.
export function encodeWindowsTask(text) {
  return Buffer.concat([UTF16LE_BOM, Buffer.from(String(text), 'utf16le')]);
}

// A definition file's text: UTF-16 with a byte order mark (the task), or
// UTF-8 (every other kind, and a task file an older release wrote).
export function readDefinitionText(file) {
  const bytes = readFileSync(file);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString('utf16le');
  }
  return bytes.toString('utf8');
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
function createCommandRunner({ executeCommands, execute, env, platform }) {
  function run(file, args) {
    if (!executeCommands) return;
    try {
      execute(file, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        env,
        windowsHide: true,
      });
    } catch (error) {
      const text = Buffer.isBuffer(error?.stderr)
        ? error.stderr.toString(platform === 'win32' ? 'latin1' : 'utf8')
        : String(error?.stderr ?? '');
      const line = text
        .split(/\r?\n/u)
        .map((part) => part.trim())
        .find(Boolean);
      if (line && error && typeof error === 'object') {
        error.detail = line.slice(0, 240);
      }
      throw error;
    }
  }

  function tryRun(file, args) {
    try {
      run(file, args);
      return true;
    } catch {
      return false;
    }
  }

  return { run, tryRun };
}

function registeredKind(paths) {
  if (existsSync(paths.launchAgent)) return 'launch-agent';
  if (existsSync(paths.task)) return 'scheduled-task';
  if (existsSync(paths.systemd)) return 'systemd';
  if (existsSync(paths.desktop)) return 'xdg-autostart';
  return null;
}

function createRegistrar(context) {
  return function register({ runtime, config }) {
    const command = commandFor({ runtime, config, nodePath: context.nodePath });
    let kind;
    let definition;
    if (context.platform === 'darwin') {
      kind = 'launch-agent';
      definition = context.paths.launchAgent;
      writePrivateFile(definition, launchAgentDefinition(command));
      context.tryRun('launchctl', [
        'bootout',
        `gui/${context.uid}/${LAUNCH_LABEL}`,
      ]);
      try {
        context.run('launchctl', [
          'enable',
          `gui/${context.uid}/${LAUNCH_LABEL}`,
        ]);
        context.run('launchctl', [
          'bootstrap',
          `gui/${context.uid}`,
          definition,
        ]);
      } catch (error) {
        safeUnlink(definition);
        throw error;
      }
    } else if (context.platform === 'win32') {
      kind = 'scheduled-task';
      definition = context.paths.task;
      writePrivateFile(
        definition,
        encodeWindowsTask(
          windowsTaskDefinition(windowsHeadlessCommand(command, context.env), {
            userId: windowsUserId(context.env),
          }),
        ),
      );
      try {
        context.run(windowsSystemTool('schtasks.exe', context.env), [
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
      definition = context.paths.systemd;
      writePrivateFile(definition, systemdDefinition(command));
      try {
        context.run('systemctl', ['--user', 'daemon-reload']);
        context.run('systemctl', [
          '--user',
          'enable',
          '--now',
          `${SERVICE_ID}.service`,
        ]);
      } catch (error) {
        safeUnlink(definition);
        if (!context.desktop) {
          const refused = new Error(
            'no systemd user session and no desktop session to start the proxy at login',
          );
          refused.code = 'ENOLOGINITEM';
          refused.cause = error;
          throw refused;
        }
        kind = 'xdg-autostart';
        definition = context.paths.desktop;
        writePrivateFile(definition, desktopDefinition(command));
      }
    }
    return { kind, definition, command };
  };
}

function createUnregister(context) {
  return function unregister({ stop = true, keepRunning = false } = {}) {
    const kind = registeredKind(context.paths);
    if (kind === 'launch-agent') {
      for (const file of Object.values(context.paths)) safeUnlink(file);
      if (!keepRunning) {
        context.tryRun('launchctl', [
          'bootout',
          `gui/${context.uid}/${LAUNCH_LABEL}`,
        ]);
      }
      if (!stop || keepRunning) {
        context.tryRun('launchctl', [
          'disable',
          `gui/${context.uid}/${LAUNCH_LABEL}`,
        ]);
      }
      return { removed: true, kind };
    }
    if (kind === 'systemd') {
      context.tryRun('systemctl', [
        '--user',
        'disable',
        ...(stop && !keepRunning ? ['--now'] : []),
        `${SERVICE_ID}.service`,
      ]);
      context.tryRun('systemctl', ['--user', 'daemon-reload']);
    } else if (kind === 'scheduled-task') {
      context.tryRun(windowsSystemTool('schtasks.exe', context.env), [
        '/Delete',
        '/TN',
        TASK_NAME,
        '/F',
      ]);
    }
    for (const file of Object.values(context.paths)) safeUnlink(file);
    return { removed: Boolean(kind), kind };
  };
}

function expectedDefinition(context, kind, target, node = context.nodePath) {
  const command = commandFor({ ...target, nodePath: node });
  if (kind === 'launch-agent') return launchAgentDefinition(command);
  if (kind === 'systemd') return systemdDefinition(command);
  if (kind === 'xdg-autostart') return desktopDefinition(command);
  return windowsTaskDefinition(windowsHeadlessCommand(command, context.env), {
    userId: windowsUserId(context.env),
  });
}

function recordedNode(context, kind, target, text) {
  const MARK = 'ZEROHNODEPATHMARKER';
  const template = expectedDefinition(context, kind, target, MARK);
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

function createRegistrationCheck(context) {
  return function isRegistered(target = null) {
    const kind = registeredKind(context.paths);
    if (!kind) return false;
    if (kind === 'xdg-autostart' && !context.desktop) return false;
    if (target) {
      const file = {
        'launch-agent': context.paths.launchAgent,
        systemd: context.paths.systemd,
        'xdg-autostart': context.paths.desktop,
        'scheduled-task': context.paths.task,
      }[kind];
      let node;
      try {
        node = recordedNode(context, kind, target, readDefinitionText(file));
      } catch {
        return false;
      }
      if (!node || nodeGone(node)) return false;
    }
    if (!context.executeCommands) return true;
    if (kind === 'launch-agent') {
      return context.tryRun('launchctl', [
        'print',
        `gui/${context.uid}/${LAUNCH_LABEL}`,
      ]);
    }
    if (kind === 'systemd') {
      return context.tryRun('systemctl', [
        '--user',
        'is-enabled',
        '--quiet',
        `${SERVICE_ID}.service`,
      ]);
    }
    if (kind === 'scheduled-task') {
      return context.tryRun(windowsSystemTool('schtasks.exe', context.env), [
        '/Query',
        '/TN',
        TASK_NAME,
      ]);
    }
    return true;
  };
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
  desktop = graphicalSession(env),
  nodePath = stableNodePath({ env, platform }),
} = {}) {
  const paths = definitionPaths({ env, home, definitionRoot });
  const runner = createCommandRunner({
    executeCommands,
    execute,
    env,
    platform,
  });
  const context = {
    env,
    platform,
    uid,
    desktop,
    nodePath,
    executeCommands,
    paths,
    ...runner,
  };
  return {
    paths,
    register: createRegistrar(context),
    unregister: createUnregister(context),
    registeredKind: () => registeredKind(paths),
    isRegistered: createRegistrationCheck(context),
  };
}

// --- a refused login item ----------------------------------------------------

// What proxy.json records when the system refuses the login item (an older
// release recorded only the time, as a string).
export function loginItemRefusal(error, { platform = process.platform } = {}) {
  return {
    at: new Date().toISOString(),
    platform,
    code: error?.code ? String(error.code) : 'refused',
    ...(error?.detail ? { detail: String(error.detail).slice(0, 240) } : {}),
  };
}

function refusalRecord(record, platform) {
  if (!record) return null;
  if (typeof record === 'string')
    return { at: record, platform, code: 'refused' };
  return { platform, code: 'refused', ...record };
}

// The step that fixes a refused login item on this system.
export function loginItemFix(record, { platform = process.platform } = {}) {
  const refusal = refusalRecord(record, platform);
  const system = refusal?.platform || platform;
  if (refusal?.code === 'ENOLOGINITEM') {
    return 'run `loginctl enable-linger "$USER"` once (it gives your user a systemd session that starts the proxy at login), then start a new Claude Code session';
  }
  if (system === 'darwin') {
    return 'allow it in System Settings > General > Login Items & Extensions (Allow in the Background), then start a new Claude Code session';
  }
  if (system === 'win32') {
    return `update ZeroH Disclosure (\`claude plugin update ${PUBLIC_PLUGIN_ID}\`) and start a new Claude Code session; if Task Scheduler is blocked on this PC, ask your administrator to allow per-user scheduled tasks`;
  }
  return 'run `systemctl --user status` to see why your user session refused it, then start a new Claude Code session';
}

// Why the login item is missing, in one plain sentence (no paths, no user
// names): the tool's own words when it gave any.
export function loginItemReason(record, { platform = process.platform } = {}) {
  const refusal = refusalRecord(record, platform);
  if (!refusal) return null;
  if (refusal.code === 'ENOLOGINITEM') {
    return 'this system has nothing that starts programs at login (no systemd user session and no desktop session)';
  }
  const tool =
    { darwin: 'launchctl', win32: 'schtasks', linux: 'systemctl --user' }[
      refusal.platform
    ] || 'the system';
  return refusal.detail
    ? `${tool} refused it: "${refusal.detail}"`
    : `${tool} refused it (${refusal.code})`;
}
