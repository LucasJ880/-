/**
 * CHAIN-3 进口线索 — 开关 / 解析与逐条校验 / 比对三档 / 汇总 / 视图文案 / 接线（纯函数 + 源码断言）
 * 运行：npx tsx src/lib/tender-import-leads/__tests__/import-leads.test.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isImportLeadsEnabledForOrgWithEnv } from "../flags";
import { BATCH_TEXT, IMPORT_COLUMNS_HINT_ZH, IMPORT_HEADER_NAMES_ZH, groupProblems, importDedupeKey, isHttpUrl, parseDelimited, parseImportText, parseShipmentDate } from "../parse";
import { MANUAL_SOURCE_NOTE_ZH, importLeadSourceNotesZh, manualPasteProvider } from "../provider";
import { candidatePairKeys, createCandidatePairFinder, createImporterMatcher, matchImporter, preparedPairKey, prepareName, relatePrepared, uniqueWinnerNames } from "../match-pure";
import { IMPORT_LEAD_ALIAS_AUDIT_ACTION, IMPORT_LEAD_ALIAS_REVOKE_AUDIT_ACTION, effectiveDecisions } from "../alias-decisions";
import { IMPORT_LEADS_TEXT, aggregateByExporter, importResultZh, keywordsOf, sharedKeywords, slotSummaryZh, winnersStateMessage, type ImportLeadsView } from "../aggregate-pure";
import { aliasPairKey, compareCompanyNames, decideAlias } from "@/lib/tender-competition/company-identity";
import { createImportLead } from "@/lib/tender-competition/import-leads";
import { platformDisplay, sourceOriginDisplay } from "@/lib/supplier-intel/workspace-labels";
import { prioritizeSignal } from "@/lib/supplier-intel/discovery-priority-service";
import { SIGNAL_PLATFORMS } from "@/lib/supplier-intel/constants";
import { SUPPLIER_SOURCE_LABELS } from "@/lib/inquiry/types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 900)); }
}
const NOW = new Date("2026-11-20T12:00:00Z");

console.log("import leads");

// ── 开关 ──
{
  const on = (v: string | undefined, list: string | undefined, org = "org_1") =>
    isImportLeadsEnabledForOrgWithEnv(org, { TENDER_IMPORT_LEADS_ENABLED: v, TENDER_IMPORT_LEADS_ORG_ALLOWLIST: list } as NodeJS.ProcessEnv);
  ok(!on(undefined, undefined) && !on("0", undefined), "开关未设 / 0 → 关");
  ok(on("1", undefined) && on(" TRUE ", "") && on("on", "org_1, org_2") && on("yes", undefined), "开关为 1 / true / on / yes 且白名单为空或含本组织 → 开");
  ok(!on("1", "org_2") && !on("1", undefined, ""), "白名单只含别的组织 / 没有组织 → 关");
}

// ── 格式 ──
const parse = (text: string, o: { sourceLabel?: string | null; dateOrder?: "YMD" | "MDY" | "DMY" | null } = {}) => parseImportText(text, { now: NOW, ...o });
{
  const csv = 'Importer,Exporter,Date,Goods,Quantity,URL\n"Northfield Pest Supply, Inc.","Ningbo Bedding Co., Ltd.",2026-03-05,"Mattress encasement, zippered",1200 PCS,https://example.test/bol/1\n';
  const tsv = "Importer\tExporter\tDate\tGoods\tQuantity\tURL\nNorthfield Pest Supply, Inc.\tNingbo Bedding Co., Ltd.\t2026-03-05\tMattress encasement, zippered\t1200 PCS\thttps://example.test/bol/1\n";
  const a = parse(csv);
  const b = parse(tsv);
  ok(a.ok && b.ok && a.records.length === 1 && b.records.length === 1 && JSON.stringify(a.records[0]) === JSON.stringify(b.records[0]), "逗号分隔（带引号、内有逗号）与制表符分隔解析一致", { a, b });
  const r = a.ok ? a.records[0] : null;
  ok(!!r && r.importer === "Northfield Pest Supply, Inc." && r.exporter === "Ningbo Bedding Co., Ltd." && r.shipmentDate === "2026-03-05" && r.goods === "Mattress encasement, zippered" && r.quantityRaw === "1200 PCS" && r.sourceUrlLink === "https://example.test/bol/1" && r.recordNo === 1, "各列取值正确", r);
  const zh = parse("进口商,出口商,日期,品名,数量,来源网址\n甲公司,乙工厂,2026-1-5,睡袋,10,https://x.test\n");
  ok(zh.ok && zh.records[0].shipmentDate === "2026-01-05", "中文表头；月日一位补零", zh);
  const dup = parse("Shipper,Exporter,Importer\nA,B,C\n");
  ok(!dup.ok && dup.code === "DUPLICATE_COLUMN" && dup.messageZh === "表头里有两列都是「出口商」：Shipper、Exporter。请删掉一列再贴。", "同一种列认出两列：整批不导入", dup);
  const prefix = parse("Importer,Shipper Address,URL\nA,B,https://x.test\n");
  ok(!prefix.ok && prefix.code === "MISSING_COLUMNS" && prefix.messageZh === `缺少必需的列：出口商。${IMPORT_HEADER_NAMES_ZH}你贴的表头是：Importer、Shipper Address、URL。`, "表头整格匹配：Shipper Address 不算出口商列；说明表头能写成什么、你贴的是什么", prefix);
  const named = parse("Consignee Name,Shipper Name,Arrival Date,Product Description,Qty,Link\nA Co,B Co,2026-01-02,Tents,5,https://x.test\n");
  ok(named.ok && named.records[0].importer === "A Co" && named.records[0].exporter === "B Co" && named.records[0].goods === "Tents", "常见导出表头：Consignee Name / Shipper Name / Product Description", named);
  const tsvQuoted = parse('Importer\tExporter\tGoods\tURL\nA Co\tB Co\t"Widget\nBlue"\thttps://x.test/1\nC Co\tD Co\tTents\thttps://x.test/2\n');
  ok(tsvQuoted.ok && tsvQuoted.totalRecords === 2 && tsvQuoted.records[0].goods === "Widget\nBlue" && tsvQuoted.records[1].recordNo === 2 && tsvQuoted.problems.length === 0, "从表格粘贴：单元格里有换行（带引号）也按一条记录", tsvQuoted);
  const blanks = parse("Importer,Exporter,URL\n  ,  ,\nA Co,B Co,https://x.test\n");
  ok(blanks.ok && blanks.totalRecords === 1 && blanks.records[0].recordNo === 1, "整行都是空白的不算记录（逗号分隔也一样）", blanks);
  ok(parseDelimited('a,"b ""q"" c",d\r\ne,f,g', ",").map((r) => r.join("|")).join("/") === 'a|b "q" c|d/e|f|g', "RFC 4180：转义引号、CRLF");
  const unclosed = parse('Importer,Exporter,Goods,URL\nA Co,B Co,"6 inch pipe,https://x.test/1\nC Co,D Co,Tents,https://x.test/2\nE Co,F Co,Bags,https://x.test/3\n');
  ok(!unclosed.ok && unclosed.code === "UNCLOSED_QUOTE" && unclosed.messageZh.startsWith("第 1 条记录里有引号没有配对"), "以引号开头的格子没有配对：整批不导入并写明第几条（不把后面的记录吞进去）", unclosed);
  const crOnly = parse("Importer,Exporter,Goods,URL\rA Co,B Co,Tent\tpoles,https://x.test/1\rC Co,D Co,Bags,https://x.test/2\r");
  ok(crOnly.ok && crOnly.records.length === 2, "只用 CR 换行（Mac 版 Excel）：判分隔符与拆行一致", crOnly);
  const wrongOrder = parse("Importer,Exporter,Date,URL\nA Co,B Co,03/04/2025,https://x.test/1\nA Co,C Co,03/25/2025,https://x.test/2\n", { dateOrder: "DMY" });
  ok(!wrongOrder.ok && wrongOrder.code === "DATE_ORDER_MISMATCH" && wrongOrder.messageZh === "有 1 条日期按「日/月/年」读不通（如「03/25/2025」），可能选错了日期写法；这一批一条都没有导入，请改选后重新导入。", "选了日期写法但有日期按它读不通、按另一种读得通：整批不导入（免得日 ≤ 12 的按错的月日进库）", wrongOrder);
  ok(parseShipmentDate("2026-01-05T00:00:00Z", "YMD") === "2026-01-05" && parseShipmentDate("2026-01-05T00:00:00.000Z", "YMD") === "2026-01-05" && parseShipmentDate("2026-01-05 08:00:00+08:00", "YMD") === "2026-01-05", "带时区的 ISO 时间：取日期部分");
}

// ── 整批不导入 ──
{
  const m = (t: string) => { const r = parse(t); return r.ok ? "" : r.messageZh; };
  ok(m("") === "没有可导入的内容。" && m("Importer,Exporter\n") === "没有可导入的内容。", "空内容 / 只有表头");
  ok(m("Importer,Goods\nA,B\n").startsWith("缺少必需的列：出口商。表头可写（不分大小写）：") && m("Goods\nB\n").startsWith("缺少必需的列：进口商、出口商。") && m("Goods\nB\n").endsWith("你贴的表头是：Goods。"), "缺列");
  ok(m("Importer,Exporter,URL\n" + Array.from({ length: 501 }, (_, i) => `A${i},B,https://x.test/${i}`).join("\n")) === "一次最多导入 500 条记录，这次有 501 条。", "超过 500 条");
  ok(m("Importer,Exporter\n" + "x".repeat(210 * 1024)) === "内容太长（超过 200 KB），请分批导入。" && BATCH_TEXT.tooLarge === "内容太长（超过 200 KB），请分批导入。", "超过 200 KB");
}

// ── 逐条校验 ──
{
  const text = [
    "Importer,Exporter,Date,URL",
    "Alpha Co,,2026-01-02,https://x.test/1",
    "Alpha Co,Exp B,03/04/2025,https://x.test/2",
    "Alpha Co,Exp C,2027-01-01,https://x.test/3",
    "Alpha Co,Exp D,2026-01-02,",
    "",
    "Alpha Co,Exp E,2026/01/02,https://x.test/5",
  ].join("\n");
  const r = parse(text);
  const groups = r.ok ? groupProblems(r.problems) : [];
  ok(r.ok && r.records.length === 1 && r.records[0].exporter === "Exp E" && r.records[0].recordNo === 5 && r.records[0].shipmentDate === "2026-01-02", "只导入完整的那条；空行不算记录（完整那条是第 5 条）", r);
  ok(groups.map((g) => g.messageZh).join(" | ") === "缺少出口商：第 1 条记录 | 日期「03/04/2025」认不出（请写成年在前，或为这一批选日期写法）：第 2 条记录 | 日期在未来（可能选错了日期写法）：第 3 条记录 | 缺少来源网址，也没有填来源说明：第 4 条记录", "问题按原因归并，写明第几条记录", groups);
  const near = parse("Importer,Exporter,Date,URL\nA,B,2026-11-21,https://x.test/1\nA,C,2026-11-22,https://x.test/2\n");
  ok(near.ok && near.records.length === 1 && near.records[0].exporter === "B" && near.problems[0]?.code === "DATE_FUTURE", "「在未来」按 UTC 今天再加一天：明天的不算（时差），后天的算", near);
  ok(parseShipmentDate("11/5/2026 0:00", "MDY") === "2026-11-05" && parseShipmentDate("2026-11-05 13:45:00", "YMD") === "2026-11-05" && parseShipmentDate("11/5/26", "MDY") === null, "表格导出带的时间去掉；两位年份不认");
  const mdy = parse(text, { dateOrder: "MDY" });
  const dmy = parse(text, { dateOrder: "DMY" });
  ok(mdy.ok && dmy.ok && parseShipmentDate("03/04/2025", "MDY") === "2025-03-04" && parseShipmentDate("03/04/2025", "DMY") === "2025-04-03" && parseShipmentDate("03/04/2025", "YMD") === null && parseShipmentDate("2025-02-30", "YMD") === null, "选了「月/日/年」「日/月/年」才按所选读；不存在的日期认不出");
  ok(mdy.ok && mdy.records.some((x) => x.exporter === "Exp B" && x.shipmentDate === "2025-03-04"), "按「月/日/年」导入：03/04/2025 读作 2025-03-04", mdy);
  const labelled = parse("Importer,Exporter\nAlpha Co,Exp F\n", { sourceLabel: "ImportYeti 查询" });
  ok(labelled.ok && labelled.records[0].evidenceRef === "ImportYeti 查询 · 第 1 条记录" && labelled.records[0].sourceUrlRaw === null, "没有来源网址但填了来源说明：用来源说明作出处", labelled);
  const many = groupProblems([{ recordNo: 2, code: "DATE_INVALID", value: "1/2/2025" }, { recordNo: 3, code: "DATE_INVALID", value: "x" }]);
  ok(many[0].messageZh === "日期「1/2/2025」等认不出（请写成年在前，或为这一批选日期写法）：第 2、3 条记录", "同一原因多条：写第一个例子加「等」", many);
  const long = parse(`Importer,Exporter,Goods,URL\n${"A".repeat(301)},B,x,https://x.test\nA,B,${"g".repeat(1001)},https://x.test\n`);
  ok(long.ok && groupProblems(long.problems).map((g) => g.code).join() === "NAME_TOO_LONG,GOODS_TOO_LONG", "名称超过 300 字、品名超过 1000 字", long);
  ok(isHttpUrl("https://a.test/x") && !isHttpUrl("javascript:alert(1)") && !isHttpUrl("ftp://a.test") && !isHttpUrl(`https://a.test/${"x".repeat(2050)}`), "只有 http(s) 网址才当链接");
  const js = parse("Importer,Exporter,URL\nA,B,javascript:alert(1)\n");
  ok(js.ok && js.records[0].sourceUrlLink === null && js.records[0].sourceUrlRaw === "javascript:alert(1)", "不是 http(s) 的来源网址只留原文、不给链接", js);
  const longUrl = `https://a.test/${"x".repeat(3000)}`;
  const lu = parse(`Importer,Exporter,URL\nA,B,${longUrl}\n`);
  ok(lu.ok && lu.records[0].sourceUrlLink === null && lu.records[0].sourceUrlRaw?.length === 2048, "超过 2048 字的来源网址：只存前 2048 字，不当链接", lu.ok ? lu.records[0].sourceUrlRaw?.length : lu);
}

// ── 重复 ──
{
  const r = parse("Importer,Exporter,Date,Goods,URL\nAlpha Co.,Exp B,2026-01-02,Tents,https://x.test/1\nALPHA CO,exp b,2026-01-02,tents,https://x.test/1\nAlpha Co,Exp B,2026-01-02,Tents,https://x.test/2\n");
  ok(r.ok && r.records.length === 2 && r.duplicatesInBatch === 1, "同批规整后六项都相同的只导入一条；来源网址不同算两票", r);
  ok(importDedupeKey({ importer: "A", exporter: "B", shipmentDate: null, goods: null, quantityRaw: "10", sourceUrlRaw: null }) !== importDedupeKey({ importer: "A", exporter: "B", shipmentDate: null, goods: null, quantityRaw: "20", sourceUrlRaw: null }), "数量不同不算重复");
}

// ── 比对三档 ──
{
  const winners = uniqueWinnerNames(["Northfield Pest Supply Inc.", "NORTHFIELD PEST SUPPLY INC", "Boreal Outfitters Ltd."]);
  ok(winners.join("|") === "Northfield Pest Supply Inc.|Boreal Outfitters Ltd.", "中标者按规整后去重", winners);
  const a = matchImporter("NORTHFIELD PEST SUPPLY, INC.", winners, []);
  const b = matchImporter("Northfield Pest Supply", winners, []);
  const c = matchImporter("Northfield Pet Supply", winners, []);
  ok(a.status === "MATCHED" && a.winners.join() === "Northfield Pest Supply Inc.", "规整后同名：挂上", a);
  ok(b.status === "SUGGESTED" && b.suggestions[0].basisZh === "只差公司后缀" && b.suggestions[0].winnerName === "Northfield Pest Supply Inc.", "只差公司后缀：疑似同一家", b);
  ok(c.status === "UNRELATED", "名称相近但不是同一家：无关", c);
  const pk = aliasPairKey("Northfield Pest Supply", "Northfield Pest Supply Inc.");
  const confirmed = decideAlias({ pairKey: pk, nameA: "Northfield Pest Supply", nameB: "Northfield Pest Supply Inc." }, { decision: "CONFIRMED", decidedBy: "u1", decidedAt: NOW.toISOString() });
  const rejected = decideAlias({ pairKey: pk, nameA: "Northfield Pest Supply", nameB: "Northfield Pest Supply Inc." }, { decision: "REJECTED", decidedBy: "u1", decidedAt: NOW.toISOString() });
  ok(confirmed.ok && matchImporter("Northfield Pest Supply", winners, [confirmed.decision]).status === "MATCHED", "人工确认后：挂上");
  ok(rejected.ok && matchImporter("Northfield Pest Supply", winners, [rejected.decision]).status === "UNRELATED", "否决后：按无关处理，不再建议");
  const both = matchImporter("Boreal Outfitters", ["Boreal Outfitters Ltd.", "Boreal Outfitters Inc."], []);
  ok(both.status === "SUGGESTED" && both.suggestions.length === 2, "与两个中标者都疑似：各列一对", both);
  const mixed = matchImporter("Boreal Outfitters Ltd.", ["Boreal Outfitters Ltd.", "Boreal Outfitters"], []);
  ok(mixed.status === "MATCHED" && mixed.winners.join() === "Boreal Outfitters Ltd.", "既同名又疑似：以同名为准", mixed);
  ok(candidatePairKeys(["Northfield Pest Supply", "Other"], winners).join() === pk, "候选对只含疑似同一家的那几对");
  // 比对器与 TI-3a 的 compareCompanyNames / aliasPairKey 逐对一致
  const names = ["Northfield Pest Supply Inc.", "NORTHFIELD PEST SUPPLY, INC", "Northfield Pest Supply", "Northfield Pet Supply", "P&G Trading Ltd", "P and G Trading", "A.B.C.", "ＡＢＣ Trading", "ABC Trading Co", "Boreal Outfitters", "Boreal Outfitters Ltd.", "Boreal", "The Boreal Outfitters Co. Ltd.", "", "宁波 床品 有限公司", "宁波 床品"];
  let same = true;
  for (const a of names) for (const b of names) {
    const want = compareCompanyNames(a, b);
    const got = relatePrepared(prepareName(a), prepareName(b));
    if (want.relation !== got.relation || ("basis" in want ? want.basis : "") !== ("basis" in got ? got.basis : "") || (want.relation !== "UNRELATED" && aliasPairKey(a, b) !== preparedPairKey(prepareName(a), prepareName(b)))) { same = false; console.error("diff", a, b, want, got); }
  }
  ok(same, "比对器与 TI-3a 的名称比对规则逐对一致（同名、只差后缀、整词包含、无关；配对键）");
  const bigWinners = Array.from({ length: 200 }, (_, i) => `Winner Company Number ${i} ${"x".repeat(200)} Inc.`);
  const bigImporters = Array.from({ length: 2000 }, (_, i) => `Winner Company Number ${i % 200} ${"x".repeat(200)} Branch ${i}`);
  const t0 = Date.now();
  candidatePairKeys(bigImporters, bigWinners);
  const matcher = createImporterMatcher(bigWinners, []);
  for (const imp of bigImporters) matcher(imp);
  const ms = Date.now() - t0;
  ok(ms < 5000, `2000 条长名称 × 200 个中标者：比对在 5 秒内（实测 ${ms} ms）`, ms);
  ok(winnersStateMessage("not_connected") === "授标记录还没有接通，没法比对历史中标者（请联系管理员开启）。" && winnersStateMessage("no_buyer") === "项目没有采购方名称，没法找历史中标者。" && winnersStateMessage("none") === "本项目采购方还没有他人中标的记录（不含我方结果），没法比对。", "没有可比对的中标者：三种原因");
}

// ── 线索只是线索 ──
{
  const lead = createImportLead({ importerName: "A", exporterName: "B", sourceKind: manualPasteProvider.sourceKind, capturedAt: NOW.toISOString(), shipmentDate: "2024-06-15", evidenceRef: "https://x.test" }, NOW);
  ok(lead.ok && lead.lead.statusZh === "线索，未证实当前供货" && lead.lead.isHistorical === true && IMPORT_LEADS_TEXT.leadStatus === "线索，未证实当前供货", "2024-06-15 的记录：线索、未证实当前供货，标为历史", lead);
  ok(IMPORT_LEADS_TEXT.caveat === "历史进口关联只是寻源线索：不代表独家、不代表当前供货，也不代表对方的投标价。", "线索说明原文");
  const notes = importLeadSourceNotesZh();
  ok(notes.join("|") === "授权贸易 / 提单数据：未接通。这不表示没有记录，而是没有查。|" + MANUAL_SOURCE_NOTE_ZH && MANUAL_SOURCE_NOTE_ZH === "人工导入：把你在别处查到的进口记录贴进来；系统不接入、也不访问任何提单库或网站。", "来源情况两句", notes);
  const view: ImportLeadsView = {
    caveatZh: IMPORT_LEADS_TEXT.caveat, leadStatusZh: IMPORT_LEADS_TEXT.leadStatus, sourceNotesZh: notes, winners: { status: "ok", names: ["W"] },
    suggestions: [{ pairKey: "k", importerName: "I", winnerName: "W", basisZh: "只差公司后缀", recordCount: 1 }],
    exporters: aggregateByExporter([{ exporterName: "E", shipmentDate: "2026-01-01", goods: "tent", winners: ["W"], linkedSupplier: { id: "s", name: "E", hasEmail: false, active: true } }], { now: NOW, requirementTexts: ["Tents"] }),
    leadCount: 1, storedLeadCount: 2, canDecideAliases: false, decidedPairs: [], canEdit: true,
  };
  const keys = new Set<string>();
  const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  walk(view);
  ok(![...keys].some((k) => /recommend|price|cost|margin|bid|score|rank/i.test(k)), "视图各层的键里没有推荐、价格、成本、毛利、投标价", [...keys]);
}

// ── 汇总 ──
{
  const L = (exporterName: string, shipmentDate: string | null, goods: string | null = null, winners = ["W1"]) => ({ exporterName, shipmentDate, goods, winners, linkedSupplier: null });
  const rows = [
    L("甲 Co", "2026-09-01"), L("甲 Co", "2026-10-01"),
    L("乙 Co", "2024-01-01"), L("乙 Co", "2024-02-01"), L("乙 Co", "2024-03-01"), L("乙 Co", "2024-04-01"), L("乙 Co", "2024-05-01"),
    L("丙 Co", "2026-08-01"), L("丙 Co", "2026-07-01"), L("丙 Co", "2024-01-01"), L("丙 CO.", null, null, ["W2"]),
  ];
  const s = aggregateByExporter(rows, { now: NOW, requirementTexts: [] });
  ok(s.map((x) => x.exporterName).join() === "丙 Co,甲 Co,乙 Co", "排序：近 12 个月票数、票数、最近一票，再按名称", s.map((x) => [x.exporterName, x.last12Months, x.shipments]));
  const c = s[0], y = s[2];
  ok(c.shipments === 4 && c.last12Months === 2 && c.latestDate === "2026-08-01" && c.historical === false && c.winnerNames.join() === "W1,W2", "丙：4 票、近 12 个月 2 票、对应两个中标者", c);
  ok(y.historical === true && y.last12Months === 0 && y.latestDate === "2024-05-01", "乙：已超过 12 个月", y);
  const tomorrow = aggregateByExporter([L("戊", "2026-11-21")], { now: NOW, requirementTexts: [] });
  ok(tomorrow[0].last12Months === 1 && tomorrow[0].latestDate === "2026-11-21", "UTC 明天的日期（时差）：算进近 12 个月，与解析的界线一致", tomorrow);
  ok(IMPORT_LEADS_TEXT.leadCap(5000, 5000) === "这个项目已有 5000 条进口记录（含在供应链页标为不采用的），最多 5000 条，这一批放不下了。", "上限那一句写明含标为不采用的");
  const unknown = aggregateByExporter([L("丁", null)], { now: NOW, requirementTexts: [] });
  ok(unknown[0].historical === null && unknown[0].latestDate === null && IMPORT_LEADS_TEXT.dateUnknown === "日期未知", "都没有日期：日期未知");
  ok([...keywordsOf("Sleeping bags, rated -20C; the bags shall include compression sacks")].sort().join() === "bag,compression,rated,sack,sleeping", "关键词：英文词、去虚词、去词尾 s");
  ok(sharedKeywords(["Sleeping Bags 3-season", "Tent poles"], ["Sleeping bag rated to -20C", "Tents shall be 4-person"]).join() === "bags,sleeping,tent", "品名与要求共有的词：按去词尾 s 比，显示品名里的原词，按字母序");
  ok(sharedKeywords(["Lithium batteries"], ["Battery pack"]).join() === "batteries" || sharedKeywords(["Lithium batteries"], ["Batteries pack"]).join() === "batteries", "不显示截出来的「batterie」");
  const okW = { status: "ok" as const, names: ["W1"] };
  const pend = [{ pairKey: "k", importerName: "I", winnerName: "W", basisZh: "只差公司后缀", recordCount: 3 }];
  ok(slotSummaryZh({ exporters: s, leadCount: 11, storedLeadCount: 11, winners: okW, suggestions: [] }) === "3 家出口商（11 条线索）" && slotSummaryZh({ exporters: [], leadCount: 0, storedLeadCount: 0, winners: okW, suggestions: [] }) === "还没有导入进口记录。", "槽里的摘要：有线索 / 一条都没有");
  ok(slotSummaryZh({ exporters: [], leadCount: 0, storedLeadCount: 3, winners: okW, suggestions: pend }) === "已导入 3 条进口记录，都在等组织管理员确认是不是同一家（打开进口线索查看）。" && slotSummaryZh({ exporters: [], leadCount: 0, storedLeadCount: 3, winners: { status: "unavailable", messageZh: "x" }, suggestions: [] }) === "已导入 3 条进口记录；历史中标者现在读不出来，先不显示。" && slotSummaryZh({ exporters: [], leadCount: 0, storedLeadCount: 3, winners: okW, suggestions: [] }) === "已导入 3 条进口记录，但都对不上本采购方现在的历史中标者（或已标为不是同一家），不显示。", "存着线索但在等确认 / 中标者读不出来 / 都对不上：照实说，不说成没导入");
  ok(slotSummaryZh({ exporters: [], leadCount: 0, storedLeadCount: 0, winners: { status: "no_buyer", messageZh: "项目没有采购方名称，没法找历史中标者。" }, suggestions: [] }) === "暂时不能导入：项目没有采购方名称，没法找历史中标者。", "第一次来、没有可比对的中标者：槽里直接说为什么不能导入");
  const linkable = aggregateByExporter([
    { exporterName: "E", shipmentDate: null, goods: null, winners: ["W"], linkedSupplier: { id: "s", name: "E", hasEmail: true, active: true } },
    { exporterName: "E", shipmentDate: null, goods: null, winners: ["W"], linkedSupplier: null, linkable: true },
  ], { now: NOW, requirementTexts: [] });
  ok(linkable[0].supplier?.id === "s" && linkable[0].unlinkedLeads === 1, "已在供应商库、又新导入了一条：还有 1 条没关联", linkable);
  ok(importResultZh({ totalRecords: 20, imported: 5, matched: 3, suggested: 2, duplicates: 1, unrelated: 4, unrelatedImporters: ["甲", "乙"], problemRecords: 10 }) === "共 20 条：导入 5 条（3 条已对应中标者，2 条要等组织管理员确认是不是同一家）；重复跳过 1 条；4 条的进口商不是这个采购方的中标者，没有保存（甲、乙）；10 条有问题没有导入，见下。", "导入结果那一句");
  ok(importResultZh({ totalRecords: 4, imported: 0, matched: 0, suggested: 0, duplicates: 4, unrelated: 0, unrelatedImporters: [], problemRecords: 0 }) === "共 4 条：没有新导入；重复跳过 4 条。" && importResultZh({ totalRecords: 2, imported: 2, matched: 2, suggested: 0, duplicates: 0, unrelated: 0, unrelatedImporters: [], problemRecords: 0 }) === "共 2 条：导入 2 条（2 条已对应中标者）。", "为 0 的那半句不写");
}

// ── 在其它页面上的显示 ──
{
  ok((SIGNAL_PLATFORMS as readonly string[]).includes("TRADE_DATA") && platformDisplay("TRADE_DATA").label === "进口记录（人工导入）" && sourceOriginDisplay("MANUAL_ENTRY").label === "人工录入", "信号列表：平台「进口记录（人工导入）」、来源「人工录入」");
  const brief = { productNames: ["sleeping bag"] } as unknown as Parameters<typeof prioritizeSignal>[0];
  ok(prioritizeSignal(brief, { platform: "TRADE_DATA", title: "sleeping bag" } as Parameters<typeof prioritizeSignal>[1]) === null && prioritizeSignal(brief, { platform: "MANUAL", title: "sleeping bag" } as Parameters<typeof prioritizeSignal>[1]) !== null, "进口记录不带找厂优先级（别的平台照旧）");
  ok((SUPPLIER_SOURCE_LABELS as Record<string, string>).trade_data === "进口线索", "供应商来源 trade_data 显示为「进口线索」");
  for (const f of ["src/app/(main)/suppliers/supplier-table.tsx", "src/app/(main)/suppliers/[id]/page.tsx", "src/app/(main)/suppliers/page.tsx", "src/app/(main)/suppliers/supplier-filters.tsx"]) {
    ok(/trade_data: "进口线索"/.test(readFileSync(path.join(process.cwd(), f), "utf8")), `${f}：来源名称表有「进口线索」`);
  }
}

// ── 源码断言 ──
{
  const root = process.cwd();
  const read = (f: string) => readFileSync(path.join(root, f), "utf8");
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const dir = "src/lib/tender-import-leads";
  const files = readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".ts")).map((f) => `${dir}/${f}`);
  const routes = ["src/app/api/projects/[id]/tender-intel/import-leads/route.ts", "src/app/api/projects/[id]/tender-intel/import-leads/aliases/route.ts", "src/app/api/projects/[id]/tender-intel/import-leads/aliases/revoke/route.ts", "src/app/api/projects/[id]/tender-intel/import-leads/suppliers/route.ts"];
  for (const f of [...files, ...routes, "src/components/tender-intel/import-leads-panel.tsx"]) {
    let code = "";
    try { code = strip(read(f)); } catch { ok(false, `${f} 存在`); continue; }
    ok(!/\bfetch\(|axios|node:https?|from ["']https?["']|undici|got\(|from ["'][^"']*(openai|anthropic|@ai-sdk|\/llm|\/ai\/)[^"']*["']|callStructured\(|generateText\(/.test(code.replace(/apiFetch\(/g, "")), `${f}：没有网络请求、没有模型调用`);
  }
  ok(readdirSync(path.join(root, "src/lib/tender-competition")).filter((f) => f.endsWith(".ts")).length === 5, "tender-competition/ 仍是 5 个文件（线索层不碰库的守卫不动）");
  const access = read("src/lib/tender-import-leads/api-access.ts");
  ok(/access\.status === 401 \? access : notFound\(\)/.test(access) && /!isSuperAdmin\(access\.user\.role\) && !access\.orgRole/.test(access) && access.indexOf("isImportLeadsEnabledForOrg(orgId)") > access.indexOf("access.orgRole") && /status: 403/.test(access), "接口判定顺序：401 → 不能读或非有效成员 404 → 开关 404 → 写不了 403");
  for (const r of routes) ok(/requireImportLeads(Read|Write|AliasDecide)\(request, projectId\)/.test(read(r)), `${r}：走统一的权限判定`);
  // CHAIN-3c：裁决与撤回只限组织管理员
  for (const r of ["src/app/api/projects/[id]/tender-intel/import-leads/aliases/route.ts", "src/app/api/projects/[id]/tender-intel/import-leads/aliases/revoke/route.ts"]) ok(/requireImportLeadsAliasDecide\(request, projectId\)/.test(read(r)) && !/requireImportLeadsWrite\(/.test(read(r)), `${r}：裁决与撤回走组织管理员判定`);
  ok(/isSuperAdmin\(access\.user\.role\) \|\| \(!!access\.orgRole && hasOrgRole\(access\.orgRole, "org_admin"\)\)/.test(access) && /IMPORT_LEADS_TEXT\.notOrgAdmin, code: "NOT_ORG_ADMIN" \}, \{ status: 403/.test(access), "组织管理员 = 平台超级管理员或组织角色不低于 org_admin 的有效成员；其他人 403");
  const svc = read("src/lib/tender-import-leads/service.ts");
  ok(/linkSignalToSupplier\(/.test(svc) && /sourceOrigin: "MANUAL_ENTRY"/.test(svc) && /pg_advisory_xact_lock/.test(svc) && !/supplierDiscoverySignal\.update(Many)?\(/.test(svc), "服务：线索走既有关联流程、不直接改信号；来源人工录入；写操作加锁");
  ok(/export const MAX_PROJECT_LEADS = 5000;/.test(svc) && /stored \+ fresh\.length > MAX_PROJECT_LEADS/.test(svc) && /= ANY\(\$\{keys\}::text\[\]\)/.test(svc), "每个项目最多 5000 条，到了上限拒绝；查重在库里按这一批的去重键查（不受读视图条数限制）");
  ok(/tx\.supplier\.findMany\(\{ where: \{ orgId: input\.orgId \}, orderBy: \{ updatedAt: "desc" \}/.test(svc) && !/take: 200/.test(svc), "同名供应商在本组织里全量比（不按前缀筛、不截 200 条）");
  ok(/content-length/.test(access) && access.indexOf("content-length") < access.indexOf("getReader()") && /total > maxBytes/.test(access) && !/request\.text\(\)/.test(access), "请求体先看声明的长度，超了不读；没声明的边读边数，超了就停");
  const slots = read("src/components/tender-intel/org-award-intel-slots.tsx");
  ok(/importLeads\.state\.kind === "hidden" \|\| importLeads\.state\.kind === "loading" \? \(\s*empty\("规划中：M3 海关数据源（Trade 域证据只读引用）接入后启用"\)/.test(slots) && /<ImportLeadsPanel /.test(slots), "供应链槽：读取中与接口 404 时仍是原来的规划占位句与徽标；开着时是摘要，面板在网格下方");
  const supplierPage = read("src/app/(main)/suppliers/[id]/page.tsx");
  ok(/>补邮箱</.test(supplierPage) && /saveContact\(\{ status: "active" \}\)/.test(supplierPage) && /method: "PATCH"/.test(supplierPage) && ["邮箱格式不对，请检查。", "还没有联系邮箱（没有邮箱不能发询价）", "这家供应商已停用，不能发询价。", "已启用。", "已保存。在项目里点「问供应商要价」就能勾选这家。", "没有保存成功，请稍后再试。"].every((t) => supplierPage.includes(t)), "供应商页：能直接补邮箱、启用，各种结果都有一句");
  ok(/status=\{importLeads\.state\.kind === "hidden" \|\| importLeads\.state\.kind === "loading" \? \(intel\?\.supplyChain\.status \?\? null\) : null\}/.test(slots), "开关开时槽不显示状态徽标");
  const panel = read("src/components/tender-intel/import-leads-panel.tsx");
  ok(IMPORT_LEADS_TEXT.aliasConfirmed === "已确认是同一家，相关记录已加入出口商汇总。" && IMPORT_LEADS_TEXT.aliasRejected === "已标为不是同一家，这些记录不再显示。" && /IMPORT_LEADS_TEXT\.aliasConfirmed : IMPORT_LEADS_TEXT\.aliasRejected/.test(panel), "裁决后写明结果");
  ok(/可能是同一家（\{s\.basisZh\}），涉及 \{s\.recordCount\} 条记录。/.test(panel) && /IMPORT_LEADS_UI\.supplierNotAdded/.test(panel) && /join\(" · "\)/.test(panel) && /IMPORT_HEADER_NAMES_ZH/.test(panel), "面板：疑似同一家那一句；供应商库状态一行写完；导入框下列出表头可写的名字");
  ok(["进口线索（人工导入）", "收起进口线索", "进口记录（连同表头）", "来源说明", "本项目采购方的历史中标者（来自授标记录，不含我方结果）：", "要确认是不是同一家", "出口商汇总", "操作没有成功，请稍后再试。", "网络出错，请稍后再试。", "正在加入…", "正在导入…", "未加入供应商库", "缺联系邮箱，去补邮箱", "对不上中标者的记录不用改，重新导入也会跳过。"].every((t) => panel.includes(t)) && /等 \$\{n\} 家/.test(panel), "面板的固定说法");
  ok(/供货给：/.test(panel) && /共 \{e\.shipments\} 票，近 12 个月 \{e\.last12Months\} 票/.test(panel) && /最近一票 /.test(panel) && /和本标要求重合的词：/.test(panel) && /IMPORT_LEADS_UI\.linkNew\(e\.unlinkedLeads\)/.test(panel), "出口商汇总的说法与「关联新导入的 N 条」");
  ok(/view\.caveatZh/.test(panel) && /view\.sourceNotesZh/.test(panel) && /需要的列：进口商、出口商；可选：日期、品名、数量、来源网址。/.test(panel) && /window\.confirm\(IMPORT_LEADS_UI\.confirmReject\)/.test(panel) && /window\.confirm\(IMPORT_LEADS_UI\.confirmSame\)/.test(panel) && /本组织所有项目/.test(panel) && /view\.canEdit \?/.test(panel) && /IMPORT_LEADS_UI\.readOnly/.test(panel) && /进口线索暂时读不出来，请稍后刷新。/.test(panel) && /导入 \/ 查看进口线索/.test(panel) && /aria-live="polite"/.test(panel) && /if \(r\.problems\.length === 0 && r\.unrelated === 0\) setText\(""\)/.test(panel), "面板：线索说明、来源情况、需要的列；两种裁决都先确认并说明对全组织生效；只读的人有说明；出错一句话；有没导入的记录时保留原文");
  ok(IMPORT_COLUMNS_HINT_ZH === "把表格里的记录连同表头一起粘贴进来（逗号或制表符分隔）。需要的列：进口商、出口商；可选：日期、品名、数量、来源网址。", "导入框说明需要的列");
}

{
  // CHAIN-3c：有效裁决由撤回行指向决定，不靠时间先后
  const tgt = new Map([["t1", "p1"], ["t2", "p2"]]);
  const dec = (id: string, targetId: string, pairKey: string, decision: string, at: number) => ({ id, action: IMPORT_LEAD_ALIAS_AUDIT_ACTION, targetId, createdAt: new Date(at), afterData: JSON.stringify({ pairKey, nameA: "A", nameB: "B", decision, decidedBy: "u", decidedAt: new Date(at).toISOString() }) });
  const rev = (id: string, targetId: string, revokedAuditId: string, at: number) => ({ id, action: IMPORT_LEAD_ALIAS_REVOKE_AUDIT_ACTION, targetId, createdAt: new Date(at), afterData: JSON.stringify({ pairKey: "p1", revokedAuditId, revokedBy: "u", revokedAt: "x" }) });
  ok(effectiveDecisions([dec("a1", "t1", "p1", "CONFIRMED", 1000)], tgt)[0]?.auditId === "a1", "只有一条裁决：有效，带审计行 id");
  ok(effectiveDecisions([dec("a1", "t1", "p1", "CONFIRMED", 1000), rev("r1", "t1", "a1", 500)], tgt).length === 0, "撤回行时间比裁决早（时钟偏差）：照样撤回");
  const again = effectiveDecisions([dec("a1", "t1", "p1", "CONFIRMED", 1000), rev("r1", "t1", "a1", 2000), dec("a2", "t1", "p1", "REJECTED", 1500)], tgt);
  ok(again.length === 1 && again[0].auditId === "a2" && again[0].decision === "REJECTED", "撤回后重新裁决（新裁决的时间甚至早于撤回行）：新裁决有效");
  ok(effectiveDecisions([dec("a1", "t1", "p1", "CONFIRMED", 1000), rev("r1", "t1", "other", 2000)], tgt)[0]?.auditId === "a1", "撤回行指向别的裁决：这条仍有效");
  ok(effectiveDecisions([dec("a1", "t1", "p1", "CONFIRMED", 1000), { ...rev("r1", "t1", "a1", 2000), afterData: "not json" }], tgt).length === 1, "形状不对的撤回行不算");
  ok(effectiveDecisions([dec("a1", "t1", "p1", "CONFIRMED", 1000), dec("a2", "t2", "p2", "REJECTED", 1000), rev("r1", "t1", "a1", 2000)], tgt).map((d) => d.pairKey).join() === "p2", "撤回只影响它指向的那一对");
  const two = effectiveDecisions([dec("a1", "t1", "p1", "CONFIRMED", 1000), dec("a2", "t1", "p1", "REJECTED", 2000)], tgt);
  ok(two.length === 1 && two[0].auditId === "a2" && two[0].recordedAt === new Date(2000).toISOString(), "两条都没撤回（只可能来自手工改库）：取最新的一条，带写入时间");
  ok(effectiveDecisions([dec("a1", "t1", "p1", "CONFIRMED", 1000), { ...dec("a2", "t1", "p1", "REJECTED", 2000), afterData: "{}" }], tgt)[0]?.auditId === "a1", "最新一行形状不对：退回更早的有效裁决");
  ok(IMPORT_LEAD_ALIAS_REVOKE_AUDIT_ACTION === "tender.import_lead_alias_revoked" && IMPORT_LEAD_ALIAS_AUDIT_ACTION === "tender.import_lead_alias_decided", "两种审计 action");
  const finder = createCandidatePairFinder(["Northfield Pest Supply Inc.", "Boreal Outfitters"]);
  const pairs = finder("NORTHFIELD PEST SUPPLY");
  ok(pairs.length === 1 && pairs[0].winnerName === "Northfield Pest Supply Inc." && pairs[0].pairKey === candidatePairKeys(["NORTHFIELD PEST SUPPLY"], ["Northfield Pest Supply Inc.", "Boreal Outfitters"])[0] && finder("Northfield Pest Supply Inc.").length === 0 && finder("").length === 0, "候选的对：只列疑似同一家（同名不算），与 candidatePairKeys 同一把键");
  ok(IMPORT_LEADS_TEXT.notOrgAdmin === "只有组织管理员能确认、否决或撤回「是不是同一家」（对本组织所有项目生效）。" && IMPORT_LEADS_TEXT.revokeConflict === "同事已经撤回或改过这一对的裁决，页面已更新；请看清现在的结论再操作。" && IMPORT_LEADS_TEXT.pairNotInProject === "本项目已没有涉及这一对的记录（可能刚在供应链页标为不采用，或历史中标者有变），页面已更新。" && IMPORT_LEADS_TEXT.formerMember === "本组织以外的人" && IMPORT_LEADS_TEXT.unnamedMember === "本组织成员（未填姓名）" && IMPORT_LEADS_TEXT.revokedNotPendingHere === "本项目里这家进口商已和别的中标者对上，这一对不会显示为待确认。", "撤回与权限的固定说法");
  ok(IMPORT_LEADS_TEXT.revokedConfirmed("A", "B") === "已撤回「A」和「B」的确认，这一对回到待确认；靠它对上的记录已移出出口商汇总（已加入供应商库的不受影响）。" && IMPORT_LEADS_TEXT.revokedRejected("A", "B") === "已撤回「A」和「B」的否决，这一对回到待确认。否决期间导入时被当作「不是这个采购方的中标者」跳过的记录没有保存，需要的话请重新导入原表（已导入的不会重复）。", "撤回后按结论写出结果");
  const panel = readFileSync(path.join(process.cwd(), "src/components/tender-intel/import-leads-panel.tsx"), "utf8");
  ok(["只有组织管理员能确认或否决（对本组织所有项目生效）；在那之前，这些记录不进出口商汇总，也不能加入供应商库。请组织管理员打开本项目的进口线索处理。", "哪一对判断错了，请组织管理员在这里撤回。", "已裁决的（对本组织所有项目生效）", "已确认是同一家", "已标为不是同一家", "裁决人：", "正在撤回…", "确定是同一家吗？确认后本组织所有项目都会把这两个名称当成同一家；组织管理员可以撤回。", "确定不是同一家吗？否决后本组织所有项目都不再把这两个名称当成同一家，也不再提示；之后各项目再导入这家进口商的记录会被跳过、不保存（撤回后也要重新导入）。组织管理员可以撤回。", "你只有查看权限；导入和加入供应商库需要能修改本项目。"].every((t) => panel.includes(t)) && !panel.includes("不能撤回"), "面板：撤回与权限的固定说法；不再写「不能撤回」");
  ok(panel.includes("撤回「${importer}」和中标者「${winner}」是同一家的确认？撤回后这一对回到「要确认是不是同一家」，本组织所有项目里靠它对上的进口记录会移出出口商汇总，等重新确认；已加入供应商库的供应商和关联不变。") && panel.includes("撤回「${importer}」和中标者「${winner}」不是同一家的否决？撤回后这一对回到「要确认是不是同一家」，本组织所有项目里否决前存着的记录会重新显示为待确认；否决期间导入时被跳过的记录不会自动回来，要重新导入。"), "撤回前按结论分别确认、写出两个名称");
  ok(/canDecide=\{view\.canDecideAliases\}/.test(panel) && /\{view\.canDecideAliases \? null : <p className="mt-1 text-muted">\{IMPORT_LEADS_UI\.notAdminNote\}<\/p>\}/.test(panel) && /\{view\.canDecideAliases \? null : <p className="mt-1 text-muted">\{IMPORT_LEADS_UI\.notAdminDecidedNote\}<\/p>\}/.test(panel) && /if \(window\.confirm\(text\)\) revoke\(d\);/.test(panel) && /decisionId: d\.decisionId/.test(panel), "面板：裁决与撤回按钮只给组织管理员；撤回先确认、带裁决标识");
  ok(/「\{d\.importerName\}」和中标者「\{d\.winnerName\}」：\{d\.decision === "CONFIRMED" \? IMPORT_LEADS_UI\.decidedConfirmed : IMPORT_LEADS_UI\.decidedRejected\}（\{IMPORT_LEADS_UI\.decidedBy\}\{d\.deciderName\}，\{d\.decidedOn\}），涉及 \{d\.recordCount\} 条记录。/.test(panel) && /next\.suggestions\.some\(\(x\) => x\.pairKey === d\.pairKey\) \? base0 : `\$\{base0\}\$\{IMPORT_LEADS_TEXT\.revokedNotPendingHere\}`/.test(panel), "面板：已裁决的每一对那一句；撤回后这一对不会待确认时另说明");

}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
