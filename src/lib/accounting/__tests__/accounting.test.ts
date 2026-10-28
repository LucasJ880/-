/**
 * PERM-5a：会计视图（不连库）
 *   提成口径与原本人接口逐项等价、分组、月份 / 季度解析、CSV、工作区与导航、接口源码断言（不出成本 / 个人资料）
 * 运行：npx tsx src/lib/accounting/__tests__/accounting.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { groupCommissionBySales, summarizeCommission, type CommissionQuoteInput } from "../commission";
import { parseMonth, parseQuarter } from "../period";
import { toCsv } from "../csv";
import {
  canAccessAccountingWorkspace,
  getAccessibleWorkspaces,
  getDefaultWorkspace,
  resolveHomeRedirect,
} from "@/lib/rbac/workspace-policy";
import { NAVIGATION_REGISTRY, isNavItemVisible, type NavigationFilterContext } from "@/lib/navigation";
import { mergedProfileBindings } from "@/lib/authorization/role-defaults";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

/** 本次改动前 /api/sales/commission-summary 的内联实现（逐行照抄），用于等价校验 */
function legacyInline(quotes: CommissionQuoteInput[], commissionRate: number) {
  let realMargin = 0;
  let quotesWithCost = 0;
  let itemsCosted = 0;
  let itemsTotal = 0;
  for (const quote of quotes) {
    let quoteCosted = false;
    for (const item of quote.items) {
      itemsTotal += 1;
      if (item.costPrice != null) {
        realMargin += item.price - item.costPrice;
        itemsCosted += 1;
        quoteCosted = true;
      }
    }
    if (quoteCosted) quotesWithCost += 1;
  }
  realMargin = Math.round(realMargin * 100) / 100;
  return {
    quotesSigned: quotes.length,
    quotesWithCost,
    itemsCosted,
    itemsTotal,
    realMargin,
    realCommission: Math.round(realMargin * commissionRate * 100) / 100,
  };
}

console.log("PERM-5a 提成口径");
{
  const fixtures: Array<{ name: string; quotes: CommissionQuoteInput[]; rate: number }> = [
    { name: "空", quotes: [], rate: 0.3 },
    {
      name: "混合成本",
      quotes: [
        { grandTotal: 1130, items: [{ price: 500, costPrice: 300 }, { price: 500, costPrice: null }] },
        { grandTotal: 565.5, items: [{ price: 500.33, costPrice: 211.11 }] },
        { grandTotal: 99, items: [{ price: 99, costPrice: null }] },
      ],
      rate: 0.3,
    },
    { name: "小数舍入", quotes: [{ grandTotal: 0.1 + 0.2, items: [{ price: 0.1, costPrice: 0.005 }, { price: 0.2, costPrice: 0.001 }] }], rate: 0.333 },
    { name: "负毛利", quotes: [{ grandTotal: 100, items: [{ price: 100, costPrice: 150 }] }], rate: 0.25 },
  ];
  for (const f of fixtures) {
    const a = summarizeCommission(f.quotes, f.rate);
    const b = legacyInline(f.quotes, f.rate);
    const same = (Object.keys(b) as Array<keyof typeof b>).every((k) => a[k] === b[k]);
    ok(same, `与原本人接口逐项等价：${f.name}`, { a, b });
  }
  const mixed = summarizeCommission(fixtures[1].quotes, 0.3);
  ok(mixed.signedAmount === 1794.5, "成交金额 = Σ grandTotal（四舍五入到分）", mixed.signedAmount);
  ok(mixed.quotesSigned === 3 && mixed.quotesWithCost === 2 && mixed.itemsTotal === 4 && mixed.itemsCosted === 2, "无成本单计入签约数、不计入有成本单数");

  const grouped = groupCommissionBySales(
    [
      { createdById: "alex", grandTotal: 1000, items: [{ price: 900, costPrice: 600 }] },
      { createdById: "lynn", grandTotal: 3000, items: [{ price: 2800, costPrice: null }] },
      { createdById: "alex", grandTotal: 500, items: [{ price: 450, costPrice: 300 }] },
    ],
    0.3,
  );
  ok(grouped.length === 2 && grouped[0].salesUserId === "lynn" && grouped[1].salesUserId === "alex", "按销售分组、按成交金额倒序");
  ok(grouped[1].quotesSigned === 2 && grouped[1].realMargin === 450 && grouped[1].realCommission === 135, "Alex：2 单、毛利 450、提成 135");

  const route = read("src/app/api/sales/commission-summary/route.ts");
  ok(/summarizeCommission\(quotes, commissionRate\)/.test(route) && !/realMargin \+=/.test(route), "本人提成接口改用同一纯函数");
  ok(
    ["monthStart", "quotesSigned", "quotesWithCost", "itemsCosted", "itemsTotal", "realMargin", "commissionRate", "realCommission", "costRatesConfigured"].every((k) =>
      new RegExp(`\\b${k}\\b`).test(route),
    ) && !/signedAmount/.test(route),
    "本人提成接口响应字段不变（不新增 signedAmount）",
  );
}

console.log("PERM-5a 时间窗口");
{
  const m = parseMonth("2026-10");
  ok(!!m && m.label === "2026-10" && m.start.getMonth() === 9 && m.start.getDate() === 1 && m.end.getMonth() === 10, "2026-10 → [10/1, 11/1)");
  const dec = parseMonth("2026-12");
  ok(!!dec && dec.end.getFullYear() === 2027 && dec.end.getMonth() === 0, "12 月跨年");
  ok(parseMonth("2026-13") === null && parseMonth("2026-1") === null && parseMonth("abc") === null, "非法月份 → null");
  const now = new Date(2026, 9, 28);
  ok(parseMonth(null, now)?.label === "2026-10" && parseMonth("", now)?.label === "2026-10", "缺省 = 本月");
  const q = parseQuarter("2026-Q3");
  ok(q !== null && q !== "invalid" && q.start.getMonth() === 6 && q.end.getMonth() === 9, "2026-Q3 → [7/1, 10/1)");
  const q4 = parseQuarter("2026-q4");
  ok(q4 !== null && q4 !== "invalid" && q4.end.getFullYear() === 2027, "Q4 跨年、大小写不敏感");
  ok(parseQuarter(null) === null && parseQuarter("2026-Q5") === "invalid" && parseQuarter("2026Q1") === "invalid", "缺省 null、非法 invalid");
}

console.log("PERM-5a CSV");
{
  const csv = toCsv(["销售", "金额"], [["Alex, Jr.", 10], ['Lynn "L"', null]]);
  ok(csv.startsWith("﻿") && csv.includes('"Alex, Jr.",10') && csv.includes('"Lynn ""L""",') && csv.endsWith("\r\n"), "BOM + 逗号 / 引号转义 + CRLF");
}

console.log("PERM-5a 工作区与导航");
{
  const keysOf = (...profiles: string[]) => [
    ...new Set(profiles.flatMap((p) => mergedProfileBindings("window_covering_services_v1", p).map((b) => b.permissionKey))),
  ];
  const ctx = (keys: string[], platformRole = "user") => ({ platformRole, orgRole: "org_member", permissionKeys: keys, hasMembership: true });
  const acc = ctx(keysOf("accounting"));
  ok(canAccessAccountingWorkspace(acc) && getDefaultWorkspace(acc) === "/accounting" && resolveHomeRedirect(acc) === "/accounting", "纯会计 → 默认 /accounting");
  ok(getAccessibleWorkspaces(acc).includes("accounting"), "会计可访问工作区含 accounting");
  const bids = ctx(keysOf("bids"));
  ok(canAccessAccountingWorkspace(bids) && getDefaultWorkspace(bids) === "/bids", "招投标可进会计页但默认仍落 /bids");
  const rep = ctx(keysOf("sales_rep"), "sales");
  ok(!canAccessAccountingWorkspace(rep), "销售不可进会计页");
  const opsLead = ctx([...keysOf("ops_lead"), "accounting.read"]);
  ok(getDefaultWorkspace(opsLead) !== "/accounting", "持运营键的人不默认落地会计页");

  const navCtx = (keys: string[], platformRole = "user"): NavigationFilterContext => ({
    pathname: "/",
    platformRole,
    orgRole: "org_member",
    isPlatformAdmin: false,
    hasMembership: true,
    workspaceIds: ["ws1"],
    modules: { enabled: ["window_covering", "sales", "projects", "bids"] },
    permissionKeys: keys,
  });
  const accItem = NAVIGATION_REGISTRY.find((i) => i.href === "/accounting");
  ok(!!accItem && accItem.workspaceAccess === "accounting", "导航登记 /accounting（workspaceAccess = accounting）");
  const hasNav = (keys: string[], role?: string) => !!accItem && isNavItemVisible(accItem, navCtx(keys, role));
  ok(hasNav(keysOf("accounting")), "会计导航含会计视图");
  ok(!hasNav(keysOf("sales_rep"), "sales"), "销售导航不含会计视图");
  ok(read("src/lib/api-fetch.ts").includes('"/api/accounting/"'), "前端按当前企业为 /api/accounting/ 带 orgId");
}

console.log("PERM-5a 接口源码：权限与不输出字段");
{
  const svc = read("src/lib/accounting/service.ts");
  const quoteSelect = svc.slice(svc.indexOf("export async function loadQuoteProcess"), svc.indexOf("// ── 项目结算"));
  ok(!/costPrice|phone|email|address|notes|formDataJson|shareToken|signatureUrl|pdfPath|signedPdfPath/.test(quoteSelect), "报价过程 select 不含成本 / 联系方式 / 备注 / 表单 / 签名 / PDF");
  ok(/customer: \{ select: \{ name: true \} \}/.test(quoteSelect), "客户只取名称");
  const salesFn = svc.slice(svc.indexOf("export async function loadSalesSummary"), svc.indexOf("// ── 报价过程"));
  ok(/items: \{ select: \{ price: true, costPrice: true \} \}/.test(salesFn) && /bySales: SalesSummaryRow\[\] = groups\.map/.test(salesFn), "成本只进计算，输出是分组汇总");
  const projFn = svc.slice(svc.indexOf("export async function loadProjectSettlements"));
  ok(!/expenses|receipt|payments|vendor/i.test(projFn.slice(projFn.indexOf("out.push"), projFn.indexOf("return { available: true"))), "项目结算只取汇总字段");
  ok(/isFinancialControlEnabled\(\)/.test(projFn) && /available: false/.test(projFn), "财务未启用 → available:false");
  ok(/members: \{ some: \{ userId, status: "active" \} \}/.test(projFn) && /ownerId: userId/.test(projFn), "ASSIGNED = 成员或负责人");
  const ss = read("src/app/api/accounting/sales-summary/route.ts");
  ok(/requireAccountingPermissions\(user, orgRes\.orgId, \[ACCOUNTING_READ\]\)/.test(ss) && /action: "accounting\.export"/.test(ss), "成交汇总要 accounting.read；导出写审计");
  const qr = read("src/app/api/accounting/quotes/route.ts");
  ok(/\[ACCOUNTING_READ, "sales\.quote\.read"\]/.test(qr), "报价过程要 accounting.read + sales.quote.read");
  const pr = read("src/app/api/accounting/projects/route.ts");
  ok(/resolveProjectFinanceScope\(user, orgRes\.orgId\)/.test(pr), "项目结算按 project.finance.read 范围");
  const access = read("src/lib/accounting/access.ts");
  ok(/d\.scopes\.includes\("ORG"\)/.test(access), "成交 / 报价要求 ORG 范围");
  ok(!/project\.finance\.read|accounting/.test(read("src/lib/project-finance/access.ts")), "既有单项目财务授权未改（D4）");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
