/**
 * 情报转研究报告、来源标记、1/3/7 序列规则。
 * 运行：npx tsx src/lib/trade/__tests__/outreach-sequence.test.ts
 */
import { getResearchReportForAgents, parseResearchBundle } from "../research-bundle";
import {
  extractObservedEmail,
  buildIntelligenceResearchBundle,
} from "../intelligence-to-research";
import {
  SEQUENCE_DAY_OFFSETS,
  SEQUENCE_CATEGORY_BY_OFFSET,
  addUtcDays,
  nextFollowUpAfterSend,
  isSequenceDayOffset,
} from "../outreach-sequence-constants";
import { tradeProspectSourceLabel } from "../source-labels";
import type { IntelligenceCandidate } from "../intelligence-types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function run() {
  const contacts = [
    {
      companyName: "North Star Home",
      contactType: "general_email" as const,
      url: "mailto:buyer@northstar.example",
      label: "Email buyer@northstar.example",
      confidence: 0.8,
      reason: "contact page",
    },
    {
      companyName: "Other Co",
      contactType: "general_email" as const,
      url: "mailto:info@example.com",
      label: "info@example.com",
      confidence: 0.4,
      reason: "generic",
    },
  ];
  ok(
    extractObservedEmail(contacts, "North Star Home") === "buyer@northstar.example",
    "只提取原文已出现的邮箱",
  );
  ok(extractObservedEmail([], "X") === null, "无联系人则不编造邮箱");
  ok(extractObservedEmail(null, "X") === null, "空 contacts 返回 null");

  const candidate: IntelligenceCandidate = {
    name: "North Star Home",
    role: "buyer",
    website: "https://northstar.example",
    country: "Canada",
    confidence: 0.82,
    evidence: [],
    reason: "Retailer listing matches UPC",
    riskFlags: [],
    nextVerificationStep: "confirm buyer email",
  };
  const bundle = buildIntelligenceResearchBundle({
    productName: "Bathrobe",
    brand: "Mengxin",
    candidate,
    evidenceUrls: ["https://northstar.example/robes"],
  });
  ok(bundle.v === 1 && bundle.report.companyOverview.includes("North Star Home"), "转换写 v1 研究报告");
  ok(getResearchReportForAgents(bundle)?.matchAnalysis.includes("UPC"), "v1 bundle 可供开发信读取");

  const legacyIntel = {
    intelligenceCaseId: "case_1",
    productName: "Bathrobe",
    brand: "Mengxin",
    evidenceUrls: ["https://northstar.example/robes"],
    confidence: 0.8,
    candidateRole: "buyer",
    candidateName: "North Star Home",
    candidateWebsite: "https://northstar.example",
    reason: "Retailer listing matches UPC",
  };
  const parsedLegacy = parseResearchBundle(legacyIntel);
  ok(parsedLegacy.report?.companyOverview.includes("North Star Home"), "旧情报 JSON 仍能解析成报告");
  ok((parsedLegacy.sources?.length ?? 0) === 1, "旧情报 evidenceUrls 变成 sources");

  ok(SEQUENCE_DAY_OFFSETS.join(",") === "0,3,7", "序列天数 1/3/7");
  ok(SEQUENCE_CATEGORY_BY_OFFSET[0] === "first", "Day1 为首封");
  ok(SEQUENCE_CATEGORY_BY_OFFSET[3] === "follow_up_d3", "Day3 为跟进");
  ok(SEQUENCE_CATEGORY_BY_OFFSET[7] === "follow_up_d7", "Day7 为收口");
  ok(isSequenceDayOffset(3) && !isSequenceDayOffset(5), "只允许 0/3/7");

  const sent = new Date("2026-09-20T00:00:00.000Z");
  ok(addUtcDays(sent, 3).toISOString() === "2026-09-23T00:00:00.000Z", "UTC 加 3 天");
  ok(nextFollowUpAfterSend(sent, 0)?.toISOString() === "2026-09-23T00:00:00.000Z", "首封后下次跟进 +3 天");
  ok(nextFollowUpAfterSend(sent, 3)?.toISOString() === "2026-09-24T00:00:00.000Z", "第 3 天后下次跟进 +4 天到第 7 天");
  ok(nextFollowUpAfterSend(sent, 7) === null, "第 7 天后不再自动排期");

  ok(tradeProspectSourceLabel("website") === "官网", "官网来源标记");
  ok(tradeProspectSourceLabel("trade_intelligence") === "情报", "情报来源标记");
  ok(tradeProspectSourceLabel("google") === "搜索", "搜索来源标记");

  console.log(`outreach-sequence: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
