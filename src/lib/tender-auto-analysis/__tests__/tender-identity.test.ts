/**
 * P0 Tender Identity Alignment — TENDER-ID 纯函数矩阵
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/tender-identity.test.ts
 *
 * Canonical：Project.workDomain === "tender"（前后端同一事实源）。
 * TENDER-ID-01/02/03（创建落库）由真实浏览器 UAT 验证；此处覆盖可纯测的
 * 04（tender gate PASS）/ 05（general → NOT_TENDER_PROJECT）/ 06（frontend isTenderProject）。
 */

import { canAutoEnqueueAnalysis } from "../gate";
import { mapReasonToOutcome } from "../enqueue-outcome";
import {
  isTenderProject as isTenderWorkDomain,
  normalizeProjectWorkDomain,
} from "@/lib/projects/work-domain";
import { isTenderProject } from "@/components/project-detail/project-detail-types";
import type { ProjectDetail } from "@/components/project-detail/project-detail-types";

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

function proj(overrides: Partial<ProjectDetail>): ProjectDetail {
  return {
    id: "p1",
    name: "t",
    description: null,
    color: "#000",
    status: "active",
    ...overrides,
  } as ProjectDetail;
}

console.log("tender identity alignment");

// TENDER-ID-04: workDomain=tender → Package gate PASS
{
  const r = canAutoEnqueueAnalysis({ workDomain: "tender", hasIntelligenceRoom: false });
  ok(r.ok === true && r.reason === "tender_domain", "TENDER-ID-04: tender → gate PASS (tender_domain)");
}

// TENDER-ID-05: general project → NOT_TENDER_PROJECT
{
  const r = canAutoEnqueueAnalysis({ workDomain: "general", hasIntelligenceRoom: false });
  ok(r.ok === false && r.reason === "gate_closed", "TENDER-ID-05: general → gate_closed");
  const outcome = mapReasonToOutcome("gate_closed");
  ok(outcome.code === "NOT_TENDER_PROJECT", "TENDER-ID-05: outcome code = NOT_TENDER_PROJECT");
  ok(
    outcome.message.includes("不是招投标项目"),
    "TENDER-ID-05 (§12): UX 文案 = 此项目不是招投标项目（非 AI 出错）",
  );
}

// TENDER-ID-06: frontend isTenderProject —— canonical workDomain
{
  ok(isTenderProject(proj({ workDomain: "tender" })) === true, "TENDER-ID-06: workDomain=tender → true");
  ok(isTenderProject(proj({ workDomain: "general" })) === false, "TENDER-ID-06: workDomain=general（无 legacy）→ false");
  ok(isTenderProject(proj({ workDomain: "delivery" })) === false, "TENDER-ID-06: workDomain=delivery → false");
  // legacy 兼容 fallback：历史 bidtogo / tenderStatus / category 项目仍判 tender
  ok(isTenderProject(proj({ workDomain: "general", sourceSystem: "bidtogo" })) === true, "TENDER-ID-06: legacy bidtogo fallback 保留");
  ok(isTenderProject(proj({ workDomain: null, tenderStatus: "open" })) === true, "TENDER-ID-06: legacy tenderStatus fallback 保留");
}

// 前后端同一判定：frontend(workDomain) ⇔ backend gate
{
  for (const d of ["tender", "delivery", "general"] as const) {
    const fe = isTenderWorkDomain(d);
    const be = canAutoEnqueueAnalysis({ workDomain: d, hasIntelligenceRoom: false }).ok;
    ok(fe === be, `alignment: workDomain=${d} → frontend=${fe} backend=${be}`);
  }
}

// normalize：非法值不得静默当 tender
{
  ok(normalizeProjectWorkDomain("TENDER") === "tender", "normalize: 大小写归一");
  ok(normalizeProjectWorkDomain("rfp") === null, "normalize: 非法值 → null（不猜测）");
  ok(normalizeProjectWorkDomain(null) === null, "normalize: null → null");
}

console.log(`\ntender-identity: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
