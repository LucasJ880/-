/**
 * NAV-1c：看到来信就能回（openspec change nav-1c-reply-entry；spec trade/inquiry-reply-entry）
 *
 *   1. 纯函数：回复目标解析、时间线文字、主题预填、卡片回复按钮、深链地址
 *   2. 源码断言：时间线入口只跟着回复目标出现；收件箱按钮不依赖 AI 草稿、窗口有来信原文、深链；
 *      手写标记；审批面链接与占位文字；打开不等于发送（单会话接口与回复目标解析里没有发信与模型调用）
 *
 * 纯函数 + 源码断言，无 DB。隔离库端到端见 reply-entry-db.isolated.test.ts。
 * 运行：npx tsx src/lib/trade/__tests__/reply-entry.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  inboxReplyHref,
  interactionMetaLine,
  opportunityIdsNeedingTarget,
  replyButtonFor,
  replySubjectFor,
  resolveReplyTargets,
  type ReplyTargetInteraction,
} from "../reply-target";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 600)}`}`);
  }
}
const ROOT = join(__dirname, "../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** 去掉注释后的源码：断言只看真正执行的代码 */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ───────────────────────── 1. 纯函数 ─────────────────────────
console.log("\n1. 回复目标解析");
{
  const interactions: ReplyTargetInteraction[] = [
    { id: "in_linked", direction: "inbound", opportunityId: "opp_a" },
    { id: "in_no_prospect", direction: "inbound", opportunityId: "opp_b" },
    { id: "in_no_opp", direction: "inbound", opportunityId: null },
    { id: "out_linked", direction: "outbound", opportunityId: "opp_a" },
    { id: "note", direction: null, opportunityId: "opp_a" },
  ];
  const byOpp = new Map([["opp_a", "prospect_1"]]);
  const t = resolveReplyTargets(interactions, byOpp, true);
  ok(t.get("in_linked")?.prospectId === "prospect_1", "来信 + 有商机 + 有线索 → 线索 id");
  ok(t.get("in_no_prospect") === null, "来信 + 有商机 + 无线索 → 空");
  ok(t.get("in_no_opp") === null, "来信 + 无商机 → 空");
  ok(t.get("out_linked") === null && t.get("note") === null, "发出的、没有方向的互动 → 空（即使商机有线索）");
  ok(t.size === interactions.length, "每条互动都有结果（空也是结果）");
  const denied = resolveReplyTargets(interactions, byOpp, false);
  ok([...denied.values()].every((v) => v === null), "不放行（不持 trade.manage / 未开外贸模块 / 收件箱不放行）→ 全部为空");
  ok(JSON.stringify(opportunityIdsNeedingTarget(interactions)) === JSON.stringify(["opp_a", "opp_b"]), "只为「来信且挂着商机」的互动去查线索，商机 id 去重");
  ok(opportunityIdsNeedingTarget([{ id: "x", direction: "outbound", opportunityId: "o" }]).length === 0, "没有来信时不需要查线索");
}

console.log("\n2. 时间线文字、主题预填、回复按钮、深链");
{
  ok(interactionMetaLine("inbound", "Cathy Li") === "客户来信 · 经手人：Cathy Li", "来信：客户来信 · 经手人：X");
  ok(interactionMetaLine("outbound", "Cathy Li") === "我方发出 · 经手人：Cathy Li", "发出：我方发出 · 经手人：X");
  ok(interactionMetaLine(null, "Lynn") === "经手人：Lynn" && interactionMetaLine(undefined, "Lynn") === "经手人：Lynn", "没有方向：经手人：X");

  ok(replySubjectFor("Bedding inquiry") === "Re: Bedding inquiry", "来信主题 → 加 Re:");
  ok(replySubjectFor("RE: Bedding inquiry") === "RE: Bedding inquiry" && replySubjectFor("re：订单") === "re：订单", "已以 Re: 开头（不分大小写、全角冒号）→ 原样");
  ok(replySubjectFor("") === "" && replySubjectFor(null) === "" && replySubjectFor("   ") === "", "来信没有主题 → 留空");

  const b = replyButtonFor;
  ok(b({ replied: false, hasDraft: true }).label === "查看回复草稿" && b({ replied: false, hasDraft: true }).useDraft, "未回复 + 有 AI 草稿 → 查看回复草稿（带草稿打开）");
  ok(b({ replied: false, hasDraft: false }).label === "写回复" && !b({ replied: false, hasDraft: false }).useDraft, "未回复 + 没有草稿（生成中 / 失败 / 没有）→ 写回复（空白）");
  ok(b({ replied: true, hasDraft: false }).label === "再写一封" && b({ replied: true, hasDraft: true }).label === "再写一封" && !b({ replied: true, hasDraft: true }).useDraft, "已回复 → 再写一封（空白，不带旧草稿）");

  ok(inboxReplyHref({ prospectId: "p 1" }) === "/trade/inbox?prospect=p%201", "时间线入口：带线索 id 的询盘收件箱地址");
  ok(inboxReplyHref({ opportunityId: "opp/1" }) === "/trade/inbox?opportunity=opp%2F1", "审批面入口：带商机 id 的询盘收件箱地址");
}

// ───────────────────────── 2. 源码断言 ─────────────────────────
console.log("\n3. 客户时间线");
{
  const timeline = code("src/app/(main)/sales/customers/[id]/interaction-timeline.tsx");
  ok(/\{item\.replyTarget && \(\s*<Link\s+href=\{inboxReplyHref\(item\.replyTarget\)\}/.test(timeline) && /回复\s*<\/Link>/.test(timeline), "时间线条目：「回复」只在回复目标非空时出现，指向带线索 id 的收件箱地址");
  ok(/interactionMetaLine\(item\.direction, item\.createdBy\.name\)/.test(timeline) && !/"收到"|"发出"/.test(timeline), "时间线条目：文字经映射函数得出，不再有「收到」「发出」");
  const page = code("src/app/(main)/sales/customers/[id]/page.tsx");
  ok(/customer\.interactions\.find\(\(i\) => i\.replyTarget\)\?\.replyTarget \?\? null/.test(page), "页签右上：取最近一条带回复目标的互动");
  ok(/\{latestReplyTarget && \(\s*<Link\s+href=\{inboxReplyHref\(latestReplyTarget\)\}/.test(page) && /回复客户\s*<\/Link>/.test(page), "页签右上：「回复客户」只在有回复目标时出现");
  const api = code("src/app/api/sales/customers/[id]/route.ts");
  ok(/loadReplyTargets\(user, orgRes\.orgId, customer\.interactions\)/.test(api) && /replyTarget: replyTargets\.get\(i\.id\) \?\? null/.test(api), "客户详情接口：每条互动带 replyTarget，读时计算");
  ok(api.indexOf("loadReplyTargets(") > api.indexOf("permission: 'sales.customer.read'"), "客户详情接口：先过客户读权限，再算回复目标");
}

console.log("\n4. 询盘收件箱");
{
  const page = code("src/app/(main)/trade/inbox/page.tsx");
  ok(/replyButtonFor\(\{ replied: t\.replied, hasDraft: hasReplyDraft\(t\) \}\)/.test(page) && /replyButton\.kind !== "draft" && \(/.test(page) && /\{replyButton\.label\}/.test(page), "卡片：没有草稿渲染「写回复」，已回复渲染「再写一封」，不以 AI 草稿为前提");
  ok(/\{replyFor && \(\s*<ReplyModal/.test(page) && !/draftFor/.test(page) && !/analysis!\.replyDraft!/.test(page), "回复窗口：打开不再要求会话带 AI 草稿");
  ok(/target\.useDraft \? \(thread\.analysis\?\.replyDraft \?\? null\) : null/.test(page) && /replySubjectFor\(thread\.lastInboundSubject\)/.test(page), "回复窗口：草稿可选；没有草稿时正文空、主题按来信预填");
  const inbound = page.indexOf("data-reply-inbound");
  ok(inbound > 0 && inbound < page.indexOf('placeholder="主题"') && inbound < page.indexOf("<textarea"), "回复窗口：只读的来信原文在主题与正文输入框之前");
  ok(/fromAiDraft: Boolean\(draft\)/.test(page), "回复窗口：带草稿打开时声明来自 AI 草稿，空白打开时声明为否");
  ok(/params\.get\("prospect"\)/.test(page) && /params\.get\("opportunity"\)/.test(page) && /\/api\/trade\/inbox\/focus\?/.test(page) && /没有找到这位买家的询盘会话/.test(page), "深链：读 prospect / opportunity 参数，走单会话接口，找不到时提示");
  const submits = page.match(/void submit\("(send|mark_sent)"\)/g) ?? [];
  ok(submits.length === 2 && (page.match(/\/reply`/g) ?? []).length === 1, "回复窗口：只有点「发送邮件」或「已在别处发送，标记」才请求回复接口");

  const reply = code("src/app/api/trade/inbox/[prospectId]/reply/route.ts");
  ok(/aiDraft: body\.fromAiDraft === true/.test(reply) && !/aiDraft: true/.test(reply), "回复接口：留底标记只在请求声明来自 AI 草稿时为真");
  ok(/requireTradePermission\(request, TRADE_MANAGE_KEYS\)/.test(reply) && /sendTradeEmailForOrg\(/.test(reply) && /syncTradeOutboundToRevenueSpine\(/.test(reply), "回复接口：权限、发信、外发同步都是原来那一套");
}

console.log("\n5. 打开不等于发送");
{
  const SEND = /sendTradeEmail|sendGmail|sendEmail|resend\.emails|createCompletion|chat\.completions|generateText|callLlm|openai|anthropic/i;
  const WRITE = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
  for (const f of ["src/app/api/trade/inbox/focus/route.ts", "src/lib/trade/reply-target.ts", "src/lib/trade/reply-target-server.ts"]) {
    const src = code(f);
    ok(!SEND.test(src) && !WRITE.test(src), `${f}：没有发信、模型调用与写库`);
  }
  const svc = code("src/lib/trade/inbox-service.ts");
  const focusFn = svc.slice(svc.indexOf("export async function loadInquiryThreadFocus"));
  ok(focusFn.length > 0 && !SEND.test(focusFn) && !WRITE.test(focusFn), "单会话读取：只读");
  const focus = code("src/app/api/trade/inbox/focus/route.ts");
  ok(/requireTradePermission\(request, TRADE_READ_KEYS\)/.test(focus) && /THREAD_NOT_FOUND/.test(focus) && !/export async function (POST|PUT|PATCH|DELETE)/.test(focus), "单会话接口：只有 GET，要求外贸读权限，找不到统一 404");
}

console.log("\n6. 审批面");
{
  const LINK = "不想用这份？去询盘收件箱自己写（发出后这份草稿自动作废）";
  const today = code("src/app/(main)/revenue/today/page.tsx");
  ok(today.includes(LINK) && /canWriteInInbox && o \? \(\s*<Link href=\{inboxReplyHref\(\{ opportunityId: o\.opportunityId \}\)\}/.test(today), "今日询盘：待批卡的链接指向该商机的收件箱回复窗口");
  ok(/useNavigationAccess\(\)\.canOpen\("\/trade\/inbox"\)/.test(today), "今日询盘：链接只在询盘收件箱放行时出现");
  const detail = code("src/app/(main)/revenue/[id]/page.tsx");
  ok(detail.includes(LINK) && /p\.status === "pending" && canWriteInInbox \?/.test(detail), "商机详情：待批草稿卡带同一链接");
  ok(/尚无草稿[\s\S]{0,200}canWriteInInbox \?[\s\S]{0,200}去询盘收件箱写回复/.test(detail), "商机详情：没有草稿时显示「去询盘收件箱写回复」");
  ok(/useNavigationAccess\(\)\.canOpen\("\/trade\/inbox"\)/.test(detail) && (detail.match(/inboxReplyHref\(\{ opportunityId: o\.id \}\)/g) ?? []).length === 2, "商机详情：两处链接都指向该商机，且只在收件箱放行时出现");
  ok(detail.includes('placeholder="把买家在别处发来的内容贴到这里，AI 会重新起草回复"') && !/CUSTOMER_REPLIED|重跑 FDE/.test(read("src/app/(main)/revenue/[id]/page.tsx").match(/placeholder="[^"]*"/g)?.join("\n") ?? ""), "商机详情：占位文字改为白话，不再含 CUSTOMER_REPLIED 与 FDE");
}

console.log(`\nreply-entry: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
