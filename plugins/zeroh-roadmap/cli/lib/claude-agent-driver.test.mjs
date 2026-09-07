#!/usr/bin/env node
/** TEST-FIRST: Claude stream JSON fulfills the neutral durable driver contract. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MODEL_IDS, launchArgv, resumeArgv } from "./drivers.mjs";
import { ClaudeAgentDriver } from "./claude-agent-driver.mjs";

const digest = (v) => createHash("sha256").update(v).digest("hex");
const ROLE = Buffer.from("role: phase-executor\n");
const GOV = Buffer.from("governance\n");
const REF = {
  status: "known",
  envelopeDigest: "sha256:authority",
  source: { kind: "managed-host-receipt", ref: "38.4" },
};
function request(overrides = {}) {
  return {
    runId: "run-38-4",
    executorId: "executor-38",
    arcId: "NATIVEGREEN",
    phase: 38,
    roleId: "phase-executor",
    driverId: "claude",
    model: MODEL_IDS.SONNET,
    worktree: "/tmp/claude-38",
    baseHead: "1".repeat(40),
    requestedHead: "2".repeat(40),
    roleCardDigest: digest(ROLE),
    governanceDigest: digest(GOV),
    authority: {
      parent: {
        profile: "workspace-write",
        bounds: {
          filesystem: "workspace-write",
          network: "denied",
          gitPush: false,
          externalWrites: false,
        },
        provenance: { kind: "managed-host-input", source: "supervisor" },
      },
      request: {
        profile: "inherit",
        bounds: {
          filesystem: "workspace-write",
          network: "denied",
          gitPush: false,
          externalWrites: false,
        },
        provenance: null,
      },
      effective: {
        profile: "workspace-write",
        bounds: {
          filesystem: "workspace-write",
          network: "denied",
          gitPush: false,
          externalWrites: false,
        },
      },
      native: {
        driver: "claude",
        runtime: { version: null, verified: false },
        argv: ["-p"],
        enforcement: {
          filesystem: "sandbox",
          network: "sandbox-config",
          gitPush: "semantic-only",
          externalWrites: "semantic-only",
        },
        limitations: ["runtime unverified"],
      },
    },
    authorityRef: REF,
    ...overrides,
  };
}
function fixture({
  bound = false,
  nativeSessionId = "claude-session-38",
} = {}) {
  const calls = [];
  const req = request();
  let rev = bound ? 1 : 0;
  const rec = (patch = {}) => ({
    path: `/tmp/claude-${rev}.json`,
    digest: digest(`r${rev}`),
    snapshot: {
      request: req,
      requestFingerprint: digest(JSON.stringify(req)),
      revision: rev,
      pendingOperation: rev
        ? null
        : { kind: "start", actionFingerprint: digest("start") },
      nativeSessionId: bound ? nativeSessionId : null,
      latestObservation: null,
      terminalResult: null,
      outcome: bound ? "active" : "pending",
      ...patch,
    },
  });
  let current = rec();
  const receiptStore = {
    persistRunRequest(c, r, o) {
      calls.push(["persistRunRequest", c, structuredClone(r), o]);
      return { status: "recorded", receipt: current };
    },
    bindNativeSession(c, i) {
      calls.push(["bindNativeSession", c, i]);
      rev++;
      current = rec({ nativeSessionId, outcome: "active" });
      return { status: "recorded", receipt: current };
    },
    persistRunResult(c, i) {
      calls.push(["persistRunResult", c, structuredClone(i)]);
      rev++;
      current = rec({
        nativeSessionId,
        latestObservation: i.observation,
        terminalResult: i.result,
        outcome: "complete",
      });
      return { status: "recorded", receipt: current };
    },
    reconcileRunReceipt() {
      return { status: "active", operation: "awaitEvent", receipt: current };
    },
  };
  const ownershipStore = {
    claimExecutorRun(...a) {
      calls.push(["claimExecutorRun", ...a]);
      return { status: "recorded" };
    },
  };
  const processTransport = {
    async execute(input) {
      calls.push(["execute", structuredClone(input)]);
      return {
        exitCode: 0,
        signal: null,
        stdout:
          [
            JSON.stringify({
              type: "system",
              subtype: "init",
              session_id: nativeSessionId,
              model: MODEL_IDS.SONNET,
            }),
            JSON.stringify({
              type: "result",
              subtype: "success",
              session_id: nativeSessionId,
              result: "complete",
            }),
          ].join("\n") + "\n",
        stderr: "",
      };
    },
  };
  return {
    calls,
    req,
    nativeSessionId,
    receiptStore,
    ownershipStore,
    processTransport,
    readLaunchInputs: () => ({
      roleCardBytes: ROLE,
      governanceBytes: GOV,
      prompt: "execute 38.4",
    }),
  };
}
const make = (f) =>
  new ClaudeAgentDriver({
    processTransport: f.processTransport,
    readLaunchInputs: f.readLaunchInputs,
    receiptStore: f.receiptStore,
    ownershipStore: f.ownershipStore,
    sessionId: "parent-38-4",
  });

test("fresh Claude persists and claims before registry-owned stream JSON launch, binding one native session", async () => {
  const f = fixture(),
    d = make(f),
    h = await d.start(f.req);
  assert.equal(h.nativeSessionId, f.nativeSessionId);
  assert.deepEqual(
    f.calls.slice(0, 4).map((x) => x[0]),
    ["persistRunRequest", "claimExecutorRun", "execute", "bindNativeSession"],
  );
  const x = f.calls.find((x) => x[0] === "execute")[1];
  assert.deepEqual(
    x.argv,
    launchArgv("claude", {
      worktree: f.req.worktree,
      authority: f.req.authority,
      model: f.req.model,
      streamJson: true,
    }),
  );
  assert.equal(x.stdin, "execute 38.4");
  assert.equal(x.cwd, f.req.worktree);
});

test("resume addresses the exact durable Claude session and persists one terminal exited result", async () => {
  const f = fixture({ bound: true }),
    d = make(f),
    h = { request: f.req, nativeSessionId: f.nativeSessionId };
  assert.deepEqual(await d.resume(h), h);
  const x = f.calls.find((x) => x[0] === "execute")[1];
  assert.deepEqual(
    x.argv,
    resumeArgv("claude", f.nativeSessionId, {
      worktree: f.req.worktree,
      authority: f.req.authority,
      model: f.req.model,
      streamJson: true,
    }),
  );
  assert.equal(x.argv.includes("--continue"), false);
  assert.equal(x.cwd, f.req.worktree);
  const done = await d.awaitEvent(h, {
    arcId: f.req.arcId,
    stage: "phase",
    status: "active",
    processedEventIds: [],
    lastHalt: null,
    authorityRef: REF,
  });
  assert.equal(done.handle.request.runId, f.req.runId);
  assert.equal(done.observation.event.type, "exited");
  assert.equal(f.calls.filter((x) => x[0] === "persistRunResult").length, 1);
});

test("valid native role metadata cannot replace the semantic request role", async () => {
  const f = fixture();
  const original = f.processTransport.execute;
  f.processTransport.execute = async (input) => {
    const result = await original(input);
    result.stdout = result.stdout.replace(
      '"model":"claude-sonnet-5"',
      '"model":"claude-sonnet-5","roleId":"native-role"',
    );
    return result;
  };
  const d = make(f);
  const h = await d.start(f.req);
  const done = await d.awaitEvent(h, {
    arcId: f.req.arcId,
    stage: "phase",
    status: "active",
    processedEventIds: [],
    lastHalt: null,
    authorityRef: REF,
  });
  assert.equal(done.observation.roleId, "phase-executor");
  assert.equal(done.handle.request.roleId, "phase-executor");
});

test("a changed native Claude model refuses binding by itself", async () => {
  const f = fixture();
  f.processTransport.execute = async (input) => {
    f.calls.push(["execute", input]);
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ type: "system", subtype: "init", session_id: f.nativeSessionId, model: MODEL_IDS.OPUS })}
${JSON.stringify({ type: "result", subtype: "success", session_id: f.nativeSessionId })}
`,
      stderr: "",
    };
  };
  await assert.rejects(() => make(f).start(f.req), /model|provenance/i);
  assert.equal(
    f.calls.some((x) => x[0] === "bindNativeSession"),
    false,
  );
});

test("a changed terminal Claude session refuses binding by itself", async () => {
  const f = fixture();
  f.processTransport.execute = async (input) => {
    f.calls.push(["execute", input]);
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ type: "system", subtype: "init", session_id: f.nativeSessionId, model: f.req.model })}
${JSON.stringify({ type: "result", subtype: "success", session_id: "other" })}
`,
      stderr: "",
    };
  };
  await assert.rejects(() => make(f).start(f.req), /session|identity/i);
  assert.equal(
    f.calls.some((x) => x[0] === "bindNativeSession"),
    false,
  );
});

test("caller authority mismatch refuses before source, receipt, ownership, or process effects", async () => {
  const f = fixture();
  const forged = request({
    authority: {
      ...f.req.authority,
      effective: {
        ...f.req.authority.effective,
        bounds: { ...f.req.authority.effective.bounds, network: "allowed" },
      },
    },
  });
  await assert.rejects(
    () => make(f).start(forged),
    /authority|network|intersection/i,
  );
  assert.deepEqual(f.calls, []);
});

test("fresh Claude composes with real receipt and ownership stores through one terminal result", async (t) => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, rmSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const receiptStore = await import("./run-receipt.mjs");
  const ownershipStore = await import("./executor-arm.mjs");
  const root = mkdtempSync(join(tmpdir(), "claude-adapter-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "-b", "develop"], { cwd: root });
  execFileSync("git", ["config", "user.name", "test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: root,
  });
  execFileSync("git", ["commit", "--allow-empty", "-qm", "seed"], {
    cwd: root,
  });
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const f = fixture();
  f.req = request({
    worktree: root,
    baseHead: head,
    requestedHead: head,
    runId: "run-real-38-4",
  });
  const d = new ClaudeAgentDriver({
    processTransport: f.processTransport,
    readLaunchInputs: f.readLaunchInputs,
    receiptStore,
    ownershipStore,
    sessionId: "parent-38-4",
  });
  const handle = await d.start(f.req);
  const done = await d.awaitEvent(handle, {
    arcId: f.req.arcId,
    stage: "phase",
    status: "active",
    processedEventIds: [],
    lastHalt: null,
    authorityRef: REF,
  });
  assert.equal(done.result.status, "transport-exited");
  const stored = JSON.parse(readFileSync(done.receipt.path, "utf8"));
  assert.equal(stored.nativeSessionId, f.nativeSessionId);
  assert.equal(stored.latestObservation.observation.roleId, f.req.roleId);
  assert.equal(stored.terminalResult.status, "transport-exited");
});


test("native terminal error details survive atomic transport completion", async () => {
  const f = fixture();
  const original = f.processTransport.execute;
  f.processTransport.execute = async (input) => {
    const result = await original(input);
    const records = result.stdout.trim().split("\n").map(JSON.parse);
    records[1].subtype = "error_max_turns";
    records[1].is_error = true;
    return { ...result, stdout: records.map(JSON.stringify).join("\n") + "\n" };
  };
  const driver = make(f);
  const handle = await driver.start(f.req);
  const completed = await driver.awaitEvent(handle, {
    arcId: f.req.arcId, stage: "phase", status: "active",
    processedEventIds: [], lastHalt: null, authorityRef: REF,
  });
  assert.equal(completed.result.protocolSubtype, "error_max_turns");
  assert.equal(completed.result.protocolError, true);
  assert.equal(completed.observation.event.evidence.protocolError, true);
  assert.equal(completed.transition.next.status, "halted");
});
