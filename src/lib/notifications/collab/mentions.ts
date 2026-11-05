/**
 * 协作通知 COLLAB-2：@ 提及（design D3、D4，spec notifications/mentions）
 *
 * - 名单格式：可选数组，每项 { userId, name? }；按 userId 去重；最多 20 人；只保存 userId 与 name。
 * - 被 @ 的人要同时满足：账号在职、对象所属组织的 active 成员、能看到对象（规则由调用方注入）。
 *   任一人不满足 → 整条请求 400（MENTION_NOT_ALLOWED），只回 id，不回姓名与邮箱；@ 自己视为满足。
 * - 10 分钟内的重发：讨论区只判带 @ 的消息（正文与名单都相同）；任务评论不论带不带 @（正文相同）。
 * - 提及通知：mention / high；去重键 mention:<消息或评论 id>:<被 @ 人 id>；摘要取正文前 80 字并脱敏。
 */

import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import type { MentionItem } from "@/lib/project-discussion/types";
import { canUserViewTask, type TaskAccessFields } from "@/lib/tasks/access";
import type { CollabEvent } from "./deliver";
import { REDACTED_TEXT, isSensitiveText, redactText } from "./redact";

export const MENTION_MAX = 20;
/** 任务评论 @ 的候选人上限 */
export const MENTION_CANDIDATE_MAX = 200;
export const MENTION_NAME_MAX = 50;
export const MENTION_SUMMARY_MAX = 80;
export const MENTION_REPLAY_WINDOW_MS = 10 * 60 * 1000;

export const MENTION_INVALID_ERROR = "@ 名单格式不正确";
export const MENTION_TOO_MANY_ERROR = `一次最多 @ ${MENTION_MAX} 人`;
export const MENTION_NOT_ALLOWED_ERROR = "有被 @ 的人无法接收：账号已停用、不在本组织，或看不到这里";

// ── 名单格式 ──────────────────────────────────────────────────

export interface RequestedMention {
  userId: string;
  /** 请求里带的显示名；没带（或不是字符串）为 null */
  name: string | null;
}

export type MentionParseResult =
  | { ok: true; mentions: RequestedMention[] }
  | { ok: false; error: string };

export function parseMentionList(raw: unknown): MentionParseResult {
  if (raw === undefined || raw === null) return { ok: true, mentions: [] };
  if (!Array.isArray(raw)) return { ok: false, error: MENTION_INVALID_ERROR };
  const out: RequestedMention[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: MENTION_INVALID_ERROR };
    }
    const { userId, name } = item as { userId?: unknown; name?: unknown };
    if (typeof userId !== "string" || !userId.trim()) {
      return { ok: false, error: MENTION_INVALID_ERROR };
    }
    if (seen.has(userId)) continue;
    seen.add(userId);
    out.push({ userId, name: typeof name === "string" ? name : null });
  }
  if (out.length > MENTION_MAX) return { ok: false, error: MENTION_TOO_MANY_ERROR };
  return { ok: true, mentions: out };
}

/** 保存的名单：每项只含 userId 与 name；name 优先用请求里的（截到 50 字），没带用账号姓名 */
export function buildMentionMetadata(
  requested: RequestedMention[],
  accountNames: Map<string, string>,
): MentionItem[] {
  return requested.map((m) => {
    const given = m.name?.trim() ? m.name : null;
    const name = (given ?? accountNames.get(m.userId) ?? "").slice(0, MENTION_NAME_MAX);
    return { userId: m.userId, name };
  });
}

/** 从已存消息的 metadata 读出 @ 名单 */
export function mentionIdsOf(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const list = (metadata as { mentions?: unknown }).mentions;
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => (m && typeof m === "object" ? (m as { userId?: unknown }).userId : undefined))
    .filter((id): id is string => typeof id === "string");
}

// ── 接收条件 ──────────────────────────────────────────────────

export interface MentionCheckDeps {
  loadUsers(ids: string[]): Promise<AuthUser[]>;
  findActiveMemberIds(orgId: string, ids: string[]): Promise<string[]>;
  /** 能否看到对象：讨论区按查看讨论区的规则，任务按查看任务详情的规则 */
  canView(user: AuthUser): Promise<boolean>;
}

export type MentionCheckResult =
  | { ok: true; names: Map<string, string> }
  | { ok: false; invalidUserIds: string[] };

export async function checkMentionRecipients(
  ids: string[],
  ctx: { actorId: string; orgId: string | null },
  deps: MentionCheckDeps,
): Promise<MentionCheckResult> {
  if (ids.length === 0) return { ok: true, names: new Map() };
  const users = await deps.loadUsers(ids);
  const byId = new Map(users.map((u) => [u.id, u]));
  const names = new Map(users.map((u) => [u.id, u.name]));
  const others = ids.filter((id) => id !== ctx.actorId);
  const members =
    ctx.orgId && others.length > 0
      ? new Set(await deps.findActiveMemberIds(ctx.orgId, others))
      : null;
  const invalid: string[] = [];
  for (const id of others) {
    const u = byId.get(id);
    if (!u || u.status !== "active") invalid.push(id);
    else if (members && !members.has(id)) invalid.push(id);
    else if (!(await deps.canView(u))) invalid.push(id);
  }
  return invalid.length > 0 ? { ok: false, invalidUserIds: invalid } : { ok: true, names };
}

const MENTION_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  nickname: true,
  avatar: true,
  role: true,
  status: true,
  canEditCustomers: true,
} as const;

function toAuthUser(u: {
  id: string;
  email: string;
  name: string;
  nickname: string | null;
  avatar: string | null;
  role: string;
  status: string;
  canEditCustomers: boolean | null;
}): AuthUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    nickname: u.nickname,
    avatar: u.avatar,
    role: u.role,
    status: u.status,
    canEditCustomers: u.canEditCustomers ?? true,
  };
}

/** 按 id 加载被 @ 的人（AuthUser 形状，供查看规则使用） */
export async function loadMentionUsers(ids: string[]): Promise<AuthUser[]> {
  const rows = await db.user.findMany({ where: { id: { in: ids } }, select: MENTION_USER_SELECT });
  return rows.map(toAuthUser);
}

export interface MentionCandidateItem {
  userId: string;
  name: string;
  avatar: string | null;
}

/** 逐个按任务查看规则过滤，保持原顺序；每次并发 20 人 */
async function filterTaskViewers(
  users: AuthUser[],
  task: TaskAccessFields,
): Promise<AuthUser[]> {
  const out: AuthUser[] = [];
  for (let i = 0; i < users.length; i += 20) {
    const chunk = users.slice(i, i + 20);
    const flags = await Promise.all(chunk.map((u) => canUserViewTask(u, task)));
    chunk.forEach((u, j) => {
      if (flags[j]) out.push(u);
    });
  }
  return out;
}

/**
 * 任务评论 @ 的候选人（design D5，spec mentions「任务评论 @ 的候选人接口」），不含调用人：
 * - 任务属于组织的项目：该组织的 active 成员、账号在职，按姓名排序取前 200 人，再逐个按任务查看规则过滤；
 * - 任务没有项目（或项目不属于组织）：只看创建人与负责人中账号在职、能看到任务的人。
 */
export async function listTaskMentionCandidates(
  task: TaskAccessFields & { orgId: string | null },
  callerId: string,
): Promise<MentionCandidateItem[]> {
  let users: AuthUser[];
  if (task.projectId && task.orgId) {
    const rows = await db.organizationMember.findMany({
      where: {
        orgId: task.orgId,
        status: "active",
        userId: { not: callerId },
        user: { status: "active" },
      },
      select: { user: { select: MENTION_USER_SELECT } },
      orderBy: { user: { name: "asc" } },
      take: MENTION_CANDIDATE_MAX,
    });
    users = rows.map((r) => toAuthUser(r.user));
  } else {
    const ids = [...new Set([task.creatorId, task.assigneeId])].filter(
      (id): id is string => !!id && id !== callerId,
    );
    users = ids.length > 0 ? (await loadMentionUsers(ids)).filter((u) => u.status === "active") : [];
    users.sort((a, b) => a.name.localeCompare(b.name));
  }
  const visible = await filterTaskViewers(users, task);
  return visible.map((u) => ({ userId: u.id, name: u.name, avatar: u.avatar }));
}

// ── 10 分钟内的重发 ───────────────────────────────────────────

export function sameMentionList(a: readonly string[], b: readonly string[]): boolean {
  const norm = (x: readonly string[]) => [...new Set(x)].sort().join("\u0000");
  return norm(a) === norm(b);
}

function withinReplayWindow(createdAt: Date, now: Date): boolean {
  return createdAt.getTime() >= now.getTime() - MENTION_REPLAY_WINDOW_MS;
}

function earliest<T extends { createdAt: Date }>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) if (!best || r.createdAt < best.createdAt) best = r;
  return best;
}

/** 讨论区：只判带 @ 的消息；正文（去首尾空白）与 @ 名单都相同、10 分钟内 → 返回最早那条 */
export function findDiscussionReplay<T extends { body: string; createdAt: Date; mentionIds: string[] }>(
  rows: T[],
  req: { body: string; mentionIds: string[] },
  now: Date,
): T | null {
  if (req.mentionIds.length === 0) return null;
  const body = req.body.trim();
  return earliest(
    rows.filter(
      (r) =>
        r.body.trim() === body &&
        withinReplayWindow(r.createdAt, now) &&
        sameMentionList(r.mentionIds, req.mentionIds),
    ),
  );
}

/** 任务评论：不论带不带 @；正文（去首尾空白）相同、10 分钟内 → 返回最早那条 */
export function findCommentReplay<T extends { content: string; createdAt: Date }>(
  rows: T[],
  req: { content: string },
  now: Date,
): T | null {
  const content = req.content.trim();
  return earliest(rows.filter((r) => r.content.trim() === content && withinReplayWindow(r.createdAt, now)));
}

// ── 标题、摘要与通知事件 ──────────────────────────────────────

export function discussionMentionTitle(actorName: string, projectName: string): string {
  return `${actorName} 在项目「${redactText(projectName)}」讨论区 @ 了你`;
}

export function taskMentionTitle(actorName: string, taskTitle: string): string {
  return `${actorName} 在任务「${redactText(taskTitle)}」的评论里 @ 了你`;
}

/** 正文去首尾空白后的前 80 字；正文（或截出的部分）含敏感内容 → 整段替换 */
export function mentionSummary(body: string): string {
  const trimmed = body.trim();
  const excerpt = trimmed.slice(0, MENTION_SUMMARY_MAX);
  return isSensitiveText(trimmed) || isSensitiveText(excerpt) ? REDACTED_TEXT : excerpt;
}

export function discussionMentionEvent(input: {
  messageId: string;
  projectId: string;
  projectName: string;
  orgId: string | null;
  actorId: string;
  actorName: string;
  body: string;
  mentionIds: string[];
}): CollabEvent {
  return {
    type: "mention",
    priority: "high",
    title: discussionMentionTitle(input.actorName, input.projectName),
    summary: mentionSummary(input.body),
    entityType: "project_discussion",
    entityId: input.messageId,
    sourceKeyPrefix: `mention:${input.messageId}`,
    orgId: input.orgId,
    projectId: input.projectId,
    actorId: input.actorId,
    recipientIds: input.mentionIds,
    metadata: { objectLabel: `项目「${redactText(input.projectName)}」讨论区` },
  };
}

export function taskCommentMentionEvent(input: {
  commentId: string;
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  orgId: string | null;
  actorId: string;
  actorName: string;
  content: string;
  mentionIds: string[];
  dueAt: Date | null;
}): CollabEvent {
  return {
    type: "mention",
    priority: "high",
    title: taskMentionTitle(input.actorName, input.taskTitle),
    summary: mentionSummary(input.content),
    entityType: "task",
    entityId: input.taskId,
    sourceKeyPrefix: `mention:${input.commentId}`,
    orgId: input.orgId,
    projectId: input.projectId,
    actorId: input.actorId,
    recipientIds: input.mentionIds,
    metadata: {
      objectLabel: `任务「${redactText(input.taskTitle)}」`,
      ...(input.dueAt ? { dueAt: input.dueAt.toISOString() } : {}),
    },
  };
}
