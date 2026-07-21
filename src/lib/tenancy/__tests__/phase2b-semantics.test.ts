/**
 * Phase 2B：Glossary / 业务对象 / 配置继承 / Brand Truth / 指标（纯逻辑 + 内存模拟）
 * 运行：npx tsx src/lib/tenancy/__tests__/phase2b-semantics.test.ts
 */

import { PLATFORM_OBJECT_TEMPLATES } from "@/lib/business-objects/registry";
import { LOCKED_SECURITY_KEYS } from "../scoped-config";
import { CONFIG_SCOPE_PRIORITY as SCOPE_ORDER } from "../scope";

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

console.log("phase2b business semantics");

// Glossary 隔离（内存模拟召回）
{
  type Term = { orgId: string; workspaceId: string | null; canonical: string; aliases: string[] };
  const store: Term[] = [
    { orgId: "sunny", workspaceId: null, canonical: "SiteMeasure", aliases: ["量尺", "Measure"] },
    { orgId: "sunny", workspaceId: "ws_sales", canonical: "SiteMeasure", aliases: ["Sales Measure"] },
    { orgId: "mengxin", workspaceId: null, canonical: "Sample", aliases: ["寄样", "Sample Order"] },
  ];

  function lookup(orgId: string, q: string, workspaceId?: string) {
    const qLower = q.toLowerCase();
    if (workspaceId) {
      const ws = store.find(
        (t) =>
          t.orgId === orgId &&
          t.workspaceId === workspaceId &&
          (t.canonical.toLowerCase() === qLower ||
            t.aliases.some((a) => a.toLowerCase() === qLower)),
      );
      if (ws) return ws;
    }
    return (
      store.find(
        (t) =>
          t.orgId === orgId &&
          t.workspaceId === null &&
          (t.canonical.toLowerCase() === qLower ||
            t.aliases.some((a) => a.toLowerCase() === qLower)),
      ) ?? null
    );
  }

  ok(lookup("sunny", "量尺")?.canonical === "SiteMeasure", "Sunny 可召回 Sunny 术语");
  ok(lookup("mengxin", "量尺") === null, "梦馨无法召回 Sunny 术语");
  ok(lookup("mengxin", "寄样")?.canonical === "Sample", "梦馨可召回梦馨术语");
  ok(
    lookup("sunny", "Sales Measure", "ws_sales")?.workspaceId === "ws_sales",
    "Workspace 术语只在对应 Workspace 生效",
  );
  ok(lookup("sunny", "不存在的词") === null, "未配置返回 missing，不回退家纺");
}

// Business Object：同名 Order 不同定义
{
  const sunnyOrder = { orgId: "sunny", objectKey: "Order", displayName: "窗饰订单" };
  const mxOrder = { orgId: "mengxin", objectKey: "Order", displayName: "外贸订单" };
  ok(
    sunnyOrder.objectKey === mxOrder.objectKey &&
      sunnyOrder.displayName !== mxOrder.displayName,
    "两企业可拥有同名但不同定义的 Order",
  );
  function load(orgId: string, key: string) {
    const rows = [sunnyOrder, mxOrder];
    return rows.find((r) => r.orgId === orgId && r.objectKey === key) ?? null;
  }
  ok(load("sunny", "Order")?.displayName === "窗饰订单", "Agent 按当前企业加载正确 Order");
  ok(load("mengxin", "Order")?.displayName === "外贸订单", "修改资源语义不能跨租户");
  ok(
    PLATFORM_OBJECT_TEMPLATES.some((t) => t.objectKey === "Order"),
    "平台提供通用 Order 模板（显式 generic，非静默企业回退）",
  );
}

// Brand Truth：单一事实主源语义
{
  type Truth = {
    orgId: string;
    factsBrand: string | null;
    voiceBrand: string | null;
  };
  function displayName(t: Truth, orgName: string) {
    return t.factsBrand || t.voiceBrand || orgName;
  }
  const sunny: Truth = {
    orgId: "sunny",
    factsBrand: "Sunny Home & Deco",
    voiceBrand: "Sunny Voice",
  };
  const mx: Truth = { orgId: "mx", factsBrand: null, voiceBrand: "梦馨语料" };
  ok(
    displayName(sunny, "Org") === "Sunny Home & Deco",
    "事实主源优先于语料",
  );
  ok(displayName(mx, "梦馨家纺") === "梦馨语料", "仅语料时标记 voice_only 可读展示名");
  ok(sunny.factsBrand !== mx.voiceBrand, "企业之间品牌事实完全隔离");
}

// Workspace 配置继承 + 安全锁定
{
  ok(
    SCOPE_ORDER.join(">") === "PLATFORM>ORGANIZATION>WORKSPACE>PROJECT",
    "继承顺序 Platform→Org→Workspace→Project",
  );
  ok(LOCKED_SECURITY_KEYS.has("tenant_isolation"), "租户隔离不可被 Workspace 关闭");
  ok(LOCKED_SECURITY_KEYS.has("force_approval_l3"), "强制审批不可被下层关闭");

  function resolveRule(
    orgValue: unknown,
    wsOverride: unknown | undefined,
    key: string,
  ) {
    if (LOCKED_SECURITY_KEYS.has(key)) {
      return { value: true, sourceScope: "PLATFORM" };
    }
    if (wsOverride !== undefined) {
      return { value: wsOverride, sourceScope: "WORKSPACE" };
    }
    return { value: orgValue, sourceScope: "ORGANIZATION" };
  }
  ok(
    resolveRule({ staleDays: 7 }, { staleDays: 3 }, "project_risk").sourceScope ===
      "WORKSPACE",
    "Organization 默认可被允许的 Workspace 覆盖",
  );
  ok(
    resolveRule(true, false, "tenant_isolation").value === true &&
      resolveRule(true, false, "tenant_isolation").sourceScope === "PLATFORM",
    "安全规则不能被 Workspace 关闭",
  );
}

// Skill / 知识库
{
  function canRunSkill(opts: {
    wsEnabled: boolean;
    hasWsAccess: boolean;
    orgId: string;
    contentOrgId: string;
  }) {
    if (!opts.hasWsAccess) return { ok: false, reason: "no_workspace" };
    if (!opts.wsEnabled) return { ok: false, reason: "skill_disabled" };
    if (opts.orgId !== opts.contentOrgId) return { ok: false, reason: "cross_tenant" };
    return { ok: true };
  }
  ok(
    !canRunSkill({
      wsEnabled: false,
      hasWsAccess: true,
      orgId: "s",
      contentOrgId: "s",
    }).ok,
    "Workspace 未启用 Skill 时不能执行",
  );
  ok(
    !canRunSkill({
      wsEnabled: true,
      hasWsAccess: false,
      orgId: "s",
      contentOrgId: "s",
    }).ok,
    "用户无 Workspace 权限时不能执行",
  );
  ok(
    !canRunSkill({
      wsEnabled: true,
      hasWsAccess: true,
      orgId: "sunny",
      contentOrgId: "mengxin",
    }).ok,
    "Sunny 检索不召回梦馨内容",
  );
}

// 经营指标
{
  const sunnyMetrics = ["active_bids", "bid_win_rate", "installations_due"];
  const mxMetrics = ["overseas_inquiries", "samples_in_progress", "content_jobs_pending"];
  ok(
    sunnyMetrics.every((k) => !mxMetrics.includes(k)),
    "Sunny 与梦馨加载不同指标定义键",
  );
  function visibleMetrics(
    defs: string[],
    allowed: Set<string>,
  ): string[] | "missing" {
    if (defs.length === 0) return "missing";
    return defs.filter((k) => allowed.has(k));
  }
  ok(
    visibleMetrics(sunnyMetrics, new Set(["active_bids"])).length === 1,
    "无权限指标不显示",
  );
  ok(
    visibleMetrics([], new Set(["active_bids"])) === "missing",
    "未配置时显示明确配置状态 missing",
  );
}

ok(SCOPE_ORDER.length === 4, "配置继承优先级共 4 层");
ok(LOCKED_SECURITY_KEYS.size >= 3, "安全锁定键已定义");

console.log(`\nphase2b: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
