/**
 * Mention Gateway M2-C — Context-specific Tool Policy + Customer Scope Guard（C1）
 * 运行：npx tsx src/lib/mention-gateway/__tests__/m2c-tool-policy.test.ts
 *
 * 覆盖：
 * - C1：scopeGuard.customerId（assertArgsMatchScopeGuard / toScopeGuard / 真实 Registry 执行链）
 * - 策略集合：PROJECT 8 / CUSTOMER 3 / ORG_WIDE 7 互斥；canonical 映射（tender→project, sales→customer）
 * - 网关：customer 上下文与 project 上下文各自的 tools / scopeGuard / domains / maxRisk
 * - 攻击（真实 Registry，无 DB）：跨客户参数、org-wide 工具、跨上下文工具、写工具
 * - 工具加固纯函数 + 源码契约：customerName 不可逃逸、opportunity 不可逃逸、shareToken 不暴露、legacy 不变
 */

import "@/lib/agent-core/tools";
import { readFileSync } from "fs";
import { join } from "path";
import { registry } from "@/lib/agent-core/tool-registry";
import { buildToolContextBase } from "@/lib/agent-core/engine";
import { assertArgsMatchScopeGuard } from "@/lib/agent-core/pre-execute-guard";
import type { ToolExecutionContext } from "@/lib/agent-core/types";
import {
  assertOpportunityWithinCustomerScope,
  customerNameLookupAllowed,
  isCustomerScoped,
  redactQuoteShareTokens,
  resolveEffectiveCustomerId,
} from "@/lib/agent-core/tools/sales-scope";
import { toScopeGuard } from "@/lib/agent-scope/resolve";
import type { AgentScopeContext } from "@/lib/agent-scope/types";
import { handleMentionEvent } from "../handle";
import {
  CUSTOMER_CONTEXT_TOOLS,
  MENTION_CONTEXT_TOOL_POLICY,
  MENTION_GATEWAY_TOOL_UNIVERSE,
  ORG_WIDE_SALES_TOOLS,
  PROJECT_CONTEXT_TOOLS,
  resolveMentionToolPolicy,
  toCanonicalContextType,
} from "../policy";
import {
  CUSTOMER_A,
  ORG_A,
  PROJECT_A,
  TEST_ENV,
  USER_A,
  baseRaw,
  finish,
  makeFakeDeps,
  ok,
} from "./helpers";

const CUSTOMER_B = "customer_b";
const PROJECT_TOOLS: readonly string[] = PROJECT_CONTEXT_TOOLS;
const CUSTOMER_TOOLS: readonly string[] = CUSTOMER_CONTEXT_TOOLS;
const ORG_WIDE: readonly string[] = ORG_WIDE_SALES_TOOLS;

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}
function code(res: { data: unknown }): string | undefined {
  return (res.data as { code?: string } | null)?.code;
}

async function main() {
  const gates = {
    PROJECT_CONTEXT_CANNOT_USE_SALES_TOOLS: true,
    CUSTOMER_CONTEXT_CANNOT_USE_PROJECT_TOOLS: true,
    CUSTOMER_CONTEXT_CANNOT_USE_ORG_WIDE_SALES_TOOLS: true,
    CUSTOMER_ID_CANNOT_BE_OVERRIDDEN: true,
    CUSTOMER_NAME_CANNOT_ESCAPE_BOUND_CUSTOMER: true,
    OPPORTUNITY_CANNOT_ESCAPE_BOUND_CUSTOMER: true,
    CUSTOMER_SCOPED_QUOTES_DO_NOT_EXPOSE_SHARE_TOKEN: true,
    MAX_RISK_STILL_L0: true,
    TOOL_REGISTRY_CHAIN_STILL_USED: true,
  };
  const fail = (k: keyof typeof gates) => {
    gates[k] = false;
  };

  console.log("C1-1 assertArgsMatchScopeGuard：customerId 与 projectId 同语义；legacy 不变");
  {
    const scoped = { orgId: ORG_A, principalUserId: USER_A, customerId: CUSTOMER_A };
    ok(assertArgsMatchScopeGuard({ customerId: CUSTOMER_A }, scoped).ok, "customer same → PASS");
    const diff = assertArgsMatchScopeGuard({ customerId: CUSTOMER_B }, scoped);
    ok(!diff.ok && diff.code === "SCOPE_CUSTOMER_OVERRIDE", "customer different → DENY SCOPE_CUSTOMER_OVERRIDE");
    ok(assertArgsMatchScopeGuard({}, scoped).ok, "args 不带 customerId → PASS（由工具层取权威值）");
    const legacy = { orgId: ORG_A, principalUserId: USER_A, projectId: PROJECT_A };
    ok(assertArgsMatchScopeGuard({ customerId: CUSTOMER_B }, legacy).ok, "no customer scope → legacy behavior unchanged");
    const orgStill = assertArgsMatchScopeGuard({ orgId: "org_b", customerId: CUSTOMER_A }, scoped);
    ok(!orgStill.ok && orgStill.code === "SCOPE_ORG_OVERRIDE", "org 守卫优先且不变");
    const userStill = assertArgsMatchScopeGuard({ userId: "u9", customerId: CUSTOMER_A }, scoped);
    ok(!userStill.ok && userStill.code === "SCOPE_USER_OVERRIDE", "user 守卫不变");
    if (diff.ok) fail("CUSTOMER_ID_CANNOT_BE_OVERRIDDEN");

    const scope: AgentScopeContext = {
      principalUserId: USER_A,
      principalPlatformRole: "sales",
      orgId: ORG_A,
      orgRole: "org_member",
      isPlatformAdmin: false,
      hasMembership: true,
      customerId: CUSTOMER_A,
      channel: "messaging",
      traceId: "t",
    };
    const guard = toScopeGuard(scope);
    ok(guard.customerId === CUSTOMER_A && guard.projectId === undefined && guard.orgId === ORG_A, "toScopeGuard 投影 customerId");
  }

  console.log("C1-2 真实 Registry 执行链：scopeGuard.customerId 在 execute 前 fail-closed");
  {
    registry.register({
      name: "__m2c_customer_scoped__",
      description: "test",
      domain: "sales",
      parameters: { type: "object", properties: { customerId: { type: "string" } }, required: [] },
      risk: "l0_read",
      allowRoles: "*",
      execute: async (ctx) => ({ success: true, data: { seen: ctx.args.customerId ?? null } }),
    });
    const base: Omit<ToolExecutionContext, "args"> = {
      userId: USER_A,
      orgId: ORG_A,
      role: "sales",
      orgRole: "org_member",
      hasMembership: true,
      allowedToolNames: ["__m2c_customer_scoped__"],
      maxRisk: "l0_read",
      scopeGuard: { orgId: ORG_A, principalUserId: USER_A, customerId: CUSTOMER_A },
    };
    const denied = await registry.execute("__m2c_customer_scoped__", { args: { customerId: CUSTOMER_B }, ...base });
    ok(denied.success === false && code(denied) === "SCOPE_CUSTOMER_OVERRIDE", "registry.execute(customer B) → SCOPE_CUSTOMER_OVERRIDE（executor 未执行）");
    const allowed = await registry.execute("__m2c_customer_scoped__", { args: { customerId: CUSTOMER_A }, ...base });
    ok(allowed.success === true, "registry.execute(customer A) → 执行");
    const legacyCtx = { ...base, scopeGuard: { orgId: ORG_A, principalUserId: USER_A } };
    const legacyRes = await registry.execute("__m2c_customer_scoped__", { args: { customerId: CUSTOMER_B }, ...legacyCtx });
    ok(legacyRes.success === true, "legacy（scope 无 customerId）→ 行为不变");
    if (denied.success !== false) fail("CUSTOMER_ID_CANNOT_BE_OVERRIDDEN");
  }

  console.log("P-1 策略集合与 canonical 映射");
  {
    ok(sameSet(PROJECT_TOOLS, [
      "project_get_tender_summary", "project_get_project_documents", "project_get_project_requirements",
      "project_get_project_inquiries", "project_get_project_quotes", "project_search_similar_projects",
      "knowledge_search_project", "org_search_knowledge",
    ]), `PROJECT_CONTEXT_TOOLS = 8`);
    ok(sameSet(CUSTOMER_TOOLS, ["sales_get_customer", "sales_get_customer_quotes", "sales_get_customer_interactions"]), "CUSTOMER_CONTEXT_TOOLS = 3（严格）");
    ok(!CUSTOMER_TOOLS.includes("org_search_knowledge"), "customer 上下文第一版不含 org_search_knowledge");
    ok(ORG_WIDE.length === 7 && ORG_WIDE.every((n) => !PROJECT_TOOLS.includes(n) && !CUSTOMER_TOOLS.includes(n)), "ORG_WIDE_SALES_TOOLS(7) 与任何上下文 allowlist 无交集");
    ok(PROJECT_TOOLS.every((n) => !n.startsWith("sales_")), "project 上下文无任何 sales_* 工具");
    ok(CUSTOMER_TOOLS.every((n) => !n.startsWith("project_") && !n.startsWith("knowledge_")), "customer 上下文无任何 project_/knowledge_ 工具");
    ok(MENTION_GATEWAY_TOOL_UNIVERSE.length === 11, "并集 = 11");
    ok(toCanonicalContextType("project") === "project" && toCanonicalContextType("tender") === "project" && toCanonicalContextType("sales") === "customer", "canonical：tender→project, sales→customer");
    ok(resolveMentionToolPolicy("tender").canonical === "project" && sameSet(resolveMentionToolPolicy("tender").tools, PROJECT_TOOLS), "tender → project policy");
    ok(resolveMentionToolPolicy("sales").canonical === "customer" && sameSet(resolveMentionToolPolicy("sales").tools, CUSTOMER_TOOLS), "sales → customer policy");
    ok(sameSet(MENTION_CONTEXT_TOOL_POLICY.customer.domains, ["sales"]) && sameSet(MENTION_CONTEXT_TOOL_POLICY.project.domains, ["project", "system"]), "domains 按上下文收窄");
    for (const n of [...PROJECT_TOOLS, ...CUSTOMER_TOOLS]) {
      const t = registry.get(n);
      ok(!!t && t.risk === "l0_read", `${n} 已注册且 risk=l0_read`);
    }
  }

  console.log("G-1 网关 customer 上下文（mock-sales-a → Customer A）");
  const { deps, adapter, runOptions } = makeFakeDeps();
  const customerRun = await handleMentionEvent({ raw: baseRaw({ channelId: "mock-sales-a" }), adapter, deps, env: TEST_ENV });
  ok(customerRun.ok && customerRun.context.type === "sales" && customerRun.context.id === CUSTOMER_A, "customer 上下文执行完成");
  const customerOpts = runOptions[0];
  ok(sameSet(customerOpts.tools ?? [], CUSTOMER_TOOLS), "tools = CUSTOMER_CONTEXT_TOOLS（3）");
  ok(customerOpts.scopeGuard?.customerId === CUSTOMER_A && customerOpts.scopeGuard?.projectId === undefined && customerOpts.scopeGuard?.orgId === ORG_A, "scopeGuard.customerId = 绑定客户（无 projectId）");
  ok(sameSet(customerOpts.domains ?? [], ["sales"]), "domains = [sales]");
  ok(customerOpts.maxRisk === "l0_read", "maxRisk = l0_read");
  ok(/销售客户|客户/.test(customerOpts.systemPrompt) && /不提供销售管道/.test(customerOpts.systemPrompt), "系统提示声明客户作用域");
  ok(customerOpts.orgRole === "org_member" && customerOpts.hasMembership === true, "租户字段仍来自 resolveAgentTenant");
  if (customerOpts.maxRisk !== "l0_read") fail("MAX_RISK_STILL_L0");

  console.log("G-2 网关 project 上下文（mock-project-a）");
  const projectRun = await handleMentionEvent({ raw: baseRaw({ eventId: "evt-p", messageId: "msg-p" }), adapter, deps, env: TEST_ENV });
  ok(projectRun.ok, "project 上下文执行完成");
  const projectOpts = runOptions[1];
  ok(sameSet(projectOpts.tools ?? [], PROJECT_TOOLS), "tools = PROJECT_CONTEXT_TOOLS（8）");
  ok(projectOpts.scopeGuard?.projectId === PROJECT_A && projectOpts.scopeGuard?.customerId === undefined, "scopeGuard.projectId = 绑定项目（无 customerId）");
  ok(sameSet(projectOpts.domains ?? [], ["project", "system"]), "domains = [project, system]");
  ok(projectOpts.maxRisk === "l0_read", "maxRisk = l0_read");
  if (projectOpts.maxRisk !== "l0_read") fail("MAX_RISK_STILL_L0");

  console.log("G-3 admin 也不会放宽（org role 高 ≠ allowlist 扩大）");
  {
    const { deps: d2, adapter: a2, runOptions: r2, world } = makeFakeDeps();
    world.users[USER_A].role = "admin";
    world.memberships[USER_A] = [ORG_A];
    const r = await handleMentionEvent({ raw: baseRaw({ channelId: "mock-sales-a" }), adapter: a2, deps: d2, env: TEST_ENV });
    ok(r.ok && sameSet(r2[0].tools ?? [], CUSTOMER_TOOLS), "admin 平台角色下 customer 上下文仍只有 3 个工具");
  }

  console.log("A-1 攻击：customer 上下文（真实 Registry，无 DB）");
  {
    const base = buildToolContextBase(customerOpts);
    const exposed = registry
      .toOpenAITools({ domains: customerOpts.domains, names: customerOpts.tools, role: "admin", orgRole: customerOpts.orgRole, maxRisk: customerOpts.maxRisk })
      .map((t) => t.function.name);
    ok(sameSet(exposed, CUSTOMER_TOOLS), `暴露给模型 = CUSTOMER_CONTEXT_TOOLS（${exposed.length}）`);

    const r1 = await registry.execute("sales_get_customer", { args: { customerId: CUSTOMER_B }, ...base });
    ok(r1.success === false && code(r1) === "SCOPE_CUSTOMER_OVERRIDE", "sales_get_customer(customer B) → SCOPE_CUSTOMER_OVERRIDE");
    if (r1.success !== false) fail("CUSTOMER_ID_CANNOT_BE_OVERRIDDEN");
    const r2 = await registry.execute("sales_get_customer_quotes", { args: { customerId: CUSTOMER_B }, ...base });
    ok(r2.success === false && code(r2) === "SCOPE_CUSTOMER_OVERRIDE", "sales_get_customer_quotes(customerId=B) → SCOPE_CUSTOMER_OVERRIDE");
    const r3 = await registry.execute("sales_get_customer_interactions", { args: { customerId: CUSTOMER_B, opportunityId: "opp_b" }, ...base });
    ok(r3.success === false && code(r3) === "SCOPE_CUSTOMER_OVERRIDE", "sales_get_customer_interactions(customerId=B) → SCOPE_CUSTOMER_OVERRIDE");

    for (const name of ORG_WIDE) {
      const res = await registry.execute(name, { args: {}, ...base });
      ok(res.success === false && code(res) === "TOOL_NOT_ALLOWLISTED", `customer ctx → ${name} → TOOL_NOT_ALLOWLISTED`);
      if (res.success !== false) fail("CUSTOMER_CONTEXT_CANNOT_USE_ORG_WIDE_SALES_TOOLS");
    }
    for (const name of PROJECT_TOOLS) {
      const res = await registry.execute(name, { args: { projectId: PROJECT_A }, ...base });
      ok(res.success === false && code(res) === "TOOL_NOT_ALLOWLISTED", `customer ctx → ${name} → TOOL_NOT_ALLOWLISTED`);
      if (res.success !== false) fail("CUSTOMER_CONTEXT_CANNOT_USE_PROJECT_TOOLS");
    }
    for (const name of ["sales_send_quote_email", "sales_update_followup", "sales_create_quote", "calendar_create_event_draft"]) {
      const res = await registry.execute(name, { args: {}, ...base });
      ok(res.success === false && code(res) === "TOOL_NOT_ALLOWLISTED", `customer ctx → ${name} → TOOL_NOT_ALLOWLISTED`);
    }
    // 篡改 allowlist 放入 org-wide 工具：maxRisk/Registry 仍在，但本测试只验证 allowlist 本身已排除
    const forged = await registry.execute("sales_get_pipeline", { args: {}, ...base, allowedToolNames: [...(base.allowedToolNames ?? []), "sales_get_pipeline"], hasMembership: false });
    ok(forged.success === false && /成员身份/.test(forged.error ?? ""), "即使伪造 allowlist，Registry 链（canInvokeTool）仍在工作");
    if (forged.success !== false) fail("TOOL_REGISTRY_CHAIN_STILL_USED");
  }

  console.log("A-2 攻击：project 上下文（真实 Registry，无 DB）");
  {
    const base = buildToolContextBase(projectOpts);
    const exposed = registry
      .toOpenAITools({ domains: projectOpts.domains, names: projectOpts.tools, role: "admin", orgRole: projectOpts.orgRole, maxRisk: projectOpts.maxRisk })
      .map((t) => t.function.name);
    ok(sameSet(exposed, PROJECT_TOOLS), `暴露给模型 = PROJECT_CONTEXT_TOOLS（${exposed.length}）`);
    for (const name of [...CUSTOMER_TOOLS, ...ORG_WIDE]) {
      const res = await registry.execute(name, { args: { customerId: CUSTOMER_A }, ...base });
      ok(res.success === false && code(res) === "TOOL_NOT_ALLOWLISTED", `project ctx → ${name} → TOOL_NOT_ALLOWLISTED`);
      if (res.success !== false) fail("PROJECT_CONTEXT_CANNOT_USE_SALES_TOOLS");
    }
    const crossProject = await registry.execute("project_get_tender_summary", { args: { projectId: "project_b" }, ...base });
    ok(crossProject.success === false && code(crossProject) === "SCOPE_PROJECT_OVERRIDE", "project ctx → 跨项目参数 → SCOPE_PROJECT_OVERRIDE（既有守卫不变）");
  }

  console.log("H-1 工具加固纯函数：服务端权威客户 / 名称不可逃逸 / 商机不可逃逸 / shareToken");
  {
    const scopedCtx = { orgId: ORG_A, scopeGuard: { orgId: ORG_A, principalUserId: USER_A, customerId: CUSTOMER_A } };
    const legacyCtx = { orgId: ORG_A, scopeGuard: { orgId: ORG_A, principalUserId: USER_A } };
    const noGuardCtx = { orgId: ORG_A, scopeGuard: undefined };
    ok(isCustomerScoped(scopedCtx) && !isCustomerScoped(legacyCtx) && !isCustomerScoped(noGuardCtx), "isCustomerScoped");
    for (const arg of [undefined, "", CUSTOMER_B, CUSTOMER_A, 42]) {
      const eff = resolveEffectiveCustomerId(scopedCtx, arg);
      ok(eff.customerId === CUSTOMER_A && eff.source === "scope", `scoped：args=${JSON.stringify(arg)} → effective = Customer A（scope）`);
      if (eff.customerId !== CUSTOMER_A) fail("CUSTOMER_NAME_CANNOT_ESCAPE_BOUND_CUSTOMER");
    }
    ok(resolveEffectiveCustomerId(legacyCtx, CUSTOMER_B).customerId === CUSTOMER_B, "legacy：采用 args.customerId");
    ok(resolveEffectiveCustomerId(legacyCtx, undefined).customerId === undefined, "legacy：无 args → undefined（走原有 name 搜索或报错）");
    ok(!customerNameLookupAllowed(scopedCtx) && customerNameLookupAllowed(legacyCtx) && customerNameLookupAllowed(noGuardCtx), "customerName 搜索仅 legacy 允许");
    if (customerNameLookupAllowed(scopedCtx)) fail("CUSTOMER_NAME_CANNOT_ESCAPE_BOUND_CUSTOMER");

    const oppOk = assertOpportunityWithinCustomerScope({ orgId: ORG_A, customerId: CUSTOMER_A }, scopedCtx, CUSTOMER_A);
    const oppOtherCustomer = assertOpportunityWithinCustomerScope({ orgId: ORG_A, customerId: CUSTOMER_B }, scopedCtx, CUSTOMER_A);
    const oppOtherOrg = assertOpportunityWithinCustomerScope({ orgId: "org_b", customerId: CUSTOMER_A }, scopedCtx, CUSTOMER_A);
    const oppMissing = assertOpportunityWithinCustomerScope(null, scopedCtx, CUSTOMER_A);
    ok(oppOk.ok, "商机属于同 org + 绑定客户 → ok");
    ok(!oppOtherCustomer.ok && !oppOtherOrg.ok && !oppMissing.ok, "商机属其它客户 / 其它 org / 不存在 → DENY");
    ok(!oppOtherCustomer.ok && !oppMissing.ok && oppOtherCustomer.error === oppMissing.error, "DENY 文案一致（不泄露存在性）");
    if (oppOtherCustomer.ok || oppOtherOrg.ok || oppMissing.ok) fail("OPPORTUNITY_CANNOT_ESCAPE_BOUND_CUSTOMER");

    const quotes = [{ id: "q1", status: "sent", shareToken: "tok-1", grandTotal: 100 }];
    const redacted = redactQuoteShareTokens(quotes, scopedCtx);
    ok(redacted.length === 1 && !("shareToken" in redacted[0]) && (redacted[0] as { id: string }).id === "q1", "scoped：quotes DTO 无 shareToken");
    ok(!JSON.stringify(redacted).includes("tok-1"), "scoped：序列化后不含 token 值");
    const kept = redactQuoteShareTokens(quotes, legacyCtx);
    ok(kept.length === 1 && (kept[0] as { shareToken?: string }).shareToken === "tok-1", "legacy：shareToken 保留（Sales UI/Agent 行为不变）");
    if ("shareToken" in redacted[0]) fail("CUSTOMER_SCOPED_QUOTES_DO_NOT_EXPOSE_SHARE_TOKEN");
  }

  console.log("H-2 源码契约：三个工具确实接入加固函数；legacy 路径保留");
  {
    const root = process.cwd();
    const quote = readFileSync(join(root, "src/lib/agent-core/tools/sales-quote.ts"), "utf8");
    const readonly = readFileSync(join(root, "src/lib/agent-core/tools/enterprise-readonly.ts"), "utf8");
    const customer = readFileSync(join(root, "src/lib/agent-core/tools/sales-customer.ts"), "utf8");
    const guard = readFileSync(join(root, "src/lib/agent-core/pre-execute-guard.ts"), "utf8");
    const resolve = readFileSync(join(root, "src/lib/agent-scope/resolve.ts"), "utf8");
    ok(/resolveEffectiveCustomerId\(ctx, ctx\.args\.customerId\)/.test(quote) && /customerNameLookupAllowed\(ctx\)/.test(quote), "sales_get_customer_quotes：权威 customerId + name 搜索受 scope 门控");
    ok(/redactQuoteShareTokens\(quoteDtos, ctx\)/.test(quote), "sales_get_customer_quotes：shareToken 经 redact");
    ok(/findFirst\(\{\s*where: \{ name: \{ contains: customerName/.test(quote), "legacy name 搜索路径仍存在（兼容）");
    ok(/assertOpportunityWithinCustomerScope\(opportunity, ctx, customerId\)/.test(readonly) && /isCustomerScoped\(ctx\)/.test(readonly), "sales_get_customer_interactions：scoped 下校验 opportunity 归属");
    ok(/resolveEffectiveCustomerId\(ctx, ctx\.args\.customerId\)/.test(readonly), "sales_get_customer_interactions：权威 customerId");
    ok(/resolveEffectiveCustomerId\(ctx, ctx\.args\.customerId\)/.test(customer), "sales_get_customer：权威 customerId");
    ok(/SCOPE_CUSTOMER_OVERRIDE/.test(guard) && /scopeGuard\.customerId/.test(guard), "pre-execute-guard：SCOPE_CUSTOMER_OVERRIDE");
    ok(/customerId: scope\.customerId/.test(resolve), "toScopeGuard：投影 customerId");
    const handle = readFileSync(join(root, "src/lib/mention-gateway/handle.ts"), "utf8");
    ok(/import\("@\/lib\/agent-core"\)/.test(handle) && /runAgent\(/.test(handle), "handle.ts 仍经 agent-core runAgent → ToolRegistry");
  }

  console.log("");
  for (const [k, v] of Object.entries(gates)) console.log(`${k} = ${v ? "PASS" : "FAIL"}`);
  if (Object.values(gates).some((v) => !v)) {
    console.error("  ✗ M2-C 安全断言未全部通过");
    process.exit(1);
  }
  finish("M2-C Context Tool Policy + Customer Scope Guard");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
