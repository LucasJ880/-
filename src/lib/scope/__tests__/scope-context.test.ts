/**
 * ScopeContext 单元测试（纯内存 deps，无 DB）
 */
import assert from "node:assert/strict";
import {
  resolveScopeContext,
  rejectUntrustedScopeClaims,
  type ScopeResolveDeps,
} from "../resolve";
import { ScopeResolutionError } from "../errors";
import {
  assertSameOrg,
  assertSameProject,
  assertToolArgsDoNotOverrideScope,
} from "../assert";
import { isAgentAutomationKilled } from "../kill-switch";
import {
  isQmScopePhase1Enabled,
  isQmPhase1ShadowMode,
  isOrgAllowlisted,
  isProjectAllowlisted,
} from "../flags";

function makeDeps(opts?: {
  orgs?: Record<string, { id: string; status: string }>;
  memberships?: Record<string, { role: string; status: string }>;
  projects?: Record<
    string,
    {
      id: string;
      orgId: string | null;
      ownerId: string | null;
      intakeStatus: string | null;
    }
  >;
  projectMembers?: Record<string, { role: string; status: string }>;
  threads?: Record<
    string,
    {
      id: string;
      userId: string;
      orgId: string | null;
      projectId: string | null;
    }
  >;
}): ScopeResolveDeps {
  const orgs = opts?.orgs ?? {
    orgA: { id: "orgA", status: "active" },
    orgB: { id: "orgB", status: "active" },
  };
  const memberships = opts?.memberships ?? {
    "userA:orgA": { role: "org_member", status: "active" },
    "userB:orgB": { role: "org_member", status: "active" },
  };
  const projects = opts?.projects ?? {
    projA: {
      id: "projA",
      orgId: "orgA",
      ownerId: "userA",
      intakeStatus: "dispatched",
    },
    projB: {
      id: "projB",
      orgId: "orgB",
      ownerId: "userB",
      intakeStatus: "dispatched",
    },
  };
  const projectMembers = opts?.projectMembers ?? {};
  const threads = opts?.threads ?? {
    thrA: {
      id: "thrA",
      userId: "userA",
      orgId: "orgA",
      projectId: "projA",
    },
  };

  return {
    audit: false,
    findOrg: async (id) => orgs[id] ?? null,
    findMembership: async (userId, orgId) =>
      memberships[`${userId}:${orgId}`] ?? null,
    findProject: async (id) => projects[id] ?? null,
    findProjectMember: async (userId, projectId) =>
      projectMembers[`${userId}:${projectId}`] ?? null,
    findThread: async (id) => threads[id] ?? null,
    loadWorkspaceIds: async () => [],
  };
}

async function expectDeny(
  fn: () => Promise<unknown>,
  reason: string,
): Promise<void> {
  try {
    await fn();
    assert.fail(`expected deny ${reason}`);
  } catch (err) {
    assert.ok(err instanceof ScopeResolutionError);
    assert.equal(err.reason, reason);
  }
}

async function main() {
  const deps = makeDeps();
  const principalA = { id: "userA", role: "user" };

  // ORG scope
  {
    const scope = await resolveScopeContext(deps, {
      principal: principalA,
      orgId: "orgA",
      scopeType: "ORG",
    });
    assert.equal(scope.scopeType, "ORG");
    assert.equal(scope.scopeId, "orgA");
    assert.equal(scope.orgId, "orgA");
    assert.equal(scope.principalUserId, "userA");
    assert.ok(scope.correlationId);
  }

  // USER scope
  {
    const scope = await resolveScopeContext(deps, {
      principal: principalA,
      orgId: "orgA",
      scopeType: "USER",
    });
    assert.equal(scope.scopeType, "USER");
    assert.equal(scope.scopeId, "userA");
  }

  // PROJECT scope
  {
    const scope = await resolveScopeContext(deps, {
      principal: principalA,
      orgId: "orgA",
      scopeType: "PROJECT",
      projectId: "projA",
    });
    assert.equal(scope.scopeType, "PROJECT");
    assert.equal(scope.projectId, "projA");
    assert.equal(scope.scopeId, "projA");
  }

  // THREAD scope
  {
    const scope = await resolveScopeContext(deps, {
      principal: principalA,
      orgId: "orgA",
      scopeType: "THREAD",
      threadId: "thrA",
    });
    assert.equal(scope.scopeType, "THREAD");
    assert.equal(scope.threadId, "thrA");
    assert.equal(scope.projectId, "projA");
  }

  // missing org
  await expectDeny(
    () =>
      resolveScopeContext(deps, {
        principal: principalA,
        orgId: "",
        scopeType: "ORG",
      }),
    "missing_org",
  );

  // invalid project
  await expectDeny(
    () =>
      resolveScopeContext(deps, {
        principal: principalA,
        orgId: "orgA",
        scopeType: "PROJECT",
        projectId: "missing",
      }),
    "invalid_project",
  );

  // scope / project org mismatch (Org A user → Org B project)
  await expectDeny(
    () =>
      resolveScopeContext(deps, {
        principal: principalA,
        orgId: "orgA",
        scopeType: "PROJECT",
        projectId: "projB",
      }),
    "project_org_mismatch",
  );

  // forged org claim
  await expectDeny(
    () =>
      resolveScopeContext(deps, {
        principal: principalA,
        orgId: "orgA",
        scopeType: "ORG",
        untrustedClaim: { orgId: "orgB" },
      }),
    "untrusted_claim_rejected",
  );

  // forged user claim
  await expectDeny(
    () =>
      resolveScopeContext(deps, {
        principal: principalA,
        orgId: "orgA",
        scopeType: "ORG",
        untrustedClaim: { principalUserId: "userB" },
      }),
    "untrusted_claim_rejected",
  );

  // no membership → deny
  await expectDeny(
    () =>
      resolveScopeContext(deps, {
        principal: { id: "userA", role: "user" },
        orgId: "orgB",
        scopeType: "ORG",
      }),
    "no_membership",
  );

  // rejectUntrusted direct
  assert.throws(
    () =>
      rejectUntrustedScopeClaims({
        trustedOrgId: "orgA",
        trustedUserId: "userA",
        claim: { orgId: "orgB" },
      }),
    ScopeResolutionError,
  );

  // cross-org assert
  {
    const scope = await resolveScopeContext(deps, {
      principal: principalA,
      orgId: "orgA",
      scopeType: "ORG",
    });
    assert.throws(() => assertSameOrg(scope, "orgB"), ScopeResolutionError);
    assert.doesNotThrow(() => assertSameOrg(scope, "orgA"));
  }

  // project assert + tool args override
  {
    const scope = await resolveScopeContext(deps, {
      principal: principalA,
      orgId: "orgA",
      scopeType: "PROJECT",
      projectId: "projA",
    });
    assert.throws(() => assertSameProject(scope, "projB"), ScopeResolutionError);
    assert.throws(
      () => assertToolArgsDoNotOverrideScope(scope, { orgId: "orgB" }),
      ScopeResolutionError,
    );
    assert.doesNotThrow(() =>
      assertToolArgsDoNotOverrideScope(scope, { orgId: "orgA", q: 1 }),
    );
  }

  // service principal without membership OK
  {
    const scope = await resolveScopeContext(deps, {
      principal: { id: "system", role: "user" },
      orgId: "orgA",
      scopeType: "PROJECT",
      projectId: "projA",
      servicePrincipal: "system:cron:project-daily-brief",
      triggerSource: "cron",
      allowServicePrincipalWithoutMembership: true,
    });
    assert.equal(scope.servicePrincipal, "system:cron:project-daily-brief");
    assert.equal(scope.hasMembership, false);
  }

  // background without service principal still needs membership
  await expectDeny(
    () =>
      resolveScopeContext(deps, {
        principal: { id: "system", role: "user" },
        orgId: "orgA",
        scopeType: "ORG",
        allowServicePrincipalWithoutMembership: true,
      }),
    "no_membership",
  );

  // flags defaults
  assert.equal(isQmScopePhase1Enabled({}), false);
  assert.equal(isQmPhase1ShadowMode({}), true);
  assert.equal(isOrgAllowlisted("orgA", {}), false);
  assert.equal(
    isOrgAllowlisted("orgA", { QINGYAN_QM_PHASE1_ORG_ALLOWLIST: "orgA,orgX" }),
    true,
  );
  assert.equal(
    isProjectAllowlisted("projA", {
      QINGYAN_QM_PHASE1_PROJECT_ALLOWLIST: "projA",
    }),
    true,
  );

  // kill switch
  assert.equal(isAgentAutomationKilled(undefined), false);
  assert.equal(isAgentAutomationKilled({ agentAutomationEnabled: false }), true);
  assert.equal(isAgentAutomationKilled({ agentAutomationEnabled: true }), false);

  console.log("scope-context: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
