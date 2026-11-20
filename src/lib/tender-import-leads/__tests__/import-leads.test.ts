/**
 * CHAIN-3 进口线索 — 开关 / 解析与逐条校验 / 比对三档 / 汇总 / 视图文案 / 接线（纯函数 + 源码断言）
 * 运行：npx tsx src/lib/tender-import-leads/__tests__/import-leads.test.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isImportLeadsEnabledForOrgWithEnv } from "../flags";
import { BATCH_TEXT, IMPORT_COLUMNS_HINT_ZH, groupProblems, importDedupeKey, isHttpUrl, parseImportText, parseShipmentDate } from "../parse";
import { MANUAL_SOURCE_NOTE_ZH, importLeadSourceNotesZh, manualPasteProvider } from "../provider";
import { candidatePairKeys, matchImporter, uniqueWinnerNames } from "../match-pure";
import { IMPORT_LEADS_TEXT, aggregateByExporter, keywordsOf, sharedKeywords, slotSummaryZh, winnersStateMessage, type ImportLeadsView } from "../aggregate-pure";
import { aliasPairKey, decideAlias } from "@/lib/tender-competition/company-identity";
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
  ok(!prefix.ok && prefix.code === "MISSING_COLUMNS" && prefix.messageZh === "缺少必需的列：出口商。请连同表头一起粘贴。", "表头整格匹配：Shipper Address 不算出口商列", prefix);
}

// ── 整批不导入 ──
{
  const m = (t: string) => { const r = parse(t); return r.ok ? "" : r.messageZh; };
  ok(m("") === "没有可导入的内容。" && m("Importer,Exporter\n") === "没有可导入的内容。", "空内容 / 只有表头");
  ok(m("Importer,Goods\nA,B\n") === "缺少必需的列：出口商。请连同表头一起粘贴。" && m("Goods\nB\n") === "缺少必需的列：进口商、出口商。请连同表头一起粘贴。", "缺列");
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
  ok(groups.map((g) => g.messageZh).join(" | ") === "缺少出口商：第 1 条记录 | 日期「03/04/2025」认不出（请写成年在前，或为这一批选日期写法）：第 2 条记录 | 日期在未来：第 3 条记录 | 缺少来源网址，也没有填来源说明：第 4 条记录", "问题按原因归并，写明第几条记录", groups);
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
  ok(winnersStateMessage("not_connected") === "授标记录还没有接通（需管理员开启），没法比对历史中标者。" && winnersStateMessage("no_buyer") === "项目没有采购方名称，没法找历史中标者。" && winnersStateMessage("none") === "本项目采购方还没有他人中标的记录（不含我方结果），没法比对。", "没有可比对的中标者：三种原因");
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
    leadCount: 1, canEdit: true,
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
  const unknown = aggregateByExporter([L("丁", null)], { now: NOW, requirementTexts: [] });
  ok(unknown[0].historical === null && unknown[0].latestDate === null && IMPORT_LEADS_TEXT.dateUnknown === "日期未知", "都没有日期：日期未知");
  ok([...keywordsOf("Sleeping bags, rated -20C; the bags shall include compression sacks")].sort().join() === "bag,compression,rated,sack,sleeping", "关键词：英文词、去虚词、去词尾 s");
  ok(sharedKeywords(["Sleeping Bags 3-season", "Tent poles"], ["Sleeping bag rated to -20C", "Tents shall be 4-person"]).join() === "bag,sleeping,tent", "品名与要求共有的关键词，按字母序");
  ok(slotSummaryZh({ exporters: s, leadCount: 11 }) === "3 家出口商（11 条线索）" && slotSummaryZh({ exporters: [], leadCount: 0 }) === "还没有导入进口记录。", "槽里的摘要");
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
  const routes = ["src/app/api/projects/[id]/tender-intel/import-leads/route.ts", "src/app/api/projects/[id]/tender-intel/import-leads/aliases/route.ts", "src/app/api/projects/[id]/tender-intel/import-leads/suppliers/route.ts"];
  for (const f of [...files, ...routes, "src/components/tender-intel/import-leads-panel.tsx"]) {
    let code = "";
    try { code = strip(read(f)); } catch { ok(false, `${f} 存在`); continue; }
    ok(!/\bfetch\(|axios|node:https?|from ["']https?["']|undici|got\(|from ["'][^"']*(openai|anthropic|@ai-sdk|\/llm|\/ai\/)[^"']*["']|callStructured\(|generateText\(/.test(code.replace(/apiFetch\(/g, "")), `${f}：没有网络请求、没有模型调用`);
  }
  ok(readdirSync(path.join(root, "src/lib/tender-competition")).filter((f) => f.endsWith(".ts")).length === 5, "tender-competition/ 仍是 5 个文件（线索层不碰库的守卫不动）");
  const access = read("src/lib/tender-import-leads/api-access.ts");
  ok(/access\.status === 401 \? access : notFound\(\)/.test(access) && /!isSuperAdmin\(access\.user\.role\) && !access\.orgRole/.test(access) && access.indexOf("isImportLeadsEnabledForOrg(orgId)") > access.indexOf("access.orgRole") && /status: 403/.test(access), "接口判定顺序：401 → 不能读或非有效成员 404 → 开关 404 → 写不了 403");
  for (const r of routes) ok(/requireImportLeads(Read|Write)\(request, projectId\)/.test(read(r)), `${r}：走统一的权限判定`);
  const svc = read("src/lib/tender-import-leads/service.ts");
  ok(/linkSignalToSupplier\(/.test(svc) && /sourceOrigin: "MANUAL_ENTRY"/.test(svc) && /pg_advisory_xact_lock/.test(svc) && !/supplierDiscoverySignal\.update(Many)?\(/.test(svc), "服务：线索走既有关联流程、不直接改信号；来源人工录入；写操作加锁");
  const slots = read("src/components/tender-intel/org-award-intel-slots.tsx");
  ok(/importLeads\.state\.kind === "hidden" \? \(\s*empty\("规划中：M3 海关数据源（Trade 域证据只读引用）接入后启用"\)/.test(slots) && /<ImportLeadsPanel /.test(slots), "供应链槽：接口 404 时仍是原来的规划占位句；开着时是摘要，面板在网格下方");
  const panel = read("src/components/tender-intel/import-leads-panel.tsx");
  ok(/view\.caveatZh/.test(panel) && /view\.sourceNotesZh/.test(panel) && /需要的列：进口商、出口商；可选：日期、品名、数量、来源网址。/.test(panel) && /window\.confirm\(IMPORT_LEADS_UI\.confirmReject\)/.test(panel) && /view\.canEdit \?/.test(panel) && /进口线索暂时读不出来，请稍后刷新。/.test(panel) && /导入 \/ 查看进口线索/.test(panel), "面板：线索说明、来源情况、需要的列；「不是」先确认；不能修改的人没有导入框与按钮；出错一句话");
  ok(IMPORT_COLUMNS_HINT_ZH === "把表格里的记录连同表头一起粘贴进来（逗号或制表符分隔）。需要的列：进口商、出口商；可选：日期、品名、数量、来源网址。", "导入框说明需要的列");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
