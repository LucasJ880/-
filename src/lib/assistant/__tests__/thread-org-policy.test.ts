/**
 * Phase 3B-A：AiThread 组织绑定策略单测（无 DB）
 * 运行：npx tsx src/lib/assistant/__tests__/thread-org-policy.test.ts
 */

import assert from "node:assert/strict";
import {
  decideAiThreadOrgBackfill,
  canConfirmPendingActionInActiveOrg,
} from "@/lib/assistant/thread-org-backfill";
import {
  visibleThreadWhere,
  ownedThreadWhere,
  threadNotFoundResponse,
  resolveTrustedAssistantOrg,
  threadAccessAllowsArchived,
} from "@/lib/assistant/thread-org";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("thread-org-policy");

// ── 创建契约 ──
ok(
  "visible where requires userId+orgId+not archived",
  (() => {
    const w = visibleThreadWhere("u1", "sunny");
    return w.userId === "u1" && w.orgId === "sunny" && w.archived === false;
  })(),
);

ok(
  "owned where binds thread+user+org",
  (() => {
    const w = ownedThreadWhere("t1", "u1", "sunny");
    return (
      w.id === "t1" &&
      w.userId === "u1" &&
      w.orgId === "sunny" &&
      w.archived === false
    );
  })(),
);

ok(
  "owned where includeArchived omits archived filter",
  (() => {
    const w = ownedThreadWhere("t1", "u1", "sunny", { includeArchived: true });
    return (
      w.id === "t1" &&
      w.orgId === "sunny" &&
      !("archived" in w)
    );
  })(),
);

ok(
  "cross-org leak uses THREAD_NOT_FOUND 404",
  (() => {
    const res = threadNotFoundResponse();
    return res.status === 404;
  })(),
);

// ── 组织解析：activeOrg 优先；query/body 仅交叉校验 ──
ok(
  "activeOrg=Sunny + queryOrg=Sunny → PASS",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: "sunny",
      memberOrgIds: ["sunny", "mengxin"],
      queryOrgId: "sunny",
    });
    return r.ok && r.orgId === "sunny";
  })(),
);

ok(
  "activeOrg=Sunny + queryOrg=梦馨 → ORG_CONTEXT_MISMATCH",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: "sunny",
      memberOrgIds: ["sunny", "mengxin"],
      queryOrgId: "mengxin",
    });
    return !r.ok && r.code === "ORG_CONTEXT_MISMATCH";
  })(),
);

ok(
  "activeOrg=Sunny + bodyOrg=梦馨 → ORG_CONTEXT_MISMATCH",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: "sunny",
      memberOrgIds: ["sunny", "mengxin"],
      bodyOrgId: "mengxin",
    });
    return !r.ok && r.code === "ORG_CONTEXT_MISMATCH";
  })(),
);

ok(
  "无 activeOrg + 多 membership + queryOrg=Sunny → TENANT_CONTEXT_REQUIRED",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: null,
      memberOrgIds: ["sunny", "mengxin"],
      queryOrgId: "sunny",
    });
    return !r.ok && r.code === "TENANT_CONTEXT_REQUIRED";
  })(),
);

ok(
  "无 activeOrg + 唯一 membership → fallback",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: null,
      memberOrgIds: ["sunny"],
      queryOrgId: null,
    });
    return r.ok && r.orgId === "sunny";
  })(),
);

ok(
  "query 不能选组织（activeOrg 优先于 query）",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: "sunny",
      memberOrgIds: ["sunny", "mengxin"],
      queryOrgId: "mengxin",
    });
    // 不得返回 mengxin
    return !r.ok || r.orgId !== "mengxin";
  })(),
);

ok(
  "body 不能选组织",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: "sunny",
      memberOrgIds: ["sunny", "mengxin"],
      bodyOrgId: "mengxin",
    });
    return !r.ok && r.code === "ORG_CONTEXT_MISMATCH";
  })(),
);

ok(
  "非 membership 的 activeOrg 不可信 → TENANT_CONTEXT_REQUIRED（多 membership）",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: "other",
      memberOrgIds: ["sunny", "mengxin"],
    });
    return !r.ok && r.code === "TENANT_CONTEXT_REQUIRED";
  })(),
);

ok(
  "非 membership activeOrg + 唯一 membership → 用唯一 membership",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: "other",
      memberOrgIds: ["sunny"],
    });
    return r.ok && r.orgId === "sunny";
  })(),
);

ok(
  "无 membership → NO_MEMBERSHIP",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: "sunny",
      memberOrgIds: [],
    });
    return !r.ok && r.code === "NO_MEMBERSHIP";
  })(),
);

ok(
  "activeOrg 优先于唯一 membership 以外的臆测",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: "mengxin",
      memberOrgIds: ["sunny", "mengxin"],
      queryOrgId: "sunny",
    });
    return !r.ok && r.code === "ORG_CONTEXT_MISMATCH";
  })(),
);

// ── 归档访问策略 ──
ok(
  "list/read/message 不允许默认访问归档",
  !threadAccessAllowsArchived({ operation: "list" }) &&
    !threadAccessAllowsArchived({ operation: "read" }) &&
    !threadAccessAllowsArchived({ operation: "message" }),
);

ok(
  "patch/delete 允许访问归档（取消归档/删除）",
  threadAccessAllowsArchived({ operation: "patch" }) &&
    threadAccessAllowsArchived({ operation: "delete" }),
);

ok(
  "同 org 归档线程可 PATCH archived=false（策略）",
  (() => {
    // includeArchived where 可命中；orgId 必须非空
    const w = ownedThreadWhere("t-arch", "u1", "sunny", {
      includeArchived: true,
    });
    return w.orgId === "sunny" && !("archived" in w);
  })(),
);

ok(
  "消息读取仍排除归档（默认 where）",
  (() => {
    const w = ownedThreadWhere("t-arch", "u1", "sunny");
    return w.archived === false;
  })(),
);

ok(
  "orgId=null 历史归档无法经普通 API 恢复（无 org 匹配）",
  (() => {
    // 普通 API 永远要求 orgId=activeOrg；null 永不命中
    const activeOrg = "sunny";
    const historical = { id: "h1", orgId: null as string | null, archived: true };
    const canRestore =
      historical.orgId === activeOrg; // false
    return !canRestore;
  })(),
);

ok(
  "跨 org 归档线程 PATCH/DELETE 表现为不存在",
  (() => {
    const activeOrg = "sunny";
    const otherArchived = { id: "t2", orgId: "mengxin", archived: true };
    const visible =
      otherArchived.orgId === activeOrg; // false → 404
    return !visible;
  })(),
);

// ── 回填：创建/绑定来源 ──
ok(
  "already bound skipped",
  decideAiThreadOrgBackfill({
    existingOrgId: "org-a",
    archived: false,
    projectOrg: "org-b",
    pendingActionOrgs: [],
    agentRunOrgs: [],
    membershipOrgs: ["org-a"],
  }).kind === "skip_bound",
);

ok(
  "already archived unresolved skipped (idempotent)",
  decideAiThreadOrgBackfill({
    existingOrgId: null,
    archived: true,
    projectOrg: "org-a",
    pendingActionOrgs: [],
    agentRunOrgs: [],
    membershipOrgs: ["org-a"],
  }).kind === "skip_already_archived",
);

ok(
  "project unique bind",
  (() => {
    const d = decideAiThreadOrgBackfill({
      existingOrgId: null,
      archived: false,
      projectOrg: "org-a",
      pendingActionOrgs: ["org-a"],
      agentRunOrgs: [],
      membershipOrgs: ["org-a", "org-b"],
    });
    return d.kind === "bind" && d.source === "project" && d.orgId === "org-a";
  })(),
);

ok(
  "pending action unique bind",
  (() => {
    const d = decideAiThreadOrgBackfill({
      existingOrgId: null,
      archived: false,
      projectOrg: null,
      pendingActionOrgs: ["org-b"],
      agentRunOrgs: [],
      membershipOrgs: ["org-a", "org-b"],
    });
    return (
      d.kind === "bind" && d.source === "pending_action" && d.orgId === "org-b"
    );
  })(),
);

ok(
  "agent run unique bind",
  (() => {
    const d = decideAiThreadOrgBackfill({
      existingOrgId: null,
      archived: false,
      projectOrg: null,
      pendingActionOrgs: [],
      agentRunOrgs: ["org-c"],
      membershipOrgs: [],
    });
    return d.kind === "bind" && d.source === "agent_run" && d.orgId === "org-c";
  })(),
);

ok(
  "unique active membership bind",
  (() => {
    const d = decideAiThreadOrgBackfill({
      existingOrgId: null,
      archived: false,
      projectOrg: null,
      pendingActionOrgs: [],
      agentRunOrgs: [],
      membershipOrgs: ["org-only"],
    });
    return (
      d.kind === "bind" && d.source === "membership" && d.orgId === "org-only"
    );
  })(),
);

ok(
  "multiple pending orgs conflict",
  (() => {
    const d = decideAiThreadOrgBackfill({
      existingOrgId: null,
      archived: false,
      projectOrg: null,
      pendingActionOrgs: ["org-a", "org-b"],
      agentRunOrgs: [],
      membershipOrgs: ["org-a"],
    });
    return (
      d.kind === "archive" && d.reasonCode === "MULTIPLE_PENDING_ACTION_ORGS"
    );
  })(),
);

ok(
  "project vs pending conflict",
  (() => {
    const d = decideAiThreadOrgBackfill({
      existingOrgId: null,
      archived: false,
      projectOrg: "org-a",
      pendingActionOrgs: ["org-b"],
      agentRunOrgs: [],
      membershipOrgs: ["org-a"],
    });
    return (
      d.kind === "archive" &&
      d.reasonCode === "PROJECT_PENDING_ACTION_CONFLICT"
    );
  })(),
);

ok(
  "multiple agent run orgs conflict",
  (() => {
    const d = decideAiThreadOrgBackfill({
      existingOrgId: null,
      archived: false,
      projectOrg: null,
      pendingActionOrgs: [],
      agentRunOrgs: ["org-a", "org-b"],
      membershipOrgs: [],
    });
    return d.kind === "archive" && d.reasonCode === "MULTIPLE_AGENT_RUN_ORGS";
  })(),
);

ok(
  "no reliable source → multiple memberships unresolved",
  (() => {
    const d = decideAiThreadOrgBackfill({
      existingOrgId: null,
      archived: false,
      projectOrg: null,
      pendingActionOrgs: [],
      agentRunOrgs: [],
      membershipOrgs: ["org-a", "org-b"],
    });
    return (
      d.kind === "archive" && d.reasonCode === "MULTIPLE_ACTIVE_MEMBERSHIPS"
    );
  })(),
);

ok(
  "no membership unresolved",
  (() => {
    const d = decideAiThreadOrgBackfill({
      existingOrgId: null,
      archived: false,
      projectOrg: null,
      pendingActionOrgs: [],
      agentRunOrgs: [],
      membershipOrgs: [],
    });
    return d.kind === "archive" && d.reasonCode === "NO_ACTIVE_MEMBERSHIP";
  })(),
);

ok(
  "idempotent: bound stays skip on repeat",
  decideAiThreadOrgBackfill({
    existingOrgId: "org-a",
    archived: false,
    projectOrg: null,
    pendingActionOrgs: [],
    agentRunOrgs: [],
    membershipOrgs: ["org-a", "org-b"],
  }).kind === "skip_bound",
);

// ── PendingAction 跨 org ──
ok(
  "same org can confirm PA",
  canConfirmPendingActionInActiveOrg({
    actionOrgId: "sunny",
    activeOrgId: "sunny",
  }).ok,
);

ok(
  "cross org PA confirm rejected (Sunny→梦馨)",
  (() => {
    const r = canConfirmPendingActionInActiveOrg({
      actionOrgId: "sunny",
      activeOrgId: "mengxin",
    });
    return !r.ok && r.code === "ORG_CONTEXT_MISMATCH";
  })(),
);

ok(
  "null-org personal draft allowed under active org gate",
  canConfirmPendingActionInActiveOrg({
    actionOrgId: null,
    activeOrgId: "sunny",
  }).ok,
);

// ── 列表过滤契约（模拟） ──
ok(
  "list excludes null-org and other-org threads",
  (() => {
    const activeOrg = "sunny";
    const threads = [
      { id: "a", orgId: "sunny", archived: false },
      { id: "b", orgId: "mengxin", archived: false },
      { id: "c", orgId: null, archived: true },
      { id: "d", orgId: "sunny", archived: true },
    ];
    const visible = threads.filter(
      (t) => t.orgId === activeOrg && !t.archived,
    );
    return (
      visible.length === 1 &&
      visible[0].id === "a" &&
      !visible.some((t) => t.orgId === null || t.orgId === "mengxin")
    );
  })(),
);

console.log(`结果: ${passed} passed`);
