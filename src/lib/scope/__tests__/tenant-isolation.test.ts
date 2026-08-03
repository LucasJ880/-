/**
 * 跨组织 / 跨项目越权 — 零容忍
 */
import assert from "node:assert/strict";
import { resolveScopeContext, type ScopeResolveDeps } from "../resolve";
import { ScopeResolutionError } from "../errors";
import {
  assertSameOrg,
  assertSameProject,
  assertToolArgsDoNotOverrideScope,
} from "../assert";

function deps(): ScopeResolveDeps {
  return {
    audit: false,
    findOrg: async (id) =>
      id === "orgA" || id === "orgB"
        ? { id, status: "active" }
        : null,
    findMembership: async (userId, orgId) => {
      if (userId === "userA" && orgId === "orgA") {
        return { role: "org_member", status: "active" };
      }
      if (userId === "userB" && orgId === "orgB") {
        return { role: "org_member", status: "active" };
      }
      return null;
    },
    findProject: async (id) => {
      if (id === "projA") {
        return {
          id: "projA",
          orgId: "orgA",
          ownerId: "userA",
          intakeStatus: "dispatched",
        };
      }
      if (id === "projB") {
        return {
          id: "projB",
          orgId: "orgB",
          ownerId: "userB",
          intakeStatus: "dispatched",
        };
      }
      return null;
    },
    findProjectMember: async () => null,
    findThread: async (id) => {
      if (id === "thrB") {
        return {
          id: "thrB",
          userId: "userB",
          orgId: "orgB",
          projectId: "projB",
        };
      }
      return null;
    },
  };
}

async function main() {
  const d = deps();

  // Org A 用户不能以 Org B 身份解析
  try {
    await resolveScopeContext(d, {
      principal: { id: "userA", role: "user" },
      orgId: "orgB",
      scopeType: "ORG",
    });
    assert.fail("should deny");
  } catch (err) {
    assert.ok(err instanceof ScopeResolutionError);
    assert.equal(err.reason, "no_membership");
  }

  // Org A 用户不能读 Org B 项目
  try {
    await resolveScopeContext(d, {
      principal: { id: "userA", role: "user" },
      orgId: "orgA",
      scopeType: "PROJECT",
      projectId: "projB",
    });
    assert.fail("should deny");
  } catch (err) {
    assert.ok(err instanceof ScopeResolutionError);
    assert.equal(err.reason, "project_org_mismatch");
  }

  // Org A Agent/Memory 边界：assertSameOrg
  const scopeA = await resolveScopeContext(d, {
    principal: { id: "userA", role: "user" },
    orgId: "orgA",
    scopeType: "PROJECT",
    projectId: "projA",
  });
  assert.throws(() => assertSameOrg(scopeA, "orgB", "memory"), ScopeResolutionError);
  assert.throws(() => assertSameProject(scopeA, "projB", "memory"), ScopeResolutionError);

  // Tool 不能通过参数覆盖 ScopeContext
  assert.throws(
    () => assertToolArgsDoNotOverrideScope(scopeA, { orgId: "orgB" }),
    ScopeResolutionError,
  );

  // 后台任务缺少 service principal 不能跳过租户
  try {
    await resolveScopeContext(d, {
      principal: { id: "cron-bot", role: "user" },
      orgId: "orgA",
      scopeType: "ORG",
      allowServicePrincipalWithoutMembership: true,
    });
    assert.fail("should deny");
  } catch (err) {
    assert.ok(err instanceof ScopeResolutionError);
    assert.equal(err.reason, "no_membership");
  }

  // 后台任务带 service principal：仍不能跨 org 读项目
  try {
    await resolveScopeContext(d, {
      principal: { id: "cron-bot", role: "user" },
      orgId: "orgA",
      scopeType: "PROJECT",
      projectId: "projB",
      servicePrincipal: "system:cron:qm-project-daily-brief",
      allowServicePrincipalWithoutMembership: true,
    });
    assert.fail("should deny");
  } catch (err) {
    assert.ok(err instanceof ScopeResolutionError);
    assert.equal(err.reason, "project_org_mismatch");
  }

  // 线程跨组织
  try {
    await resolveScopeContext(d, {
      principal: { id: "userA", role: "user" },
      orgId: "orgA",
      scopeType: "THREAD",
      threadId: "thrB",
    });
    assert.fail("should deny");
  } catch (err) {
    assert.ok(err instanceof ScopeResolutionError);
    assert.equal(err.reason, "thread_org_mismatch");
  }

  console.log("tenant-isolation: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
