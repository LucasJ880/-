/**
 * NAV-3：审批草稿可改（openspec change nav-3-approval-draft-editable；spec trade/inquiry-reply-entry）
 *
 *   1. 纯函数：待批草稿能不能带进回复窗口（七个条件）、收件邮箱是否不同、带草稿 id 的深链地址
 *   2. 单会话接口：按草稿 id 取原文，只读，只返回四个字段；回复接口正文上限
 *   3. 询盘收件箱页面：深链带草稿 id、「改草稿再发」窗口、草稿失效的提示、收件邮箱不同的提示
 *   4. 审批面：链接文字、带草稿 id、今日询盘上先展开草稿才出现
 *
 * 纯函数 + 源码断言，无 DB。真实的待批草稿走一遍见 reply-entry-db.isolated.test.ts 第 5 组。
 * 运行：npx tsx src/lib/trade/__tests__/approval-draft-edit.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { approvalRecipientDiffers, inboxReplyHref, usableApprovalDraft, type ApprovalDraftRow } from "../reply-target";

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
const code = (rel: string) => read(rel).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TYPE = "sales.send_inquiry_reply";
const NEW_LINK = "想改一改再发？去询盘收件箱改这份草稿（发出后这份草稿自动作废）";
const OLD_LINK = "不想用这份？去询盘收件箱自己写";

// ───────────────────────── 1. 纯函数 ─────────────────────────
console.log("\n1. 待批草稿能不能带进回复窗口");
{
  const now = new Date("2026-11-16T10:00:00Z");
  const row = (over: Partial<ApprovalDraftRow> = {}, payload: Record<string, unknown> = {}): ApprovalDraftRow => ({
    id: "pa_1",
    orgId: "org_a",
    type: TYPE,
    status: "pending",
    expiresAt: new Date("2026-11-18T10:00:00Z"),
    payload: { opportunityId: "opp_1", customerId: "c_1", to: " Mark@Maple.test ", subject: " Re: curtains ", body: "Dear Mark,\nMOQ is 500.\n", html: "<!doctype html><p>x</p>", metadata: { orgId: "org_a" }, ...payload },
    ...over,
  });
  const ctx = { orgId: "org_a", opportunityId: "opp_1" as string | null, actionType: TYPE, buyerIsOnboardingTest: false, now };

  const good = usableApprovalDraft(row(), ctx);
  ok(JSON.stringify(good) === JSON.stringify({ pendingActionId: "pa_1", subject: "Re: curtains", body: "Dear Mark,\nMOQ is 500.", to: "Mark@Maple.test" }), "七个条件全满足 → 草稿 id、主题、正文、收件邮箱（去掉首尾空格）", good);
  ok(good !== null && Object.keys(good).sort().join(",") === "body,pendingActionId,subject,to", "只有四个字段：不带 HTML 版、内部元数据、商机与客户 id");

  ok(usableApprovalDraft(row({ orgId: "org_b" }), ctx) === null && usableApprovalDraft(row({ orgId: null }), ctx) === null, "条件一：不属于本企业 → 空");
  ok(usableApprovalDraft(row({ type: "sales.send_quote" }), ctx) === null, "条件二：类型不是询盘回复 → 空");
  ok(["approved", "rejected", "failed", "expired", "executed", "cancelled"].every((status) => usableApprovalDraft(row({ status }), ctx) === null), "条件三：状态不是待批（已批准 / 已拒绝 / 已作废 / 已过期…）→ 空");
  ok(usableApprovalDraft(row({ expiresAt: new Date("2026-11-16T09:59:59Z") }), ctx) === null && usableApprovalDraft(row({ expiresAt: now }), ctx) === null, "条件四：已过期（含刚好到期）→ 空");
  ok(usableApprovalDraft(row({ expiresAt: null }), ctx) !== null, "没有过期时间的待批草稿 → 可用");
  ok(usableApprovalDraft(row({}, { opportunityId: "opp_2" }), ctx) === null && usableApprovalDraft(row({}, { opportunityId: undefined }), ctx) === null, "条件五：草稿关联的不是这位买家的商机 → 空");
  ok(usableApprovalDraft(row(), { ...ctx, opportunityId: null }) === null, "这位买家没有对应的商机 → 空");
  ok(usableApprovalDraft(row(), { ...ctx, buyerIsOnboardingTest: true }) === null, "条件六：买家是入驻测试询盘的测试买家 → 空");
  ok(usableApprovalDraft(row({}, { subject: "  " }), ctx) === null && usableApprovalDraft(row({}, { body: "" }), ctx) === null && usableApprovalDraft(row({}, { body: 123 }), ctx) === null, "条件七：主题或正文为空 / 不是文字 → 空");
  ok(usableApprovalDraft(null, ctx) === null && usableApprovalDraft(undefined, ctx) === null && usableApprovalDraft(row({ payload: null }), ctx) === null && usableApprovalDraft(row({ payload: ["x"] }), ctx) === null, "审批记录不存在、载荷不是对象 → 空");
  ok(usableApprovalDraft(row({}, { to: undefined }), ctx)?.to === "", "载荷里没有收件邮箱 → 仍可用，收件邮箱为空");

  ok(approvalRecipientDiffers("mark@maple.test", "nora@maple.test"), "收件邮箱不同 → 提示");
  ok(!approvalRecipientDiffers(" Mark@Maple.test ", "mark@maple.test"), "只差大小写与首尾空格 → 不算不同");
  ok(!approvalRecipientDiffers("", "mark@maple.test") && !approvalRecipientDiffers("mark@maple.test", null) && !approvalRecipientDiffers(undefined, undefined), "任一为空 → 不算不同");

  ok(inboxReplyHref({ opportunityId: "opp 1", approvalId: "pa/1" }) === "/trade/inbox?opportunity=opp%201&approval=pa%2F1", "审批面入口：地址同时带商机 id 与草稿 id");
  ok(inboxReplyHref({ opportunityId: "opp_1" }) === "/trade/inbox?opportunity=opp_1" && inboxReplyHref({ opportunityId: "opp_1", approvalId: null }) === "/trade/inbox?opportunity=opp_1", "不带草稿 id 时地址与原来相同");
  ok(inboxReplyHref({ prospectId: "p_1" }) === "/trade/inbox?prospect=p_1", "时间线入口的地址不变");
}

// ───────────────────────── 2. 接口 ─────────────────────────
console.log("\n2. 单会话接口与回复接口");
{
  const focus = code("src/app/api/trade/inbox/focus/route.ts");
  ok(/url\.searchParams\.get\("approvalId"\)/.test(focus) && /\.\.\.\(approvalId \? \{ approvalDraft: await loadApprovalDraft\(orgRes\.orgId, focus\.thread\.prospectId, approvalId\) \} : \{\}\)/.test(focus), "单会话接口：带 approvalId 才返回 approvalDraft，草稿按解析到的这位买家核对");
  const handlers = [...focus.matchAll(/^export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((m) => m[1]);
  ok(handlers.join(",") === "GET" && /requireTradePermission\(request, TRADE_READ_KEYS\)/.test(focus), "单会话接口：仍只有 GET，仍按外贸读权限放行");

  const server = code("src/lib/trade/reply-target-server.ts");
  const loader = server.slice(server.indexOf("export async function loadApprovalDraft"));
  ok(loader.length > 0 && !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(loader) && !/sendTradeEmail|sendEmail|chat\.completions|generateText|openai|anthropic/i.test(loader), "取草稿原文：只读，不改审批记录，不发信、不调模型");
  ok(/tradeProspect\.findFirst\(\{ where: \{ id: prospectId, orgId \}/.test(loader) && /pendingAction\.findFirst\(\{ where: \{ id: approvalId, orgId \}/.test(loader) && /salesOpportunity\.findFirst\(\{ where: \{ id: opportunityId, orgId \}/.test(loader), "取草稿原文：线索、审批记录、商机三次读取都限定在本企业");
  ok(/actionType: INQUIRY_REPLY_ACTION_TYPE/.test(loader) && /buyerIsOnboardingTest: hasOnboardingTestTag\(opportunity\.customer\.tags\)/.test(loader) && /usableApprovalDraft\(row,/.test(loader), "取草稿原文：类型用询盘回复的审批类型，测试买家用入驻测试标记，判定交给纯函数");
  ok(/select: \{ id: true, orgId: true, type: true, status: true, expiresAt: true, payload: true \}/.test(loader), "取草稿原文：审批记录只取判定用到的字段");

  const reply = code("src/app/api/trade/inbox/[prospectId]/reply/route.ts");
  ok(/body\.body\.trim\(\)\.slice\(0, 10_000\)/.test(reply) && !/slice\(0, 8000\)/.test(reply), "回复接口：正文上限 10000 字");
  ok(/requireTradePermission\(request, TRADE_MANAGE_KEYS\)/.test(reply) && !/pendingAction|approv/i.test(reply), "回复接口：仍要求处理外贸的键；不碰审批记录（不批准、不执行、不写回草稿）");
}

// ───────────────────────── 3. 询盘收件箱页面 ─────────────────────────
console.log("\n3. 询盘收件箱页面");
{
  const page = code("src/app/(main)/trade/inbox/page.tsx");
  const effect = page.slice(page.indexOf('params.get("prospect")'), page.indexOf('router.replace("/trade/inbox")'));
  ok(/const approvalId = params\.get\("approval"\);/.test(effect) && /approvalId \? `&approvalId=\$\{encodeURIComponent\(approvalId\)\}` : ""/.test(effect), "深链：读到草稿 id 就把它带给单会话接口");
  ok(/const approvalDraft = approvalId \? \(data\.approvalDraft \?\? null\) : null;/.test(effect), "深链：没带草稿 id 时不看响应里的草稿");
  ok(/useDraft: approvalId \? false : replyButtonFor\(/.test(effect) && /approvalDraft,\s*\}\);/.test(effect), "深链：带着草稿 id 进来的，取到就用待批草稿，没取到就空白（不预填收件箱自己的分析草稿）");
  ok(/if \(approvalId && !approvalDraft\) setFocusNotice\(APPROVAL_GONE_NOTICE\);/.test(effect) && /const APPROVAL_GONE_NOTICE = "这份待批草稿已经处理过或已失效，可以直接在下面写回复";/.test(page), "深链：草稿不可用时提示，窗口照常打开");
  ok(effect.indexOf("if (mayReply) {") > 0 && effect.indexOf("setReplyFor(") > effect.indexOf("if (mayReply) {") && effect.indexOf("APPROVAL_GONE_NOTICE") < effect.indexOf("} else {"), "深链：预填与提示都在「能回复」的分支里；不能回复的成员仍只提示、不开窗口");

  const modal = page.slice(page.indexOf("function ReplyModal("));
  ok(/const approval = target\.approvalDraft \?\? null;/.test(modal) && /const draft = approval \? null : target\.useDraft \?/.test(modal), "回复窗口：带待批草稿时不同时带收件箱的分析草稿");
  ok(/useState\(approval \? approval\.subject : draft \? draft\.subject : replySubjectFor\(thread\.lastInboundSubject\)\)/.test(modal) && /useState\(approval \? approval\.body : draft \? draft\.body : ""\)/.test(modal), "回复窗口：主题与正文预填待批草稿的原文");
  ok(/\{approval \? "改草稿再发" : draft \? "回复草稿" : "写回复"\} · \{thread\.companyName\}/.test(modal), "回复窗口：标题「改草稿再发 · 〈公司〉」");
  ok(/: approval\s*\? APPROVAL_EDIT_HINT/.test(modal) && page.includes('const APPROVAL_EDIT_HINT = "这是等审批的那份 AI 草稿，改好后点「发送邮件」。发出后那份草稿自动作废，不用再去批准；从这里发出的是普通文本邮件。";'), "回复窗口：写明发出后原草稿作废、发出的是普通文本邮件");
  ok(/fromAiDraft: Boolean\(draft\) \|\| Boolean\(approval\)/.test(modal), "回复窗口：从待批草稿发出时声明来自 AI 草稿");
  ok(/const recipientDiffers = approval \? approvalRecipientDiffers\(approval\.to, thread\.contactEmail\) : false;/.test(modal) && /\{approval && recipientDiffers && \(/.test(modal) && /这份草稿原本发给 \{approval\.to\}；从这里发送会发给 \{thread\.contactEmail\}。/.test(modal), "回复窗口：收件邮箱不同时写出两个邮箱，以两者不相等为出现条件");
  ok([...modal.matchAll(/submit\("(?:send|mark_sent)"\)/g)].length === 2 && [...modal.matchAll(/\/api\/trade\/inbox\/\$\{[^}]+\}\/reply/g)].length === 1, "回复窗口：发出只走既有的回复接口，入口仍只有两个按钮");
  ok(!/\/api\/(pending-actions|revenue|approvals)\b/.test(page), "询盘收件箱页面不请求任何审批接口（不批准、不拒绝、不改草稿）");
}

// ───────────────────────── 4. 审批面 ─────────────────────────
console.log("\n4. 今日询盘与商机详情");
{
  const today = code("src/app/(main)/revenue/today/page.tsx");
  const detail = code("src/app/(main)/revenue/[id]/page.tsx");
  ok(today.includes(NEW_LINK) && detail.includes(NEW_LINK) && !today.includes(OLD_LINK) && !detail.includes(OLD_LINK), "两个页面：链接是新文字，不再有「不想用这份？去询盘收件箱自己写」");
  ok(/inboxReplyHref\(\{ opportunityId: o\.opportunityId, approvalId: item\.pendingActionId \}\)/.test(today), "今日询盘：地址带该商机与这份草稿的 id");
  ok(/inboxReplyHref\(\{ opportunityId: o\.id, approvalId: p\.id \}\)/.test(detail), "商机详情：地址带该商机与这份草稿的 id");

  // 今日询盘：链接在展开草稿的区块之内
  const openAt = today.indexOf("{open ? (", today.indexOf("{item.preview}") - 700);
  const openEnd = today.indexOf(") : null}", today.indexOf(NEW_LINK));
  const closeOfBlock = today.indexOf("<div className=\"mt-2 flex gap-2\">");
  const linkAt = today.indexOf(NEW_LINK);
  ok(openAt > 0 && linkAt > today.indexOf("{item.preview}") && linkAt < closeOfBlock && openEnd > linkAt, "今日询盘：链接位于展开草稿的区块之内（在预览之后、批准按钮之前）", { openAt, linkAt, closeOfBlock });
  const between = today.slice(today.indexOf("{item.preview}"), linkAt);
  ok(!/\) : null\}\s*<div className="mt-2 flex gap-2">/.test(between), "今日询盘：链接与预览之间没有离开展开的区块");
  ok(/\{canWriteInInbox && o \? \(\s*<Link\s+href=\{inboxReplyHref\(\{ opportunityId: o\.opportunityId, approvalId/.test(today), "今日询盘：链接只在询盘收件箱放行且卡片带商机时出现");
  ok(/p\.status === "pending" && canWriteInInbox \? \(\s*<Link href=\{inboxReplyHref\(\{ opportunityId: o\.id, approvalId: p\.id \}\)\}/.test(detail), "商机详情：链接只在草稿待批且询盘收件箱放行时出现");
  ok(/尚无草稿[\s\S]{0,200}canWriteInInbox \?[\s\S]{0,200}inboxReplyHref\(\{ opportunityId: o\.id \}\)[\s\S]{0,120}去询盘收件箱写回复/.test(detail), "商机详情：没有草稿时的「去询盘收件箱写回复」不变（不带草稿 id）");
}

console.log(`\napproval-draft-edit: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
