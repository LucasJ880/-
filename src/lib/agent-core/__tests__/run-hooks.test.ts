/**
 * A1-P1 B1：tool start/terminal observation is awaited.
 * 运行：npx tsx src/lib/agent-core/__tests__/run-hooks.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fireToolCallHook,
  fireToolStartHook,
} from "../run-hooks";
import type {
  AgentRunHooks,
  AgentToolCallInfo,
  AgentToolStartInfo,
  ToolExecutionResult,
} from "../types";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const startInfo: AgentToolStartInfo = {
  name: "org_search_knowledge",
  round: 1,
  toolCallId: "step1:1",
};

function callInfo(result: ToolExecutionResult): AgentToolCallInfo {
  return {
    name: "org_search_knowledge",
    args: {},
    result,
    durationMs: 4,
    round: 1,
    toolCallId: "step1:1",
  };
}

/** Mirrors engine: start → execute → await terminal hook → continue. */
async function observedToolStep(
  hooks: AgentRunHooks | undefined,
  execute: () => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  await fireToolStartHook(hooks, startInfo);
  const result = await execute();
  await fireToolCallHook(hooks, callInfo(result));
  return result;
}

async function main() {
  console.log("agent-core run-hooks B1 durability");

  {
    let startedDone = false;
    await fireToolStartHook(
      {
        onToolStart: async () => {
          await delay(25);
          startedDone = true;
        },
      },
      startInfo,
    );
    ok(startedDone, "tool STARTED hook finishes before caller continues");
  }

  {
    let completedDone = false;
    await fireToolCallHook(
      {
        onToolCall: async () => {
          await delay(25);
          completedDone = true;
        },
      },
      callInfo({ success: true, data: { ok: true } }),
    );
    ok(completedDone, "tool COMPLETED hook finishes before caller continues");
  }

  {
    let failedDone = false;
    await fireToolCallHook(
      {
        onToolCall: async () => {
          await delay(25);
          failedDone = true;
        },
      },
      callInfo({ success: false, data: null, error: "tool_failed" }),
    );
    ok(failedDone, "tool FAILED hook finishes before caller continues");
  }

  {
    const log: string[] = [];
    const result = await observedToolStep(
      {
        onToolStart: async () => {
          await delay(15);
          log.push("started-persisted");
        },
        onToolCall: async () => {
          await delay(15);
          log.push("completed-persisted");
        },
      },
      async () => {
        log.push("execute");
        return { success: true, data: { n: 1 } };
      },
    );
    log.push("engine-advance");
    ok(
      log.join(",") ===
        "started-persisted,execute,completed-persisted,engine-advance",
      "STARTED persists before execute; COMPLETED persists before engine advances",
      log,
    );
    ok(
      result.success === true &&
        typeof result.data === "object" &&
        result.data !== null &&
        (result.data as { n: number }).n === 1,
      "successful tool result unchanged",
    );
  }

  {
    const log: string[] = [];
    const result = await observedToolStep(
      {
        onToolStart: async () => {
          log.push("started-persisted");
        },
        onToolCall: async () => {
          await delay(15);
          log.push("failed-persisted");
        },
      },
      async () => {
        log.push("execute");
        return { success: false, data: null, error: "boom" };
      },
    );
    log.push("engine-advance");
    ok(
      log.join(",") ===
        "started-persisted,execute,failed-persisted,engine-advance",
      "FAILED persistence finishes before engine advances",
      log,
    );
    ok(result.success === false, "failed tool business result preserved");
  }

  {
    const result = await observedToolStep(
      {
        onToolStart: async () => {
          throw new Error("start db down");
        },
        onToolCall: async () => {
          throw new Error("terminal db down");
        },
      },
      async () => ({ success: true, data: { kept: true } }),
    );
    ok(
      result.success === true &&
        typeof result.data === "object" &&
        result.data !== null &&
        (result.data as { kept: boolean }).kept === true,
      "observation DB/hook failure does not change tool result",
    );
  }

  try {
    await fireToolStartHook(
      {
        onToolStart: () => {
          throw new Error("sync start fail");
        },
      },
      startInfo,
    );
    ok(true, "start hook throw is swallowed");
  } catch {
    ok(false, "start hook throw is swallowed");
  }

  try {
    await fireToolCallHook(
      {
        onToolCall: () => {
          throw new Error("sync terminal fail");
        },
      },
      callInfo({ success: true, data: null }),
    );
    ok(true, "terminal hook throw is swallowed");
  } catch {
    ok(false, "terminal hook throw is swallowed");
  }

  const engineSrc = readFileSync(
    join(process.cwd(), "src/lib/agent-core/engine.ts"),
    "utf8",
  );
  ok(
    (engineSrc.match(/await fireToolStartHook/g) ?? []).length === 2,
    "engine awaits fireToolStartHook on both runAgent paths",
  );
  ok(
    (engineSrc.match(/await fireToolCallHook/g) ?? []).length === 2,
    "engine awaits fireToolCallHook on both runAgent paths",
  );
  ok(
    !/Promise\.resolve\(\)[\s\S]{0,120}onToolCall/.test(engineSrc),
    "no fire-and-forget canonical terminal write (onToolCall)",
  );
  ok(
    !engineSrc.includes("processAutopilotTelemetryOutbox"),
    "processor remains async / outside engine",
  );

  let cursor = 0;
  for (const label of ["non-stream", "stream"]) {
    const startAt = engineSrc.indexOf("await fireToolStartHook", cursor);
    const execAt = engineSrc.indexOf("await executeToolUnified", cursor);
    const callAt = engineSrc.indexOf("await fireToolCallHook", cursor);
    ok(
      startAt >= 0 && execAt > startAt && callAt > execAt,
      `${label}: start → execute → await terminal hook`,
      { startAt, execAt, callAt },
    );
    cursor = callAt + 1;
  }

  const hooksSrc = readFileSync(
    join(process.cwd(), "src/lib/agent-core/run-hooks.ts"),
    "utf8",
  );
  ok(hooksSrc.includes("await hooks.onToolCall"), "run-hooks awaits onToolCall");
  ok(hooksSrc.includes("await hooks.onToolStart"), "run-hooks awaits onToolStart");
  ok(
    engineSrc.includes("function fireFinishHook") &&
      engineSrc.includes("Promise.resolve()"),
    "onFinish may remain fire-and-forget",
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
