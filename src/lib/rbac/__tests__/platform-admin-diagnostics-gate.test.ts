/**
 * 上线前：平台管理员调试面门禁契约
 * 运行：npx tsx src/lib/rbac/__tests__/platform-admin-diagnostics-gate.test.ts
 */

import { isPlatformAdmin } from "@/lib/rbac/platform-admin";
import { isOrgSystemAdmin, isSuperAdmin } from "@/lib/rbac/roles";
import {
  findForbiddenDiagnosticFields,
  toBusinessConversationDto,
  toBusinessMessageDto,
  toBusinessRuntimeDto,
  toPlatformDiagnosticConversationDto,
  toPlatformDiagnosticMessageDto,
  toPlatformDiagnosticRuntimeDto,
} from "@/lib/conversations/dto";
import {
  isNavItemVisible,
  resolveNavigationTree,
} from "@/lib/navigation";
import { NAVIGATION_REGISTRY } from "@/lib/navigation/registry";
import type { NavigationFilterContext } from "@/lib/navigation/types";

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

console.log("platform-admin diagnostics gate");

// ── 角色边界 ──
ok(isPlatformAdmin("admin"), "admin 是平台管理员");
ok(isPlatformAdmin("super_admin"), "super_admin 是平台管理员");
ok(isPlatformAdmin({ role: "admin" }), "user.role=admin 是平台管理员");
ok(!isPlatformAdmin("user"), "普通 user 不是平台管理员");
ok(!isPlatformAdmin("sales"), "sales 不是平台管理员");
ok(!isPlatformAdmin("manager"), "manager 不是平台管理员");
ok(!isPlatformAdmin(null), "null 不是平台管理员");
ok(!isPlatformAdmin("org_owner"), "org_owner 字符串不是平台角色（平台 role 字段）");
ok(isOrgSystemAdmin("org_owner"), "org_owner 是组织系统管理");
ok(isOrgSystemAdmin("org_admin"), "org_admin 是组织系统管理");
ok(
  isOrgSystemAdmin("org_owner") && !isPlatformAdmin("user"),
  "企业负责人（org）≠ 平台管理员",
);
ok(isSuperAdmin("admin") === isPlatformAdmin("admin"), "与 isSuperAdmin 对齐");

// ── 导航：普通用户看不到调试入口 ──
const memberCtx: NavigationFilterContext = {
  pathname: "/",
  platformRole: "user",
  orgRole: "org_owner",
  hasMembership: true,
  workspaceIds: ["ws1"],
  modules: {
    enabled: [
      "operations",
      "sales",
      "trade",
      "projects",
      "marketing",
      "product_content",
    ],
  },
  isPlatformAdmin: false,
};

const adminCtx: NavigationFilterContext = {
  ...memberCtx,
  platformRole: "admin",
  isPlatformAdmin: true,
};

const memoryItem = NAVIGATION_REGISTRY.find((i) => i.key === "mgmt-memory");
ok(!!memoryItem, "组织记忆导航项存在");
ok(
  !!memoryItem && !isNavItemVisible(memoryItem, memberCtx),
  "普通用户（含 org_owner）看不到组织记忆",
);
ok(
  !!memoryItem && isNavItemVisible(memoryItem, adminCtx),
  "平台管理员可见组织记忆",
);

const caps = NAVIGATION_REGISTRY.find((i) => i.key === "capabilities");
const runsChild = caps?.children?.find((c) => c.key === "cap-runs");
ok(!!runsChild, "运行中心导航项存在");
ok(
  !!runsChild && !isNavItemVisible(runsChild, memberCtx),
  "普通用户看不到运行诊断",
);
ok(
  !!runsChild && isNavItemVisible(runsChild, adminCtx),
  "平台管理员可见运行诊断",
);

const memberTree = resolveNavigationTree(NAVIGATION_REGISTRY, memberCtx);
const memberHrefs = new Set(
  memberTree.flatMap((i) => [
    i.href,
    ...(i.children?.map((c) => c.href) ?? []),
  ]),
);
ok(!memberHrefs.has("/memory"), "树中无 /memory");
ok(!memberHrefs.has("/capabilities/runs"), "树中无 /capabilities/runs");
ok(!memberHrefs.has("/settings/agent-skills"), "树中无数字员工技能（本就不在主导航）");

// ── 会话 DTO：业务视图不得含诊断字段 ──
const sampleConv = {
  id: "c1",
  title: "测试",
  channel: "web",
  status: "active",
  environment: { id: "e1", code: "dev", name: "开发" },
  user: { id: "u1", name: "张三", email: "a@b.com" },
  messageCount: 2,
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  estimatedCost: 0.01,
  avgLatencyMs: 120,
  agentId: "agent-1",
  runtimeStatus: "completed",
  lastErrorMessage: "secret stack",
  runCount: 3,
  startedAt: new Date().toISOString(),
  lastMessageAt: new Date().toISOString(),
  endedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const bizConv = toBusinessConversationDto(sampleConv);
const bizJson = JSON.stringify(bizConv);
ok(!("inputTokens" in bizConv), "业务会话无 inputTokens");
ok(!("totalTokens" in bizConv), "业务会话无 totalTokens");
ok(!("estimatedCost" in bizConv), "业务会话无 estimatedCost");
ok(!("avgLatencyMs" in bizConv), "业务会话无 avgLatencyMs");
ok(!("agentId" in bizConv), "业务会话无 agentId");
ok(!bizJson.includes("secret stack"), "业务会话无内部错误原文");
ok(!bizJson.toLowerCase().includes("prompt"), "业务会话 JSON 无 prompt");
ok(bizConv.businessStatus.length > 0, "业务会话有 businessStatus");

const diag = toPlatformDiagnosticConversationDto(sampleConv, {
  prompt: { id: "p1", key: "k", name: "Prompt A", version: 1 },
  knowledgeBase: null,
  contextSnapshot: {
    id: "s1",
    promptKey: "k",
    knowledgeBaseKey: null,
    systemPromptSnapshot: "You are...",
    retrievalConfigJson: null,
    extraConfigJson: null,
    createdAt: new Date().toISOString(),
  },
});
ok(diag.conversation.totalTokens === 150, "诊断会话保留 tokens");
ok(diag.prompt?.key === "k", "诊断会话保留 prompt");
ok(
  diag.contextSnapshot?.systemPromptSnapshot === "You are...",
  "诊断会话保留 systemPrompt",
);

const sampleMsg = {
  id: "m1",
  role: "assistant",
  content: "你好",
  contentType: "text",
  sequence: 1,
  modelName: "gpt-test",
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 99,
  status: "success",
  errorMessage: null,
  toolName: null,
  toolCallId: null,
  parentMessageId: null,
  metadataJson: '{"traceId":"t1"}',
  createdAt: new Date().toISOString(),
};

const bizMsg = toBusinessMessageDto(sampleMsg);
const bizMsgJson = JSON.stringify(bizMsg);
ok(!("modelName" in bizMsg), "业务消息无 modelName");
ok(!("inputTokens" in bizMsg), "业务消息无 inputTokens");
ok(!("metadataJson" in bizMsg), "业务消息无 metadataJson");
ok(!bizMsgJson.includes("gpt-test"), "业务消息 JSON 无 model");
ok(!bizMsgJson.includes("traceId"), "业务消息 JSON 无 traceId");

const toolMsg = toBusinessMessageDto({
  ...sampleMsg,
  role: "tool",
  content: '{"secret":true}',
  toolName: "search_db",
  toolCallId: "call_1",
});
ok(toolMsg.content === "", "业务工具消息正文清空");
ok(toolMsg.isToolCall === true, "业务工具消息仅标记");

const diagMsg = toPlatformDiagnosticMessageDto(sampleMsg);
ok(diagMsg.modelName === "gpt-test", "诊断消息保留 model");
ok(diagMsg.metadataJson?.includes("traceId"), "诊断消息保留 metadata");

// ── 普通 GET 响应键：彻底不存在诊断键 ──
ok(!("modelName" in bizMsg), "1. 普通 GET messages 无 modelName key");
ok(
  !("inputTokens" in bizMsg) && !("outputTokens" in bizMsg),
  "2. 普通响应无 inputTokens/outputTokens key",
);
ok(
  !("toolName" in toolMsg) && !("toolCallId" in toolMsg),
  "3. 普通响应无 toolName/toolCallId key",
);
ok(!("metadataJson" in bizMsg), "4. 普通响应无 metadataJson key");

const memberConvBody = { conversation: toBusinessConversationDto(sampleConv) };
ok(!("prompt" in memberConvBody), "5. 普通 conversation 响应无 prompt key");
ok(
  !("knowledgeBase" in memberConvBody) &&
    !("contextSnapshot" in memberConvBody),
  "5b. 普通 conversation 响应无 knowledgeBase/contextSnapshot key",
);

// ── POST 诊断字段 fail-closed（模拟 org_owner / org_admin / user）──
function assertPostForbidden(
  body: Record<string, unknown>,
  label: string,
) {
  const fields = findForbiddenDiagnosticFields(body);
  ok(fields.length > 0, `${label} → 检出诊断字段`);
  // 路由层会返回 400 DIAGNOSTIC_FIELDS_FORBIDDEN
  return fields;
}

ok(
  assertPostForbidden({ content: "hi", modelName: "x" }, "6. POST modelName")
    .includes("modelName"),
  "6. 普通用户 POST modelName → 拒绝",
);
ok(
  assertPostForbidden(
    { content: "hi", inputTokens: 1 },
    "7. POST inputTokens",
  ).includes("inputTokens"),
  "7. 普通用户 POST inputTokens → 拒绝",
);
ok(
  assertPostForbidden(
    { content: "hi", role: "tool" },
    "8. POST role=tool",
  ).includes("role"),
  "8. 普通用户 POST role=tool → 拒绝",
);
ok(
  assertPostForbidden(
    { content: "hi", metadataJson: "{}" },
    "9. POST metadataJson",
  ).includes("metadataJson"),
  "9. 普通用户 POST metadataJson → 拒绝",
);

// org_owner / org_admin 平台 role 仍是 user/sales 等 — 诊断写入看 User.role
ok(!isPlatformAdmin("user"), "10. org_owner 场景下平台 role=user 非平台管理员");
ok(
  findForbiddenDiagnosticFields({ content: "x", role: "assistant" }).includes(
    "role",
  ),
  "10. org_owner 同样被拒绝提交 role",
);
ok(
  findForbiddenDiagnosticFields({
    content: "x",
    outputTokens: 3,
  }).includes("outputTokens"),
  "11. org_admin 同样被拒绝提交 outputTokens",
);

ok(isPlatformAdmin("admin"), "12. platform admin 可使用诊断字段（角色通过）");
ok(
  findForbiddenDiagnosticFields({ content: "ok" }).length === 0,
  "12b. 仅业务字段时无禁止键（admin 可另带诊断字段）",
);

// ── Runtime DTO ──
const rawRuntime = {
  newMessages: [
    {
      id: "n1",
      role: "assistant",
      content: "ok",
      modelName: "gpt-x",
      inputTokens: 1,
      outputTokens: 2,
    },
  ],
  toolTraces: [
    {
      id: "t1",
      toolKey: "search",
      toolName: "Search",
      status: "success",
      durationMs: 10,
    },
  ],
};

const bizRuntime = toBusinessRuntimeDto(rawRuntime);
const bizRuntimeJson = JSON.stringify(bizRuntime);
ok(!("toolTraces" in bizRuntime), "13. 普通 POST run 响应无 toolTraces");
ok(
  !bizRuntimeJson.includes("gpt-x") &&
    !bizRuntimeJson.includes("token") &&
    !bizRuntimeJson.includes("metadata") &&
    !bizRuntimeJson.includes("Search"),
  "14. 普通 POST run 响应无 model/token/metadata",
);
ok(
  Object.keys(bizRuntime).sort().join(",") ===
    "businessMessage,newMessageCount,status",
  "14b. 普通 Runtime 仅 status/businessMessage/newMessageCount",
);

const diagRuntime = toPlatformDiagnosticRuntimeDto(rawRuntime);
ok("toolTraces" in diagRuntime, "管理员 Runtime 含 toolTraces");
ok(
  Array.isArray(diagRuntime.newMessages) &&
    diagRuntime.newMessages.length === 1,
  "管理员 Runtime 含 newMessages",
);

const failedBiz = toBusinessRuntimeDto({
  newMessages: [],
  toolTraces: [],
  error: "Prisma P2003 secret stack",
});
ok(failedBiz.status === "failed", "失败 Runtime 业务 status=failed");
ok(
  !JSON.stringify(failedBiz).includes("Prisma") &&
    !JSON.stringify(failedBiz).includes("secret"),
  "失败 Runtime 不泄漏内部错误",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
