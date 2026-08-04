import assert from "node:assert/strict";
import {
  resolveScopedSkill,
  mapAgentSkillRow,
  assertUserSkillNotEscalated,
  type ScopedSkillRecord,
} from "../scoped-registry";
import type { ScopeContext } from "@/lib/scope";

function scope(over?: Partial<ScopeContext>): ScopeContext {
  return {
    orgId: "orgA",
    principalUserId: "userA",
    principalRole: "org_member",
    scopeType: "PROJECT",
    scopeId: "projA",
    projectId: "projA",
    correlationId: "tr_1",
    hasMembership: true,
    isPlatformAdmin: false,
    ...over,
  };
}

function skill(over?: Partial<ScopedSkillRecord>): ScopedSkillRecord {
  return {
    id: "s1",
    slug: "demo",
    orgId: "orgA",
    ownerScopeType: "ORG",
    ownerScopeId: "orgA",
    version: 1,
    lifecycleStatus: "ACTIVE",
    isActive: true,
    isBuiltin: false,
    requiredTools: ["project_list", "project_get"],
    riskLevel: "low",
    approvalMode: "inherit",
    approvedBy: "admin1",
    ...over,
  };
}

function main() {
  // SYSTEM
  {
    const r = resolveScopedSkill({
      skill: skill({
        ownerScopeType: "SYSTEM",
        isBuiltin: true,
        approvedBy: null,
      }),
      scope: scope({ scopeType: "ORG", scopeId: "orgA", projectId: undefined }),
      callerToolAllowlist: ["project_list", "project_get", "other"],
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.effectiveTools.sort(), ["project_get", "project_list"]);
  }

  // ORG unapproved ACTIVE → deny
  {
    const r = resolveScopedSkill({
      skill: skill({ approvedBy: null }),
      scope: scope({ scopeType: "ORG", scopeId: "orgA", projectId: undefined }),
      callerToolAllowlist: ["project_list"],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "unapproved_org_skill");
  }

  // PROJECT skill cannot cross project
  {
    const r = resolveScopedSkill({
      skill: skill({
        ownerScopeType: "PROJECT",
        ownerScopeId: "projA",
      }),
      scope: scope({ projectId: "projB", scopeId: "projB" }),
      callerToolAllowlist: ["project_list", "project_get"],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "cross_project");
  }

  // PROJECT ok
  {
    const r = resolveScopedSkill({
      skill: skill({
        ownerScopeType: "PROJECT",
        ownerScopeId: "projA",
      }),
      scope: scope(),
      callerToolAllowlist: ["project_list"],
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.effectiveTools, ["project_list"]);
  }

  // USER mismatch
  {
    const r = resolveScopedSkill({
      skill: skill({
        ownerScopeType: "USER",
        ownerScopeId: "userB",
        approvedBy: null,
      }),
      scope: scope(),
      callerToolAllowlist: ["project_list", "project_get"],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "user_scope_mismatch");
  }

  // suspended
  {
    const r = resolveScopedSkill({
      skill: skill({ lifecycleStatus: "SUSPENDED" }),
      scope: scope({ scopeType: "ORG", scopeId: "orgA", projectId: undefined }),
      callerToolAllowlist: ["project_list"],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "suspended");
  }

  // skill tools cannot exceed caller
  {
    const r = resolveScopedSkill({
      skill: skill({ requiredTools: ["project_list", "secret_admin_tool"] }),
      scope: scope({ scopeType: "ORG", scopeId: "orgA", projectId: undefined }),
      callerToolAllowlist: ["project_list"],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.effectiveTools, ["project_list"]);
      assert.ok(!r.effectiveTools.includes("secret_admin_tool"));
    }
  }

  // version mapping
  {
    const mapped = mapAgentSkillRow({
      id: "1",
      slug: "x",
      orgId: "orgA",
      version: 3,
      isActive: true,
      isBuiltin: true,
      requiredTools: "a,b",
      lifecycleStatus: "ACTIVE",
    });
    assert.equal(mapped.version, 3);
    assert.equal(mapped.ownerScopeType, "SYSTEM");
    assert.deepEqual(mapped.requiredTools, ["a", "b"]);
  }

  assert.equal(
    assertUserSkillNotEscalated(
      skill({ ownerScopeType: "USER", ownerScopeId: "userA" }),
    ),
    true,
  );

  console.log("scoped-registry: all passed");
}

main();
