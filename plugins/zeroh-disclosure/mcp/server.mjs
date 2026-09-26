#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Local MCP server (stdio) with three tools: request_unmask and
// report_missed_secret ask the user in Claude Code's own dialog; end_unmask
// ends unmask grants at once, without a dialog, because ending early only
// reduces exposure (it never creates or extends a grant). Nothing here makes
// a network call.
import readline from 'node:readline';
import {
  DURATION_OPTIONS,
  PERSONAL_DATA_TYPES,
  SECRET_TYPES,
  capFor,
  consumeUnmaskMcpSession,
  createGrant,
  durationOptionsForCap,
  durationResultText,
  endGrants,
  isPersonalDataType,
  isSecretType,
  normaliseKind,
  unmaskDialog,
} from '../lib/unmask.js';
import {
  deleteReport,
  reportMiss,
  validateMissInput,
} from '../lib/report-miss.js';
import { envSessionId, projectRootFromEnv } from '../lib/session.js';

const KEEP_REPORT = 'Keep it on this computer';
const DELETE_REPORT = 'Delete it';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const content = (text) => ({ content: [{ type: 'text', text }] });
const pending = new Map();
let nextId = 1000;
let supportsElicitation = false;
let reportsThisSession = 0;
const isHeadlessClaude = process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli';
const REPORT_LIMIT = 20;

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  void handle(message).catch((error) => {
    if (message.id !== undefined) {
      send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32603, message: error.message },
      });
    }
  });
});

async function handle(message) {
  if (message.method === 'initialize') {
    supportsElicitation =
      !!message.params?.capabilities?.elicitation && !isHeadlessClaude;
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'zeroh-disclosure', version: '1.0.0' },
      },
    });
    return;
  }
  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          {
            name: 'request_unmask',
            description:
              'Ask the user to temporarily show real values for one personal-data kind. Secrets and credentials are never unmasked.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: {
                  type: 'string',
                  enum: [...PERSONAL_DATA_TYPES, ...SECRET_TYPES],
                  description: 'The detector token kind to unmask.',
                },
                reason: {
                  type: 'string',
                  minLength: 1,
                  description: 'Why Claude needs to see this kind of value.',
                },
              },
              required: ['kind', 'reason'],
            },
          },
          {
            name: 'end_unmask',
            description:
              'End unmask grants now, for one personal-data kind or all: real values are masked again at once. Call it when the user asks to stop showing real values. It cannot create or extend a grant.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: {
                  type: 'string',
                  enum: [...PERSONAL_DATA_TYPES, 'all'],
                  description: 'The kind whose grants end, or all.',
                },
              },
              required: ['kind'],
            },
          },
          {
            name: 'report_missed_secret',
            description:
              'Report a real-looking secret or personal value that was not masked. ZeroH immediately masks that exact value locally and saves a shape-only report. When the user asks you to report a value, call this tool with it: the user owns that decision. Omit the fields only when the user invokes the report-miss slash command; an interactive private form will collect them.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                value: {
                  type: 'string',
                  minLength: 8,
                  maxLength: 4096,
                  description:
                    'The exact value that should be masked from now on.',
                },
                type_guess: {
                  type: 'string',
                  maxLength: 64,
                  description:
                    'Optional detector type guess, such as API_KEY or EMAIL.',
                },
                where: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 512,
                  description:
                    'Where the value appeared, such as Bash output, file .env, or typed prompt.',
                },
                why: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 512,
                  description: 'Why the value appears sensitive.',
                },
              },
            },
          },
        ],
      },
    });
    return;
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    const result =
      name === 'request_unmask'
        ? await requestUnmask(message.params?.arguments ?? {})
        : name === 'end_unmask'
          ? endUnmask(message.params?.arguments ?? {})
          : name === 'report_missed_secret'
            ? await reportMissedSecret(message.params?.arguments ?? {})
            : content(`Unknown tool: ${name || '(missing)'}.`);
    send({ jsonrpc: '2.0', id: message.id, result });
    return;
  }
  if (message.id !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
  }
}

function elicitation(params) {
  const requestId = nextId++;
  const answer = new Promise((resolve) => pending.set(requestId, resolve));
  send({
    jsonrpc: '2.0',
    id: requestId,
    method: 'elicitation/create',
    params,
  });
  return answer;
}

async function collectMissInput(input) {
  if (input.value !== undefined) return input;
  if (!supportsElicitation) {
    return null;
  }
  const response = await elicitation({
    message:
      'Enter the value directly into this private ZeroH form. It will be stored only in the encrypted local vault and will not be repeated in the report.',
    requestedSchema: {
      type: 'object',
      properties: {
        value: {
          type: 'string',
          title: 'Value to mask',
          minLength: 8,
          maxLength: 4096,
        },
        type_guess: {
          type: 'string',
          title: 'Type guess (optional)',
        },
        where: {
          type: 'string',
          title: 'Where it appeared',
        },
        why: {
          type: 'string',
          title: 'Why it looks sensitive',
        },
      },
      required: ['value', 'where', 'why'],
    },
  });
  if (response?.result?.action !== 'accept') return null;
  return response.result.content ?? {};
}

async function reportMissedSecret(input) {
  // A slot is reserved before any dialog so a looping or injected caller
  // cannot keep opening forms, or race past the limit, once it is spent.
  if (reportsThisSession >= REPORT_LIMIT) {
    return content(
      `Report refused: this session has reached the limit of ${REPORT_LIMIT} reports. Start a new session to report another value.`,
    );
  }
  reportsThisSession += 1;
  let result;
  try {
    const collected = await collectMissInput(input);
    if (!collected) {
      return content(
        supportsElicitation
          ? 'The user cancelled; no value was saved or reported.'
          : 'Report miss needs an interactive value-entry dialog when no value is supplied; no report was created.',
      );
    }
    try {
      validateMissInput(collected);
    } catch (error) {
      return content(`Report refused: ${error.message}.`);
    }
    // The same project root the hooks use, so the reported value is masked
    // in the project whose output the hooks inspect.
    result = reportMiss(collected, {
      cwd: projectRootFromEnv(),
    });
  } finally {
    if (!result) reportsThisSession -= 1;
  }
  if (!supportsElicitation) {
    return content(
      `${result.resultText} Shape-only report ${result.id} was saved locally because no interactive report dialog is available. Nothing left this machine.`,
    );
  }

  // A plain question with the safe answer preselected (T-23): Enter keeps
  // the report on this computer. 1.0 has no sender, so sending is not a
  // choice; the message says when it arrives.
  const response = await elicitation({
    message: `ZeroH masked the value as ${result.token} from now on.\n${shapeSummary(result.report)}\nNothing leaves this machine: sending reports to Blade Labs comes in 1.1.\nEnter keeps the report; → changes the answer.`,
    requestedSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          title: 'What should ZeroH do with this report?',
          enum: [KEEP_REPORT, DELETE_REPORT],
          default: KEEP_REPORT,
        },
      },
      required: ['action'],
    },
  });
  const action = response?.result?.content?.action;
  if (response?.result?.action === 'accept' && action === DELETE_REPORT) {
    deleteReport(result.id);
    return content(
      `${result.resultText} The shape-only report was discarded. Nothing left this machine.`,
    );
  }
  // Keep local, cancel, decline and any unexpected answer all keep the report.
  return content(
    `${result.resultText} Shape-only report ${result.id} is kept locally. Nothing left this machine.`,
  );
}

// One line saying what the saved report holds: its shape, never the value
// (`zeroh-disclosure reports show <id>` prints all of it).
function shapeSummary(report) {
  const prefix = report.shape.public_prefix
    ? `, starts with ${report.shape.public_prefix}`
    : '';
  return `The report holds only: type ${report.type}, ${report.shape.length} characters${prefix}, found in ${report.where}; never the value.`;
}

async function requestUnmask({ kind, reason }) {
  const sessionId =
    consumeUnmaskMcpSession(projectRootFromEnv()) || envSessionId();
  const value = normaliseKind(kind);
  if (isSecretType(value)) {
    return content(
      `${value} is a secret or credential type. Keys are never unmasked.`,
    );
  }
  if (!isPersonalDataType(value)) {
    return content(
      `Unknown personal-data kind: ${value || '(empty)'}. No unmask grant was created.`,
    );
  }
  if (!supportsElicitation) {
    return content(
      'Unmask needs an interactive Claude Code session; no grant was created.',
    );
  }
  const { options, message } = unmaskDialog(value, reason, capFor(value));
  if (options.length === 0) {
    return content(
      `${value} unmasking is disabled by the user's cap; no grant was created.`,
    );
  }
  const response = await elicitation({
    message,
    requestedSchema: {
      type: 'object',
      properties: {
        // The shortest allowed duration is preselected, so Enter accepts
        // it straight away (T-21); → shows the others.
        duration: {
          type: 'string',
          title: 'Show real values for (→ to change)',
          enum: options.map(({ label }) => label),
          default: options[0].label,
        },
      },
      required: ['duration'],
    },
  });
  const action = response?.result?.action;
  const selected = response?.result?.content?.duration;
  const option = options.find(({ label }) => label === selected);
  if (action !== 'accept' || !option)
    return content('The user declined; no unmask grant was created.');
  const currentOptions = durationOptionsForCap(capFor(value));
  if (
    !currentOptions.some(({ value: duration }) => duration === option.value)
  ) {
    return content(
      `The user's ${value} cap changed while the request was open; no unmask grant was created.`,
    );
  }
  const grant = createGrant({
    root: projectRootFromEnv(),
    kind: value,
    reason: String(reason),
    duration: option.value,
    sessionId,
  });
  return content(durationResultText(grant, option.label));
}

// Ends grants without asking: the model may reduce exposure, never add it.
function endUnmask({ kind }) {
  const value = kind === 'all' ? 'all' : normaliseKind(kind);
  if (value !== 'all' && !isPersonalDataType(value)) {
    return content(
      `Unknown personal-data kind: ${value || '(empty)'}. No grant was ended.`,
    );
  }
  const ended = endGrants(projectRootFromEnv(), value);
  if (!ended.length) {
    return content(
      value === 'all'
        ? 'No unmask is active; real values are already masked.'
        : `No ${value} unmask is active; ${value} is already masked.`,
    );
  }
  const kinds = [...new Set(ended.map((grant) => grant.kind))].join(', ');
  return content(`${kinds} masked again: the unmask ended.`);
}

void DURATION_OPTIONS;
