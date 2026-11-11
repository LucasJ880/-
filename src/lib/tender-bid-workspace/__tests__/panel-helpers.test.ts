/**
 * TI-4b 面板的两个纯函数 + 面板源码断言
 * 运行：npx tsx src/lib/tender-bid-workspace/__tests__/panel-helpers.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { costSheetRequestSchema, saveWorkspaceRequestSchema } from "../contract";
import {
  buildCostRequest, costDraftStorageKey, currenciesNeedingFx, emptyCostDraft, emptyDraftLine, parseCostDraft, type CostDraft,
} from "../cost-draft";
import { nowWithOffset, parseHolderNames, parseSchedulePaste, splitRow } from "../paste-import";
import { validatePriceSchedule, type PriceScheduleLine } from "@/lib/tender-price-schedule/contract";
import { OTTAWA_18026_LINES } from "@/lib/tender-price-schedule/__tests__/fixtures/ottawa-18026";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

/* ---------- 价格表粘贴 ---------- */
console.log("价格表粘贴");
const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return s.includes(",") ? `"${s}"` : s;
};
const HEADER = "Item,Description,Quantity,UOM,Pack,Dimensions,Min Dimensions,Certification";
const csv = [HEADER, ...OTTAWA_18026_LINES.map((l) => [l.lineNo, l.description, l.quantity, l.uom, l.packCount, l.dimensions, l.minimumDimensions, l.certificationGate].map(csvCell).join(","))].join("\n");
const p = parseSchedulePaste(csv);
ok("渥太华 18 行带表头：解析出 18 行、跳过表头、没有问题行", p.lines.length === 18 && p.skippedHeader && p.issues.length === 0);
ok("带引号的字段里的逗号不拆列", p.lines[15].description === "Laundry Bags, Front Load" && p.lines[15].uom === "Roll" && p.lines[15].packCount === 25);
ok("单位与数量按原文保留，不换算", p.lines[9].uom === "Pack" && p.lines[9].quantity === "2349" && p.lines[9].packCount === 2);
ok("最小尺寸与认证要求落在各自的列", p.lines[12].minimumDimensions === "37.5 x 23 x 23" && p.lines[12].dimensions === null && /whole-equipment/.test(p.lines[12].certificationGate ?? ""));
ok("解析结果通过价格表结构校验", validatePriceSchedule(p.lines as unknown as PriceScheduleLine[]).valid);
ok("解析结果能通过保存接口的请求校验", saveWorkspaceRequestSchema.safeParse({ priceSchedule: { lines: p.lines } }).success);

const tsv = OTTAWA_18026_LINES.slice(0, 3).map((l) => [l.lineNo, l.description, l.quantity, l.uom, "", l.dimensions].join("\t")).join("\r\n");
const pt = parseSchedulePaste(tsv);
ok("制表符分隔、没有表头、行尾缺列也能解析", pt.lines.length === 3 && !pt.skippedHeader && pt.lines[0].dimensions === "39 x 77.5 x 9-15" && pt.lines[0].certificationGate === null);

const bad = parseSchedulePaste("1,Cover,abc,Each\n2,Box,10,Each\n3,,5,Each\n4,Bag,5,Roll,x");
ok("数量不是数字的行被报告，其余行照常解析", bad.lines.length === 1 && bad.lines[0].lineNo === 2 && bad.issues.length === 3);
ok("问题说明带行号与原文", bad.issues[0].row === 1 && bad.issues[0].messageZh.includes("abc"));
ok("千分位逗号的数量（带引号）可解析为数字", parseSchedulePaste('1,Cover,"2,367",Each').lines[0].quantity === "2367");
ok("空文本：零行零问题", parseSchedulePaste("  \n \n").lines.length === 0 && parseSchedulePaste("").issues.length === 0);
ok("splitRow：转义的双引号还原", splitRow('1,"He said ""hi"", ok",2')[1] === 'He said "hi", ok');

/* ---------- 领取方名单 ---------- */
console.log("文件领取方名单");
const names = parseHolderNames("Northfield Pest Supply Inc.\n\n Lakeshore   Linen Co. \nMaple Facility Products Ltd.\nHarbour Bedding Wholesale\nRideau Janitorial Supply\n\nCapital Textile Imports Inc.\nSUNNY SHUTTER INC\nPrairie Hospitality Goods\nSummit Thermal Equipment\n");
ok("九家名单夹空行：得到九条", names.length === 9);
ok("行内多余空白折叠", names[1].name === "Lakeshore Linen Co.");
ok("本地时间带时区偏移", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(nowWithOffset(new Date("2026-11-11T15:00:00Z"))));
ok("名单能通过保存接口的请求校验", saveWorkspaceRequestSchema.safeParse({
  documentHolders: { solicitationId: "18026-93121-T01", portal: "MERX", sourceKind: "USER_UPLOAD_TABLE", capturedAt: nowWithOffset(), entries: names },
}).success);

/* ---------- 成本草稿 ---------- */
console.log("成本草稿");
const draft: CostDraft = {
  ...emptyCostDraft(),
  lines: {
    "1": { ...emptyDraftLine(), unitPrice: " 30.00 ", currency: "cny", dutyRatePct: "18", freightCad: "1.20", localDeliveryCad: "0.50" },
    "2": emptyDraftLine(),
    "3": { ...emptyDraftLine(), sourcing: "DOMESTIC", unitPrice: "12", currency: "CAD", dutyRatePct: "18", freightCad: "0.80", evidenceKind: "SIGNED_QUOTE" },
  },
  fx: { CNY: { rate: "0.19", source: "Bank of Canada", asOf: "2026-11-10" } },
  reserveOnSalePct: "3",
};
const req = buildCostRequest(draft, [1, 2, 3, 4]);
ok("没填报价的行不进请求", req.lines.length === 2 && req.lines.map((l) => l.lineNo).join() === "1,3");
const l1 = req.lines[0];
ok("第 1 行：30.00 人民币按件，去掉首尾空白，币种转大写", l1.quote?.unitPrice === "30.00" && l1.quote?.currency === "CNY" && l1.quote?.basis === "PER_PIECE");
ok("第 1 行：汇率来自草稿（含来源与日期）", l1.fx?.rateCadPerUnit === "0.19" && l1.fx?.source === "Bank of Canada" && l1.fx?.asOf === "2026-11-10");
ok("第 1 行：18% 关税带上；运费进国际运费", l1.duty?.ratePct === "18" && l1.internationalFreightCad === "1.20" && l1.domesticFreightCad === null && l1.localDeliveryCad === "0.50");
const l3 = req.lines[1];
ok("本地采购行：不带关税、不带汇率，运费进国内运费", l3.duty === null && l3.fx === null && l3.domesticFreightCad === "0.80" && l3.internationalFreightCad === null);
ok("按售价留的预备金进请求", req.reserves?.length === 1 && req.reserves[0].mode === "ON_SALE" && req.reserves[0].ratePct === "3");
ok("定价方式与比率进请求", req.pricing.method === "MARGIN_ON_PRICE" && (req.pricing as { targetMarginPct: string }).targetMarginPct === "25");
ok("组装出的请求通过接口的请求校验", costSheetRequestSchema.safeParse(req).success);
ok("外币没填汇率：请求里汇率为空（由服务端判为不完整，不在前端猜）", buildCostRequest({ ...draft, fx: {} }, [1]).lines[0].fx?.rateCadPerUnit === null);
ok("需要汇率的币种：只列有报价的非加元币种", currenciesNeedingFx(draft).join() === "CNY");
ok("本地存储键按项目区分", costDraftStorageKey("p1") === "qy.bidWorkspace.costDraft.p1" && costDraftStorageKey("p1") !== costDraftStorageKey("p2"));
ok("草稿读回：往返一致", JSON.stringify(parseCostDraft(JSON.stringify(draft))) === JSON.stringify(draft));
ok("草稿读回：坏数据、旧版本、空值都给空草稿而不抛", [parseCostDraft("{oops"), parseCostDraft('{"version":0,"lines":{}}'), parseCostDraft(null)].every((d) => JSON.stringify(d) === JSON.stringify(emptyCostDraft())));

/* ---------- 面板源码断言 ---------- */
console.log("面板源码");
const root = resolve(__dirname, "../../../..");
const panel = readFileSync(resolve(root, "src/components/tender/bid-workspace-panel.tsx"), "utf8");
const tab = readFileSync(resolve(root, "src/components/project-detail/tabs/bid-tab.tsx"), "utf8");
const code = panel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const apiPaths = [...code.matchAll(/\/api\/[^"'`\s)]*/g)].map((m) => m[0]);
ok("只请求投标工作区的两个接口", apiPaths.length === 2 && apiPaths.every((u) => /^\/api\/projects\/\$\{projectId\}\/bid-workspace(\/cost-sheet)?$/.test(u)));
ok("请求方法只有读取、保存、计算（没有删除）", !/method:\s*"(DELETE|PATCH)"/.test(code) && (code.match(/method:\s*"PUT"/g) ?? []).length === 1 && (code.match(/method:\s*"POST"/g) ?? []).length === 1);
ok("没有审批、发信、提交之类的调用", !/pending-?action|PendingAction|approve|sendEmail|send-email|\/send|submit-bid|\/submit|mailto:/i.test(code));
ok("404（开关关闭）时不渲染任何内容", /res\.status === 404\) return setState\(\{ status: "off" \}\)/.test(code) && /if \(state\.status !== "ready"\) return null;/.test(code));
ok("没有「是否执行」之类的询问控件", !/window\.confirm|confirm\(|是否(需要|要|执行|查询)/.test(code));
ok("组件不做金额运算（不引用定点与核算函数）", !/project-finance\/money|computeCostScenario|buildCostSheetView|roundMoney|parseFloat|Number\(.*(Price|Cad|rate)/.test(code));
ok("成本输入只进浏览器本地存储", /window\.localStorage\.setItem\(storageKey/.test(code) && /costDraftStorageKey\(projectId\)/.test(code));
ok("写有「领取文件不等于投标」「不含 HST」的来源与 403 文案", panel.includes("领取文件不等于投标") && /t\.taxNote/.test(code) && panel.includes("需要财务查看权"));
ok("面板挂在「标书与报价」页签里", /import \{ BidWorkspacePanel \} from "@\/components\/tender\/bid-workspace-panel";/.test(tab) && /<BidWorkspacePanel projectId=\{projectId\} canManage=\{canManage\} \/>/.test(tab));
ok("计算成功后判定改用接口返回的判定；保存、清空、失败后作废", /onReadiness\(json\.readiness \?\? null\)/.test(code) && (code.match(/onReadiness\(null\)/g) ?? []).length === 3 && /setCostReadiness\(null\);\s*return null;/.test(code) && panel.includes("已计入本次成本核算"));
ok("导入入口只对有写权限的人显示", (code.match(/canManage &&/g) ?? []).length >= 3);

console.log(`\n✓ panel-helpers: ${passed} 项断言全部通过`);
