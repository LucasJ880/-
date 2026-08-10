/**
 * Workforce Read API — org 访问解析契约测试（Final Review FIX A：A1–A6）
 *
 * activeOrgId 只是偏好不是授权：必须经 canUseOrg 现查重授权；
 * stale/revoked/archived 偏好不得使用；多可用 org 不得随机代选。
 *
 * 纯内存 fake deps，零 DB。
 * 运行：npx tsx src/lib/workforce-runtime/read-model/__tests__/api-access.test.ts
 */

import { resolveWorkforceApiOrg } from "../api-access";
import type { WorkforceApiOrgDeps } from "../api-access";
import { getWorkforceJobView } from "../service";
import type { WorkforceReadModelReader } from "../service";
import { makePlan, makeRun } from "./fixtures";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

function section(name: string): void {
  console.log(`\n━━ ${name}`);
}

/**
 * fake deps：orgs 表带 archived 标记；memberships 表带 status。
 * canUseOrg 语义与生产 canUserUseOrg 一致：org 存在且未归档 +
 * （super_admin 直通 / membership active）。记录全部 canUseOrg 调用。
 */
function makeDeps(config: {
  activeOrgId: string | null;
  orgs: Record<string, { archived?: boolean }>;
  memberships: Array<{ orgId: string; status: string }>;
}): { deps: WorkforceApiOrgDeps; canUseOrgCalls: string[] } {
  const canUseOrgCalls: string[] = [];
  const deps: WorkforceApiOrgDeps = {
    getActiveOrgId: async () => config.activeOrgId,
    canUseOrg: async (_userId, userRole, orgId) => {
      canUseOrgCalls.push(orgId);
      const org = config.orgs[orgId];
      if (!org || org.archived === true) return false;
      if (userRole === "super_admin") return true;
      return config.memberships.some(
        (m) => m.orgId === orgId && m.status === "active",
      );
    },
    listActiveMembershipOrgIds: async () =>
      config.memberships.filter((m) => m.status === "active").map((m) => m.orgId),
  };
  return { deps, canUseOrgCalls };
}

/** spy Reader：记录查询用到的 orgId（证明 stale org 从未被执行） */
function makeSpyReader(): { reader: WorkforceReadModelReader; queriedOrgIds: string[] } {
  const queriedOrgIds: string[] = [];
  const runA = makeRun({
    id: "run_org_a_job",
    orgId: "org_a",
    status: "executing",
    planJson: makePlan(["s1"]),
  });
  const reader: WorkforceReadModelReader = {
    agentRun: {
      findFirst: async (args) => {
        queriedOrgIds.push(args.where.orgId);
        const { id, orgId, runType } = args.where;
        return runA.id === id && runA.orgId === orgId && runA.runType === runType
          ? runA
          : null;
      },
    },
    agentRunStep: {
      findMany: async (args) => {
        queriedOrgIds.push(args.where.orgId);
        return [];
      },
    },
    agentRunEvent: {
      findMany: async (args) => {
        queriedOrgIds.push(args.where.orgId);
        return [];
      },
    },
    pendingAction: {
      findMany: async (args) => {
        queriedOrgIds.push(args.where.orgId);
        return [];
      },
    },
  };
  return { reader, queriedOrgIds };
}

const user = { userId: "user_1", userRole: "sales" };

async function main() {
  /* ================================================================ */
  section("A1 valid activeOrg → PASS");
  {
    const { deps, canUseOrgCalls } = makeDeps({
      activeOrgId: "org_a",
      orgs: { org_a: {} },
      memberships: [{ orgId: "org_a", status: "active" }],
    });
    const r = await resolveWorkforceApiOrg(user, deps);
    ok(r.ok && r.orgId === "org_a", "偏好 org 现查通过 → 使用", r);
    ok(canUseOrgCalls.includes("org_a"), "canUseOrg 确实被现查（非直接信任）");
  }

  /* ================================================================ */
  section("A2 stale activeOrgId + membership revoked → BLOCK");
  {
    const { deps } = makeDeps({
      activeOrgId: "org_old",
      orgs: { org_old: {} },
      memberships: [{ orgId: "org_old", status: "revoked" }],
    });
    const r = await resolveWorkforceApiOrg(user, deps);
    ok(!r.ok && r.reason === "NO_ORG", "membership revoked → 拒绝", r);

    // getWorkforceJobView 不得以旧 orgId 执行（路由逻辑镜像：解析失败即不查询）
    const { reader, queriedOrgIds } = makeSpyReader();
    if (r.ok) {
      await getWorkforceJobView({ orgId: r.orgId, jobId: "run_org_a_job" }, reader);
    }
    ok(queriedOrgIds.length === 0, "解析失败 → 零查询（旧 orgId 从未被执行）", queriedOrgIds);

    // A2b：stale 偏好 + 另一个有效 org → 使用有效 org，旧 org 绝不返回
    const { deps: deps2 } = makeDeps({
      activeOrgId: "org_old",
      orgs: { org_old: { archived: true }, org_new: {} },
      memberships: [
        { orgId: "org_old", status: "active" },
        { orgId: "org_new", status: "active" },
      ],
    });
    const r2 = await resolveWorkforceApiOrg(user, deps2);
    ok(
      r2.ok && r2.orgId === "org_new",
      "stale 偏好被弃用 → fallback 到唯一可用 org（绝不返回旧 org）",
      r2,
    );
  }

  /* ================================================================ */
  section("A3 activeOrg archived → BLOCK");
  {
    const { deps } = makeDeps({
      activeOrgId: "org_arch",
      orgs: { org_arch: { archived: true } },
      memberships: [{ orgId: "org_arch", status: "active" }],
    });
    const r = await resolveWorkforceApiOrg(user, deps);
    ok(!r.ok && r.reason === "NO_ORG", "archived org → 拒绝（偏好与 fallback 双拦）", r);

    // super_admin 同规则：archived 一样拦（canUseOrg 统一判定）
    const rAdmin = await resolveWorkforceApiOrg(
      { userId: "admin_1", userRole: "super_admin" },
      deps,
    );
    ok(!rAdmin.ok, "super_admin 的 archived 偏好同样被 canUseOrg 拦截", rAdmin);
  }

  /* ================================================================ */
  section("A4 no activeOrg + exactly one active membership → PASS");
  {
    const { deps } = makeDeps({
      activeOrgId: null,
      orgs: { org_only: {} },
      memberships: [{ orgId: "org_only", status: "active" }],
    });
    const r = await resolveWorkforceApiOrg(user, deps);
    ok(r.ok && r.orgId === "org_only", "唯一可用 org → fallback 使用", r);
  }

  /* ================================================================ */
  section("A5 no activeOrg + multiple memberships → 不得随机选择");
  {
    const { deps } = makeDeps({
      activeOrgId: null,
      orgs: { org_1: {}, org_2: {}, org_3: {} },
      memberships: [
        { orgId: "org_1", status: "active" },
        { orgId: "org_2", status: "active" },
        { orgId: "org_3", status: "active" },
      ],
    });
    const r = await resolveWorkforceApiOrg(user, deps);
    ok(
      !r.ok && r.reason === "ORG_SELECTION_REQUIRED",
      "多可用 org → ORG_SELECTION_REQUIRED（绝不 findFirst 代选）",
      r,
    );

    // 多 membership 但仅一个可用（其余 archived）→ 不歧义，正常 fallback
    const { deps: deps2 } = makeDeps({
      activeOrgId: null,
      orgs: { org_1: { archived: true }, org_2: {} },
      memberships: [
        { orgId: "org_1", status: "active" },
        { orgId: "org_2", status: "active" },
      ],
    });
    const r2 = await resolveWorkforceApiOrg(user, deps2);
    ok(r2.ok && r2.orgId === "org_2", "多候选但唯一可用 → 使用之（非歧义）", r2);
  }

  /* ================================================================ */
  section("A6 cross-org job ID → NOT_FOUND");
  {
    const { deps } = makeDeps({
      activeOrgId: "org_b",
      orgs: { org_b: {} },
      memberships: [{ orgId: "org_b", status: "active" }],
    });
    const r = await resolveWorkforceApiOrg(user, deps);
    ok(r.ok && r.orgId === "org_b", "org_b 用户解析到 org_b");
    if (r.ok) {
      const { reader, queriedOrgIds } = makeSpyReader(); // 数据属 org_a
      const result = await getWorkforceJobView(
        { orgId: r.orgId, jobId: "run_org_a_job" },
        reader,
      );
      ok(
        !result.ok && result.error === "NOT_FOUND",
        "org_b 解析结果读 org_a Job → NOT_FOUND",
        result,
      );
      ok(
        queriedOrgIds.every((o) => o === "org_b"),
        "全部查询仍以解析出的 org_b 作用域（未泄漏 org_a）",
        queriedOrgIds,
      );
    }
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("测试执行异常", error);
  process.exit(1);
});
