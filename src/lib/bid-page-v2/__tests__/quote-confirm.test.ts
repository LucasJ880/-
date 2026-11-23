/**
 * BIDPAGE-6 定报价只点一次——纯逻辑与源码断言（无 DB / 无网络 / 无模型）
 * （openspec change quote-one-step-confirm，spec tender/quote-one-step-confirm、tender/quote-line-mode、tender/bid-page 的修改）
 * 运行：npx tsx src/lib/bid-page-v2/__tests__/quote-confirm.test.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  actionBarOf,
  bidQuoteHref,
  blockReasonZh,
  cleanNoteText,
  confirmPromptZh,
  confirmRequestSchema,
  formatDecidedAtZh,
  frozenNoteZh,
  notifyOutcomeZh,
  ourBidLineZh,
  quoteIdFromHash,
  QUOTE_ACTION_TEXT,
  returnRequestSchema,
  reviewNotificationZh,
  reviseRequestSchema,
  submitRequestSchema,
  type ActionBarInput,
} from "@/lib/bid-page-v2/quote-confirm/contract";
import { EXPORT_NOT_DECIDED_ZH, EXPORT_REVISION_PENDING_ZH, frozenZh } from "@/lib/bid-page-v2/quote-line/service";
import { notificationHref } from "@/lib/notifications/href";
import { NOTIFICATION_TYPE_KEYS } from "@/lib/notifications/constants";
import { sectionForAnchor } from "@/components/bid-page-v2/entry-mode";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 800)}`}`);
  }
}
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

console.log("BIDPAGE-6 定报价只点一次——纯逻辑与源码断言");

// —— 1. 主按钮矩阵（spec「主按钮按状态与权限」） ——
{
  const who = { approver: { canEdit: true, canApprove: true }, editor: { canEdit: true, canApprove: false }, none: { canEdit: false, canApprove: false } };
  const bar = (status: string, w: keyof typeof who, isOurBid = false, otherOurBidAwarded = false) => actionBarOf({ status, isOurBid, otherOurBidAwarded, ...who[w] } as ActionBarInput);
  const cases: Array<[string, ReturnType<typeof bar>, string[], string | null]> = [
    ["草稿 · 有批准权限", bar("draft", "approver"), ["confirm"], null],
    ["草稿 · 只有编辑权限", bar("draft", "editor"), ["submit"], null],
    ["草稿 · 都没有", bar("draft", "none"), [], null],
    ["待批准 · 有批准权限", bar("review", "approver"), ["approve", "return"], null],
    ["待批准 · 只有编辑权限", bar("review", "editor"), [], "已提交，等负责人批准"],
    ["待批准 · 都没有", bar("review", "none"), [], "已提交，等负责人批准"],
    ["已批准是我方报价 · 有批准权限", bar("approved", "approver", true), [], "已定为我方报价"],
    ["已批准是我方报价 · 只有编辑权限", bar("approved", "editor", true), [], "已定为我方报价"],
    ["已批准是我方报价 · 都没有", bar("approved", "none", true), [], "已定为我方报价"],
    ["已批准不是我方报价 · 有批准权限", bar("approved", "approver"), ["confirm"], null],
    ["已批准不是我方报价 · 只有编辑权限", bar("approved", "editor"), [], "已批准，还没定为我方报价"],
    ["已批准不是我方报价 · 都没有", bar("approved", "none"), [], "已批准，还没定为我方报价"],
    ["已中标 · 有批准权限", bar("awarded", "approver"), [], "已中标"],
    ["已被新版替代 · 只有编辑权限", bar("superseded", "editor"), [], "已被新版替代"],
    ["已作废 · 都没有", bar("cancelled", "none"), [], "已作废"],
  ];
  for (const [name, got, buttons, statusZh] of cases) ok(JSON.stringify(got.buttons) === JSON.stringify(buttons) && got.statusZh === statusZh, `按钮矩阵：${name}`, got);
  const aw = bar("draft", "approver", false, true);
  ok(aw.buttons.length === 0 && aw.statusZh === "现在的我方报价已中标，这里不改选；要改请在专业模式里做", "现在的我方报价是另一份并已中标：草稿不给「定为我方报价」，改写说明", aw);
  ok(JSON.stringify(bar("review", "approver", false, true).buttons) === '["return"]' && bar("approved", "approver", false, true).buttons.length === 0, "已中标时待批准的只能退回、已批准的不给改选");
}

// —— 2. 不可点的原因（spec「主按钮不可点的情况」） ——
{
  ok(blockReasonZh({ dirty: true, computedOk: true, unpricedCount: 0 }) === "有修改还没保存：先保存或放弃修改", "有没保存的修改");
  ok(blockReasonZh({ dirty: false, computedOk: false, unpricedCount: 0 }) === "报价算不出，先按上面的提示改好", "引擎算不出");
  ok(blockReasonZh({ dirty: false, computedOk: true, unpricedCount: 2 }) === "还有计入但没填数的行，填完才能提交、批准", "有计入但没填数的行");
  ok(blockReasonZh({ dirty: false, computedOk: true, unpricedCount: 0 }) === null, "都没有 → 可点");
  ok(blockReasonZh({ dirty: true, computedOk: false, unpricedCount: 3 }) === QUOTE_ACTION_TEXT.dirty, "几种同时有时先说没保存（保存后其余的才准）");
}

// —— 3. 确认框（spec「定之前确认一次」） ——
{
  const l = confirmPromptZh({ label: "报价合计", amount: 1200000, currency: "CAD", current: { version: 1, amount: 1100000, currency: "CAD" } });
  ok(l[0] === "报价合计 1,200,000.00 加元，定了以后内容锁定，要改需另起新版。" && l[1] === "现在的我方报价是第 1 版（1,100,000.00 加元），定了以后改成这一份。" && l.length === 2, "逐行报价、要改选：两句与规格逐字一致", l);
  const l2 = confirmPromptZh({ label: "税前报价", amount: 1037322.68, currency: "CAD", current: null });
  ok(l2.length === 1 && l2[0] === "税前报价 1,037,322.68 加元，定了以后内容锁定，要改需另起新版。", "总价报价、没有别的我方报价：只一句、写「税前报价」", l2);
}

// —— 4. 请求体与原因 ——
{
  ok(confirmRequestSchema.safeParse({ baseUpdatedAt: "2026-11-23T00:00:00.000Z", expectedSellingPrice: 1 }).success && !confirmRequestSchema.safeParse({ baseUpdatedAt: "x" }).success && !confirmRequestSchema.safeParse({ baseUpdatedAt: "x", expectedSellingPrice: Number.NaN }).success, "一次定价要修改时间与报价合计（有限数）");
  ok(submitRequestSchema.safeParse({ baseUpdatedAt: "x" }).success && !submitRequestSchema.safeParse({}).success, "提交要修改时间");
  ok(returnRequestSchema.safeParse({ baseUpdatedAt: "x" }).success && returnRequestSchema.safeParse({ baseUpdatedAt: "x", note: null }).success, "退回原因可不填");
  ok(!reviseRequestSchema.safeParse({}).success && reviseRequestSchema.safeParse({ reason: "x" }).success, "另起新版要原因");
  ok(cleanNoteText("  海运费\u0007要‮重新问 \n ", 500) === "海运费要重新问" && cleanNoteText("   ", 500) === null && cleanNoteText("a".repeat(600), 500)?.length === 500 && cleanNoteText("一\n二\t三", 500) === "一\n二\t三", "原因去掉控制字符与方向字符、保留换行与制表符、截到上限、空的当没写");
}

// —— 5. 通知（spec「给负责人的站内通知」「通知与审计不带金额与成本」） ——
{
  const n = reviewNotificationZh({ projectName: "合成学校窗帘标", submitterName: "李四", quoteName: "合成总价报价", version: 2 });
  ok(n.title === "报价等你批准：合成学校窗帘标" && n.summary === "李四 提交了「合成总价报价」第 2 版，请到「标书与报价」② 批准并定为我方报价，或退回。", "标题与摘要的写法", n);
  ok(!/\d{3,}|加元|CAD|成本|毛利|供应商/.test(n.title + n.summary), "通知文字里没有金额、成本、毛利、供应商");
  ok(notifyOutcomeZh({ kind: "notified", ownerName: "张三" }) === "已提交，已通知负责人 张三" && notifyOutcomeZh({ kind: "gated" }).includes("关掉了站内通知或这类通知") && notifyOutcomeZh({ kind: "no_recipient" }).includes("项目负责人不是本组织的在职成员，没有人收到通知，请直接联系有批准权限的同事") && notifyOutcomeZh({ kind: "self" }).includes("你就是项目负责人") && notifyOutcomeZh({ kind: "failed" }).includes("通知没发出去"), "五种通知结果的说法");
  const href = notificationHref({ entityType: "bid_quote", entityId: "q_1", projectId: "p_1" } as never);
  ok(href === "/projects/p_1?tab=bid#bid-quote-q_1" && href === bidQuoteHref("p_1", "q_1"), "通知点开：/projects/{项目}?tab=bid#bid-quote-{报价}", href);
  ok(notificationHref({ entityType: "bid_quote", entityId: "q_1", projectId: null } as never) === null, "没有项目 id 时不拼地址（照通知页的回落规则）");
  ok(quoteIdFromHash("#bid-quote-q_1") === "q_1" && quoteIdFromHash("#bid-quote-area") === null && quoteIdFromHash("#rfq-section") === null && quoteIdFromHash("") === null, "#bid-quote-{id} 读出报价 id；#bid-quote-area 不是");
  ok(sectionForAnchor("#bid-quote-q_1") === "quote" && sectionForAnchor("#bid-quote-area") === "quote", "#bid-quote-{id} 落在 ②");
  ok((NOTIFICATION_TYPE_KEYS as readonly string[]).includes("project_update"), "用的是已登记的通知类型 project_update（不新增类型）");
  const svc = stripComments(read("src/lib/bid-page-v2/quote-confirm/service.ts"));
  ok(/type: "project_update"/.test(svc) && /entityType: "bid_quote"/.test(svc) && /recipientIds: \[project\.ownerId\]/.test(svc) && /deliverCollabNotification\(/.test(svc) && !/sendEmail|PendingAction|mailer|fetch\(/.test(svc), "只发站内通知给项目负责人、走既有投递入口（过在职成员与通知设置），不发邮件、不出站");
  ok(!/sellingPrice|estimatedCost|amount|currency/.test(svc.slice(svc.indexOf("reviewNotificationZh("), svc.indexOf("reviewNotificationZh(") + 200)), "通知的输入里没有金额");
}

// —— 6. 冻结提示与导出原因（spec tender/quote-line-mode） ——
{
  ok(frozenNoteZh("approved") === "这份报价「已批准」，内容锁定；要改请点「另起新版」" && frozenNoteZh("superseded") === "这份报价「已被新版替代」，内容锁定" && frozenNoteZh("awarded").includes("专业模式") && frozenZh("approved") === frozenNoteZh("approved"), "冻结提示：已批准写「另起新版」，已中标写去专业模式，其余只写状态");
  ok(EXPORT_NOT_DECIDED_ZH.startsWith("报价定为我方报价后才能导出") && EXPORT_NOT_DECIDED_ZH.includes("定为我方报价") && EXPORT_NOT_DECIDED_ZH.includes("提交给负责人") && !EXPORT_NOT_DECIDED_ZH.includes("专业模式") && EXPORT_REVISION_PENDING_ZH.includes("新版还没定") && !EXPORT_REVISION_PENDING_ZH.includes("专业模式"), "导出不可用的原因写在这一页定，不再说「在专业模式里做」");
  const comps = ["src/components/bid-page-v2/quote-step.tsx", "src/components/bid-page-v2/lump-sum-editor.tsx", "src/lib/bid-page-v2/quote-line/service.ts"].map(read).join("\n");
  ok(!comps.includes("提交、批准在专业模式里做") && !comps.includes("目前在专业模式里做") && !comps.includes("要改请在专业模式里另起新版"), "编辑器与导出处不再叫人去专业模式提交、批准、另起新版");
}

// —— 7. 我方报价一行（spec「我方报价一行」） ——
{
  ok(formatDecidedAtZh("2026-11-23T15:05:00.000Z") === "2026-11-23 10:05" && formatDecidedAtZh("2026-07-01T14:00:00.000Z") === "2026-07-01 10:00", "多伦多时间（冬令时 / 夏令时）");
  ok(ourBidLineZh({ status: "AUTHORITATIVE", quoteId: "q", version: 2, quoteStatus: "approved", sellingPrice: 1284000, currency: "CAD", decidedBy: "张三", decidedAt: "2026-11-23T15:05:00.000Z", entryMode: "LUMP_SUM" }) === "我方报价：第 2 版，1,284,000.00 加元，张三 2026-11-23 10:05 定的", "已定：第 N 版，金额，谁 何时 定的");
  ok(ourBidLineZh({ status: "AUTHORITATIVE", quoteId: "q", version: 1, quoteStatus: "approved", sellingPrice: 1, currency: "CAD", decidedBy: null, decidedAt: null, entryMode: null }) === "我方报价：第 1 版，1.00 加元", "都没有记录：只写版本与金额");
  ok(ourBidLineZh({ status: "QUOTE_REVISION_PENDING", quoteId: "q", version: 1, pending: { id: "q2", version: 2, status: "draft" } }) === "我方报价第 1 版已另起新版，新版第 2 版是草稿，定了以后才是我方报价", "新版待定");
  ok(ourBidLineZh({ status: "NONE", approvedCount: 0 }) === "还没有我方报价" && ourBidLineZh({ status: "NONE", approvedCount: 2 }) === "还没有我方报价；已批准 2 份，还没定为我方报价", "还没有");
}

// —— 8. 接口：守卫级别固定、第一步守卫、开关与金额门在读请求体之前（spec「四个接口的守卫与门」） ——
{
  const base = "src/app/api/projects/[id]/bid-page/quotes/[quoteId]";
  const levels: Array<[string, string]> = [["confirm", "approve"], ["submit", "edit"], ["return", "approve"], ["revise", "edit"]];
  for (const [name, level] of levels) {
    const src = stripComments(read(`${base}/${name}/route.ts`));
    const body = src.slice(src.indexOf("export async function POST"));
    const guard = body.indexOf(`await requireQuoteAccess(request, projectId, "${level}")`);
    const gate = body.indexOf("await lineModeGate(access)");
    const readBody = body.indexOf("request.json()");
    ok(guard > -1 && gate > guard && readBody > gate && (body.match(/requireQuoteAccess\(/g) ?? []).length === 1 && !/\bGET\b|export async function (PUT|DELETE|PATCH)/.test(src), `${name}：第一步报价权限守卫（级别 ${level}，不看请求体），再开关与金额门，最后才读请求体；只有 POST`);
  }
  const svc = stripComments(read("src/lib/bid-page-v2/quote-confirm/service.ts"));
  ok(/applyQuoteTransitionTx\(tx/.test(svc) && /assertQuoteTransitionAllowed\(/.test(svc) && !/tx\.projectQuote\.update\(/.test(svc) && !/appendProjectEvent|appendQuoteLedgerEventTx/.test(svc), "迁移与台账只用报价引擎的同一段代码（不另写迁移）");
  const confirmBody = svc.slice(svc.indexOf("export async function confirmAsOurBid("), svc.indexOf("async function assertNotAwardedOther("));
  const lock = confirmBody.indexOf("await lockQuoteRow(tx, q.id)");
  const step = confirmBody.indexOf("await applyQuoteTransitionTx(tx");
  const sync = confirmBody.indexOf("syncTenderBidPointerTx)(tx");
  const mirror = confirmBody.indexOf("await mirror(tx");
  ok((confirmBody.match(/db\.\$transaction\(/g) ?? []).length === 1 && lock > -1 && step > lock && sync > step && mirror > sync, "一次定价：一个事务；先锁报价行、再迁移、再同步指针（锁项目行）、需要时改选写镜像");
  ok(confirmBody.includes("TenderBidSyncError") && confirmBody.includes("auditSyncFailure(") && confirmBody.includes("TENDER_BID_SYNC_FAILED"), "同步或写镜像失败：整笔回滚、写同步失败审计、返回 TENDER_BID_SYNC_FAILED");
  const audits = svc.slice(svc.indexOf("await writeStepAudits({ projectId: input.projectId"), svc.indexOf("return { id: q.id, status: \"approved\", version: q.version, isOurBid: true, reselectedFrom: outcome.reselectedFrom"));
  ok(!/estimatedCost|grossProfit|grossMargin|internalCost|costLines/.test(audits) && /sellingPrice: s\.sellingPrice/.test(audits), "新写的选定审计不带成本、毛利（只有与手动选定相同的卖价与币种）");
  const engine = stripComments(read("src/lib/quote-engine/service.ts"));
  const trans = engine.slice(engine.indexOf("export async function transitionQuote("), engine.indexOf("export async function reviseQuote("));
  ok(/assertQuoteTransitionAllowed\(q, \{ from, to: input\.to \}\)/.test(trans) && /await applyQuoteTransitionTx\(tx, \{ q, from, to: input\.to, now/.test(trans) && /action: transitionAuditAction\(input\.to\)/.test(trans), "transitionQuote 调用抽出的两段与审计 action（专业模式与一次定价同一套）");
}

// —— 9. 新页面不放中标与建项目预算（spec「新页面不放中标与建项目预算」） ——
{
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(join(process.cwd(), dir))) {
      const rel = `${dir}/${f}`;
      if (statSync(join(process.cwd(), rel)).isDirectory()) { if (f !== "__tests__") walk(rel); }
      else if (/\.(tsx?|ts)$/.test(f)) files.push(rel);
    }
  };
  walk("src/components/bid-page-v2");
  const all = files.map((f) => stripComments(read(f))).join("\n");
  ok(!/\/award\b|awardQuote|建项目预算|AwardPanel/.test(all) && !/>\s*已中标\s*</.test(all), "新页面组件里没有中标接口调用、没有「已中标」「建项目预算」按钮", files.length);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
