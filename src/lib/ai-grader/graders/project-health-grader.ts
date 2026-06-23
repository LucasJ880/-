/**
 * ProjectHealthGrader —— 项目风险体检（微信 AI 分身优化阶段 · 第四阶段）
 *
 * 第一版聚焦：deadline 风险 + 缺文件/缺确认 + 无下一步任务 + 长时间无更新 +
 * 窗帘/工程项目专属轻量文本检查。不做完整项目管理。
 *
 * 两种模式：
 * - GLOBAL：返回最有风险的 Top 项目
 * - PROJECT：检查指定项目
 *
 * 设计约束：
 * - 纯只读，无写副作用；suggestedActions 仅建议，执行走 PendingAction 适配器。
 * - 严格单组织 orgId 边界（微信绑定 org）+ 组织内 owner/member 可见范围；
 *   admin/super_admin/org_admin 可见本组织全部。不跨 org 查询。
 * - 字段不存在则跳过对应规则，不阻塞。第一版规则型，不依赖 LLM。
 */

import { db } from "@/lib/db";
import { resolveSalesOwnOnly } from "./_scope";
import { computeScoreAndRisk } from "./_scoring";
import { orderAndCapActions, buildProjectInternalNoteAction } from "./_actions";
import type {
  GraderResult,
  GraderIssue,
  GraderAction,
  GraderEvidence,
  RiskLevel,
} from "../types";

export type ProjectHealthGraderContext = {
  orgId: string;
  userId: string;
  role: string;
  now?: Date;
  mode?: "GLOBAL" | "PROJECT";
  projectId?: string;
  projectName?: string;
  maxIssues?: number;
  maxActions?: number;
};

const DEFAULT_MAX_ISSUES = 5;
const DEFAULT_MAX_ACTIONS = 3;
const DAY_MS = 86_400_000;

/** 视为"已结束/不需体检"的项目状态 */
const DONE_STATUSES = new Set([
  "completed",
  "archived",
  "closed",
  "done",
  "won",
  "lost",
  "cancelled",
]);

/** 视为"已完成"的任务状态 */
const DONE_TASK_STATUSES = new Set(["done", "completed", "cancelled", "archived"]);

const CURTAIN_KEYWORDS =
  /shade|blind|roller|motorized|curtain|window covering|窗帘|卷帘|电动|马达/i;
const MOTORIZED_KEYWORDS = /motorized|motor|somfy|电动|马达/i;

type ProjectFinding = {
  level: RiskLevel;
  title: string;
  projectId: string;
  projectName: string;
  actionKind: "deadline" | "task" | null;
  reason?: string;
  /** 转 CREATE_PROJECT_TASK 时使用的任务标题（缺省用 reason/title） */
  taskTitle?: string;
};

type ProjectRow = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  description: string | null;
  dueDate: Date | null;
  updatedAt: Date;
  tasks: Array<{ status: string; priority: string; completedAt: Date | null; title: string }>;
  _count: { documents: number };
};

const PROJECT_SELECT = {
  id: true,
  name: true,
  code: true,
  status: true,
  description: true,
  dueDate: true,
  updatedAt: true,
  tasks: {
    select: { status: true, priority: true, completedAt: true, title: true },
    take: 50,
  },
  _count: { select: { documents: true } },
} as const;

// ── 可见性（单组织边界 + 组织内 owner/member 范围） ───────────

async function buildProjectScopeWhere(
  userId: string,
  orgId: string,
  role: string,
): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    orgId,
    abandonedAt: null,
    intakeStatus: "dispatched",
  };
  const ownOnly = await resolveSalesOwnOnly(userId, orgId, role);
  if (!ownOnly) return base; // admin / org_admin / super_admin → 本组织全部
  return {
    ...base,
    OR: [
      { ownerId: userId },
      { members: { some: { userId, status: "active" } } },
    ],
  };
}

// ── 项目解析（PROJECT 模式） ───────────────────────────────────

export type ProjectResolution =
  | { status: "ok"; projectId: string; projectName: string }
  | { status: "not_found" }
  | { status: "ambiguous"; candidates: Array<{ name: string }> }
  | { status: "need_name" };

export async function resolveProjectForHealth(
  ctx: ProjectHealthGraderContext,
): Promise<ProjectResolution> {
  const scope = await buildProjectScopeWhere(ctx.userId, ctx.orgId, ctx.role);

  if (ctx.projectId) {
    const p = await db.project.findFirst({
      where: { AND: [scope, { id: ctx.projectId }] },
      select: { id: true, name: true, code: true },
    });
    return p
      ? { status: "ok", projectId: p.id, projectName: p.code ?? p.name }
      : { status: "not_found" };
  }

  const name = (ctx.projectName ?? "").trim();
  if (!name) return { status: "need_name" };

  const matches = await db.project.findMany({
    where: {
      AND: [
        scope,
        {
          OR: [
            { code: { contains: name, mode: "insensitive" } },
            { name: { contains: name, mode: "insensitive" } },
          ],
        },
      ],
    },
    select: { id: true, name: true, code: true },
    take: 6,
  });

  if (matches.length === 0) return { status: "not_found" };
  if (matches.length > 1) {
    return { status: "ambiguous", candidates: matches.map((m) => ({ name: m.code ?? m.name })) };
  }
  return { status: "ok", projectId: matches[0].id, projectName: matches[0].code ?? matches[0].name };
}

// ── 主入口 ─────────────────────────────────────────────────────

export async function runProjectHealthGrader(
  ctx: ProjectHealthGraderContext,
): Promise<GraderResult> {
  if (!ctx.orgId || !ctx.userId) {
    throw new Error("ProjectHealthGrader 缺少 orgId / userId");
  }
  const mode = ctx.mode ?? "GLOBAL";
  return mode === "PROJECT" ? runProjectMode(ctx) : runGlobalMode(ctx);
}

// ── GLOBAL 模式 ────────────────────────────────────────────────

async function runGlobalMode(ctx: ProjectHealthGraderContext): Promise<GraderResult> {
  const now = ctx.now ?? new Date();
  const maxIssues = ctx.maxIssues ?? DEFAULT_MAX_ISSUES;
  const maxActions = ctx.maxActions ?? DEFAULT_MAX_ACTIONS;

  const scope = await buildProjectScopeWhere(ctx.userId, ctx.orgId, ctx.role);
  const projects = (await db.project.findMany({
    where: scope,
    select: PROJECT_SELECT,
    orderBy: { updatedAt: "asc" },
    take: 50,
  })) as ProjectRow[];

  const findings: ProjectFinding[] = [];
  for (const p of projects) {
    findings.push(...evaluateProject(p, now, true));
  }
  sortBySeverity(findings);

  return buildResult(findings, maxIssues, maxActions, now, {
    emptySummary: "暂时没有需要处理的高风险项目，保持节奏 👍",
    summaryFn: (s, r, n) => `项目风险体检：评分 ${s}/100（风险 ${r}），有 ${n} 个项目需要处理。`,
  });
}

// ── PROJECT 模式 ───────────────────────────────────────────────

async function runProjectMode(ctx: ProjectHealthGraderContext): Promise<GraderResult> {
  const now = ctx.now ?? new Date();
  const maxIssues = ctx.maxIssues ?? DEFAULT_MAX_ISSUES;
  const maxActions = ctx.maxActions ?? DEFAULT_MAX_ACTIONS;

  if (!ctx.projectId) throw new Error("PROJECT 模式需要已解析的 projectId");
  const scope = await buildProjectScopeWhere(ctx.userId, ctx.orgId, ctx.role);

  const project = (await db.project.findFirst({
    where: { AND: [scope, { id: ctx.projectId }] },
    select: PROJECT_SELECT,
  })) as ProjectRow | null;

  if (!project) {
    return {
      score: 100,
      riskLevel: "LOW",
      summary: "没有找到该项目或无权访问。",
      issues: [],
      suggestedActions: [],
      evidence: [],
    };
  }

  const findings = evaluateProject(project, now, false);
  sortBySeverity(findings);

  const displayName = project.code ?? project.name;
  return buildResult(findings, maxIssues, maxActions, now, {
    subjectName: displayName,
    emptySummary: `${displayName} 暂无明显风险 👍`,
    summaryFn: (s, r, n) => `${displayName} 健康分 ${s}/100（风险 ${r}），发现 ${n} 项需关注。`,
  });
}

// ── 规则 ───────────────────────────────────────────────────────

function evaluateProject(
  p: ProjectRow,
  now: Date,
  withPrefix: boolean,
): ProjectFinding[] {
  const out: ProjectFinding[] = [];
  const display = p.code ?? p.name;
  const prefix = withPrefix ? `${display}：` : "";
  const base = { projectId: p.id, projectName: display };

  // 已结束项目不体检
  if (DONE_STATUSES.has(p.status)) return out;

  const daysSince = (d: Date) => Math.floor((now.getTime() - new Date(d).getTime()) / DAY_MS);

  // 1) deadline 风险
  if (p.dueDate) {
    const daysUntil = Math.ceil((new Date(p.dueDate).getTime() - now.getTime()) / DAY_MS);
    if (daysUntil < 0) {
      out.push({ ...base, level: "CRITICAL", title: `${prefix}项目已逾期 ${-daysUntil} 天`, actionKind: "deadline", reason: "项目已逾期未完成" });
    } else if (daysUntil <= 3) {
      out.push({ ...base, level: "CRITICAL", title: `${prefix}deadline ${daysUntil} 天内到期`, actionKind: "deadline", reason: "项目 deadline 临近（3 天内）" });
    } else if (daysUntil <= 7) {
      out.push({ ...base, level: "HIGH", title: `${prefix}deadline ${daysUntil} 天内到期`, actionKind: "deadline", reason: "项目 deadline 临近（7 天内）" });
    }
  }

  // 2) 长时间无更新
  const silent = daysSince(p.updatedAt);
  if (silent >= 14) {
    out.push({ ...base, level: "HIGH", title: `${prefix}项目 ${silent} 天无更新`, actionKind: "task", reason: "项目长时间无更新", taskTitle: `${display} 项目复查` });
  } else if (silent >= 7) {
    out.push({ ...base, level: "MEDIUM", title: `${prefix}项目 ${silent} 天无更新`, actionKind: "task", reason: "项目较长时间无更新", taskTitle: `${display} 项目复查` });
  }

  // 3) 无下一步任务
  const openTasks = p.tasks.filter(
    (t) => !t.completedAt && !DONE_TASK_STATUSES.has(t.status),
  );
  if (openTasks.length === 0) {
    out.push({ ...base, level: "MEDIUM", title: `${prefix}没有下一步任务`, actionKind: "task", reason: "项目缺少下一步任务", taskTitle: "补齐项目下一步事项" });
  }

  // 4) 未完成高优先级任务
  const openHigh = openTasks.filter((t) => t.priority === "high" || t.priority === "urgent");
  if (openHigh.length > 0) {
    out.push({ ...base, level: "HIGH", title: `${prefix}有 ${openHigh.length} 个未完成高优先级任务`, actionKind: "task", reason: "存在未完成高优先级任务", taskTitle: "跟进高优先级任务" });
  }

  // 5) 缺项目文件
  if (p._count.documents === 0) {
    out.push({ ...base, level: "MEDIUM", title: `${prefix}缺少项目文件`, actionKind: "task", reason: "项目尚无任何文件/附件", taskTitle: "补充项目文件" });
  }

  // 6) 窗帘/工程项目专属轻量文本检查
  out.push(...evaluateCurtain(p, prefix, base));

  return out;
}

function evaluateCurtain(
  p: ProjectRow,
  prefix: string,
  base: { projectId: string; projectName: string },
): ProjectFinding[] {
  const out: ProjectFinding[] = [];
  const text = [p.name, p.code ?? "", p.description ?? "", ...p.tasks.map((t) => t.title)]
    .join(" ")
    .toLowerCase();

  if (!CURTAIN_KEYWORDS.test(text)) return out;

  // 样品/布料确认
  if (!/sample|fabric|样品|布料/i.test(text)) {
    out.push({ ...base, level: "HIGH", title: `${prefix}未检测到样品/布料确认`, actionKind: "task", reason: "窗帘项目缺少样品/布料确认", taskTitle: "确认样品/布料" });
  }
  // 现场测量
  if (!/site measure|site measurement|现场测量|测量/i.test(text)) {
    out.push({ ...base, level: "MEDIUM", title: `${prefix}未检测到现场测量安排`, actionKind: "task", reason: "窗帘项目缺少现场测量", taskTitle: "安排现场测量" });
  }
  // 安装
  if (!/install|installation|安装/i.test(text)) {
    out.push({ ...base, level: "MEDIUM", title: `${prefix}未检测到安装安排`, actionKind: "task", reason: "窗帘项目缺少安装安排", taskTitle: "安排项目安装" });
  }
  // 电动项目电源/电工责任
  if (MOTORIZED_KEYWORDS.test(text) && !/electrician|power|电工|电源/i.test(text)) {
    out.push({ ...base, level: "HIGH", title: `${prefix}电动项目未检测到电源/电工责任确认`, actionKind: "task", reason: "电动项目缺少电源/电工责任确认", taskTitle: "确认电源/电工责任" });
  }

  return out;
}

// ── 结果组装 ───────────────────────────────────────────────────

function buildResult(
  findings: ProjectFinding[],
  maxIssues: number,
  maxActions: number,
  now: Date,
  opts: {
    subjectName?: string;
    emptySummary: string;
    summaryFn: (score: number, risk: RiskLevel, n: number) => string;
  },
): GraderResult {
  const scored = findings.filter((f) => f.level !== "LOW");
  const { score, riskLevel } = computeScoreAndRisk(scored.map((f) => f.level));

  const topFindings = findings.slice(0, maxIssues);
  const issues: GraderIssue[] = topFindings.map((f) => ({
    severity: f.level,
    category: "project_health",
    title: f.title,
    description: "",
  }));
  const evidence: GraderEvidence[] = topFindings.map((f) => ({
    sourceType: "PROJECT",
    sourceId: f.projectId,
    text: f.title,
  }));

  const suggestedActions = buildActions(findings, maxActions, now);

  const summary =
    scored.length === 0 ? opts.emptySummary : opts.summaryFn(score, riskLevel, findings.length);

  return { score, riskLevel, summary, issues, suggestedActions, evidence };
}

function buildActions(
  findings: ProjectFinding[],
  maxActions: number,
  now: Date,
): GraderAction[] {
  const candidates: GraderAction[] = [];
  const seen = new Set<string>();
  const startTime = nextMorningISO(now);

  for (const f of findings) {
    if (!f.actionKind) continue;
    const key = `${f.actionKind}:${f.projectId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (f.actionKind === "deadline") {
      candidates.push({
        actionType: "CREATE_CALENDAR_REMINDER",
        label: `创建 ${f.projectName} 截止提醒`,
        description: "提醒负责人处理项目截止前事项",
        requiresApproval: true,
        payload: {
          title: `项目截止提醒 - ${f.projectName}`,
          startTime,
          durationMinutes: 30,
          projectId: f.projectId,
          reason: f.reason ?? f.title,
        },
      });
    } else if (f.actionKind === "task") {
      // CREATE_PROJECT_TASK → grader.project_task（真实创建 Task）
      const taskTitle = (f.taskTitle ?? f.reason ?? f.title).slice(0, 160);
      candidates.push({
        actionType: "CREATE_PROJECT_TASK",
        label: `创建 ${f.projectName} 处理任务`,
        description: f.reason ?? f.title,
        requiresApproval: true,
        payload: {
          projectId: f.projectId,
          title: taskTitle,
          description: f.reason ?? f.title,
          reason: f.reason ?? f.title,
          issueCategory: "project_health",
          issueSeverity: f.level,
          graderType: "PROJECT_HEALTH",
        },
      });
    }
  }

  // 仅对 Top 1 高风险项目生成 1 个 PROJECT internal note（沉淀到项目 timeline）。
  // 排序后落在 calendar / project task 之后（第 3 位或被截断），不挤掉 deadline 提醒。
  const note = buildTopProjectNote(findings);
  if (note) candidates.push(note);

  return orderAndCapActions(candidates, maxActions);
}

/** 取最高风险项目（CRITICAL/HIGH）的若干 finding，汇总成一条 PROJECT internal note */
function buildTopProjectNote(findings: ProjectFinding[]): GraderAction | null {
  const top = findings.find((f) => f.level === "CRITICAL" || f.level === "HIGH");
  if (!top) return null;

  const projectFindings = findings
    .filter((f) => f.projectId === top.projectId && f.level !== "LOW")
    .slice(0, 3);
  const reasons = projectFindings.map((f) => f.reason ?? stripPrefix(f.title, top.projectName));
  const noteText = `AI 项目体检发现：${top.projectName} ${reasons.join("；")}。建议尽快安排负责人处理。`;

  return buildProjectInternalNoteAction({
    projectId: top.projectId,
    projectName: top.projectName,
    noteText: noteText.slice(0, 2000),
    reason: "ProjectHealthGrader 检测到项目高风险",
    issueCategory: "project_health",
    issueSeverity: top.level,
  });
}

function stripPrefix(title: string, projectName: string): string {
  return title.startsWith(`${projectName}：`) ? title.slice(projectName.length + 1) : title;
}

// ── 工具 ───────────────────────────────────────────────────────

function sortBySeverity(findings: ProjectFinding[]): void {
  const rank: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  findings.sort((a, b) => rank[a.level] - rank[b.level]);
}

function nextMorningISO(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}
