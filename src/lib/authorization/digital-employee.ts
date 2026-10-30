/**
 * PERM-5b：数字员工主体（复用 Agent，不新建员工表）
 *
 * - 主体解析：Agent active、所属项目在当前企业、创建人（sponsor）是该企业 active 成员；任一不满足 fail-closed
 * - 默认岗位：四类数字员工角色各对应一个岗位（只允许绑这四个）
 * - 审计：correlation 标"数字员工 X 代 岗位 Y"，列表接口用 describeAuditActor 出展示文本
 * 规格：openspec/changes/perm-5b-digital-employee-positions/specs/authorization/digital-employee-principal/spec.md
 */

import { db } from "@/lib/db";
import type { PrincipalRef } from "./types";

/** 数字员工只允许绑定的岗位（拍板：销售 / 营销增长 / 投标 / 数据分析） */
export const DIGITAL_EMPLOYEE_POSITION_KEYS = ["sales_rep", "ops_staff", "bids", "accounting"] as const;
export type DigitalEmployeePositionKey = (typeof DIGITAL_EMPLOYEE_POSITION_KEYS)[number];

export function isDigitalEmployeePositionKey(key: string): key is DigitalEmployeePositionKey {
  return (DIGITAL_EMPLOYEE_POSITION_KEYS as readonly string[]).includes(key);
}

export type DigitalEmployeeResolveFailure =
  | "AGENT_NOT_FOUND"
  | "AGENT_INACTIVE"
  | "AGENT_ORG_MISMATCH"
  | "SPONSOR_NOT_MEMBER";

export type ResolvedDigitalEmployee =
  | { ok: true; principal: PrincipalRef; agent: { id: string; name: string } }
  | { ok: false; reasonCode: DigitalEmployeeResolveFailure };

/** 纯判定：给定 Agent 与 sponsor 成员信息，决定能否作为本企业的数字员工主体 */
export function decideDigitalEmployeePrincipal(input: {
  orgId: string;
  agent: { id: string; name: string; status: string; createdById: string; projectOrgId: string | null } | null;
  sponsorMembershipStatus: string | null;
}): ResolvedDigitalEmployee {
  const { agent } = input;
  if (!agent) return { ok: false, reasonCode: "AGENT_NOT_FOUND" };
  if (agent.status !== "active") return { ok: false, reasonCode: "AGENT_INACTIVE" };
  if (!agent.projectOrgId || agent.projectOrgId !== input.orgId) {
    return { ok: false, reasonCode: "AGENT_ORG_MISMATCH" };
  }
  if (input.sponsorMembershipStatus !== "active") return { ok: false, reasonCode: "SPONSOR_NOT_MEMBER" };
  return {
    ok: true,
    principal: { type: "DIGITAL_EMPLOYEE", id: agent.id, orgId: input.orgId, sponsorUserId: agent.createdById },
    agent: { id: agent.id, name: agent.name },
  };
}

/** 从 Agent 记录解析数字员工主体；sponsor = Agent 创建人（design D2） */
export async function resolveDigitalEmployeePrincipal(input: {
  agentId: string;
  orgId: string;
}): Promise<ResolvedDigitalEmployee> {
  const row = await db.agent.findUnique({
    where: { id: input.agentId },
    select: { id: true, name: true, status: true, createdById: true, project: { select: { orgId: true } } },
  });
  const membership = row
    ? await db.organizationMember.findUnique({
        where: { orgId_userId: { orgId: input.orgId, userId: row.createdById } },
        select: { status: true },
      })
    : null;
  return decideDigitalEmployeePrincipal({
    orgId: input.orgId,
    agent: row
      ? { id: row.id, name: row.name, status: row.status, createdById: row.createdById, projectOrgId: row.project.orgId }
      : null,
    sponsorMembershipStatus: membership?.status ?? null,
  });
}

export const DIGITAL_EMPLOYEE_ACTOR_KIND = "digital_employee" as const;

/** 审计 correlation：并入 AuditLog.afterData._runtimeCorrelation（零 schema） */
export function digitalEmployeeCorrelation(input: {
  principal: PrincipalRef;
  agentName: string;
  positionKey: string;
}): {
  actorKind: typeof DIGITAL_EMPLOYEE_ACTOR_KIND;
  actorType: "agent";
  actorId: string;
  agentId: string;
  agentName: string;
  positionKey: string;
  sponsorUserId: string;
} {
  return {
    actorKind: DIGITAL_EMPLOYEE_ACTOR_KIND,
    actorType: "agent",
    actorId: input.principal.id,
    agentId: input.principal.id,
    agentName: input.agentName,
    positionKey: input.positionKey,
    sponsorUserId: input.principal.sponsorUserId ?? "",
  };
}

/**
 * 审计列表展示：数字员工记录返回"数字员工 <名> 代 岗位 <key>"，其余返回 null。
 * AuditLog.afterData 落库为 JSON 字符串，这里两种形态都接受。
 */
export function describeAuditActor(afterData: unknown): string | null {
  let data = afterData;
  if (typeof data === "string") {
    if (!data.includes("_runtimeCorrelation")) return null;
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const c = (data as { _runtimeCorrelation?: unknown })._runtimeCorrelation;
  if (!c || typeof c !== "object") return null;
  const { actorKind, agentName, agentId, positionKey } = c as Record<string, unknown>;
  if (actorKind !== DIGITAL_EMPLOYEE_ACTOR_KIND) return null;
  const name = typeof agentName === "string" && agentName ? agentName : typeof agentId === "string" ? agentId : "?";
  const pos = typeof positionKey === "string" && positionKey ? positionKey : "?";
  return `数字员工 ${name} 代 岗位 ${pos}`;
}
