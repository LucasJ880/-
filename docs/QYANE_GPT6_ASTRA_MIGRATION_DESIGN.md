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
  supervisor: flag? gpt-6-astra : gpt-5.6-terra,
  planner:    flag? gpt-6-astra : gpt-5.6-sol,
  researcher: flag? gpt-6-astra : 调用方 baseline,
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
| `ENABLE_GPT6_ASTRA_WORKFLOWS` | 默认 `supervisor,planner,researcher` |
| `OPENAI_MODEL_SUPERVISOR` 等 | 角色覆盖（仍受 kill switch） |
| `OPENAI_MODEL_GPT6_FALLBACK` | 回退模型，默认 Chat |

判定复用 Supervisor flag 语义：未开总开关 → 关；allowlist 未命中不可被 pct 绕过。

Kill switch：flag 关闭时，即使角色 env 写成 `gpt-6-astra` 也回退 baseline。

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

不重试：400 参数、invalid schema、401、明确 policy 失败。

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

Phase 1（flag 打开且 workflow 默认集合）：

1. `resolveSupervisorModel` — planner/observer/repair → Astra；summary 角色是 summarizer，默认不升级
2. `agent-runtime-v2/planner.ts`
3. `tender-understanding/llm.ts` `createUnifiedRuntimeInvoker`
4. `market-intelligence/research-runtime.ts`（任务专用 `OPENAI_MODEL_MARKET_INTELLIGENCE` 仍优先）
5. `agent/skills/tender-analysis.ts`

Phase 2 仅当 `ENABLE_GPT6_ASTRA_WORKFLOWS` 显式加入 `coder` / `supplier_intelligence` / `proposal`。本 PR **不**改 M1 确定性脊柱。

Phase 3：其余 workflow 等 benchmark。

## 兼容性测试矩阵（自动化）

见 `src/lib/ai/model-policy/__tests__/*` 与 `client-tuning.test.ts`。
