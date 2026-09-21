# Qyane GPT-6 Astra — Migration Design

## 目标

把 `gpt-6-astra` 用在真正需要高推理、高自治、复杂工具调用的位置，同时保持：

- 现网行为默认不变（flag 关闭 = 100% 旧模型）
- 成本与回滚可控
- 授权/租户边界不变
- 不把 GPT-6 塞进每一次 LLM 请求

## 非目标

- 全局 `gpt-5.6-*` → `gpt-6-astra`
- 为形式统一把所有 Chat Completions 迁 Responses
- 改 Prisma schema
- 删除现有 fallback
- 用长上下文绕过 memory / evidence verifier
- 把 Supplier Intelligence 打分脊柱改成 LLM

## Model Policy Layer（最小侵入）

现网已有 `ProviderRouter` + `TASK_PRESETS`。本轮**不替换**它们，在上方加角色解析：

```
src/lib/ai/model-policy/
  flags.ts        ENABLE_GPT6_ASTRA（fail-closed）
  roles.ts        supervisor/planner/researcher/coder/…
  resolve.ts      resolveModelPolicy()
  reasoning.ts    simple→low … exception→max
  compat.ts       Astra 禁止 none；tools → Responses
  retry.ts        429/5xx vs 400/401/schema
  guardrails.ts   max turns/retries/tool result
```

业务代码禁止写 `model: "gpt-6-astra"`。唯一字面量在 `OPENAI_GPT6_ASTRA`。

等价于：

```
AI_MODELS = {
  supervisor: flag+pct/allowlist? gpt-6-astra : gpt-5.6-terra,
  planner:    flag+pct/allowlist? gpt-6-astra : gpt-5.6-sol,
  researcher: flag+pct/allowlist? gpt-6-astra : 调用方 baseline,
  tender:     ENABLE_GPT6_ASTRA=1（allowlist 未拦截）→ gpt-6-astra（QUALITY_FIRST，不走 ROLLOUT_PCT）
              ENABLE_GPT6_ASTRA=0 → gpt-5.6-terra baseline；fallback = gpt-5.6-sol
  coder:      仅当 WORKFLOWS 包含 coder,
  classifier / summarizer / chat / fast: 保持低成本
}
```

### 环境变量

| Key | 作用 |
|---|---|
| `ENABLE_GPT6_ASTRA` | 总开关 / 紧急回滚 |
| `ENABLE_GPT6_ASTRA_ORG_ALLOWLIST` | 组织灰度 |
| `ENABLE_GPT6_ASTRA_USER_ALLOWLIST` | 用户灰度 |
| `ENABLE_GPT6_ASTRA_ROLE_ALLOWLIST` | 角色灰度 |
| `ENABLE_GPT6_ASTRA_ROLLOUT_PCT` | 无 allowlist 时的百分比 |
| `ENABLE_GPT6_ASTRA_WORKFLOWS` | 默认 `supervisor,planner,researcher,tender` |
| `OPENAI_MODEL_SUPERVISOR` 等 | 角色覆盖（仍受 kill switch） |
| `OPENAI_MODEL_TENDER` | Tender 独立模型；生产目标 `gpt-6-astra` |
| `OPENAI_MODEL_GPT6_FALLBACK` | 回退模型，默认 Chat（Sol） |

判定复用 Supervisor flag 语义：未开总开关 → 关；allowlist 未命中不可被 pct 绕过。

Kill switch：flag 关闭时，即使角色 env 写成 `gpt-6-astra` 也回退 baseline。

## Tender is a QUALITY_FIRST domain

Tender / Procurement Intelligence 是当前最高价值 AI workload 之一。**模型质量、推理能力和可靠性优先级明显高于 token 成本。**

GPT-6 Astra is the default primary reasoning model for Tender Intelligence when the GPT-6 emergency kill switch is enabled.

- 独立角色 `tender` / `OPENAI_MODEL_TENDER`，不再复用 generic `researcher`
- Preview 可用 org/user allowlist；验证后 **禁止用 `ROLLOUT_PCT` 随机拆模型**
- Production target：`ENABLE_GPT6_ASTRA=1` + `OPENAI_MODEL_TENDER=gpt-6-astra`
- 禁止 `OPENAI_CHAT_MODEL=gpt-6-astra`
- Fallback 仅 429 / timeout / 5xx / provider unavailable / hard compatibility；**禁止因 token 成本、大输入、日预算优化降到 Terra**
- 回退链：Astra → 同模型 1 次 → `gpt-5.6-sol` → 安全失败。fallback 完成须标记 `ANALYZED_WITH_FALLBACK_MODEL`
- 一次 Tender run pin：`modelFamily` / `modelVersion` / `promptVersion`
- 证据契约不变：CLAIM → EVIDENCE → SOURCE → CONFIDENCE；无法证明 = UNKNOWN
- 确定性机件保持：解析、索引、归一化、去重、schema、授权、org scoping
- GPT-6 用于：理解、跨文档综合、Addendum 对照、资格/风险/Bid-No-Bid 推理

### Tender reasoning

| Stage | Effort |
|---|---|
| triage | medium |
| understanding / mandatory / eligibility / technical / commercial / bid-no-bid | high |
| addendum / cross-document / complex risk / adjudication | xhigh |
| critical + evidence conflict + supervisor escalation | max（仅此） |

### Tender Supervisor stages（推理重的阶段默认 Astra）

Document inventory → understanding → mandatory → eligibility → technical → commercial → execution feasibility → evidence verification → risk → Bid/No-Bid

Addendum：ORIGINAL / SUPERSEDED / MODIFIED / NEW / UNCHANGED；后发布有效补遗优先。跨文档识别 conflict / duplicate / override / dependency / missing form / cross-reference。

## Reasoning Policy

| Band | Effort | 何时 |
|---|---|---|
| simple | low | summarizer / classifier / fast |
| normal | medium | chat |
| complex | high | supervisor / planner / researcher / coder |
| critical | xhigh | 显式 critical 或 supervisor escalation |
| exception | max | escalation **且** critical **且** retry≥2 |

禁止：

- 默认 max
- 仅因 prompt 变长而升级（必须同时有 toolCount≥2）
- Astra 发送 `none`

用户 quality mode=`high` 时，complex 升到 xhigh，仍不是默认。

## Responses API

仅当 `isGpt6Astra(model) && hasTools`：

`src/lib/ai/responses-client.ts` → `client.responses.create` → Chat Completions 兼容 `choices[].message.tool_calls`。

无 tools 的 Astra 请求继续 Chat Completions（`reasoning_effort`，无 temperature）。

Agent Core 流式在该条件下把完整 Responses 伪装成单块 delta，避免重写整个 stream parser。

## Fallback

```
GPT-6 Astra
  → 同模型 1 次（仅 retryable：429/5xx/timeout/network）
  → 现有 fallback 模型（Supervisor=Chat，研究=terra 等）
  → safe failure（抛给调用方规则降级）
```

Tender：Astra → 同模型 1 次 → **gpt-5.6-sol** → 安全失败；结果标记 `ANALYZED_WITH_FALLBACK_MODEL`。不得因成本降级。

Supervisor 原有 `isTransientModelError` + 一次 fallback **保留**。

## Cost telemetry

继续 `recordAiCall` → ledger。新增可选：`workflow` `reasoningEffort` `cachedInputTokens` `retryCount` `toolCalls`。

定价：`gpt-6-astra` 10/50 USD per 1M；cached input 按现有半价粗估（ledger 本就 ESTIMATED）。

## Security

- 工具授权仍在服务端（`canInvokeTool` / approval-gate）
- Memory / corporate-memory accessClass 不变
- Supplier Intel score-contract 继续禁 LLM
- 不扩大 Mention Gateway maxRisk

## 迁移接线（已实现）

Phase 1（flag 打开）：

1. `resolveSupervisorModel` — planner/observer/repair → Astra（仍受 pct/allowlist）；summary 角色是 summarizer，默认不升级
2. `agent-runtime-v2/planner.ts`（仍受 pct/allowlist）
3. `tender-understanding/llm.ts` **`role: tender`** — QUALITY_FIRST，kill switch 开即 Astra
4. `agent/skills/tender-analysis.ts` **`role: tender`** — 跨文档一次综合，禁止逐 PDF 拼接
5. `market-intelligence/research-runtime.ts` 仍是 generic researcher（pct/allowlist）

Phase 2 仅当 `ENABLE_GPT6_ASTRA_WORKFLOWS` 显式加入 `coder` / `supplier_intelligence` / `proposal`。本 PR **不**改 M1 确定性脊柱。

Phase 2 仅当 `ENABLE_GPT6_ASTRA_WORKFLOWS` 显式加入 `coder` / `supplier_intelligence` / `proposal`。本 PR **不**改 M1 确定性脊柱。

Phase 3：其余 workflow 等 benchmark。

## 兼容性测试矩阵（自动化）

见 `src/lib/ai/model-policy/__tests__/*` 与 `client-tuning.test.ts`。
