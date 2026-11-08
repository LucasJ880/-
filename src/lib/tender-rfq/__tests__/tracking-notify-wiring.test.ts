/**
 * T-1 询价进展通知 — 接线（源码断言，同 collab-wiring.test.ts 写法；design 验证方式）
 * 只断言接线点；文案、去重、收件人由 tracking-notify-pure.test.ts 覆盖，入站挂钩由 inbound-apply.test.ts 覆盖。
 * - 催单：只有定时扫描 runChaseScan 发通知（催单待批一轮一条、未响应每家一条），手动 / Muse chase 不发；
 *   Muse 钩子照常调用；判定函数与 Muse 模块未被改动
 * - 入站：默认 deps 接上 notifyTracking；两条既有入站提醒归入询价类别，标题 / 摘要 / 优先级 / 去重键不变
 * - 升级邮件：只加 rfq_chase_ready；项目页首屏按 #rfq-round-<id> 展开
 * - 投递：统一经 deliverCollabNotification，系统触发 actorId 为 null；不导入 LLM 客户端
 * 运行：npx tsx src/lib/tender-rfq/__tests__/tracking-notify-wiring.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function ok(cond: unknown, name: string, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}
/** 文件不存在时返回空串，让断言逐条报失败 */
const read = (p: string) => {
  const full = join(process.cwd(), p);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
};
/** 从 `start` 截到下一个顶层 export（或文件尾） */
function block(src: string, start: string): string {
  const i = src.indexOf(start);
  if (i < 0) return "";
  const j = src.indexOf("\nexport ", i + start.length);
  return src.slice(i, j < 0 ? undefined : j);
}

const chaseService = read("src/lib/tender-rfq/chase-service.ts");
const chasePure = read("src/lib/tender-rfq/chase-pure.ts");
const inboundSync = read("src/lib/tender-rfq/inbound-sync.ts");
const trackingNotify = read("src/lib/tender-rfq/tracking-notify.ts");
const trackingPure = read("src/lib/tender-rfq/tracking-notify-pure.ts");
const museHooks = read("src/lib/muse-bridge/hooks.ts");
const museRouter = read("src/lib/muse-bridge/router.ts");

console.log("催单扫描：只有定时检查发通知");
{
  const scan = block(chaseService, "export async function runChaseScan");
  const manual = block(chaseService, "export async function draftChasesForProject");
  ok(scan.includes("manual: false"), "runChaseScan 仍是 manual: false");
  ok(/onRoundDrafted:\s*\(round\)\s*=>\s*\n?\s*notifyChaseRoundDrafted\(/.test(scan), "runChaseScan 传 onRoundDrafted → notifyChaseRoundDrafted");
  ok(/onNoResponse:\s*async/.test(scan) && scan.includes("notifyChaseNoResponse("), "runChaseScan 的 onNoResponse 发未响应通知");
  ok(scan.includes("await emitNoResponse(itemId, reason)"), "runChaseScan 仍调 Muse 的 no_response 钩子");
  ok(scan.indexOf("emitNoResponse(") < scan.indexOf("notifyChaseNoResponse("), "未响应：先 Muse 钩子再站内通知");
  ok(/try\s*\{\s*await emitNoResponse[\s\S]*?\}\s*catch/.test(scan), "Muse 钩子出错被吞掉，不抛给 runForItems");
  ok(/runForItems\(input\.orgId, items, now, \{ manual: true, principalUserId: input\.userId \}\)/.test(manual), "draftChasesForProject（手动 / Muse chase）不传任何通知回调");
  ok(!/notifyChase|onRoundDrafted|onNoResponse/.test(manual), "draftChasesForProject 里没有通知");
  ok(!/notifyChase/.test(museRouter), "Muse router 不直接发询价通知");
}

console.log("催单扫描：一轮一次");
{
  const run = block(chaseService, "async function runForItems");
  ok(/if \(roundCards\.length > 0\) await opts\.onRoundDrafted\?\.\(\{ \.\.\.roundCtx, cards: roundCards \}\)/.test(run), "每轮起草完、有新卡时调用一次 onRoundDrafted");
  const loopEnd = run.indexOf("roundCards.push(");
  const callAt = run.indexOf("opts.onRoundDrafted?.(");
  ok(loopEnd > 0 && callAt > loopEnd, "onRoundDrafted 在本轮卡全部起草之后");
  ok(/roundCards\.push\(\{[^}]*missingFields: plan\.missingFields/.test(run), "每张卡带上本次追问的缺字段");
  ok(/opts\.onNoResponse\?\.\(itemId, [^,]+, \{ \.\.\.roundCtx, supplierName: it\.snapshot\.supplierName \}\)/.test(run), "onNoResponse 带轮次上下文与供应商名");
  ok(/days,\s*\n\s*\};/.test(run) && run.includes("const days = resolveChaseAfterDays("), "轮次上下文的催单天数就是 decideChases 用的那个");
  const load = block(chaseService, "async function loadItems");
  ok(/inquiry: \{ select: \{[^}]*roundNumber: true, createdById: true/.test(load), "loadItems 只多 select 轮次序号与发起人");
}

console.log("判定与 Muse 模块不动");
{
  ok(!/tracking-notify/.test(chasePure), "chase-pure.ts 不引用询价通知（判定不变）");
  ok(!/tracking-notify/.test(museHooks), "muse-bridge/hooks.ts 不引用询价通知");
  ok(/export async function museOnNoResponse/.test(museHooks) && /export async function museOnQuoteRecorded/.test(museHooks), "Muse 钩子导出仍在");
}

console.log("入站：默认 deps 接上 notifyTracking");
{
  const deps = block(inboundSync, "export async function defaultInboundSyncDeps");
  ok(/notifyTracking: async \(e\) =>/.test(deps) && deps.includes("notifyInboundTracking("), "默认 deps 的 notifyTracking → notifyInboundTracking");
  ok(/transition: e\.plan\.transition/.test(deps) && /missingFields: e\.plan\.missingFields/.test(deps), "传入转移与缺字段");
  const loop = block(inboundSync, "export async function syncOrgInbound");
  const auditAt = loop.indexOf('action: "rfq_inbound:applied"');
  const notifyAt = loop.indexOf("notify({ orgId: org.orgId, item, plan, messageId: ref.messageId })");
  ok(auditAt > 0 && notifyAt > auditAt, "入站通知在写完入表审计之后");
  ok(/plan\.transition === "quoted" \|\| plan\.transition === "replied"/.test(loop), "只对 quoted / replied 调用");
  ok(/\.catch\(\(e\) => console\.error\("\[tender-rfq-inbound\] tracking notify failed:"/.test(loop), "出错只记日志");
}

console.log("入站提醒：归入询价类别，去重键不变");
{
  const deps = block(inboundSync, "export async function defaultInboundSyncDeps");
  const failedBlock = deps.slice(deps.indexOf("notifyFailed: async (e) =>"), deps.indexOf("runChaseScan:"));
  const scopeBlock = deps.slice(deps.indexOf("remindReadScope: async"), deps.indexOf("listReplies:"));
  ok(/export const INBOUND_NOTIFICATION_CATEGORY = "tender_rfq" as const;/.test(inboundSync), "入站提醒类别为 tender_rfq");
  ok(/category: INBOUND_NOTIFICATION_CATEGORY/.test(failedBlock) && /category: INBOUND_NOTIFICATION_CATEGORY/.test(scopeBlock), "两条提醒都用这个类别");
  ok(/title: "有一封供应商回信解析失败，请手工录入"/.test(failedBlock), "解析失败提醒：标题不变");
  ok(/summary: `回信（Gmail \$\{e\.messageId\}）未能自动入表：\$\{e\.error\.slice\(0, 120\)\}`/.test(failedBlock), "解析失败提醒：摘要不变");
  ok(/priority: "medium"/.test(failedBlock) && /sourceKey: `tender-rfq-inbound:failed:\$\{e\.messageId\}`/.test(failedBlock), "解析失败提醒：优先级与去重键不变");
  ok(/entityType: "tender_rfq_round",\s*\n\s*entityId: e\.inquiryId,/.test(failedBlock), "解析失败提醒：对象改为该回信所属的询价轮次");
  ok(/inquiryId: owner\.inquiryId/.test(block(inboundSync, "export async function syncOrgInbound")), "失败分支把轮次 id 传给提醒");
  ok(/title: "询价回信无法自动入表：请重新授权 Gmail 读取权限"/.test(scopeBlock), "读信权限提醒：标题不变");
  ok(/priority: "high"/.test(scopeBlock) && /sourceKey: `\$\{reminderPrefix\(orgId, userId\)\}\$\{now\.toISOString\(\)\}`/.test(scopeBlock), "读信权限提醒：优先级与去重键不变");
  ok(!/entityType/.test(scopeBlock), "读信权限提醒：对象不变（没有对象）");
  ok(/type: "project_update"/.test(failedBlock) && /type: "project_update"/.test(scopeBlock), "两条提醒类型仍为 project_update");
}

console.log("升级邮件：只加催单待批");
{
  const escalation = read("src/lib/notifications/collab/escalation.ts");
  ok(/export const ESCALATION_TYPES = \["mention", "task_assigned", "rfq_chase_ready"\] as const;/.test(escalation), "ESCALATION_TYPES 加 rfq_chase_ready，其余不变");
  ok(!/rfq_quote_received|rfq_reply_received|rfq_no_response/.test(escalation), "报价 / 回信 / 未响应不进升级邮件");
}

console.log("项目页：从链接直达询价轮次");
{
  const section = read("src/components/inquiry/project-inquiry-section.tsx");
  const href = read("src/lib/notifications/href.ts");
  ok(/case "tender_rfq_round":\s*\n\s*return projectId && id && `\/projects\/\$\{projectId\}\?tab=bid#rfq-round-\$\{id\}`/.test(href), "href.ts：tender_rfq_round → ?tab=bid#rfq-round-");
  ok(/roundIdFromHash\(window\.location\.hash\)/.test(section), "首次加载列表时读 location.hash");
  ok(/hashHandledRef\.current = true/.test(section), "锚点只读一次");
  ok(/initialExpandedRound\(\{ hashRoundId, roundIds, currentRoundId: prev, latestRoundId \}\)/.test(section), "展开哪一轮交给 initialExpandedRound");
  ok(/if \(anchoredRef\.current && firstPendingInquiryId === initialPendingRef\.current\) return;/.test(section), "按锚点展开后，只有首屏就有的那张待批卡不抢展开");
  ok(/if \(initialPendingRef\.current === undefined\) \{\s*\n\s*initialPendingRef\.current = data\.available \? \(data\.pendingSends\[0\]\?\.inquiryId \?\? null\) : null;/.test(section), "首屏待批轮次在入口数据第一次加载成功时记下（没有待批也记 null）");
  ok(/window\.addEventListener\("hashchange", onHashChange\)/.test(section) && /window\.removeEventListener\("hashchange", onHashChange\)/.test(section), "已在本页时监听 hashchange（并在卸载时移除）");
  ok(/document\.getElementById\(`rfq-round-\$\{scrollToRound\}`\)/.test(section) && /scrollIntoView/.test(section), "列表渲染后滚到该轮");
  ok(/id=\{`rfq-round-\$\{r\.id\}`\}/.test(section), "轮次卡片的 id 与锚点一致");
}

console.log("催单卡原地审批（design D13）");
{
  const entry = read("src/lib/tender-rfq/web-entry.ts");
  const route = read("src/app/api/projects/[id]/tender-rfq/entry/route.ts");
  const approval = read("src/lib/tender-rfq/web-entry-approval.ts");
  const panel = read("src/components/inquiry/rfq-approval-panel.tsx");
  const section = read("src/components/inquiry/project-inquiry-section.tsx");
  ok(/type: TENDER_SEND_CHASE_TYPE,\s*\n\s*OR: \[\{ status: "approved" \}, \{ status: "pending", expiresAt: \{ gt: now \} \}\]/.test(entry), "入口只查未过期待批与已批执行中的催单卡");
  ok(/pendingChases: chaseRows\.flatMap/.test(entry), "入口返回 pendingChases");
  ok(/\.\.\.entry\.pendingChases\.map\(\(c\) => c\.actionId\)/.test(route) && /pendingChases: entry\.pendingChases\.map\(\(c\) => \(\{\s*\n\s*\.\.\.c,\s*\n\s*approval: approvals\[c\.actionId\]/.test(route), "路由给催单卡补审批能力与正文");
  ok(/out\[r\.id\] = previewEmailsFromPayload\(r\.payload\)/.test(approval), "正文预览兼容询价与催单两种 payload");
  ok(/if \(!isChase\) \{\s*\n\s*await apiFetch\(`\/api\/projects\/\$\{projectId\}\/inquiries\/\$\{inquiryId\}`, \{\s*\n\s*method: "PATCH"/.test(panel), "催单驳回不把轮次标为已取消（只有询价发送卡会）");
  ok(/variant="chase"/.test(section) && /chases\.map\(\(c\) => \(/.test(section), "轮次展开后每张催单卡一块面板");
  ok(/chaseBadge\(chases\.length\)/.test(section), "卡片头显示催单待批计数");
  ok(/lastOutcome\.source === "chase" \? CHASE_FAILED_HINT/.test(section), "催单卡失败的提示不叫人重新问供应商要价");
}

console.log("投递与纪律");
{
  ok(/deliverCollabNotification\(/.test(trackingNotify), "统一经 deliverCollabNotification 投递");
  ok(/actorId: null/.test(trackingNotify), "系统触发：actorId 为 null");
  ok(!/createNotification\(/.test(trackingNotify), "不绕过投递入口直接写通知");
  ok(!/sendGmail|sendEmail|EmailProvider|deliverMail/.test(trackingNotify + trackingPure), "不发任何邮件");
  for (const [name, src] of [["tracking-notify.ts", trackingNotify], ["tracking-notify-pure.ts", trackingPure]] as const) {
    ok(!/@\/lib\/ai\/|openai|anthropic|createCompletion|callLLM/i.test(src), `${name} 不导入 LLM 客户端`);
  }
  ok(!/from "@\/lib\/db"/.test(trackingPure), "纯模块不导入 db");
}

console.log(`\ntracking-notify-wiring: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
