/**
 * P2-1b：CanadaBuys 截标时间按东部当地时间解析
 * 运行：npx tsx src/lib/procurement-records/__tests__/closing-tz-pure.test.ts
 * 用两种进程时区各跑一遍结果相同（换算不依赖进程时区）：TZ=UTC / TZ=Asia/Shanghai
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canadaBuysInstant, parseCanadaBuysNoticesCsv } from "../sources-pure";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("单个时间");
{
  ok("冬令时：2026-12-15T14:00:00 → 19:00Z（多伦多下午 2 点 EST）", canadaBuysInstant("2026-12-15T14:00:00") === "2026-12-15T19:00:00.000Z", canadaBuysInstant("2026-12-15T14:00:00"));
  ok("夏令时：2027-06-02T11:00:00 → 15:00Z（EDT）", canadaBuysInstant("2027-06-02T11:00:00") === "2027-06-02T15:00:00.000Z", canadaBuysInstant("2027-06-02T11:00:00"));
  ok("没有秒：2026-11-20T14:00 → 19:00Z", canadaBuysInstant("2026-11-20T14:00") === "2026-11-20T19:00:00.000Z");
  ok("带秒：23:59:59 → 次日 04:59:59Z", canadaBuysInstant("2026-12-31T23:59:59") === "2027-01-01T04:59:59.000Z");
  ok("空格分隔也认", canadaBuysInstant("2026-12-15 14:00:00") === "2026-12-15T19:00:00.000Z");
  ok("夏令时开始那天的 03:00（跳变后）", canadaBuysInstant("2027-03-14T03:00:00") === "2027-03-14T07:00:00.000Z", canadaBuysInstant("2027-03-14T03:00:00"));
  ok("夏令时结束那天的 01:30（重复时刻取第一次，EDT）", canadaBuysInstant("2026-11-01T01:30:00") === "2026-11-01T05:30:00.000Z", canadaBuysInstant("2026-11-01T01:30:00"));
  ok("带 Z：照原样", canadaBuysInstant("2026-12-15T14:00:00Z") === "2026-12-15T14:00:00.000Z");
  ok("带偏移：照原样", canadaBuysInstant("2026-12-15T14:00:00-05:00") === "2026-12-15T19:00:00.000Z" && canadaBuysInstant("2026-07-15T14:00:00-04:00") === "2026-07-15T18:00:00.000Z");
  ok("只有日期：照旧（UTC 零点）", canadaBuysInstant("2026-12-15") === "2026-12-15T00:00:00.000Z");
  ok("空 / 乱写 / 越界：null", canadaBuysInstant("") === null && canadaBuysInstant(null) === null && canadaBuysInstant("not a date") === null && canadaBuysInstant("2026-12-15T24:00:00") === null && canadaBuysInstant("2026-12-15T14:60:00") === null);
  ok("前后空格", canadaBuysInstant("  2026-12-15T14:00:00 ") === "2026-12-15T19:00:00.000Z");
}

console.log("整段 CSV");
{
  const header = `"title-titre-eng","title-titre-fra","referenceNumber-numeroReference","amendmentNumber-numeroModification","solicitationNumber-numeroSollicitation","publicationDate-datePublication","tenderClosingDate-appelOffresDateCloture","tenderStatus-appelOffresStatut-eng","gsin-nibs","unspsc","unspscDescription-eng","regionsOfDelivery-regionsLivraison-eng","contractingEntityName-nomEntitContractante-eng","endUserEntitiesName-nomEntitesUtilisateurFinal-eng","noticeURL-URLavis-eng","tenderDescription-descriptionAppelOffres-eng"\r\n`;
  const row = (ref: string, closing: string) => `"Towels","Serviettes",${ref},000,W-${ref},2026-11-05,${closing},Open,N7210,52121700,Towels,Ontario,PSPC,DND,https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/${ref},"desc"\r\n`;
  const parsed = parseCanadaBuysNoticesCsv(header + row("cb-1", "2026-12-15T14:00:00") + row("cb-2", "2027-06-02T11:00:00") + row("cb-3", ""));
  ok("CSV 解析成功", parsed.ok, parsed);
  const recs = parsed.ok ? parsed.records : [];
  const by = (ref: string) => recs.find((r) => r.sourceRecordId === ref);
  ok("截标时间按东部当地时间", by("cb-1")?.closingAt === "2026-12-15T19:00:00.000Z" && by("cb-2")?.closingAt === "2027-06-02T15:00:00.000Z", recs.map((r) => [r.sourceRecordId, r.closingAt]));
  ok("没有截标时间：null", by("cb-3")?.closingAt === null);
  ok("发布日期照旧（只有日期，UTC 零点）", by("cb-1")?.publishedAt === "2026-11-05T00:00:00.000Z");
}

console.log("接线");
{
  const src = readFileSync(join(process.cwd(), "src/lib/procurement-records/sources-pure.ts"), "utf8");
  ok("CanadaBuys 截标时间用 canadaBuysInstant；换算用 America/Toronto", src.includes('closingAt: canadaBuysInstant(get(row, "closingDate")),') && src.includes('CANADABUYS_TIMEZONE = "America/Toronto"'));
  ok("进程时区：" + (process.env.TZ ?? "（未设）"), true);
}

console.log(`\nclosing-tz-pure: ${passed} passed`);
