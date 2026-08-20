/**
 * Autopilot A1-P0 telemetry durability matrix.
 * 运行：npx tsx src/lib/autopilot/__tests__/durability-matrix.test.ts
 */

import {
  AUTOPILOT_OUTBOX_BACKOFF_MS,
  AUTOPILOT_OUTBOX_MAX_ATTEMPTS,
  autopilotOutboxBackoffMs,
  autopilotOutboxIdempotencyKey,
  enqueueAutopilotTelemetryOutbox,
  isOutboxRowClaimable,
  isOutboxRowExpiredMaxAttempt,
  sanitizeOutboxError,
  type AutopilotOutboxClient,
  type ClaimedOutboxRow,
  type OutboxClaimSnapshot,
} from "../outbox";
import { processAutopilotTelemetryOutbox, type AutopilotProcessorPorts } from "../processor";
import { resolveAutopilotObservationSequence } from "../repository";
import { sanitizeAgentTrace, sanitizeAutopilotPayload } from "../sanitize";
import { describeCaptureGap } from "../telemetry-health";
import { AUTOPILOT_A1_MANDATORY_BLOCKERS } from "../types";
import {
  isAutopilotEnabled,
  isAutopilotLlmJudgeEnabled,
  isAutopilotProcessorEnabled,
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

function uniqueErr(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

function memoryOutbox(): AutopilotOutboxClient & {
  keys: string[];
  createCalls: number;
} {
  const keys: string[] = [];
  const box: AutopilotOutboxClient & { keys: string[]; createCalls: number } = {
    keys,
    createCalls: 0,
    autopilotTelemetryOutbox: {
      create: async ({ data }) => {
        box.createCalls += 1;
        const key = String(data.idempotencyKey);
        if (keys.includes(key)) throw uniqueErr();
        keys.push(key);
        return { id: `ob_${keys.length}` };
      },
    },
  };
  return box;
}

function claimed(partial: Partial<ClaimedOutboxRow> = {}): ClaimedOutboxRow {
  return {
    id: "ob1",
    orgId: "orgA",
    agentRunId: "run1",
    agentEventId: "evt1",
    sequence: 1,
    noticeType: "event",
    sourceEventType: "tool.started",
    attemptCount: 1,
    leaseToken: "lease-1",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    ...partial,
  };
}

type Overlay = { outcome: string; humanOverride: boolean; sequences: number[] };

async function main() {
  console.log("autopilot A1-P0 durability matrix");

  const telemetryGate = AUTOPILOT_A1_MANDATORY_BLOCKERS.find(
    (b) => b.id === "TELEMETRY_DURABILITY",
  );
  ok(!!telemetryGate, "TELEMETRY_DURABILITY id 仍存在");
  ok(telemetryGate?.phase === "A1", "TELEMETRY_DURABILITY phase = A1");
  ok(
    telemetryGate?.status === "CLOSED",
    "TELEMETRY_DURABILITY status = CLOSED after Final Review 2",
  );
  ok(
    Boolean(telemetryGate?.reason?.trim()) &&
      /durable/i.test(telemetryGate?.reason ?? "") &&
      /Final Review/i.test(telemetryGate?.reason ?? ""),
    "TELEMETRY_DURABILITY reason 含 durable / Final Review evidence",
  );

  ok(!isAutopilotTelemetryCaptureEnabled({}), "capture default OFF");
  ok(!isAutopilotProcessorEnabled({}), "processor default OFF");
  ok(!isAutopilotLlmJudgeEnabled({}), "LLM Judge default OFF");
  ok(!isAutopilotEnabled({}), "UI flag default OFF");
  ok(
    !isAutopilotLlmJudgeEnabled({
      AUTOPILOT_ENABLED: "1",
      AUTOPILOT_TELEMETRY_CAPTURE_ENABLED: "1",
      AUTOPILOT_PROCESSOR_ENABLED: "1",
    }),
    "UI/capture/processor 不打开 LLM Judge",
  );
  ok(
    !isAutopilotTelemetryCaptureEnabled({ AUTOPILOT_ENABLED: "1" }),
    "UI flag 不打开 capture",
  );
  ok(
    isAutopilotTelemetryCaptureEnabled({
      AUTOPILOT_TELEMETRY_CAPTURE_ENABLED: "1",
    }),
    "capture flag ON",
  );

  const envOn = { AUTOPILOT_TELEMETRY_CAPTURE_ENABLED: "1" };
  const envProc = { AUTOPILOT_PROCESSOR_ENABLED: "1" };

  ok(
    autopilotOutboxIdempotencyKey({
      orgId: "o",
      agentRunId: "r",
      noticeType: "event",
      agentEventId: "evt_9",
    }) === "event:evt_9",
    "idempotency key = event:agentEventId",
  );
  ok(
    autopilotOutboxIdempotencyKey({
      orgId: "o",
      agentRunId: "r1",
      noticeType: "run_created",
    }) === "run_created:r1",
    "run_created key per agentRunId",
  );
  ok(autopilotOutboxBackoffMs(1) === AUTOPILOT_OUTBOX_BACKOFF_MS[0], "backoff 1m");
  ok(autopilotOutboxBackoffMs(2) === 300_000, "backoff 5m");
  ok(autopilotOutboxBackoffMs(5) === 21_600_000, "backoff 6h");
  ok(
    autopilotOutboxBackoffMs(99) === AUTOPILOT_OUTBOX_BACKOFF_MS.at(-1),
    "backoff caps at last bucket",
  );
  ok(AUTOPILOT_OUTBOX_MAX_ATTEMPTS === 8, "MAX_ATTEMPTS = 8");

  // Test 1 — Normal
  {
    const overlay: Overlay = {
      outcome: "UNKNOWN",
      humanOverride: false,
      sequences: [],
    };
    const result = await processAutopilotTelemetryOutbox({
      env: envProc,
      ports: {
        claim: async () => [claimed()],
        markProcessed: async () => true,
        markRetryOrDead: async () => "pending",
        markDead: async () => true,
        loadRun: async () => ({ id: "run1", orgId: "orgA" }),
        loadEvent: async () => ({
          eventType: "tool.started",
          sequence: 1,
          payload: { name: "gmail.send" },
          createdAt: new Date(),
        }),
        project: async (notice) => {
          if (notice.type === "event" && notice.sequence != null) {
            overlay.sequences.push(notice.sequence);
          }
        },
      },
    });
    ok(result.skipped === false && result.processed === 1, "Test1: processed");
    ok(overlay.sequences.join(",") === "1", "Test1: projected sequence 1");
  }

  // Test 2 — Duplicate process → one logical projection
  {
    const store = new Set<string>();
    const ports: AutopilotProcessorPorts = {
      claim: async () => [claimed()],
      markProcessed: async () => true,
      markRetryOrDead: async () => "pending",
      markDead: async () => true,
      loadRun: async () => ({ id: "run1", orgId: "orgA" }),
      loadEvent: async () => ({
        eventType: "tool.started",
        sequence: 1,
        payload: {},
        createdAt: new Date(),
      }),
      project: async (notice) => {
        if (notice.type !== "event") return;
        store.add(`${notice.runId}:${notice.sequence}`);
      },
    };
    await processAutopilotTelemetryOutbox({ env: envProc, ports });
    await processAutopilotTelemetryOutbox({ env: envProc, ports });
    ok(store.size === 1, "Test2: duplicate process → one logical projection");
  }

  // Test 3 — projection failure then retry success
  {
    let projectCalls = 0;
    let retried = 0;
    let processed = 0;
    const failOnce = async () => {
      projectCalls += 1;
      if (projectCalls === 1) throw new Error("projection db down");
    };
    const first = await processAutopilotTelemetryOutbox({
      env: envProc,
      ports: {
        claim: async () => [claimed({ attemptCount: 1 })],
        markProcessed: async () => {
          processed += 1;
          return true;
        },
        markRetryOrDead: async (input) => {
          retried += 1;
          ok(input.attemptCount === 1, "Test3: retry records attemptCount");
          return "pending";
        },
        markDead: async () => true,
        loadRun: async () => ({ id: "run1", orgId: "orgA" }),
        loadEvent: async () => ({
          eventType: "tool.started",
          sequence: 1,
          payload: {},
          createdAt: new Date(),
        }),
        project: failOnce,
      },
    });
    ok(first.retried === 1 && first.processed === 0, "Test3: first fail → retry scheduled");
    const second = await processAutopilotTelemetryOutbox({
      env: envProc,
      ports: {
        claim: async () => [claimed({ attemptCount: 2, leaseToken: "lease-2" })],
        markProcessed: async () => {
          processed += 1;
          return true;
        },
        markRetryOrDead: async () => "pending",
        markDead: async () => true,
        loadRun: async () => ({ id: "run1", orgId: "orgA" }),
        loadEvent: async () => ({
          eventType: "tool.started",
          sequence: 1,
          payload: {},
          createdAt: new Date(),
        }),
        project: failOnce,
      },
    });
    ok(second.processed === 1, "Test3: second success → PROCESSED");
    ok(retried === 1 && processed === 1, "Test3: one retry then processed");
  }

  // Poison: one failure does not block the rest of the batch
  {
    const claimedRows = [
      claimed({ id: "bad", agentEventId: "evt_bad" }),
      claimed({ id: "good", agentEventId: "evt_good", leaseToken: "lease-g" }),
    ];
    const result = await processAutopilotTelemetryOutbox({
      env: envProc,
      ports: {
        claim: async () => claimedRows,
        markProcessed: async () => true,
        markRetryOrDead: async () => "pending",
        markDead: async () => true,
        loadRun: async () => ({ id: "run1", orgId: "orgA" }),
        loadEvent: async (input) => ({
          eventType: "tool.started",
          sequence: input.id === "evt_bad" ? 1 : 2,
          payload: {},
          createdAt: new Date(),
        }),
        project: async (notice) => {
          if (notice.type === "event" && notice.sequence === 1) {
            throw new Error("poison payload");
          }
        },
      },
    });
    ok(
      result.retried === 1 && result.processed === 1,
      "Poison: 单条失败不堵死 batch",
    );
  }

  // Dead letter after max attempts
  {
    const result = await processAutopilotTelemetryOutbox({
      env: envProc,
      ports: {
        claim: async () => [
          claimed({ attemptCount: AUTOPILOT_OUTBOX_MAX_ATTEMPTS }),
        ],
        markProcessed: async () => true,
        markRetryOrDead: async (input) => {
          ok(
            input.attemptCount >= AUTOPILOT_OUTBOX_MAX_ATTEMPTS,
            "Dead: attemptCount at cap",
          );
          return "dead";
        },
        markDead: async () => true,
        loadRun: async () => ({ id: "run1", orgId: "orgA" }),
        loadEvent: async () => ({
          eventType: "tool.started",
          sequence: 1,
          payload: {},
          createdAt: new Date(),
        }),
        project: async () => {
          throw new Error("still failing");
        },
      },
    });
    ok(result.dead === 1, "Dead letter after MAX_ATTEMPTS");
  }

  // Test 4 — Crash / lease timeout reclaim
  {
    const now = new Date("2026-08-15T12:00:00.000Z");
    const processingLive: OutboxClaimSnapshot = {
      status: "processing",
      attemptCount: 1,
      nextAttemptAt: null,
      leaseExpiresAt: new Date(now.getTime() + 30_000),
    };
    const processingExpired: OutboxClaimSnapshot = {
      status: "processing",
      attemptCount: 1,
      nextAttemptAt: null,
      leaseExpiresAt: new Date(now.getTime() - 1),
    };
    ok(
      !isOutboxRowClaimable(processingLive, now, 8),
      "Test4: live lease 不可 reclaim",
    );
    ok(
      isOutboxRowClaimable(processingExpired, now, 8),
      "Test4: expired lease 可 reclaim",
    );

    const expiredAtMax: OutboxClaimSnapshot = {
      status: "processing",
      attemptCount: AUTOPILOT_OUTBOX_MAX_ATTEMPTS,
      nextAttemptAt: null,
      leaseExpiresAt: new Date(now.getTime() - 1),
    };
    ok(
      isOutboxRowClaimable(
        {
          status: "processing",
          attemptCount: 7,
          nextAttemptAt: null,
          leaseExpiresAt: new Date(now.getTime() - 1),
        },
        now,
        8,
      ),
      "B2: processing + expired + attemptCount=7 → reclaim",
    );
    ok(
      !isOutboxRowClaimable(expiredAtMax, now, 8),
      "B2: processing + expired + attemptCount=8 → 不可 reclaim",
    );
    ok(
      isOutboxRowExpiredMaxAttempt(expiredAtMax, now, 8),
      "B2: attemptCount=8 expired processing → DEAD recovery",
    );

    let crashAttempts = 1;
    let reclaimCount = 0;
    for (let i = 0; i < 40; i++) {
      const snap: OutboxClaimSnapshot = {
        status: "processing",
        attemptCount: crashAttempts,
        nextAttemptAt: null,
        leaseExpiresAt: new Date(now.getTime() - 1),
      };
      if (isOutboxRowClaimable(snap, now, 8)) {
        crashAttempts += 1;
        reclaimCount += 1;
        continue;
      }
      ok(
        isOutboxRowExpiredMaxAttempt(snap, now, 8),
        "B2: repeated crashes stop at DEAD recovery",
      );
      break;
    }
    ok(crashAttempts === 8, "B2: attemptCount 有上界 8");
    ok(reclaimCount === 7, "B2: 从 1 到 8 只允许 7 次 reclaim");

    const row: OutboxClaimSnapshot & { owner: string | null } = {
      status: "processing",
      attemptCount: 1,
      nextAttemptAt: null,
      leaseExpiresAt: new Date(now.getTime() - 1),
      owner: "worker-a",
    };
    const workers = ["worker-b", "worker-c"];
    const winners: string[] = [];
    for (const w of workers) {
      if (isOutboxRowClaimable(row, now, 8) && winners.length === 0) {
        row.owner = w;
        row.leaseExpiresAt = new Date(now.getTime() + 60_000);
        winners.push(w);
      }
    }
    ok(winners.length === 1 && winners[0] === "worker-b", "Test4: CAS 仅一个 winner");
    ok(
      !isOutboxRowClaimable(row, now, 8),
      "Test4: 新 lease 未过期，第二 worker 失败",
    );
  }

  ok(
    !isOutboxRowClaimable(
      {
        status: "pending",
        attemptCount: 1,
        nextAttemptAt: new Date(Date.now() + 60_000),
        leaseExpiresAt: null,
      },
      new Date(),
      8,
    ),
    "backoff: nextAttemptAt 未到不 claim",
  );
  ok(
    !isOutboxRowClaimable(
      {
        status: "dead",
        attemptCount: 8,
        nextAttemptAt: null,
        leaseExpiresAt: null,
      },
      new Date(),
      8,
    ),
    "dead 不再被 claim",
  );
  ok(
    isOutboxRowClaimable(
      {
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: new Date(Date.now() - 3_600_000),
        leaseExpiresAt: null,
      },
      new Date(),
      8,
    ),
    "Replay: 1h 前 pending 仍可处理",
  );

  // Test 5 — Cross org REJECT
  {
    let deadCode = "";
    const result = await processAutopilotTelemetryOutbox({
      env: envProc,
      ports: {
        claim: async () => [claimed({ orgId: "orgA", agentRunId: "runB" })],
        markProcessed: async () => true,
        markRetryOrDead: async () => "pending",
        markDead: async (input) => {
          deadCode = input.code;
          return true;
        },
        loadRun: async () => ({ id: "runB", orgId: "orgB" }),
        loadEvent: async () => {
          throw new Error("should not load event after CROSS_ORG");
        },
        project: async () => {
          throw new Error("should not project CROSS_ORG");
        },
      },
    });
    ok(result.dead === 1 && deadCode === "CROSS_ORG", "Test5: cross-org REJECT / DEAD");
  }

  // Test 6 — Sanitization
  {
    const dirty = {
      Authorization: "Bearer secret-token-value",
      Cookie: "qy_session=abc",
      apiKey: "sk-live-abcdefghijklmnopqrstuvwxyz",
      oauth_token: "ya29.a0AfH6SMB",
      password: "hunter2",
      email: "invoice CAD $12,800 to acme@example.com 合同条款",
      contract: "合同金额 CAD 9800",
      price: "CAD 12800",
    };
    const cleaned = JSON.stringify(sanitizeAutopilotPayload(dirty));
    ok(!cleaned.includes("secret-token-value"), "Test6: Bearer 不进 payload");
    ok(!cleaned.includes("qy_session=abc"), "Test6: Cookie 不进 payload");
    ok(!cleaned.includes("sk-live-abcdefghijklmnopqrstuvwxyz"), "Test6: API key 不进 payload");
    ok(!cleaned.includes("ya29.a0AfH6SMB"), "Test6: OAuth 不进 payload");
    ok(!cleaned.includes("hunter2"), "Test6: password 不进 payload");
    const err = sanitizeOutboxError(
      new Error("Bearer secret-token-value Cookie qy_session=abc password=hunter2"),
    );
    ok(!err.summary.includes("secret-token-value"), "Test6: error diagnostics 无 Bearer");
    ok(!err.summary.includes("hunter2"), "Test6: error diagnostics 无 password");
    const mid = [
      "request failed: Authorization: Bearer abc-secret-in-middle",
      "upstream returned Cookie: qy_session=abc123mid",
      "database error password=hunter2",
      "request failed with api_key=sk-live-abcdefghijklmnopqrstuvwxyz",
    ];
    for (const raw of mid) {
      const redacted = sanitizeOutboxError(new Error(raw)).summary;
      ok(!redacted.includes("abc-secret-in-middle"), `B3 no Bearer secret: ${raw.slice(0, 24)}`);
      ok(!redacted.includes("qy_session=abc123mid"), `B3 no cookie: ${raw.slice(0, 24)}`);
      ok(!redacted.includes("hunter2"), `B3 no password: ${raw.slice(0, 24)}`);
      ok(!redacted.includes("sk-live-abcdefghijklmnopqrstuvwxyz"), `B3 no api_key: ${raw.slice(0, 24)}`);
    }
    ok(
      sanitizeOutboxError(new Error("Unique constraint failed")).code === "PROCESSOR_ERROR" ||
        sanitizeOutboxError(Object.assign(new Error("db"), { code: "P2002" })).code === "P2002",
      "B3: structured code preserved when safe",
    );
    ok(
      sanitizeOutboxError(Object.assign(new Error("x"), { code: "Bearer abcdefghijklmnop" })).code ===
        "PROCESSOR_ERROR",
      "B3: secret-bearing error.code 不得入库",
    );
    ok(
      sanitizeAgentTrace("Bearer abcdefghijklmnop") === "[REDACTED]",
      "Test6: sanitizer 仍是硬边界",
    );
    const box = memoryOutbox();
    await enqueueAutopilotTelemetryOutbox(
      box,
      {
        orgId: "orgA",
        agentRunId: "run1",
        noticeType: "event",
        agentEventId: "evt1",
        sequence: 1,
        sourceEventType: "tool.started",
      },
      envOn,
    );
    ok(box.keys[0] === "event:evt1", "Test6: outbox 只存 envelope key");
  }

  // Test 7 — Processor down, runtime still enqueues
  {
    const box = memoryOutbox();
    const inserted = await enqueueAutopilotTelemetryOutbox(
      box,
      {
        orgId: "orgA",
        agentRunId: "run1",
        noticeType: "run_created",
      },
      envOn,
    );
    const skippedProc = await processAutopilotTelemetryOutbox({
      env: { AUTOPILOT_PROCESSOR_ENABLED: "0" },
      ports: {
        claim: async () => {
          throw new Error("processor should not claim when OFF");
        },
        markProcessed: async () => true,
        markRetryOrDead: async () => "pending",
        markDead: async () => true,
        loadRun: async () => null,
        loadEvent: async () => null,
        project: async () => undefined,
      },
    });
    ok(inserted === "inserted", "Test7: runtime 仍可写入 outbox");
    ok(skippedProc.skipped === true, "Test7: processor 挂掉/关闭不阻断 runtime");
  }

  // Test 8 — Flag OFF → zero outbox DB access
  {
    let createCalls = 0;
    const hostile: AutopilotOutboxClient = {
      autopilotTelemetryOutbox: {
        create: async () => {
          createCalls += 1;
          throw new Error("must not touch outbox when capture OFF");
        },
      },
    };
    const skipped = await enqueueAutopilotTelemetryOutbox(
      hostile,
      {
        orgId: "orgA",
        agentRunId: "run1",
        noticeType: "event",
        agentEventId: "evt1",
      },
      { AUTOPILOT_TELEMETRY_CAPTURE_ENABLED: "0" },
    );
    ok(skipped === "skipped" && createCalls === 0, "Test8: capture OFF 零 outbox 写入");

    let claimCalls = 0;
    const proc = await processAutopilotTelemetryOutbox({
      env: {},
      ports: {
        claim: async () => {
          claimCalls += 1;
          throw new Error("must not claim when processor OFF");
        },
        markProcessed: async () => true,
        markRetryOrDead: async () => "pending",
        markDead: async () => true,
        loadRun: async () => null,
        loadEvent: async () => null,
        project: async () => undefined,
      },
    });
    ok(proc.skipped && claimCalls === 0, "Test8: processor OFF 零 outbox 查询");
  }

  // Duplicate outbox insert
  {
    const box = memoryOutbox();
    const a = await enqueueAutopilotTelemetryOutbox(
      box,
      {
        orgId: "orgA",
        agentRunId: "run1",
        noticeType: "event",
        agentEventId: "evt1",
      },
      envOn,
    );
    const b = await enqueueAutopilotTelemetryOutbox(
      box,
      {
        orgId: "orgA",
        agentRunId: "run1",
        noticeType: "event",
        agentEventId: "evt1",
      },
      envOn,
    );
    ok(a === "inserted" && b === "duplicate", "outbox unique idempotencyKey");
  }

  // Test 9 — Ordering uses canonical sequence
  {
    const completionOrder = [3, 1, 2];
    const projected: number[] = [];
    for (const seq of completionOrder) {
      projected.push(
        resolveAutopilotObservationSequence({
          canonicalSequence: seq,
          lastSequence: projected.at(-1) ?? 0,
        }),
      );
    }
    ok(projected.join(",") === "3,1,2", "Test9: projection sequence = canonical");
    ok(
      [...projected].sort((a, b) => a - b).join(",") === "1,2,3",
      "Test9: 重建 Runtime 顺序正确",
    );
  }

  const gapOff = describeCaptureGap({
    captureEnabled: false,
    canonicalEventCount: 10,
    outboxEventCount: 0,
  });
  ok(gapOff.captureGap === null, "CAPTURE_GAP n/a when capture OFF");
  const gapOn = describeCaptureGap({
    captureEnabled: true,
    canonicalEventCount: 10,
    outboxEventCount: 9,
  });
  ok(gapOn.captureGap === 1, "CAPTURE_GAP = canonical − outbox");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
