/**
 * TI-3a 文件领取方快照与公司名称比对（纯逻辑）
 * 运行：npx tsx src/lib/tender-competition/__tests__/document-holders.test.ts
 * 覆盖任务书验收项 A3（九家领取方不产生九个投标人）、A4（别名可复核，不自动合并不同实体）。
 * 测试里的公司名全部虚构。
 */
import assert from "node:assert/strict";
import { compareCompanyNames, decideAlias, isSameEntity, suggestAliases } from "../company-identity";
import { HOLDER_NOTE_ZH, summarizeDocumentHolders, validateHolderSnapshot, type DocumentHolderSnapshot } from "../document-holders";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

const NAMES = [
  "Northfield Pest Supply Inc.", "Lakeshore Linen Co.", "Maple Facility Products Ltd.", "Harbour Bedding Wholesale",
  "Rideau Janitorial Supply", "Capital Textile Imports Inc.", "Sunny Shutter Inc.", "Prairie Hospitality Goods", "Summit Thermal Equipment",
];
const snapshot = (o: Partial<DocumentHolderSnapshot> = {}): DocumentHolderSnapshot => ({
  solicitationId: "18026-93121-T01", portal: "MERX", sourceKind: "USER_UPLOAD_SCREENSHOT", capturedAt: "2026-11-06T10:00:00-05:00",
  entries: NAMES.map((name) => ({ name })), evidenceRef: "upload:screenshot-1", ...o,
});

console.log("tender-competition document-holders");

{
  const s = summarizeDocumentHolders({ snapshot: snapshot() });
  assert.ok(s.ok);
  ok("九个条目 → 领取方数 9", s.documentHolderCount === 9);
  ok("没有开标记录 → 投标人数为未知（null），不是 0 也不是 9", s.bidderCount === null && s.bidderSource === null);
  ok("说明文字写明领取文件不等于投标", s.noteZh === HOLDER_NOTE_ZH && s.noteZh.includes("领取文件不等于投标"));
  ok("每个条目的角色都是 DOCUMENT_HOLDER", s.entries.every((e) => e.role === "DOCUMENT_HOLDER"));
  ok("汇总里没有任何名为 bidders 的名单字段", !("bidders" in s));

  const withOpening = summarizeDocumentHolders({ snapshot: snapshot(), bidOpening: { sourceKind: "UNOFFICIAL_BID_RESULTS", capturedAt: "2026-11-10T16:00:00-05:00", bidders: [{ name: "A" }, { name: "B" }, { name: "C" }] } });
  ok("有开标记录 → 投标人数 3 来自开标记录，领取方数仍为 9", withOpening.ok && withOpening.bidderCount === 3 && withOpening.documentHolderCount === 9 && withOpening.bidderSource === "UNOFFICIAL_BID_RESULTS");
}
{
  const naive = validateHolderSnapshot(snapshot({ capturedAt: "2026-11-06T10:00:00" }));
  ok("采集时间缺时区 → 校验失败", !naive.ok && naive.issues.some((i) => i.code === "CAPTURED_AT_INVALID" && i.messageZh.includes("时区")));
  const bad = summarizeDocumentHolders({ snapshot: snapshot({ portal: " ", entries: [{ name: "" }] }) });
  ok("缺门户、条目无名称 → 失败并逐条列出", !bad.ok && bad.issues.length === 2);
}
{
  const s = summarizeDocumentHolders({ snapshot: snapshot(), ownNames: ["SUNNY SHUTTER, INC"] });
  assert.ok(s.ok);
  ok("我方条目被标出（大小写与标点不同）", s.entries.filter((e) => e.isOwn).map((e) => e.name).join() === "Sunny Shutter Inc.");
  ok("竞争对手领取方数 8，领取方数仍为 9", s.competitorHolderCount === 8 && s.documentHolderCount === 9 && s.ownEntryCount === 1);
  const dup = summarizeDocumentHolders({ snapshot: snapshot({ entries: [{ name: "Lakeshore Linen Co." }, { name: "LAKESHORE LINEN CO" }] }) });
  ok("同名重复出现：如实列出，不去重计数", dup.ok && dup.documentHolderCount === 2 && dup.duplicateNames.length === 1);
}
{
  const suffix = compareCompanyNames("Northfield Pest Supply Inc.", "Northfield Pest Supply");
  ok("只差公司后缀 → 不判同名，只给建议", suffix.relation === "SUGGEST_SAME_ENTITY" && suffix.basis === "LEGAL_SUFFIX_ONLY" && suffix.basisZh === "只差公司后缀");
  ok("Pest 与 Pet → 不同名，也不建议", compareCompanyNames("Northfield Pest Supply", "Northfield Pet Supply").relation === "UNRELATED");
  ok("大小写与标点不同 → 同名", compareCompanyNames("NORTHFIELD PEST SUPPLY, INC.", "Northfield Pest Supply Inc").relation === "SAME_NAME");
  ok("Inc. 与 Ltd. → 只给建议（可以是两个法人）", compareCompanyNames("Northfield Pest Supply Inc.", "Northfield Pest Supply Ltd.").relation === "SUGGEST_SAME_ENTITY");
  const contains = compareCompanyNames("Northfield Pest Supply", "Northfield Pest Supply Canada");
  ok("一方完整包含另一方 → 建议", contains.relation === "SUGGEST_SAME_ENTITY" && contains.basis === "NAME_CONTAINS");
  ok("只有一个词相同 → 不建议", compareCompanyNames("Northfield", "Northfield Pest Supply").relation === "UNRELATED");
  ok("完全不同 → 无关", compareCompanyNames("Lakeshore Linen Co.", "Summit Thermal Equipment").relation === "UNRELATED");
}
{
  const names = ["Northfield Pest Supply Inc.", "Northfield Pest Supply", "Northfield Pet Supply", "Lakeshore Linen Co."];
  const suggestions = suggestAliases(names);
  ok("四个名称里只有一条建议，状态为待人工确认", suggestions.length === 1 && suggestions[0].status === "PENDING_REVIEW" && suggestions[0].basis === "LEGAL_SUFFIX_ONLY");
  ok("建议不改变实体判定：未确认前不是同一实体", !isSameEntity(names[0], names[1]));
  const noDecider = decideAlias(suggestions[0], { decision: "REJECTED", decidedBy: " ", decidedAt: "2026-11-11T09:00:00-05:00" });
  ok("裁决缺确认人 → 拒绝", !noDecider.ok && noDecider.code === "DECIDER_MISSING");
  const rejected = decideAlias(suggestions[0], { decision: "REJECTED", decidedBy: "user_lucas", decidedAt: "2026-11-11T09:00:00-05:00" });
  assert.ok(rejected.ok);
  ok("否决留下确认人与时间", rejected.decision.decidedBy === "user_lucas" && rejected.decision.decidedAt === "2026-11-11T09:00:00-05:00");
  ok("否决后不再出现在建议里，也不是同一实体", suggestAliases(names, [rejected.decision]).length === 0 && !isSameEntity(names[0], names[1], [rejected.decision]));
  const confirmed = decideAlias(suggestions[0], { decision: "CONFIRMED", decidedBy: "user_lucas", decidedAt: "2026-11-11T09:05:00-05:00" });
  assert.ok(confirmed.ok);
  ok("人工确认后才算同一实体，且建议清单里不再出现", isSameEntity(names[0], names[1], [confirmed.decision]) && suggestAliases(names, [confirmed.decision]).length === 0);
  ok("确认一对不会波及相近但不同的公司", !isSameEntity(names[1], names[2], [confirmed.decision]));
}

console.log(`\ntender-competition document-holders: ${passed} passed`);
