/**
 * FIX-26 审计日志详情按财务查看权裁剪成本与毛利：纯函数 + 扫全仓审计写入调用的守卫（无 DB）
 * （openspec change legacy-quote-finance-gate，design D11；spec projects/legacy-quote-finance-view「审计详情不给没有财务查看权的人看成本与毛利」）
 * 运行：npx tsx src/lib/audit/__tests__/audit-detail-redaction.test.ts
 *
 * 守卫：用 TypeScript 语法树扫 src/**（不含 __tests__）里每个 logAudit( / writeAuditLog( / logAuditWithTx( 调用，
 * 取 beforeData / afterData 对象字面量里的全部键（含嵌套字面量）。键名像钱的——按驼峰 / 下划线拆词后有一个词是
 * price / amount / total / cost / margin / markup / profit / landed / rate / budget / fee（含复数），或整个键名含
 * cost / margin / markup / profit / landed——必须要么会被裁剪（写死清单或兜底规则），要么在下面写明理由的「可见」名单里。
 * 新加一个两边都不在的键，测试失败，逼着写的人决定藏还是给看。
 * 传变量而不是字面量的调用（beforeData / afterData 是变量、字面量里有展开、整个参数是变量）列成名单，与实际逐条核对：
 * 名单变了也失败（读到的人去看新调用带进去的是什么）。这些调用的内容靠读取侧按键名裁剪兜住。
 * 不在扫描范围的：直接 db.auditLog.create / tx.auditLog.create 的写入（不经这三个函数；读取侧同样按键名裁剪）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 2000) : ""); }
}
async function section(title: string, fn: () => Promise<void>) {
  console.log(`\n${title}`);
  try { await fn(); }
  catch (e) { fail++; console.error(`  ✗ 这一组没跑完：${e instanceof Error ? e.message.split("\n")[0] : String(e)}`); }
}
type Rec = Record<string, unknown>;

/** 写进审计、像钱但给没有财务查看权的审计读者看的键（卖价、对外价、公开数据、计数与分数） */
const VISIBLE_WITH_REASON: Record<string, string> = {
  sellingPrice: "我方卖价（对项目读者可见，FIX-25 D6）",
  sourceSellingPrice: "原版报价的卖价（同上）",
  ourBidPrice: "我方报价（对项目读者可见，FIX-25 D6）",
  winningBidPrice: "我方最终报价 / 中标价，是卖价不是成本（项目页对项目读者可见）",
  contractAmount: "公开授标金额（授标公告）",
  grandTotal: "销售报价给客户的总价",
  submittedTotal: "销售报价提交给客户的总价",
  promotionAmount: "销售报价对客户的优惠金额",
  total: "客户报价单合计 / 营销指标条数",
  totalProjects: "条数",
  totalRecords: "条数",
  totalYards: "库存码数",
  totalScore: "评分",
  officialTotalScore: "评分",
  priceEvidenceTier: "价格证据等级（标签，不是金额）",
  budgetTrimmed: "搜索额度被截断的标记（不是钱）",
  budgetVersionId: "预算版本 id（不是金额）",
};

/**
 * 传变量的审计写入（文件 → 槽位 → 次数）。槽位：beforeData 变量 / afterData 变量 / beforeData 展开 / afterData 展开 / 整个参数 / 参数里有展开。
 * 与财务有关的几条：quote-engine/import/import-service.ts（成本导入的 before / after 摘要）、quote-engine/service.ts（编辑报价前的卖价）、
 * quote-engine/tender-bid.ts（选为我方报价前的指针与卖价）、
 * bid-page-v2 两个 service（逐行报价 / 只报总价保存前的摘要）、muse-bridge/router.ts（Muse 账本行：整份回复，含所选供应商落地价）。
 */
const VARIABLE_CALLS: Record<string, number> = {
  "src/app/api/marketing/attributions/backfill/route.ts afterData 展开": 1,
  "src/app/api/marketing/attributions/route.ts afterData 变量": 1,
  "src/app/api/marketing/brand-profile/route.ts afterData 展开": 1,
  "src/app/api/marketing/brand-profile/route.ts beforeData 变量": 1,
  "src/app/api/marketing/campaigns/[id]/assets/route.ts afterData 变量": 1,
  "src/app/api/marketing/campaigns/[id]/publications/route.ts afterData 变量": 1,
  "src/app/api/marketing/campaigns/route.ts afterData 变量": 1,
  "src/app/api/marketing/economics/route.ts afterData 变量": 1,
  "src/app/api/marketing/experiments/[id]/route.ts afterData 变量": 1,
  "src/app/api/marketing/experiments/[id]/route.ts beforeData 变量": 1,
  "src/app/api/marketing/experiments/route.ts afterData 变量": 1,
  "src/app/api/marketing/metrics/route.ts afterData 变量": 1,
  "src/app/api/organizations/[orgId]/members/[memberId]/route.ts beforeData 变量": 2,
  "src/app/api/organizations/[orgId]/route.ts beforeData 变量": 2,
  "src/app/api/organizations/[orgId]/tender-awards/manual/route.ts afterData 展开": 1,
  "src/app/api/projects/[id]/agents/[agentId]/route.ts afterData 变量": 1,
  "src/app/api/projects/[id]/conversation-feedbacks/[feedbackId]/route.ts afterData 变量": 1,
  "src/app/api/projects/[id]/conversations/[conversationId]/messages/route.ts afterData 展开": 2,
  "src/app/api/projects/[id]/conversations/[conversationId]/route.ts beforeData 变量": 1,
  "src/app/api/projects/[id]/environments/[envId]/route.ts beforeData 变量": 2,
  "src/app/api/projects/[id]/evaluation-tags/[tagId]/route.ts afterData 变量": 1,
  "src/app/api/projects/[id]/knowledge-bases/[kbId]/documents/[docId]/route.ts beforeData 展开": 1,
  "src/app/api/projects/[id]/knowledge-bases/[kbId]/route.ts beforeData 展开": 1,
  "src/app/api/projects/[id]/members/[memberId]/route.ts beforeData 变量": 2,
  "src/app/api/projects/[id]/members/route.ts afterData 展开": 1,
  "src/app/api/projects/[id]/members/route.ts 参数里有展开": 1,
  "src/app/api/projects/[id]/message-feedbacks/[feedbackId]/route.ts afterData 变量": 1,
  "src/app/api/projects/[id]/prompts/[promptId]/route.ts beforeData 变量": 1,
  "src/app/api/projects/[id]/route.ts afterData 展开": 1,
  "src/app/api/projects/[id]/route.ts beforeData 展开": 1,
  "src/app/api/projects/[id]/supplier-links/[linkId]/route.ts afterData 变量": 1,
  "src/app/api/projects/[id]/tender-result/route.ts beforeData 变量": 1,
  "src/app/api/projects/[id]/tools/[toolId]/route.ts afterData 变量": 1,
  "src/app/api/sales/actions/[id]/route.ts afterData 变量": 1,
  "src/app/api/sales/quote-settings/discounts/route.ts afterData 展开": 3,
  "src/app/api/sales/quote-settings/verify-deposit-code/route.ts afterData 变量": 1,
  "src/app/api/sales/quote-settings/verify-line-discount-code/route.ts afterData 变量": 1,
  "src/app/api/sales/quotes/route.ts afterData 展开": 1,
  "src/app/api/trade/channels/[channel]/route.ts afterData 变量": 1,
  "src/app/api/trade/channels/[channel]/route.ts beforeData 变量": 1,
  "src/app/api/users/[id]/route.ts afterData 变量": 1,
  "src/app/api/users/[id]/route.ts beforeData 变量": 1,
  "src/lib/agent-core/tools/mail.ts afterData 变量": 1,
  "src/lib/authorization/audit.ts afterData 变量": 1,
  "src/lib/authorization/audit.ts beforeData 变量": 1,
  "src/lib/bid-page-v2/lump-sum/service.ts beforeData 变量": 1,
  "src/lib/bid-page-v2/quote-line/service.ts beforeData 变量": 1,
  "src/lib/calendar-watch/run.ts afterData 变量": 1,
  "src/lib/calendar-watch/settings.ts afterData 变量": 1,
  "src/lib/calendar-watch/settings.ts beforeData 变量": 1,
  "src/lib/cockpit/daily-digest.ts afterData 变量": 1,
  "src/lib/install/balance-service.ts afterData 变量": 1,
  "src/lib/install/repair-service.ts afterData 变量": 1,
  "src/lib/mail-watch/run.ts afterData 变量": 1,
  "src/lib/mail-watch/run.ts afterData 展开": 1,
  "src/lib/mention-gateway/identity-service.ts afterData 变量": 1,
  "src/lib/mention-gateway/identity-service.ts afterData 展开": 2,
  "src/lib/mention-gateway/identity-service.ts beforeData 变量": 1,
  "src/lib/muse-bridge/router.ts afterData 变量": 1,
  "src/lib/notifications/collab/digest.ts afterData 变量": 1,
  "src/lib/operations/publish-events.ts afterData 展开": 1,
  "src/lib/organizations/onboarding.ts afterData 展开": 3,
  "src/lib/organizations/onboarding.ts beforeData 变量": 1,
  "src/lib/pending-actions/executor.ts afterData 展开": 6,
  "src/lib/procurement-records/requests.ts afterData 变量": 1,
  "src/lib/procurement-records/rules.ts afterData 变量": 1,
  "src/lib/quote-engine/import/import-service.ts afterData 变量": 1,
  "src/lib/quote-engine/import/import-service.ts beforeData 变量": 1,
  "src/lib/quote-engine/service.ts beforeData 变量": 1,
  "src/lib/quote-engine/tender-bid.ts beforeData 变量": 1,
  "src/lib/revenue-spine/draft-preferences.ts afterData 变量": 1,
  "src/lib/revenue-spine/fact-proposals.ts afterData 变量": 1,
  "src/lib/revenue-spine/fact-proposals.ts beforeData 变量": 1,
  "src/lib/revenue-spine/fde/draft-feedback.ts 整个参数": 1,
  "src/lib/revenue-spine/transition.ts afterData 展开": 1,
  "src/lib/sales/quote-update.ts afterData 展开": 1,
  "src/lib/supplier-intel/signal-service.ts afterData 展开": 1,
  "src/lib/tender-research-tree/deps.ts afterData 展开": 1,
  "src/lib/tender-rfq/auto-draft-service.ts afterData 变量": 1,
  "src/lib/tender-rfq/inbound-sync.ts afterData 变量": 1,
  "src/lib/tender-submission/service.ts 整个参数": 1,
  "src/lib/tender-submission/service.ts 参数里有展开": 1,
};

const MONEY_WORD = /^(price|prices|amount|amounts|total|totals|cost|costs|margin|margins|markup|markups|profit|profits|landed|rate|rates|budget|budgets|fee|fees)$/;
const words = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-]/g, " ").toLowerCase().split(/\s+/).filter(Boolean);
const looksLikeMoney = (k: string) => words(k).some((w) => MONEY_WORD.test(w)) || /cost|margin|markup|profit|landed/i.test(k);

function scanAuditWrites(root: string): { keys: Map<string, Set<string>>; variable: Record<string, number>; calls: number } {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (n !== "__tests__" && n !== "node_modules") walk(p); }
      else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p);
    }
  };
  walk(join(root, "src"));
  const CALLEES = new Set(["logAudit", "writeAuditLog", "logAuditWithTx"]);
  const keys = new Map<string, Set<string>>();
  const variable: Record<string, number> = {};
  const bump = (k: string) => { variable[k] = (variable[k] ?? 0) + 1; };
  let calls = 0;
  const collect = (o: ts.ObjectLiteralExpression, rel: string, slot: string) => {
    for (const p of o.properties) {
      if (ts.isSpreadAssignment(p)) { bump(`${rel} ${slot} 展开`); continue; }
      const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) ? p.name.text : "<计算键>";
      if (!keys.has(name)) keys.set(name, new Set());
      keys.get(name)!.add(rel);
      if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer)) collect(p.initializer, rel, slot);
    }
  };
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!/logAudit|writeAuditLog/.test(src)) continue;
    const rel = relative(root, f);
    if (rel === "src/lib/audit/logger.ts") continue; // logAudit 本身把参数原样交给 writeAuditLog
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const c = n.expression;
        const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
        if (CALLEES.has(name)) {
          calls++;
          const arg = name === "logAudit" ? n.arguments[0] : n.arguments[1];
          if (!arg || !ts.isObjectLiteralExpression(arg)) bump(`${rel} 整个参数`);
          else {
            for (const p of arg.properties) {
              if (ts.isSpreadAssignment(p)) { bump(`${rel} 参数里有展开`); continue; }
              const pn = p.name && ts.isIdentifier(p.name) ? p.name.text : "";
              if (pn !== "beforeData" && pn !== "afterData") continue;
              if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer)) collect(p.initializer, rel, pn);
              else bump(`${rel} ${pn} 变量`);
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { keys, variable, calls };
}

async function main() {
  console.log("FIX-26 audit detail redaction");

  await section("[写死清单与兜底规则]", async () => {
    const m = await import("@/lib/audit/redact-finance");
    const LIST = ["sourceCost", "sourceMargin", "estimatedCost", "grossProfit", "grossMarginPct", "markupPct", "pricingRate", "calculatedCost", "calculatedMargin", "unitCost", "internalCost", "profitMargin", "costPrice", "costLines", "breakdown", "scenarios", "ourCostCad", "ourCostSource", "targetMarginPct", "marginPct", "landedCad", "landedCadTotal", "landedCadUnit", "landedCost", "expectedRemainingCostCad"];
    ok(LIST.every((k) => m.AUDIT_FINANCE_HIDDEN_KEYS.includes(k)) && LIST.every((k) => m.isAuditFinanceKey(k)), "design D11 的清单逐个在写死清单里、都会被置空", LIST.filter((k) => !m.AUDIT_FINANCE_HIDDEN_KEYS.includes(k)));
    ok(["newShippingCost", "COST_X", "grossmargin", "MarkupRate", "netProfitCad", "landedTotal", "costHidden"].every((k) => m.isAuditFinanceKey(k)), "兜底：键名含 cost / margin / markup / profit / landed（不分大小写）也置空");
    ok(["sellingPrice", "sourceSellingPrice", "ourBidPrice", "total", "unitPrice", "totalPrice", "status", "version", "reason", "sourceQuoteId"].every((k) => !m.isAuditFinanceKey(k)), "卖价、供应商原价（跟 FIX-26b）、状态、版本、原因等照旧可见");
    ok(m.AUDIT_COST_HIDDEN_HINT_ZH === "这条记录里的成本和毛利只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。", "审计详情页那句");
  });

  await section("[递归裁剪]", async () => {
    const { redactAuditFinance } = await import("@/lib/audit/redact-finance");
    const before = { sourceQuoteId: "q1", sourceVersion: 1, sourceSellingPrice: 114881.15, sourceCost: 87654.32, sourceMargin: 23.7, nested: { breakdown: [{ category: "MATERIAL", amount: 1 }], note: "n", inner: { ourCostCad: 5, ok: true } }, lines: [{ itemName: "a", costPrice: 17.31, unitPrice: 18 }, { itemName: "b", unitPrice: 2 }], already: { estimatedCost: null } };
    const r = redactAuditFinance(before, "beforeData");
    const v = r.value as Rec;
    ok(v.sourceCost === null && v.sourceMargin === null && v.sourceSellingPrice === 114881.15 && v.sourceVersion === 1 && v.sourceQuoteId === "q1", "顶层：成本、毛利置 null，卖价、版本、id 照旧", v);
    ok((v.nested as Rec).breakdown === null && (v.nested as Rec).note === "n" && ((v.nested as Rec).inner as Rec).ourCostCad === null && ((v.nested as Rec).inner as Rec).ok === true, "嵌套对象：整个 breakdown 与里层的 ourCostCad 置 null，其余照旧", v.nested);
    ok(((v.lines as Rec[])[0]).costPrice === null && ((v.lines as Rec[])[0]).unitPrice === 18 && ((v.lines as Rec[])[1]).unitPrice === 2, "数组：每个元素里的成本价置 null，单价照旧", v.lines);
    ok(JSON.stringify(r.paths) === JSON.stringify(["beforeData.sourceCost", "beforeData.sourceMargin", "beforeData.nested.breakdown", "beforeData.nested.inner.ourCostCad", "beforeData.lines[0].costPrice"]), "返回被置空的键路径（本来就是 null 的不算）", r.paths);
    ok(JSON.stringify(before.lines[0]) === JSON.stringify({ itemName: "a", costPrice: 17.31, unitPrice: 18 }), "不改输入对象");
    const arrTop = redactAuditFinance([{ landedCad: 1 }, 3, "x", null], "afterData");
    ok(JSON.stringify(arrTop.value) === JSON.stringify([{ landedCad: null }, 3, "x", null]) && JSON.stringify(arrTop.paths) === JSON.stringify(["afterData[0].landedCad"]), "顶层是数组也递归", arrTop);
    const plain = redactAuditFinance({ status: "approved" }, "afterData");
    ok(JSON.stringify(plain.value) === JSON.stringify({ status: "approved" }) && plain.paths.length === 0 && redactAuditFinance(null, "beforeData").value === null && redactAuditFinance("text", "afterData").value === "text", "没有命中：原样、不报路径；null 与字符串原样");
  });

  await section("[接口与页面接线]", async () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const route = strip(readFileSync(join(process.cwd(), "src/app/api/audit-logs/[id]/route.ts"), "utf8"));
    const guardEnd = route.lastIndexOf("需要项目管理员权限查看此日志");
    ok(guardEnd > 0 && route.indexOf("resolveFinanceViewSafe(") > guardEnd && route.indexOf("redactAuditFinance(") > guardEnd, "审计详情：原有权限检查之后才判财务查看权并裁剪");
    ok(/finance\.canReadAll/.test(route) && /costHidden: true/.test(route) && /redactedPaths/.test(route), "有财务查看权原样返回；没有时带 costHidden 与被置空的键路径");
    const page = strip(readFileSync(join(process.cwd(), "src/app/(main)/admin/audit-logs/page.tsx"), "utf8"));
    ok(/AUDIT_COST_HIDDEN_HINT_ZH/.test(page) && /costHidden/.test(page), "审计日志页：详情 costHidden 时写那句");
  });

  await section("[守卫：全仓审计写入里像钱的键都已分到「藏」或「可见」]", async () => {
    const { isAuditFinanceKey } = await import("@/lib/audit/redact-finance");
    const { keys, variable, calls } = scanAuditWrites(process.cwd());
    ok(calls >= 300 && keys.size >= 400, `扫到 ${calls} 处写入、${keys.size} 个键（防空跑）`);
    const money = [...keys.keys()].filter(looksLikeMoney).sort();
    const unclassified = money.filter((k) => !isAuditFinanceKey(k) && !(k in VISIBLE_WITH_REASON));
    ok(unclassified.length === 0, "像钱的键要么会被置空，要么在写明理由的可见名单里", unclassified.map((k) => `${k}（${[...keys.get(k)!].join("、")}）`));
    const bothWays = Object.keys(VISIBLE_WITH_REASON).filter((k) => isAuditFinanceKey(k));
    ok(bothWays.length === 0, "可见名单里的键不会被兜底规则误藏", bothWays);
    const stale = Object.keys(VISIBLE_WITH_REASON).filter((k) => !keys.has(k));
    ok(stale.length === 0, "可见名单里的键都还在某处写入（不留过期条目）", stale);
    const hiddenSeen = money.filter((k) => isAuditFinanceKey(k));
    ok(hiddenSeen.includes("expectedRemainingCostCad"), "已知的成本键（项目财务预测的剩余成本）在扫描里且会被置空", hiddenSeen);
    const exp = JSON.stringify(Object.entries(VARIABLE_CALLS).sort());
    const got = JSON.stringify(Object.entries(variable).sort());
    const added = Object.entries(variable).filter(([k, v]) => VARIABLE_CALLS[k] !== v);
    const removed = Object.entries(VARIABLE_CALLS).filter(([k, v]) => variable[k] !== v);
    ok(exp === got, "传变量的审计写入与名单逐条相同（变了就去看新调用带进去的是什么，再更新名单）", { added, removed });
  });

  console.log(`\nFIX-26 audit detail redaction: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
