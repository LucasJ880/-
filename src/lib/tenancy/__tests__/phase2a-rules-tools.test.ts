/**
 * Phase 2A：跨租户规则隔离、Industry Pack、canInvokeTool
 * 运行：npx tsx src/lib/tenancy/__tests__/phase2a-rules-tools.test.ts
 */

import { canInvokeTool } from "../tool-auth";
import {
  resolveIndustryPack,
  listIndustryPacks,
} from "@/lib/industry-packs/registry";
import { getIndustryPack } from "@/lib/product-content/industry-packs/home-textile";
import {
  PLATFORM_DEFAULT_QUOTE_MARGIN,
  PLATFORM_DEFAULT_QUOTE_AUTO_SEND,
} from "@/lib/org-rules/types";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("phase2a rules / packs / tool-auth");

// ── Industry Pack：禁止静默家纺回退 ──
{
  const missing = resolveIndustryPack(null);
  ok(missing.status === "missing" && missing.pack === null, "未配置 Pack → missing，不回退家纺");

  const genericMissing = resolveIndustryPack(null, { fallbackGenericOnMissing: true });
  ok(
    genericMissing.status === "missing" &&
      genericMissing.pack?.id === "generic_business_v1",
    "显式 fallbackGeneric 才用通用包",
  );

  const invalid = resolveIndustryPack("sunny_secret_pack");
  ok(invalid.status === "invalid" && invalid.pack === null, "未知 Pack → invalid，不回退");

  const sunny = resolveIndustryPack("window_covering_services_v1");
  ok(sunny.status === "ok" && sunny.pack.id === "window_covering_services_v1", "Sunny Pack 可解析");

  const mx = resolveIndustryPack("home_textile_trade_v1");
  ok(mx.status === "ok" && mx.pack.id === "home_textile_trade_v1", "梦馨 Pack 可解析");

  ok(
    sunny.status === "ok" &&
      mx.status === "ok" &&
      sunny.pack.businessVocabulary.customer !== mx.pack.businessVocabulary.customer,
    "Sunny 与梦馨词汇不同（术语不串）",
  );

  ok(listIndustryPacks().length === 3, "Registry 一期仅 3 个正式 Pack");

  let threw = false;
  try {
    getIndustryPack("window_covering_services_v1");
  } catch {
    threw = true;
  }
  ok(threw, "产品内容 getIndustryPack 不接受窗饰 Pack 时不静默回退家纺");

  ok(getIndustryPack("home_textile").id === "home_textile", "显式 home_textile 可用");
  ok(getIndustryPack("home_textile_trade_v1").id === "home_textile", "家纺外贸映射字段包");
}

// ── 平台默认不是「另一家企业」 ──
{
  ok(PLATFORM_DEFAULT_QUOTE_MARGIN.urgentBelowPct === 5, "毛利默认存在且为平台通用");
  ok(
    PLATFORM_DEFAULT_QUOTE_AUTO_SEND.allowDirectSend === false,
    "自动发送默认禁止直发",
  );
}

// ── canInvokeTool ──
{
  const salesTool = {
    name: "sales_get_pipeline",
    domain: "sales" as const,
    risk: "l0_read" as const,
    allowRoles: ["admin", "sales"] as const,
  };
  const sendTool = {
    name: "sales_send_quote_email",
    domain: "sales" as const,
    risk: "l3_strong" as const,
    allowRoles: ["admin", "sales"] as const,
  };
  const adminTool = {
    name: "cockpit_get_metrics",
    domain: "cockpit" as const,
    risk: "l0_read" as const,
    allowRoles: ["admin"] as const,
  };

  const noMember = canInvokeTool({
    tenant: {
      userId: "u1",
      orgId: "org_sunny",
      orgRole: "org_admin",
      isPlatformAdmin: true,
    },
    hasMembership: false,
    tool: salesTool,
    modulesJson: { enabled: ["sales"] },
  });
  ok(!noMember.ok && noMember.code === "no_membership", "平台管理员无 membership 拒企业工具");

  const memberOk = canInvokeTool({
    tenant: {
      userId: "u1",
      orgId: "org_sunny",
      orgRole: "org_member",
      isPlatformAdmin: false,
    },
    hasMembership: true,
    tool: salesTool,
    modulesJson: { enabled: ["sales"] },
  });
  ok(memberOk.ok === true, "org_member 可调 sales 只读工具");

  const viewerWrite = canInvokeTool({
    tenant: {
      userId: "u1",
      orgId: "org_sunny",
      orgRole: "org_viewer",
      isPlatformAdmin: false,
    },
    hasMembership: true,
    tool: sendTool,
    modulesJson: { enabled: ["sales"] },
  });
  ok(!viewerWrite.ok && viewerWrite.code === "viewer_write_denied", "viewer 不可写");

  const memberAdminOnly = canInvokeTool({
    tenant: {
      userId: "u1",
      orgId: "org_sunny",
      orgRole: "org_member",
      isPlatformAdmin: false,
    },
    hasMembership: true,
    tool: adminTool,
    modulesJson: { enabled: ["operations", "sales"] },
  });
  ok(!memberAdminOnly.ok && memberAdminOnly.code === "org_role_denied", "org_member 不可调 admin 标签工具");

  const orgAdminOk = canInvokeTool({
    tenant: {
      userId: "u1",
      orgId: "org_sunny",
      orgRole: "org_admin",
      isPlatformAdmin: false,
    },
    hasMembership: true,
    tool: adminTool,
    modulesJson: { enabled: ["operations"] },
  });
  ok(orgAdminOk.ok === true, "org_admin 可调 admin 标签工具");

  const moduleOff = canInvokeTool({
    tenant: {
      userId: "u1",
      orgId: "org_mx",
      orgRole: "org_member",
      isPlatformAdmin: false,
    },
    hasMembership: true,
    tool: salesTool,
    modulesJson: { enabled: ["trade"] },
  });
  ok(!moduleOff.ok && moduleOff.code === "module_disabled", "未启用 sales 模块拒 sales 工具");

  const dualRoleSunny = canInvokeTool({
    tenant: {
      userId: "same_user",
      orgId: "org_sunny",
      orgRole: "org_admin",
      isPlatformAdmin: false,
    },
    hasMembership: true,
    tool: adminTool,
    modulesJson: { enabled: ["operations"] },
  });
  const dualRoleMx = canInvokeTool({
    tenant: {
      userId: "same_user",
      orgId: "org_mx",
      orgRole: "org_viewer",
      isPlatformAdmin: false,
    },
    hasMembership: true,
    tool: adminTool,
    modulesJson: { enabled: ["operations"] },
  });
  ok(
    dualRoleSunny.ok === true && !dualRoleMx.ok,
    "同一用户两企业不同 orgRole → 权限不同",
  );

  const l3 = canInvokeTool({
    tenant: {
      userId: "u1",
      orgId: "org_sunny",
      orgRole: "org_member",
      isPlatformAdmin: false,
    },
    hasMembership: true,
    tool: sendTool,
    modulesJson: { enabled: ["sales"] },
    maxRisk: "l2_soft",
  });
  ok(!l3.ok && l3.code === "risk_too_high", "会话 maxRisk=l2 挡住 l3 直发");

  const l3NeedsApproval = canInvokeTool({
    tenant: {
      userId: "u1",
      orgId: "org_sunny",
      orgRole: "org_member",
      isPlatformAdmin: false,
    },
    hasMembership: true,
    tool: sendTool,
    modulesJson: { enabled: ["sales"] },
  });
  ok(
    l3NeedsApproval.ok === true && l3NeedsApproval.needsApproval === true,
    "l3 工具标记 needsApproval",
  );
}

// ── 折扣隔离（纯逻辑：模拟两 org 配置表） ──
{
  type Row = { orgId: string; zebra: number };
  const store: Row[] = [
    { orgId: "sunny", zebra: 0.5 },
    { orgId: "mengxin", zebra: 0.2 },
  ];
  function getZebra(orgId: string) {
    return store.find((r) => r.orgId === orgId)?.zebra ?? null;
  }
  function setZebra(orgId: string, zebra: number) {
    const row = store.find((r) => r.orgId === orgId);
    if (row) row.zebra = zebra;
  }
  setZebra("sunny", 0.55);
  ok(getZebra("sunny") === 0.55, "Sunny 折扣可改");
  ok(getZebra("mengxin") === 0.2, "Sunny 改折扣不影响梦馨");
}

console.log(`\nphase2a: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
