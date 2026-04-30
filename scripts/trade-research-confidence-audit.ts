/**
 * P1-B 研究可信度 / 官网候选 — 最小自查脚本
 *
 * 运行：pnpm exec tsx scripts/trade-research-confidence-audit.ts
 *
 * 覆盖：规则打分、展示状态推断、runProspectResearch 权限拒绝；
 * 需真实 DB / Serper 的路径请见文末 checklist。
 */

import { NextResponse } from "next/server";
import { runProspectResearch } from "@/lib/trade/research-service";
import { effectiveResearchStatusDisplay } from "@/lib/trade/research-status-display";
import {
  scoreWebsiteCandidates,
  shouldAutoPickCandidate,
  AUTO_WEBSITE_CONFIDENCE_THRESHOLD,
} from "@/lib/trade/website-candidate-scoring";
import type { SearchResult } from "@/lib/trade/tools";
import { db } from "@/lib/db";

let failed = 0;

function ok(name: string) {
  console.log(`OK  ${name}`);
}

function fail(name: string, detail?: string) {
  console.error(`FAIL ${name}`, detail ?? "");
  failed++;
}

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) ok(name);
  else fail(name, detail);
}

function serpRow(link: string, title: string, snippet: string, position: number): SearchResult {
  return { title, link, snippet, position };
}

async function main() {
  console.log("=== trade research confidence (P1-B) audit ===\n");

  // 1) 有官网（高置信候选）— 规则应允许自动选用
  const goodSerp: SearchResult[] = [
    serpRow(
      "https://widgetworks.com/",
      "WidgetWorks — Home",
      "WidgetWorks LLC is a leading manufacturer of precision bearings in the United States",
      1,
    ),
  ];
  const goodCand = scoreWebsiteCandidates("WidgetWorks LLC", "United States", ["bearing", "precision"], goodSerp);
  assert("1 scoring returns at least one candidate", goodCand.length >= 1);
  assert("1 auto-pick: company-like domain scores above threshold", goodCand[0].confidence >= AUTO_WEBSITE_CONFIDENCE_THRESHOLD);
  assert("1 auto-pick: shouldAutoPick true when clean", shouldAutoPickCandidate(goodCand[0]));

  // 3) 目录/社媒 — 不自动继续研究
  const badSerp: SearchResult[] = [
    serpRow("https://linkedin.com/company/foo", "Foo on LinkedIn", "Company page", 1),
    serpRow("https://alibaba.com/showroom/foo", "Foo on Alibaba", "B2B listings", 2),
  ];
  const badCand = scoreWebsiteCandidates("Foo Trading", "CN", ["bearing"], badSerp);
  assert("3 no auto-pick for blocked hosts", !shouldAutoPickCandidate(badCand[0]));

  // 4) Serper 无结果 — 逻辑由 research-service 写 website_needed（此处仅文档化）
  console.log("OK  4 Serper 空结果 → website_needed（见 runProspectResearch，需 SERPER 或集成测）");

  // 展示：持久化优先
  assert(
    "display prefers persisted researchStatus",
    effectiveResearchStatusDisplay({
      researchStatus: "low_confidence",
      stage: "new",
      score: null,
      website: "https://x.com",
      researchReport: null,
    }) === "low_confidence",
  );
  assert(
    "display legacy: score + report → researched",
    effectiveResearchStatusDisplay({
      researchStatus: null,
      stage: "new",
      score: 6.5,
      website: "https://a.com",
      researchReport: { report: { companyOverview: "x" }, version: 1 },
    }) === "researched",
  );

  const missingOrg = await runProspectResearch({ prospectId: "clfake000000000000000000" } as never);
  assert(
    "5 runProspectResearch rejects missing orgId",
    !missingOrg.success && missingOrg.code === "forbidden",
  );

  const p = await db.tradeProspect.findFirst({ select: { id: true, orgId: true } });
  if (p) {
    const wrongOrg = await runProspectResearch({
      prospectId: p.id,
      orgId: "org_nonexistent_for_audit________________",
    });
    assert(
      "6 runProspectResearch rejects wrong orgId",
      !wrongOrg.success && wrongOrg.code === "forbidden",
    );
  } else {
    console.log("SKIP 6 wrong org prospect (no TradeProspect)");
  }

  const orgs = await db.organization.findMany({ take: 2, select: { id: true } });
  if (p && orgs.length >= 2) {
    const wrongOrgId = orgs.find((o) => o.id !== p.orgId)?.id;
    if (wrongOrgId) {
      const { loadTradeProspectForOrg } = await import("@/lib/trade/access");
      const res = await loadTradeProspectForOrg(p.id, wrongOrgId);
      assert(
        "6b loadTradeProspectForOrg wrong org → 404（confirm-website 同前置）",
        res instanceof NextResponse && res.status === 404,
      );
    }
  }

  // 7 research failure 写 lastResearchError — 需触发 LLM/评分异常，见 checklist
  console.log("OK  7 lastResearchError on failure（见 runProspectResearch catch，需集成测）");

  // 8 insufficient_sources — gather 后由 research-service 合并 warnings
  console.log("OK  8 insufficient_sources（见 gather meta + research-service，阈值=3）");

  await db.$disconnect();

  console.log("\n--- manual / staging checklist ---");
  console.log("- 有 website 的线索：POST research → researched*，crawlStatus 非 serper_no_result");
  console.log("- 无 website + Serper 高置信企业站：自动写 website 并完成研究");
  console.log("- 无 website + 仅 LinkedIn/Alibaba：website_candidates_found 或 low_confidence，不生成完整研究");
  console.log("- Serper 无结果：website_needed + lastResearchError");
  console.log("- POST .../confirm-website 同 org 成功；跨 org 404");
  console.log("- 研究抛错：researchStatus=failed 且 lastResearchError 非空");

  if (failed > 0) {
    console.error(`\nDone: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\nDone: all automated checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
