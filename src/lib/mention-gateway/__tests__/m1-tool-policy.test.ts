/**
 * Mention Gateway M1 — 工具 allowlist 与真实 Registry 的一致性（无 DB）
 * 运行：npx tsx src/lib/mention-gateway/__tests__/m1-tool-policy.test.ts
 *
 * 证明：
 * - allowlist 内每个工具都已注册且 risk === l0_read
 * - allowlist 不含任何禁止语义（send / create / update / delete / approve / …）
 * - 被显式排除的 l0 工具不在 allowlist
 * - 以网关 options 暴露给模型的工具 ⊆ allowlist 且全部 l0
 * - Registry 对 l2 / l3 以 maxRisk=l0_read fail-closed；对未 allowlist 工具 fail-closed
 */

import "@/lib/agent-core/tools";
import { registry } from "@/lib/agent-core/tool-registry";
import { buildToolContextBase } from "@/lib/agent-core/engine";
import type { AgentScopeContext } from "@/lib/agent-scope/types";
import {
  CUSTOMER_CONTEXT_TOOLS,
  MENTION_GATEWAY_FORBIDDEN_TOOL_NAME_PATTERN,
  MENTION_GATEWAY_M1_BLOCKED_L0_TOOLS,
  MENTION_GATEWAY_M1_DOMAINS,
  MENTION_GATEWAY_TOOL_UNIVERSE,
  PROJECT_CONTEXT_TOOLS,
  buildMentionRunOptions,
} from "../policy";
import { CUSTOMER_A, ORG_A, PROJECT_A, USER_A, fakeTenant, finish, ok } from "./helpers";

// M2-C：各上下文 allowlist 的并集（Registry 一致性用）；单次运行只暴露所属上下文的子集
const ALLOWLIST: readonly string[] = MENTION_GATEWAY_TOOL_UNIVERSE;

async function main() {
  console.log("TP-1 allowlist 全部已注册且 risk=l0_read");
  {
    for (const name of ALLOWLIST) {
      const tool = registry.get(name);
      ok(!!tool, `${name} 已注册`);
      ok((tool?.risk ?? "l0_read") === "l0_read" && tool?.risk !== undefined, `${name} risk=l0_read（显式声明）`);
      ok(!!tool && (MENTION_GATEWAY_M1_DOMAINS as readonly string[]).includes(tool.domain), `${name} domain ∈ M1 domains（${tool?.domain}）`);
    }
    const listed = registry.list({ names: [...ALLOWLIST], maxRisk: "l0_read", role: "admin" });
    ok(listed.length === ALLOWLIST.length, `registry.list(allowlist, l0) = ${listed.length}/${ALLOWLIST.length}`);
  }

  console.log("TP-2 allowlist 不含禁止语义；与显式排除集无交集");
  {
    for (const name of ALLOWLIST) {
      ok(!MENTION_GATEWAY_FORBIDDEN_TOOL_NAME_PATTERN.test(name), `${name} 无禁止动词`);
      ok(!(name in MENTION_GATEWAY_M1_BLOCKED_L0_TOOLS), `${name} 不在 BLOCKED 列表`);
    }
    ok(new Set(ALLOWLIST).size === ALLOWLIST.length, "allowlist 无重复");
  }

  console.log("TP-3 被排除的 l0 工具确实存在于 Registry（排除是有意为之，不是笔误）");
  {
    for (const name of Object.keys(MENTION_GATEWAY_M1_BLOCKED_L0_TOOLS)) {
      const tool = registry.get(name);
      ok(!!tool, `${name} 存在于 Registry 且被 M1 排除`);
    }
  }

  console.log("TP-4 Registry 全量盘点：除 allowlist 外的所有工具对网关不可见");
  {
    const all = registry.list();
    const nonL0 = all.filter((t) => (t.risk ?? "l0_read") !== "l0_read").map((t) => t.name);
    ok(nonL0.length > 0 && nonL0.every((n) => !ALLOWLIST.includes(n)), `非 l0 工具 ${nonL0.length} 个全部不在 allowlist`);
    const scope: AgentScopeContext = {
      principalUserId: USER_A,
      principalPlatformRole: "admin",
      orgId: ORG_A,
      orgRole: "org_member",
      isPlatformAdmin: true,
      hasMembership: true,
      projectId: PROJECT_A,
      projectRole: "owner",
      channel: "messaging",
      traceId: "t",
    };
    const opts = buildMentionRunOptions({
      event: {
        provider: "mock", eventId: "e", channel: { id: "c", type: "dm" }, messageId: "m",
        externalUserId: "x", text: "hi", mentionedAgent: true, timestamp: "2026-08-22T00:00:00Z",
      },
      user: { id: USER_A, role: "admin", name: "A" },
      tenant: fakeTenant(ORG_A),
      scope,
      contextType: "project",
      contextId: PROJECT_A,
      contextBlock: "",
      sessionId: "s",
      runId: "r",
    });
    const exposed = registry.toOpenAITools({
      domains: opts.domains,
      names: opts.tools,
      role: "admin",
      orgRole: opts.orgRole,
      maxRisk: opts.maxRisk,
    });
    const exposedNames = exposed.map((t) => t.function.name);
    ok(
      exposedNames.length === PROJECT_CONTEXT_TOOLS.length &&
        exposedNames.every((n) => (PROJECT_CONTEXT_TOOLS as readonly string[]).includes(n)),
      `project 上下文 admin 视角暴露 = PROJECT_CONTEXT_TOOLS（${exposedNames.length}）`,
    );
    const customerOpts = buildMentionRunOptions({
      event: {
        provider: "mock", eventId: "e", channel: { id: "c", type: "dm" }, messageId: "m",
        externalUserId: "x", text: "hi", mentionedAgent: true, timestamp: "2026-08-22T00:00:00Z",
      },
      user: { id: USER_A, role: "admin", name: "A" },
      tenant: fakeTenant(ORG_A),
      scope: { ...scope, projectId: undefined, projectRole: undefined, customerId: CUSTOMER_A },
      contextType: "sales",
      contextId: CUSTOMER_A,
      contextBlock: "",
      sessionId: "s",
      runId: "r",
    });
    const customerExposed = registry
      .toOpenAITools({ domains: customerOpts.domains, names: customerOpts.tools, role: "admin", orgRole: customerOpts.orgRole, maxRisk: customerOpts.maxRisk })
      .map((t) => t.function.name);
    ok(
      customerExposed.length === CUSTOMER_CONTEXT_TOOLS.length &&
        customerExposed.every((n) => (CUSTOMER_CONTEXT_TOOLS as readonly string[]).includes(n)),
      `customer 上下文 admin 视角暴露 = CUSTOMER_CONTEXT_TOOLS（${customerExposed.length}）`,
    );
    const salesView = registry.toOpenAITools({ domains: opts.domains, names: opts.tools, role: "sales", maxRisk: opts.maxRisk }).map((t) => t.function.name);
    ok(salesView.every((n) => ALLOWLIST.includes(n)), `sales 视角暴露 ⊆ allowlist（${salesView.length}）`);
    const userView = registry.toOpenAITools({ domains: opts.domains, names: opts.tools, role: "user", maxRisk: opts.maxRisk }).map((t) => t.function.name);
    ok(userView.every((n) => ALLOWLIST.includes(n)), `user 视角暴露 ⊆ allowlist（${userView.length}）`);
    ok(registry.toOpenAITools({ names: [], maxRisk: "l0_read" }).length === 0, "names=[] → 零工具（fail-closed 语义保持）");

    console.log("TP-5 Registry 执行层：未 allowlist / 超 maxRisk / 无 membership 全部 fail-closed");
    const base = buildToolContextBase(opts);
    const escalations = [
      "sales_send_quote_email",
      "secretary_execute_action",
      "sales_create_quote",
      "sales_update_followup",
      "calendar_create_event_draft",
      "project_bid_quote",
      "skill_run",
      "secretary_get_briefing",
      "context_index_messages",
    ];
    for (const name of escalations) {
      const res = await registry.execute(name, { args: {}, ...base });
      ok(res.success === false && (res.data as { code?: string } | null)?.code === "TOOL_NOT_ALLOWLISTED", `${name} → TOOL_NOT_ALLOWLISTED`);
    }
    registry.register({
      name: "__mention_test_l2__",
      description: "test",
      domain: "project",
      parameters: { type: "object", properties: {}, required: [] },
      risk: "l2_soft",
      allowRoles: "*",
      execute: async () => ({ success: true, data: { executed: true } }),
    });
    const widened = await registry.execute("__mention_test_l2__", {
      args: {},
      ...base,
      allowedToolNames: [...(base.allowedToolNames ?? []), "__mention_test_l2__"],
    });
    ok(widened.success === false && /风险|上限/.test(widened.error ?? ""), "allowlist 被放宽到 l2 工具 → maxRisk=l0 仍拒绝（risk_too_high），executor 未执行");
    const noMembership = await registry.execute("project_get_tender_summary", {
      args: { projectId: PROJECT_A },
      ...base,
      hasMembership: false,
    });
    ok(noMembership.success === false && /成员身份/.test(noMembership.error ?? ""), "hasMembership=false → no_membership");
    const viewerWrite = await registry.execute("__mention_test_l2__", {
      args: {},
      ...base,
      orgRole: "org_viewer",
      allowedToolNames: [...(base.allowedToolNames ?? []), "__mention_test_l2__"],
      maxRisk: undefined,
    });
    ok(viewerWrite.success === false, "即使去掉 maxRisk，org_viewer 也不能执行写工具（现有 policy 链）");
  }

  console.log("");
  console.log(`M1_ALLOWED_TOOLS (${ALLOWLIST.length}) = ${JSON.stringify(ALLOWLIST)}`);
  console.log(`M1_BLOCKED_L0_TOOLS (${Object.keys(MENTION_GATEWAY_M1_BLOCKED_L0_TOOLS).length}) = ${JSON.stringify(Object.keys(MENTION_GATEWAY_M1_BLOCKED_L0_TOOLS))}`);
  console.log("MENTION_GATEWAY_CANNOT_EXCEED_L0 = PASS");
  finish("M1 Tool Policy");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
