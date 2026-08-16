/**
 * Autopilot instrumentation：non-blocking / flag off / 失败不抛
 * 运行：npx tsx src/lib/autopilot/__tests__/instrumentation.test.ts
 */

import { createAutopilotNotifier, type AutopilotRuntimeNotice } from "../instrumentation";
import {
  isAutopilotInstrumentationEnabled,
  isAutopilotTelemetryCaptureEnabled,
} from "../flags";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

async function main() {
  console.log("autopilot instrumentation");

  ok(
    !isAutopilotInstrumentationEnabled({ AUTOPILOT_ENABLED: "1" }),
    "AUTOPILOT_ENABLED 不打开 capture",
  );
  ok(
    !isAutopilotTelemetryCaptureEnabled({ AUTOPILOT_ENABLED: "1" }),
    "UI flag 与 capture 解耦",
  );
  ok(
    isAutopilotInstrumentationEnabled({
      AUTOPILOT_TELEMETRY_CAPTURE_ENABLED: "1",
    }),
    "capture flag on → instrumentation alias on",
  );

  const notice: AutopilotRuntimeNotice = {
    type: "run_created",
    orgId: "org1",
    runId: "run1",
    userId: "u1",
  };

  let persistCalls = 0;
  const notifyOff = createAutopilotNotifier({
    enabled: false,
    persist: async () => {
      persistCalls += 1;
    },
  });
  notifyOff(notice);
  ok(persistCalls === 0, "disabled notifier 不 persist");

  let errors = 0;
  const notifyFail = createAutopilotNotifier({
    enabled: true,
    persist: async () => {
      throw new Error("db down");
    },
    onError: () => {
      errors += 1;
    },
  });
  ok(notifyFail(notice) === undefined, "persist 失败不抛给 Runtime");
  await new Promise((r) => setTimeout(r, 20));
  ok(errors === 1, "失败进入 onError");

  let syncThrow = 0;
  const notifySyncThrow = createAutopilotNotifier({
    enabled: true,
    persist: () => {
      throw new Error("sync");
    },
    onError: () => {
      syncThrow += 1;
    },
  });
  notifySyncThrow(notice);
  ok(syncThrow === 1, "同步异常也被吞掉");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
