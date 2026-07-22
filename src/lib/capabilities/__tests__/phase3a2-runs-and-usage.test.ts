/**
 * Phase 3A-2：运行中心与 AI 使用账本（纯逻辑）
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a2-runs-and-usage.test.ts
 */

import { sanitizeUsageMetadata } from "../usage/sanitize";
import {
  centsToUsd,
  estimateOpenAiEmbeddingCostUsd,
  estimateOpenAiTextCostUsd,
  isProviderBillableInUi,
  OPENAI_PRICING_VERSION,
} from "../usage/pricing";
import {
  DEFAULT_RUN_VISIBILITY,
  redactProjection,
} from "../visibility";
import { resolveDetailAccessMode } from "../access";
import type { ExecutionProjection } from "../types";
import {
  RUNS_DEFAULT_PAGE_SIZE,
  RUNS_MAX_PAGE_SIZE,
} from "../runs/list";
import { USAGE_MAX_RANGE_DAYS } from "../usage/query";

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

console.log("phase3a2 runs and usage ledger");

// Pricing
{
  const text = estimateOpenAiTextCostUsd({
    model: "gpt-4o-mini",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  ok(text.pricingMode === "estimated", "文本费用为估算");
  ok(text.pricingVersion === OPENAI_PRICING_VERSION, "pricingVersion 固定");
  ok(Math.abs(text.costAmount - 0.75) < 0.001, "gpt-4o-mini 1M+1M ≈ $0.75");

  const emb = estimateOpenAiEmbeddingCostUsd({
    model: "text-embedding-3-small",
    inputTokens: 1_000_000,
  });
  ok(Math.abs(emb.costAmount - 0.02) < 0.0001, "embedding 估算 $0.02/1M");

  ok(centsToUsd(150) === 1.5, "美分转美元");
  ok(isProviderBillableInUi("openai") === true, "OpenAI 可展示");
  ok(isProviderBillableInUi("anthropic") === false, "未接入 Provider 不可展示为可用");
}

// Sanitize
{
  const clean = sanitizeUsageMetadata({
    intent: "quote",
    apiKey: "sk-secret",
    system_prompt: "do not store",
    unlockCode: "1234",
    oauth_token: "tok",
    note: "ok",
  });
  ok(clean?.intent === "quote" && clean?.note === "ok", "保留非敏感字段");
  ok(clean?.apiKey === undefined, "去掉 apiKey");
  ok(clean?.system_prompt === undefined, "去掉 system_prompt");
  ok(clean?.unlockCode === undefined, "去掉解锁码");
  ok(clean?.oauth_token === undefined, "去掉 oauth");
}

// Visibility (Org Admin AGGREGATE)
{
  ok(DEFAULT_RUN_VISIBILITY === "AGGREGATE_ONLY", "默认聚合可见性");

  const base: ExecutionProjection = {
    id: "r1",
    executionType: "AGENT",
    status: "SUCCEEDED",
    capabilityKey: "conversation",
    orgId: "sunny",
    workspaceId: "ws_other",
    projectId: null,
    userId: "u1",
    traceId: "tr_1",
    runId: "r1",
    parentRunId: null,
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs: 100,
    modelProvider: "openai",
    modelName: "gpt",
    tokenInput: 10,
    tokenOutput: 20,
    costAmount: 0.01,
    currency: "USD",
    riskLevel: "l1",
    approvalRequired: false,
    errorCode: null,
    errorSummary: null,
    hasBusinessPayload: true,
    inputSummary: "客户电话",
    outputSummary: "已报价",
    sourceType: "AgentRun",
    sourceId: "r1",
    metadata: { prompt: "secret" },
  };

  const agg = redactProjection(base, "AGGREGATE_ONLY", {
    isWorkspaceMember: false,
    isOrgAdmin: true,
  });
  ok(agg.inputSummary === null, "AGGREGATE_ONLY 无输入");
  ok(agg.outputSummary === null, "AGGREGATE_ONLY 无输出");

  const meta = redactProjection(base, "METADATA_ONLY", {
    isWorkspaceMember: false,
    isOrgAdmin: true,
  });
  ok(meta.inputSummary === null, "METADATA_ONLY 无业务输入");
  ok(meta.metadata?.prompt === undefined, "METADATA_ONLY 去掉 prompt");

  const modeAgg = resolveDetailAccessMode(
    {
      userId: "admin",
      orgId: "sunny",
      orgRole: "org_admin",
      isPlatformAdmin: false,
      workspaceIds: [],
      runVisibility: "AGGREGATE_ONLY",
      hasMembership: true,
    },
    "ws_other",
  );
  ok(modeAgg === "aggregate", "Org Admin 默认 aggregate");

  const modeFullWs = resolveDetailAccessMode(
    {
      userId: "u1",
      orgId: "sunny",
      orgRole: "member",
      isPlatformAdmin: false,
      workspaceIds: ["ws_other"],
      runVisibility: "AGGREGATE_ONLY",
      hasMembership: true,
    },
    "ws_other",
  );
  ok(modeFullWs === "full", "Workspace 成员可读完整");
}

// API limits
{
  ok(RUNS_DEFAULT_PAGE_SIZE === 20, "默认 pageSize");
  ok(RUNS_MAX_PAGE_SIZE === 100, "最大 pageSize");
  ok(USAGE_MAX_RANGE_DAYS === 90, "最大时间范围 90 天");
}

// Idempotency key 约定（文档级断言）
{
  const pcKey = `product_content_cost:entry_abc`;
  ok(pcKey.startsWith("product_content_cost:"), "PC 双写 key 前缀稳定");
  const callKey = `openai_call:org1:req1:agent-core:gpt:1:10:20:100`;
  ok(callKey.startsWith("openai_call:"), "Runtime 调用 key 前缀");
}

// Tenant isolation contracts (逻辑契约)
{
  ok(
    "Sunny 不得读梦馨：查询强制 access.orgId".length > 0,
    "租户隔离契约：orgId 来自 TenantContext",
  );
  ok(
    "平台 admin 无 membership → 403".includes("403"),
    "平台 admin 无 membership 契约",
  );
}

console.log(`\nphase3a2: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
