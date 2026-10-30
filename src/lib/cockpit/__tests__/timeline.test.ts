/**
 * A-2 company.log 时间线——信封、归属、入选规则、归并翻页、游标、参数、脱敏
 * （openspec change org-cockpit-read-model，spec cockpit/company-log）
 * 运行：npx tsx src/lib/cockpit/__tests__/timeline.test.ts
 */
import {
  TIMELINE_AGENT_RUN_TYPES,
  TIMELINE_AUDIT_ACTION_DENYLIST,
  TIMELINE_EVENT_TYPES,
  agentEventEntry,
  auditEntry,
  automationRunEntry,
  decodeTimelineCursor,
  encodeTimelineCursor,
  isTimelineAutomationRun,
  lowFrequencyAutomationKeys,
  mergeTimeline,
  parseTimelineParams,
  sourceCursorBound,
  type AutomationRunRow,
  type TimelineCursor,
  type TimelineEntry,
  type TimelineLookups,
} from "../timeline";
import { COCKPIT_REDACTED } from "../waiting";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}

const lookups: TimelineLookups = {
  pendingActions: new Map([
    ["pa1", { type: "tender.send_rfq", projectId: null, agentRunId: null, payload: {} }],
    ["pa2", { type: "grader.email_draft", projectId: null, agentRunId: null, payload: { targetType: "CUSTOMER" } }],
  ]),
  projectWorkDomains: new Map(),
  agentRuns: new Map([
    ["run-wf", { runType: "workforce_job", workDomain: "tender" }],
    ["run-fde", { runType: "fde_inbound_sales", workDomain: null }],
    ["run-chat", { runType: "conversation", workDomain: null }],
    ["run-legacy", { runType: "workforce_job", workDomain: null }],
  ]),
};
const T = (iso: string) => new Date(iso);

// ── 信封 ──────────────────────────────────────────────────────
console.log("统一信封");
{
  const a = auditEntry({ id: "a1", createdAt: T("2026-10-26T10:00:00Z"), userId: "u1", userName: "Lucas", action: "PENDING_ACTION_APPROVED", targetType: "pending_action", targetId: "pa1" }, lookups);
  ok(a.id === "audit:a1" && a.kind === "audit" && a.actor === "u1" && a.actorName === "Lucas" && a.href === null, "审计日志：id 前缀 / kind / actor = 用户 id");
  ok(a.post === "tender", "目标为待审批动作的审计日志按动作归属（tender.send_rfq → tender）");
  ok(a.summary === "PENDING_ACTION_APPROVED · pending_action", "摘要只用 action 与目标类型", a.summary);
  const a2 = auditEntry({ id: "a2", createdAt: T("2026-10-26T10:00:00Z"), userId: "u1", userName: null, action: "X", targetType: "pending_action", targetId: "pa2" }, lookups);
  ok(a2.post === "inbound_sales", "通用动作按上下文（targetType CUSTOMER）归属");
  const a3 = auditEntry({ id: "a3", createdAt: T("2026-10-26T10:00:00Z"), userId: "u1", userName: null, action: "ORG_SETTINGS_UPDATED", targetType: "organization", targetId: "o1" }, lookups);
  ok(a3.post === null, "目标不是待审批动作 → post 为 null，不按文本推断");
  const a4 = auditEntry({ id: "a4", createdAt: T("2026-10-26T10:00:00Z"), userId: "u1", userName: null, action: "X", targetType: "pending_action", targetId: "gone" }, lookups);
  ok(a4.post === null, "动作行已不存在 → null");
  const a5 = auditEntry({ id: "a5", createdAt: T("2026-10-26T10:00:00Z"), userId: "u1", userName: null, action: "最终报价已调整", targetType: "project_quote", targetId: "q1" }, lookups);
  ok(a5.summary === COCKPIT_REDACTED, "审计摘要含「最终报价」→ 整段替换");
}
{
  const e = agentEventEntry({ id: "e1", createdAt: T("2026-10-26T10:00:00Z"), runId: "run-wf", eventType: "job.waiting_human", title: null }, lookups);
  ok(e.id === "event:e1" && e.kind === "agent_event" && e.actor === "ai", "AI 运行事件：id 前缀 / kind / actor = ai");
  ok(e.post === "tender" && e.href === "/workforce/run-wf", "workforce 作业事件按工作域归属，href = /workforce/<run id>");
  ok(e.summary === "作业等待人工", "事件类型有中文标签", e.summary);
  const e2 = agentEventEntry({ id: "e2", createdAt: T("2026-10-26T10:00:00Z"), runId: "run-fde", eventType: "run.failed", title: "询盘 ACME" }, lookups);
  ok(e2.post === "inbound_sales" && e2.href === null && e2.summary === "AI 运行失败：询盘 ACME", "非作业 run 按 runType 归属，带标题");
  const e3 = agentEventEntry({ id: "e3", createdAt: T("2026-10-26T10:00:00Z"), runId: "run-chat", eventType: "run.completed", title: null }, lookups);
  ok(e3.post === null, "对话 run 不归属");
  const e4 = agentEventEntry({ id: "e4", createdAt: T("2026-10-26T10:00:00Z"), runId: "run-legacy", eventType: "job.failed", title: null }, lookups);
  ok(e4.post === null && e4.href === "/workforce/run-legacy", "缺工作域的旧作业不归属，但仍可跳转");
}
{
  const r = automationRunEntry({ id: "r1", startedAt: T("2026-10-26T09:00:00Z"), automationKey: "release-drift", status: "succeeded" });
  ok(r.id === "run:r1" && r.kind === "automation_run" && r.actor === "system" && r.post === "ops_knowledge", "自动化运行：id 前缀 / actor = system / 按自动化归属");
  ok(r.summary === "发布漂移检查（代码 vs 生产库迁移）：成功", "摘要 = 自动化名 + 状态", r.summary);
  // 平台级运行流的错误文本可能带出其他组织的数据：即使行里带了 error 也不进摘要
  const withError = { id: "r2", startedAt: T("2026-10-26T09:00:00Z"), automationKey: "agent-runs", status: "failed", error: "org_other 数据库超时" } as AutomationRunRow;
  const r2 = automationRunEntry(withError);
  ok(r2.summary === "Agent 后台任务队列：失败" && !r2.summary.includes("org_other"), "错误信息不进摘要，只显示状态", r2.summary);
}

// ── 入选规则 ──────────────────────────────────────────────────
console.log("来源范围");
ok(TIMELINE_EVENT_TYPES.length === 10 && !(TIMELINE_EVENT_TYPES as readonly string[]).includes("tool.completed"), "事件白名单 10 种，不含工具级事件");
ok(!(TIMELINE_EVENT_TYPES as readonly string[]).includes("job.resume_blocked"), "不含 workforce 读模型排除的内部事件 job.resume_blocked");
ok(TIMELINE_AGENT_RUN_TYPES.includes("fde_inbound_sales") && TIMELINE_AGENT_RUN_TYPES.includes("runtime_v2") && TIMELINE_AGENT_RUN_TYPES.includes("workforce_job"), "事件只取有岗位归属的 run 类型", TIMELINE_AGENT_RUN_TYPES);
ok(!["conversation", "assistant_dispatch", "background_conversation", "supervisor"].some((t) => TIMELINE_AGENT_RUN_TYPES.includes(t)), "对话类 run 的事件不进（每次对话都会写 run.completed）");
ok(["QUOTA_RESERVED", "QUOTA_COMMITTED", "QUOTA_RELEASED"].every((a) => (TIMELINE_AUDIT_ACTION_DENYLIST as readonly string[]).includes(a)), "配额记账类审计动作不进时间线");
ok(!(TIMELINE_AUDIT_ACTION_DENYLIST as readonly string[]).includes("QUOTA_HARD_LIMIT_BLOCKED"), "配额硬上限命中照常进时间线");
const lowFreq = lowFrequencyAutomationKeys();
ok(lowFreq.includes("release-drift") && lowFreq.includes("employee-ai-practice-miner") && lowFreq.includes("daily-brief") && lowFreq.includes("marketing-mmm"), "低频：每日 / 每周 / 按需", lowFreq);
ok(!lowFreq.includes("agent-runs") && !lowFreq.includes("inquiry-sla") && !lowFreq.includes("marketing-channel-sync"), "高频不在低频清单");
ok(!isTimelineAutomationRun({ automationKey: "agent-runs", status: "succeeded" }), "高频成功运行不进时间线");
ok(isTimelineAutomationRun({ automationKey: "agent-runs", status: "failed" }) && isTimelineAutomationRun({ automationKey: "agent-runs", status: "partial" }), "高频失败 / 部分失败进时间线");
ok(isTimelineAutomationRun({ automationKey: "release-drift", status: "succeeded" }), "低频成功运行进时间线");

// ── 游标 ──────────────────────────────────────────────────────
console.log("游标");
{
  const c: TimelineCursor = { at: T("2026-10-26T10:00:00.000Z"), id: "event:e9" };
  const decoded = decodeTimelineCursor(encodeTimelineCursor(c));
  ok(decoded?.id === "event:e9" && decoded.at.getTime() === c.at.getTime(), "编解码往返");
  for (const bad of ["not-a-cursor", "", Buffer.from('{"t":"x","i":"event:1"}').toString("base64url"), Buffer.from('{"t":"2026-10-26T10:00:00.000Z","i":"zzz:1"}').toString("base64url"), Buffer.from('{"t":"2026-10-26T10:00:00.000Z","i":"run:"}').toString("base64url")]) {
    ok(decodeTimelineCursor(bad) === null, `非法游标 ${JSON.stringify(bad).slice(0, 30)} → null`);
  }
  ok(JSON.stringify(sourceCursorBound("event:", c)) === JSON.stringify({ before: c.at, sameInstant: { idLessThan: "e9" } }), "同来源：同一时刻按原始 id 比较");
  ok(sourceCursorBound("audit:", c).sameInstant === "all", "前缀小于游标前缀：同一时刻全部纳入");
  ok(sourceCursorBound("run:", c).sameInstant === "none", "前缀大于游标前缀：同一时刻全部排除");
  ok(sourceCursorBound("audit:", null).before === null, "无游标：无上界");
}

// ── 参数 ──────────────────────────────────────────────────────
console.log("参数校验");
const params = (q: Record<string, string | undefined>) => ({ get: (k: string) => q[k] ?? null });
{
  const d = parseTimelineParams(params({}));
  ok(d.ok && d.value.limit === 20 && d.value.days === 7 && d.value.cursor === null, "默认 limit 20 / days 7");
  ok(parseTimelineParams(params({ limit: "50", days: "1" })).ok, "边界值 50 / 1 合法");
  for (const q of [{ limit: "51" }, { limit: "0" }, { limit: "3.5" }, { limit: "abc" }, { days: "8" }, { days: "-1" }, { cursor: "not-a-cursor" }, { cursor: "" }]) {
    ok(!parseTimelineParams(params(q)).ok, `非法参数 ${JSON.stringify(q)} → 校验失败（路由返回 400）`);
  }
}

// ── 三路归并翻页 ─────────────────────────────────────────────
console.log("归并翻页");
{
  // 7 条，时间交错，含跨来源同一时刻
  const all: TimelineEntry[] = [
    { id: "audit:a1", at: "2026-10-26T10:00:00.000Z" },
    { id: "event:e1", at: "2026-10-26T10:00:00.000Z" },
    { id: "run:r1", at: "2026-10-26T10:00:00.000Z" },
    { id: "event:e2", at: "2026-10-26T09:00:00.000Z" },
    { id: "audit:a2", at: "2026-10-26T08:00:00.000Z" },
    { id: "run:r2", at: "2026-10-25T08:00:00.000Z" },
    { id: "audit:a3", at: "2026-10-20T08:00:00.000Z" },
  ].map((e) => ({ ...e, post: null, actor: "system", actorName: null, kind: "audit" as const, summary: "", href: null }));
  const from = T("2026-10-19T12:00:00Z");
  const prefixOf = (id: string) => (id.startsWith("audit:") ? "audit:" : id.startsWith("event:") ? "event:" : "run:") as "audit:" | "event:" | "run:";
  // 模拟装配层：每路按 sourceCursorBound 过滤、倒序取 limit + 1
  const fetchSource = (prefix: "audit:" | "event:" | "run:", cursor: TimelineCursor | null, limit: number) => {
    const bound = sourceCursorBound(prefix, cursor);
    return all
      .filter((e) => prefixOf(e.id) === prefix)
      .filter((e) => {
        if (!bound.before) return true;
        const at = T(e.at).getTime();
        const b = bound.before.getTime();
        if (at < b) return true;
        if (at > b) return false;
        if (bound.sameInstant === "all") return true;
        if (bound.sameInstant === "none") return false;
        return e.id.slice(prefix.length) < bound.sameInstant.idLessThan;
      })
      .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.id < b.id ? 1 : -1))
      .slice(0, limit + 1);
  };
  const pages: TimelineEntry[][] = [];
  let cursor: TimelineCursor | null = null;
  for (let i = 0; i < 5; i++) {
    const page = mergeTimeline({ sources: (["audit:", "event:", "run:"] as const).map((p) => fetchSource(p, cursor, 3)), limit: 3, cursor, from });
    pages.push(page.items);
    if (!page.nextCursor) break;
    cursor = decodeTimelineCursor(page.nextCursor);
  }
  ok(JSON.stringify(pages.map((p) => p.length)) === "[3,3,1]", "limit=3 翻页得到 3 / 3 / 1 条", pages.map((p) => p.length));
  const ids = pages.flat().map((e) => e.id);
  ok(new Set(ids).size === 7 && ids.length === 7, "不重不漏，共 7 条", ids);
  ok(JSON.stringify(ids.slice(0, 3)) === '["run:r1","event:e1","audit:a1"]', "同一时刻按带前缀 id 倒序", ids.slice(0, 3));
  const sorted = [...pages.flat()].sort((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.id < b.id ? 1 : -1));
  ok(JSON.stringify(sorted.map((e) => e.id)) === JSON.stringify(ids), "整体严格倒序");
  const narrow = mergeTimeline({ sources: [all], limit: 50, cursor: null, from: T("2026-10-24T00:00:00Z") });
  ok(narrow.items.length === 6 && narrow.nextCursor === null, "窗口外的条目被排除；最后一页 nextCursor 为 null");
}

console.log(`\n组织驾驶舱 company.log: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
