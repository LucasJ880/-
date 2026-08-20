/**
 * 观察期包5 — 外部情报自动化闭环（纯平面，零 DB / 零出站 / 零真实模型）
 *
 * 诊断根因（2026-08-17 生产实证）：外部情报只挂 legacy FINALIZE、要求调查室
 * 先于分析存在（`&& roomBefore` 否则结果静默丢弃）、五种 no-op 全部无痕、
 * workforce 管线零情报步、手动按钮只建房间不产生分析。
 *
 * OBS-P5-RATE-*   manual 频控纯函数
 * OBS-P5-GATE-*   flag fail-closed（零出站单元验证）
 * OBS-P5-ORCH-*   编排服务结构（房间自动创建 / 显式状态）
 * OBS-P5-WIRE-*   三触发面接线（legacy / workforce ×2 / manual 端点）
 * 反例守卫：时序倒置写法与「永不兑现的承诺」文案不得回归。
 *
 * 运行：npx tsx src/lib/tender-intel/__tests__/obs-p5-intel-loop.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isExternalIntelRateLimited,
  runExternalIntelForProject,
  EXTERNAL_INTEL_STATUS_KEY,
} from "../orchestrate";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
/** 只看代码（源码级断言不把设计说明当证据） */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

console.log("观察期包5 — 外部情报自动化闭环");

async function main() {
  // ── manual 频控 ──────────────────────────────────────────
  const now = Date.parse("2026-08-17T12:00:00Z");
  ok(
    !isExternalIntelRateLimited(null, now) &&
      !isExternalIntelRateLimited({}, now) &&
      !isExternalIntelRateLimited({ ranAt: "not-a-date" }, now),
    "OBS-P5-RATE-01: 无状态/无时间/坏时间 → 不限流（允许首次触发）",
  );
  ok(
    isExternalIntelRateLimited({ ranAt: new Date(now - 30_000).toISOString() }, now) &&
      !isExternalIntelRateLimited({ ranAt: new Date(now - 61_000).toISOString() }, now),
    "OBS-P5-RATE-02: 60s 窗口边界（30s 前限流 / 61s 前放行）",
  );

  // ── flag fail-closed（真实调用路径，env 显式传空 → 零出站零写） ──
  const gate = await runExternalIntelForProject({
    projectId: "obsP5-nonexistent-project",
    trigger: "manual",
    env: {},
  });
  ok(
    gate.status === "skipped" && gate.reason === "flag_off" &&
      gate.awardCandidates === 0 && gate.webDomains === 0 && !gate.analyzed,
    "OBS-P5-GATE-01: flag 未开 → skipped(flag_off)，零候选零出站",
    gate,
  );

  // ── 编排服务结构 ─────────────────────────────────────────
  const orch = code("src/lib/tender-intel/orchestrate.ts");
  ok(
    orch.includes("bidIntelligenceRoom.upsert"),
    "OBS-P5-ORCH-01: 写入前自动创建房间（upsert，消灭静默丢弃）",
  );
  ok(
    !orch.includes("&& roomBefore") && !orch.includes("roomBefore"),
    "OBS-P5-ORCH-01b（反例守卫）: 时序倒置写法（roomBefore 前置门）不存在",
  );
  ok(
    orch.includes("EXTERNAL_INTEL_STATUS_KEY") &&
      EXTERNAL_INTEL_STATUS_KEY === "externalIntelStatus" &&
      ["flag_off", "no_analysis_run", "no_queries", "search_no_result"].every((r) =>
        orch.includes(`"${r}"`),
      ),
    "OBS-P5-ORCH-02: 显式状态键 + 四类 skipped 原因全部落状态（无痕 no-op 清零）",
  );
  ok(
    /catch \(error\)[\s\S]*status: "error"/.test(orch) &&
      orch.includes("project_no_org"),
    "OBS-P5-ORCH-03: 异常落 error 状态且不上抛；无 org 项目 fail-safe 跳过",
  );

  // ── 三触发面接线 ─────────────────────────────────────────
  const worker = code("src/lib/tender-auto-analysis/worker.ts");
  ok(
    worker.includes("runExternalIntelForProject") &&
      worker.includes('trigger: "legacy_finalize"'),
    "OBS-P5-WIRE-01: legacy FINALIZE 改调统一编排服务",
  );
  ok(
    !worker.includes("autoSearchAwardHistory") &&
      !worker.includes("analyzeExternalIntel"),
    "OBS-P5-WIRE-01b（反例守卫）: worker 内联检索块已彻底移除（单一实现）",
  );
  const tools = code("src/lib/tender-workforce/tools.ts");
  ok(
    (tools.match(/trigger: "workforce_finalize"/g) ?? []).length === 2,
    "OBS-P5-WIRE-02: workforce t9 两条终态化路径（canonical V2 + 兼容路径）均接线",
  );
  ok(
    (read("src/lib/tender-workforce/tools.ts").match(/外部情报失败不影响终态化/g) ?? [])
      .length === 2,
    "OBS-P5-WIRE-02b: 两处接线均为 fire-and-forget（失败不影响终态化）",
  );
  const route = code("src/app/api/projects/[id]/external-intel/run/route.ts");
  ok(
    route.includes("requireProjectWriteAccess") &&
      route.includes("RATE_LIMITED") &&
      route.includes('trigger: "manual"') &&
      route.includes("isExternalIntelEnabled"),
    "OBS-P5-WIRE-03: 手动端点 = 写权限门 + 频控 + flag 门 + manual 触发",
  );
  const panel = read("src/components/bid-workflow/award-history-panel.tsx");
  ok(
    panel.includes('data-testid="run-external-intel"') &&
      panel.includes("/external-intel/run"),
    "OBS-P5-WIRE-04: 情报 tab 有真实手动按钮（调 run 端点，产生真分析）",
  );

  // ── 文案纠偏 ────────────────────────────────────────────
  const awardRoute = read(
    "src/app/api/projects/[id]/external-intel/award-history/route.ts",
  );
  ok(
    !awardRoute.includes("尚无自动检索结果（分析完成后自动生成）") &&
      awardRoute.includes("externalIntelStatus"),
    "OBS-P5-COPY-01（反例守卫）: 「分析完成后自动生成」的空头承诺文案已移除，note 状态驱动",
  );

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

void main();
