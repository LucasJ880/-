/**
 * Tender QUALITY_FIRST 契约。运行：npx tsx src/lib/ai/model-policy/__tests__/tender.test.ts
 */
import { OPENAI_BUILTIN, OPENAI_GPT6_ASTRA } from "@/lib/ai/model-registry";
import { EXTRACT_SYSTEM_PROMPT } from "@/lib/tender-understanding/prompts";
import { extractionOutputSchema } from "@/lib/tender-understanding/contract";
import { callStructured } from "@/lib/tender-understanding/llm";
import { z } from "zod";
import {
  GPT6_PHASE1_WORKFLOWS,
  QUALITY_FIRST_ROLES,
  ROLE_ENV_KEYS,
  isGpt6AstraEnabledWithEnv,
  isGpt6WorkflowEnabledWithEnv,
  resolveModelPolicy,
  resolveReasoningPolicy,
  resolveTenderModelPolicy,
  isTenderCostDowngradeReason,
  isTenderFallbackAllowed,
  decideTenderRecovery,
  ANALYZED_WITH_FALLBACK_MODEL,
  TENDER_FALLBACK_MODEL,
  TENDER_PRIMARY_WHEN_ENABLED,
  TENDER_WORKFLOW,
  createPinnedTenderInvoker,
  TENDER_CALL_DEADLINE_CODE,
  createTenderCompletion,
  classifyModelError,
  isTenderCallDeadlineError,
  TenderCallDeadlineError,
  TENDER_RETRY_MIN_BUDGET_MS,
  type TenderCompletionFn,
} from "../index";

let total = 0;
let failed = 0;
function expect(c: boolean, m: string) {
  total++;
  if (c) console.log(`✓ ${m}`);
  else {
    failed++;
    console.error(`✗ ${m}`);
  }
}

expect(ROLE_ENV_KEYS.tender === "OPENAI_MODEL_TENDER", "OPENAI_MODEL_TENDER 独立于 RESEARCHER");
expect(QUALITY_FIRST_ROLES.includes("tender"), "tender 是 QUALITY_FIRST");
expect(
  (GPT6_PHASE1_WORKFLOWS as readonly string[]).includes("tender"),
  "Phase 1 workflow 含 tender",
);
expect(TENDER_PRIMARY_WHEN_ENABLED === OPENAI_GPT6_ASTRA, "Tender primary = gpt-6-astra");
expect(TENDER_FALLBACK_MODEL === OPENAI_BUILTIN.chat, "Tender fallback = Sol");
expect(TENDER_WORKFLOW === "tender", "telemetry workflow = tender");

const killSwitchOff = resolveModelPolicy({
  role: "tender",
  env: { OPENAI_MODEL_TENDER: OPENAI_GPT6_ASTRA },
});
expect(killSwitchOff.upgraded === false, "tender role falls back when kill switch off");
expect(killSwitchOff.model !== OPENAI_GPT6_ASTRA, "flag 关时 tender 不得用 Astra");

const enabledNoPct = {
  ENABLE_GPT6_ASTRA: "1",
};
const tenderOn = resolveTenderModelPolicy({ env: enabledNoPct });
expect(
  tenderOn.model === OPENAI_GPT6_ASTRA && tenderOn.upgraded,
  "tender role resolves Astra when enabled（无需 ROLLOUT_PCT）",
);
expect(tenderOn.skipRolloutPct === true, "tender 跳过百分比灰度");
expect(tenderOn.qualityFirst === true, "tender qualityFirst");
expect(
  tenderOn.fallbackModel === OPENAI_BUILTIN.chat,
  "tender fallback 钉在 Sol",
);

const researcherOff = resolveModelPolicy({
  role: "researcher",
  userId: "u1",
  env: enabledNoPct,
});
expect(
  researcherOff.upgraded === false,
  "generic researcher does not control tender / 无 pct 不升级",
);

const researcherEnv = resolveModelPolicy({
  role: "tender",
  env: {
    ...enabledNoPct,
    OPENAI_MODEL_RESEARCHER: OPENAI_BUILTIN.chat,
  },
});
expect(
  researcherEnv.model === OPENAI_GPT6_ASTRA,
  "OPENAI_MODEL_RESEARCHER 不能改 tender",
);

expect(
  isGpt6WorkflowEnabledWithEnv("tender", {}, enabledNoPct) === true,
  "ENABLE_GPT6_ASTRA=1 时 tender workflow 开",
);
expect(
  isGpt6WorkflowEnabledWithEnv("researcher", { userId: "u1" }, enabledNoPct) ===
    false,
  "researcher 仍受 ROLLOUT_PCT fail-closed",
);
expect(
  isGpt6AstraEnabledWithEnv(
    { orgId: "org-b", modelRole: "tender" },
    {
      ENABLE_GPT6_ASTRA: "1",
      ENABLE_GPT6_ASTRA_ORG_ALLOWLIST: "org-a",
    },
  ) === false,
  "Preview org allowlist 仍拦截 tender",
);

const previewEnv = {
  ENABLE_GPT6_ASTRA: "1",
  OPENAI_MODEL_TENDER: OPENAI_GPT6_ASTRA,
  ENABLE_GPT6_ASTRA_ORG_ALLOWLIST: "org-A",
};
const orgA = resolveTenderModelPolicy({
  orgId: "org-A",
  userId: "u-preview",
  env: previewEnv,
});
expect(
  orgA.model === OPENAI_GPT6_ASTRA && orgA.upgraded,
  "ENABLE_GPT6_ASTRA=1 + ORG_ALLOWLIST=org-A + Tender org-A → gpt-6-astra",
);
const orgB = resolveTenderModelPolicy({
  orgId: "org-B",
  userId: "u-preview",
  env: previewEnv,
});
expect(
  !orgB.upgraded && orgB.model !== OPENAI_GPT6_ASTRA,
  "Tender org-B → baseline",
);
const missingOrg = resolveTenderModelPolicy({
  userId: "u-preview",
  env: previewEnv,
});
expect(
  !missingOrg.upgraded &&
    missingOrg.flagDecision === "org_unavailable" &&
    missingOrg.model !== OPENAI_GPT6_ASTRA,
  "Tender missing org + ORG_ALLOWLIST → baseline / fail-closed",
);

const skillPin = createPinnedTenderInvoker({
  orgId: "org-A",
  userId: "u-skill",
  promptVersion: "tender-analysis-skill@3",
  env: previewEnv,
});
expect(
  skillPin.pin.modelVersion === OPENAI_GPT6_ASTRA &&
    skillPin.snapshot().requestedModel === OPENAI_GPT6_ASTRA,
  "Tender Skill + allowed org → requestedModel = gpt-6-astra",
);

const v2Allowed = createPinnedTenderInvoker({
  orgId: "org-A",
  userId: "u-v2",
  promptVersion: "tender-understanding-v2-extract@6",
  env: previewEnv,
});
expect(
  v2Allowed.pin.modelVersion === OPENAI_GPT6_ASTRA,
  "Tender V2 + allowed org → pinned model = gpt-6-astra",
);
const v2Denied = createPinnedTenderInvoker({
  orgId: "org-B",
  promptVersion: "tender-understanding-v2-extract@6",
  env: previewEnv,
});
expect(
  v2Denied.pin.modelVersion !== OPENAI_GPT6_ASTRA && !v2Denied.pin.modelVersion.includes("gpt-6-astra"),
  "Tender V2 + disallowed org → never Astra",
);

const noAllowlist = resolveTenderModelPolicy({
  env: { ENABLE_GPT6_ASTRA: "1" },
});
expect(
  noAllowlist.model === OPENAI_GPT6_ASTRA &&
    noAllowlist.flagDecision === "quality_first",
  "No ORG_ALLOWLIST + ENABLE_GPT6_ASTRA=1 → Tender QUALITY_FIRST",
);

const large = resolveTenderModelPolicy({
  env: enabledNoPct,
  retrievedContextChars: 500_000,
});
const small = resolveTenderModelPolicy({
  env: enabledNoPct,
  retrievedContextChars: 100,
});
expect(
  large.model === small.model && large.model === OPENAI_GPT6_ASTRA,
  "tender never cost-downgrades（大输入不换模型）",
);
expect(
  isTenderCostDowngradeReason("estimated token cost") &&
    isTenderCostDowngradeReason("daily budget optimization") &&
    isTenderCostDowngradeReason("large input"),
  "成本理由被识别",
);
expect(
  !isTenderFallbackAllowed(new Error("estimated token cost too high")),
  "成本不得作为 fallback 理由",
);

expect(
  decideTenderRecovery({
    alreadyRetriedPrimary: false,
    err: { status: 429, message: "rate" },
  }) === "retry_same",
  "tender transient error retries bounded（先同模型）",
);
expect(
  decideTenderRecovery({
    alreadyRetriedPrimary: true,
    err: { status: 503, message: "unavailable" },
  }) === "fallback",
  "同模型重试后才 fallback",
);
expect(
  decideTenderRecovery({
    alreadyRetriedPrimary: false,
    err: { status: 400, message: "invalid schema" },
  }) === "fail",
  "tender 400 does not retry",
);
expect(
  !isTenderFallbackAllowed({ status: 401, message: "invalid_api_key" }),
  "auth 失败不 fallback 风暴",
);

expect(
  ANALYZED_WITH_FALLBACK_MODEL === "ANALYZED_WITH_FALLBACK_MODEL",
  "tender fallback is observable（稳定标记）",
);

expect(
  resolveReasoningPolicy({ role: "tender", tenderStage: "triage" }) ===
    "medium",
  "tender triage → medium",
);
expect(
  resolveReasoningPolicy({
    role: "tender",
    tenderStage: "understanding",
    criticality: "high",
  }) === "high",
  "tender understanding → high",
);
expect(
  resolveReasoningPolicy({
    role: "tender",
    tenderStage: "addendum",
  }) === "xhigh",
  "addendum / cross-doc / risk → xhigh",
);
expect(
  resolveReasoningPolicy({ role: "tender", tenderStage: "understanding" }) !==
    "max",
  "tender 默认禁止 max",
);
expect(
  resolveReasoningPolicy({
    role: "tender",
    tenderStage: "adjudication",
    evidenceConflict: true,
    supervisorEscalation: true,
    criticality: "critical",
  }) === "max",
  "max 仅 critical + 证据冲突 + escalation",
);

const emptyOk = extractionOutputSchema.safeParse({
  facts: [],
  requirements: [],
  potentialRisks: [],
  ambiguities: [],
});
expect(emptyOk.success, "tender structured schema remains enforced（空数组合法）");
expect(
  EXTRACT_SYSTEM_PROMPT.includes("If you cannot quote real evidence, DO NOT output the item") &&
    EXTRACT_SYSTEM_PROMPT.includes("Missing information is a legitimate result") &&
    EXTRACT_SYSTEM_PROMPT.includes("UNKNOWN"),
  "tender UNKNOWN discipline remains enforced",
);

/* ---------------- FIX-12：调用截止时间贯穿同模型重试 / 换备用 ---------------- */

type Req = { model: string; timeoutMs: number | undefined; at: number; retryCount?: number };

/** 顺序调用的假模型 + 假时钟：每次请求把时钟拨过 min(耗时, 超时)。 */
function scripted(
  steps: Array<{ latencyMs: number; error?: { status?: number; message: string } }>,
  startAt = 1_000_000,
) {
  let t = startAt;
  const reqs: Req[] = [];
  const complete: TenderCompletionFn = async (opts) => {
    const step = steps[reqs.length] ?? { latencyMs: 1, error: { message: "no more steps" } };
    reqs.push({ model: opts.model ?? "?", timeoutMs: opts.timeoutMs, at: t, retryCount: opts.retryCount });
    const timeout = opts.timeoutMs ?? Number.POSITIVE_INFINITY;
    t += Math.min(step.latencyMs, timeout);
    if (step.latencyMs > timeout) {
      throw Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
    }
    if (step.error) throw Object.assign(new Error(step.error.message), { status: step.error.status });
    return { content: "{}", finishReason: "stop", model: opts.model ?? "?", elapsedMs: step.latencyMs };
  };
  return { complete, reqs, now: () => t, start: startAt };
}

const terraPolicy = resolveTenderModelPolicy({ env: {} });
const astraPolicy = resolveTenderModelPolicy({ env: { ENABLE_GPT6_ASTRA: "1" } });

async function deadlineCases() {
  // DL-01 本方截止中止 → 零重试、零换模型
  {
    const m = scripted([{ latencyMs: Number.POSITIVE_INFINITY }]);
    let err: unknown = null;
    try {
      await createTenderCompletion({
        systemPrompt: "s", userPrompt: "u", timeoutMs: 180_000,
        pinnedPolicy: terraPolicy, deadlineAt: m.start + 35_300, now: m.now, complete: m.complete,
      });
    } catch (e) { err = e; }
    expect(isTenderCallDeadlineError(err), "DL-01 截止中止 → CALL_DEADLINE_EXCEEDED");
    expect(m.reqs.length === 1 && m.reqs[0]!.timeoutMs === 35_300, "DL-01 只发一次请求，超时 = 剩余 35.3s");
  }
  // DL-02 剩余充足时照旧换备用，超时不超过剩余
  {
    const m = scripted([{ latencyMs: 10_000, error: { status: 429, message: "429 rate limit" } }, { latencyMs: 2_000 }]);
    const res = await createTenderCompletion({
      systemPrompt: "s", userPrompt: "u", timeoutMs: 100_000,
      pinnedPolicy: terraPolicy, deadlineAt: m.start + 70_000, now: m.now, complete: m.complete,
    });
    expect(res.fallbackUsed && m.reqs.length === 2, "DL-02 主模型限流 → 照旧换备用");
    expect(
      m.reqs[1]!.model === terraPolicy.fallbackModel && m.reqs[1]!.timeoutMs === 60_000,
      `DL-02 备用超时 = 剩余 60s（实际 ${m.reqs[1]!.timeoutMs}）`,
    );
  }
  // DL-03 不带截止时间：备用超时 = 原超时（旧行为）
  {
    const m = scripted([{ latencyMs: 10_000, error: { status: 429, message: "429 rate limit" } }, { latencyMs: 2_000 }]);
    await createTenderCompletion({
      systemPrompt: "s", userPrompt: "u", timeoutMs: 100_000,
      pinnedPolicy: terraPolicy, now: m.now, complete: m.complete,
    });
    expect(
      m.reqs.length === 2 && m.reqs[0]!.timeoutMs === 100_000 && m.reqs[1]!.timeoutMs === 100_000,
      "DL-03 无截止时间 → 主 / 备超时都 = 调用方给的 100s",
    );
  }
  // DL-04 剩余不足 0.5 秒 → 不发请求
  {
    const m = scripted([{ latencyMs: 1 }]);
    let err: unknown = null;
    try {
      await createTenderCompletion({
        systemPrompt: "s", userPrompt: "u", timeoutMs: 60_000,
        pinnedPolicy: terraPolicy, deadlineAt: m.start + 400, now: m.now, complete: m.complete,
      });
    } catch (e) { err = e; }
    expect(isTenderCallDeadlineError(err) && m.reqs.length === 0, "DL-04 剩余 0.4s → 不发请求");
  }
  // DL-10 最短 1 秒的截止（小预算）过了几毫秒仍发出首次请求
  {
    const m = scripted([{ latencyMs: 10 }]);
    await createTenderCompletion({
      systemPrompt: "s", userPrompt: "u", timeoutMs: 60_000,
      pinnedPolicy: terraPolicy, deadlineAt: m.start + 997, now: m.now, complete: m.complete,
    });
    expect(m.reqs.length === 1 && m.reqs[0]!.timeoutMs === 997, "DL-10 截止 = 开工 + 1s、已过 3ms → 照发，超时 0.997s");
  }
  // DL-11 主模型早早限流、备用在截止时被中止 → 记为截止（不当瞬时错误让上一层再试）
  {
    const m = scripted([
      { latencyMs: 5_000, error: { status: 429, message: "429 rate limit" } },
      { latencyMs: Number.POSITIVE_INFINITY },
    ]);
    let err: unknown = null;
    try {
      await createTenderCompletion({
        systemPrompt: "s", userPrompt: "u", timeoutMs: 180_000,
        pinnedPolicy: terraPolicy, deadlineAt: m.start + 35_000, now: m.now, complete: m.complete,
      });
    } catch (e) { err = e; }
    expect(
      isTenderCallDeadlineError(err) && m.reqs.length === 2 && m.reqs[1]!.timeoutMs === 30_000,
      "DL-11 备用超时 = 剩余 30s，截止中止后记为 CALL_DEADLINE_EXCEEDED",
    );
  }
  // DL-05 结构化层的重试：剩余 < 5s 不发；≥ 5s 照发且超时 ≤ 剩余
  {
    const m = scripted([{ latencyMs: 1 }]);
    let err: unknown = null;
    try {
      await createTenderCompletion({
        systemPrompt: "s", userPrompt: "u", timeoutMs: 60_000, structuredRetry: true,
        pinnedPolicy: terraPolicy, deadlineAt: m.start + TENDER_RETRY_MIN_BUDGET_MS - 1, now: m.now, complete: m.complete,
      });
    } catch (e) { err = e; }
    expect(isTenderCallDeadlineError(err) && m.reqs.length === 0, "DL-05 结构化重试、剩余 < 5s → 不发");
    const m2 = scripted([{ latencyMs: 1 }]);
    await createTenderCompletion({
      systemPrompt: "s", userPrompt: "u", timeoutMs: 60_000, structuredRetry: true,
      pinnedPolicy: terraPolicy, deadlineAt: m2.start + 10_000, now: m2.now, complete: m2.complete,
    });
    expect(m2.reqs.length === 1 && m2.reqs[0]!.timeoutMs === 10_000, "DL-05 结构化重试、剩余 10s → 照发，超时 10s");
  }
  // DL-06 不可重试的错误仍按原错误抛出（不被改写成截止）
  {
    const m = scripted([{ latencyMs: 1_000, error: { status: 400, message: "400 invalid_request" } }]);
    let err: unknown = null;
    try {
      await createTenderCompletion({
        systemPrompt: "s", userPrompt: "u", timeoutMs: 60_000,
        pinnedPolicy: terraPolicy, deadlineAt: m.start + 2_000, now: m.now, complete: m.complete,
      });
    } catch (e) { err = e; }
    expect(!isTenderCallDeadlineError(err) && m.reqs.length === 1, "DL-06 400 → 原错误、不重试");
  }
  // DL-07 Astra 同模型重试也只用剩余；重试失败后剩余 < 5s → 不再换备用
  {
    const m = scripted([
      { latencyMs: 40_000, error: { status: 500, message: "500 server error" } },
      { latencyMs: 27_000, error: { status: 500, message: "500 server error" } },
    ]);
    let err: unknown = null;
    try {
      await createTenderCompletion({
        systemPrompt: "s", userPrompt: "u", timeoutMs: 180_000,
        pinnedPolicy: astraPolicy, deadlineAt: m.start + 70_000, now: m.now, complete: m.complete,
      });
    } catch (e) { err = e; }
    expect(
      astraPolicy.model !== terraPolicy.model && m.reqs.length === 2 && m.reqs[1]!.model === astraPolicy.model && m.reqs[1]!.timeoutMs === 30_000,
      `DL-07 Astra 同模型重试超时 = 剩余 30s（实际 ${m.reqs[1]?.timeoutMs}）`,
    );
    expect(isTenderCallDeadlineError(err), "DL-07 重试失败后剩余 3s → 截止，不换备用");
  }
  // DL-08 截止错误不会被任何一层判为可重试
  expect(
    classifyModelError(new TenderCallDeadlineError(0, new Error("Request was aborted."))) === "non_retryable",
    "DL-08 截止错误分类为 non_retryable",
  );
  // 剩余毫秒数里带「429」也不得被判成可重试（文案不带数字）
  expect(
    [429, 1429, 4290].every(
      (ms) => classifyModelError(new TenderCallDeadlineError(ms, new Error("Request was aborted."))) === "non_retryable",
    ),
    "DL-08 剩余毫秒数含 429 的截止错误仍是 non_retryable",
  );
  // DL-09 钉住模型的 invoker 透传截止时间
  {
    const m = scripted([{ latencyMs: Number.POSITIVE_INFINITY }]);
    const inv = createPinnedTenderInvoker({ env: {}, now: m.now, complete: m.complete });
    let err: unknown = null;
    try {
      await inv({
        promptName: "p", promptVersion: "v", systemPrompt: "s", userPrompt: "u",
        maxTokens: 10, timeoutMs: 180_000, deadlineAt: m.start + 20_000,
      });
    } catch (e) { err = e; }
    expect(
      isTenderCallDeadlineError(err) && m.reqs.length === 1 && m.reqs[0]!.timeoutMs === 20_000,
      "DL-09 pinned invoker 透传 deadlineAt：超时 20s、截止后零重试",
    );
    expect(inv.snapshot().activeModel === terraPolicy.model, "DL-09 截止失败不改钉住的模型");
  }
  // DL-12 结构化输出层 → 钉住模型的 invoker 的接线：输出不合格后的那次重试带着「这是重试」，剩余 < 5s 就不发
  {
    const strict = z.object({ must: z.string() }); // scripted 的回复是 "{}"，过不了这个 schema
    const req = {
      promptName: "p", promptVersion: "v", systemPrompt: "s", userPrompt: "u",
      maxTokens: 10, timeoutMs: 60_000,
    };
    const m = scripted([{ latencyMs: 2_000 }, { latencyMs: 2_000 }]);
    const inv = createPinnedTenderInvoker({ env: {}, now: m.now, complete: m.complete });
    const res = await callStructured(inv, { ...req, deadlineAt: m.start + 6_000 }, strict);
    expect(
      !res.ok && res.errorCode === TENDER_CALL_DEADLINE_CODE && m.reqs.length === 1,
      `DL-12 输出不合格后剩余 4s → 结构化重试不发，CALL_DEADLINE_EXCEEDED（请求 ${m.reqs.length}）`,
    );
    const m2 = scripted([{ latencyMs: 2_000 }, { latencyMs: 2_000 }]);
    const inv2 = createPinnedTenderInvoker({ env: {}, now: m2.now, complete: m2.complete });
    const res2 = await callStructured(inv2, { ...req, deadlineAt: m2.start + 60_000 }, strict);
    expect(
      !res2.ok && res2.errorCode === "INVALID_STRUCTURED_OUTPUT" && m2.reqs.length === 2 && m2.reqs[1]!.timeoutMs === 58_000,
      `DL-12 剩余充足 → 结构化重试照发，超时 = 剩余 58s（请求 ${m2.reqs.length}，第二次超时 ${m2.reqs[1]?.timeoutMs}）`,
    );
  }
  // DL-13 结构化输出层对「请求抛错」的既有规则是不分种类再试一次：400 在模型请求层原样抛出（DL-06），
  // 到了这一层那次再试因剩余 < 5s 不发，整次调用记为截止（规格「不可重试的错误在模型请求层原样结束」）
  {
    const m = scripted([{ latencyMs: 1_000, error: { status: 400, message: "400 invalid_request" } }]);
    const inv = createPinnedTenderInvoker({ env: {}, now: m.now, complete: m.complete });
    const res = await callStructured(
      inv,
      {
        promptName: "p", promptVersion: "v", systemPrompt: "s", userPrompt: "u",
        maxTokens: 10, timeoutMs: 60_000, deadlineAt: m.start + 2_000,
      },
      z.object({}).passthrough(),
    );
    expect(
      !res.ok && res.errorCode === TENDER_CALL_DEADLINE_CODE && m.reqs.length === 1 &&
        res.logs.length === 1 && res.logs[0]!.errorCode === "TRANSIENT_MODEL_ERROR",
      `DL-13 400 且剩余 1s → 只发一次请求，调用日志记 TRANSIENT_MODEL_ERROR，整次调用以 CALL_DEADLINE_EXCEEDED 结束（请求 ${m.reqs.length}）`,
    );
  }
}

deadlineCases().then(
  () => {
    console.log(
      `\n${failed === 0 ? "✅" : "❌"} gpt6-tender: ${total - failed}/${total}`,
    );
    if (failed) process.exit(1);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
