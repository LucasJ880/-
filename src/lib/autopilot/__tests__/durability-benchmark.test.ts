/**
 * Autopilot A1-P0 local runtime/outbox micro-benchmark.
 * 不是 Production 压测。运行：npx tsx src/lib/autopilot/__tests__/durability-benchmark.test.ts
 */

import { enqueueAutopilotTelemetryOutbox, type AutopilotOutboxClient } from "../outbox";
import { processAutopilotTelemetryOutbox } from "../processor";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function fakeClient(): AutopilotOutboxClient {
  return {
    autopilotTelemetryOutbox: {
      create: async () => ({ id: "ob" }),
    },
  };
}

async function time(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

async function main() {
  const n = 200;
  const off: number[] = [];
  const on: number[] = [];
  const client = fakeClient();

  for (let i = 0; i < n; i++) {
    off.push(
      await time(() =>
        enqueueAutopilotTelemetryOutbox(
          client,
          {
            orgId: "org",
            agentRunId: "run",
            noticeType: "event",
            agentEventId: `evt_${i}`,
          },
          { AUTOPILOT_TELEMETRY_CAPTURE_ENABLED: "0" },
        ),
      ),
    );
    on.push(
      await time(() =>
        enqueueAutopilotTelemetryOutbox(
          client,
          {
            orgId: "org",
            agentRunId: "run",
            noticeType: "event",
            agentEventId: `evt_on_${i}`,
          },
          { AUTOPILOT_TELEMETRY_CAPTURE_ENABLED: "1" },
        ),
      ),
    );
  }

  const procOff: number[] = [];
  for (let i = 0; i < n; i++) {
    procOff.push(
      await time(() =>
        processAutopilotTelemetryOutbox({
          env: { AUTOPILOT_PROCESSOR_ENABLED: "0" },
        }),
      ),
    );
  }

  const round = (v: number) => Math.round(v * 1000) / 1000;
  console.log("autopilot A1-P0 local micro-benchmark (not production)");
  console.log(
    JSON.stringify(
      {
        env: "local-process",
        samples: n,
        captureOffEnqueueMs: {
          p50: round(percentile(off, 50)),
          p95: round(percentile(off, 95)),
        },
        captureOnEnqueueMs: {
          p50: round(percentile(on, 50)),
          p95: round(percentile(on, 95)),
        },
        processorOffMs: {
          p50: round(percentile(procOff, 50)),
          p95: round(percentile(procOff, 95)),
        },
        notes: [
          "BASELINE ≈ captureOffEnqueueMs（零 Outbox 访问）",
          "A1-P0 sync path ≈ captureOnEnqueueMs（假 client insert，无真实 DB）",
          "Processor batch latency 需 Preview/isolated DB，本文件不编造 Production 数字",
        ],
      },
      null,
      2,
    ),
  );
}

void main();
