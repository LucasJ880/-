# Qyane GPT-6 Astra — Current State Audit

日期：2026-09-11  
范围：`origin/main` @ `feat/gpt6-astra-migration` 工作树（不改 schema）  
原则：禁止全局替换模型名；GPT-6 只作为高端 reasoning engine。

## A. Model Inventory

当前生产默认（`OPENAI_BUILTIN`，`src/lib/ai/model-registry/openai.ts`）：

| Capability | Builtin | Env |
|---|---|---|
| Chat | `gpt-5.6-sol` | `OPENAI_CHAT_MODEL` / `OPENAI_MODEL` |
| Reasoning | `gpt-5.6-terra` | `OPENAI_REASONING_MODEL` / `OPENAI_MODEL_MINI` |
| Fast | 回退 Chat | `OPENAI_FAST_MODEL` / `OPENAI_MODEL_NANO` |
| Vision | 回退 Chat | `OPENAI_VISION_MODEL` |
| Image | `gpt-image-2` | `OPENAI_IMAGE_MODEL` |
| TTS | `gpt-4o-mini-tts` | `OPENAI_TTS_MODEL` |
| Embedding | `text-embedding-3-small` | `AGENT_EMBEDDING_MODEL` |

`TASK_PRESETS`（`src/lib/ai/config.ts`）：

| Mode | Model source | Reasoning | Max tokens | 用途 |
|---|---|---|---|---|
| `chat` / `normal` | Chat (`sol`) | medium | 8192 | 对话、草稿 |
| `fast` | Fast | low | 2048 | 摘要/改写 |
| `structured` | Reasoning (`terra`) | medium | 4096 | JSON / 招标 V2 |
| `deep` | Reasoning (`terra`) | high | 16384 | 深度研究/标书 |

### 调用点总表（按真实代码，非设计图）

| Location | Workflow | Current Model | API | Reasoning | Tools | Streaming | Business Criticality |
|---|---|---|---|---|---|---|---|
| `src/lib/ai/client.ts` `createChatStream` | Operator / `/api/ai/chat` | `TASK_PRESETS.chat` | Chat Completions | medium | no | yes | High |
| `src/lib/ai/client.ts` `createCompletionDetailed` | 统一非流式入口 | preset / override | Chat Completions | preset | no | no | High |
| `src/lib/agent-core/engine.ts` `runAgent` | Agent Core 工具环 | preset / `options.model` | Chat Completions；GPT-6+tools → Responses | preset；5.6+tools 曾强制 `none` | yes | no | High |
| `src/lib/agent-core/engine.ts` `runAgentStream` | Operator 流式工具环 | 同上 | 同上 | 同上 | yes | yes | High |
| `src/lib/runtime/openai-provider.ts` | Legacy runtime LLM | `primaryModel` | Chat Completions；GPT-6+tools → Responses | medium；5.6+tools=`none` | yes | no | Medium |
| `src/lib/agent-supervisor/model-resolve.ts` | Supervisor planner/observer/repair/summary | Reasoning；可 `AGENT_SUPERVISOR_*_MODEL` | 经 `createCompletionDetailed` | purpose 默认 | no | no | **Critical** |
| `src/lib/agent-runtime-v2/planner.ts` | FDE / Runtime V2 plan | Chat（`createCompletion` 默认 normal） | Chat Completions | 默认 medium | no | no | **Critical** |
| `src/lib/agent-runtime-v2/verifier.ts` | FDE Verify | Chat | Chat Completions | 默认 | no | no | High |
| `src/lib/tender-understanding/llm.ts` | Bid research V2 | `structured` → terra | Chat Completions | medium | no | no | **Critical** |
| `src/lib/market-intelligence/research-runtime.ts` | 市场深度研究 | Chat 主 / Reasoning 备 | 经 skill runtime → Agent Core | high → medium fallback | yes（skill） | no | High |
| `src/lib/agent/skills/tender-analysis.ts` | 标书深度报告 | `deep` → terra | Chat Completions | high | no | no | High |
| `src/lib/files/intelligence-extractor.ts` | Intelligence report | `getIntelligenceReportConfig` | Chat Completions | env / deep | no | no | High |
| `src/lib/supplier/classifier.ts` | 供应商标签 | `structured` | Chat Completions | medium | no | no | Medium |
| `src/lib/supplier-intel/*` | Supplier Intelligence M1 打分/发现 | **无 LLM** | 确定性代码 + Provider | n/a | n/a | n/a | **Critical（禁止塞模型）** |
| `src/lib/ai/conversation.ts` | 历史压缩 | `fast` | Chat Completions | low | no | no | Medium |
| `src/lib/context/compressor.ts` | 上下文压缩 | `fast` | Chat Completions | low | no | no | Medium |
| `src/app/api/ai/language-assist/route.ts` | 润色/翻译 | `fast` | Chat Completions | low | no | no | Low |
| `src/app/api/sales/cockpit/weekly-report/route.ts` | 销售周报 | `AI_MODEL` 或 Chat | **旁路** `new OpenAI().chat.completions` | 无 | no | no | Medium |
| `src/lib/sales/ai-quote-parser.ts` | 报价解析 | 直连 fetch Chat Completions | **旁路** | 无 | no | no | Medium |
| `src/app/api/ai/tts/route.ts` | TTS | `gpt-4o-mini-tts` | Audio Speech | n/a | n/a | n/a | Low |
| `src/app/api/ai/transcribe/route.ts` | STT | whisper 族 | Audio Transcriptions | n/a | n/a | n/a | Low |
| `src/lib/trade/intelligence-label-vision.ts` | 标签视觉 | Vision/Chat | Chat Completions（多模态） | 无自定义 effort | no | no | Medium |
| `src/lib/product-content/qa/multimodal.ts` | 多模态 QA | Chat | Chat Completions + `json_object` | 无 | no | no | Medium |
| 其余 `createCompletion` 调用方（sales/trade/ops/secretary/quote/workforce synthesis 等） | 见仓库 grep | 走 Unified Runtime + TASK_PRESETS | Chat Completions | 随 mode | no | no | 低–中 |

**API 形态结论：混合，但主路径是 Chat Completions + 自建 abstraction（不是 Responses-first）。**

- Responses API：本审计前 **零调用** `responses.create`。
- Chat Completions：统一客户端 + Agent Core + 少量旁路。
- Wrapper：`getClient()` / `createCompletion*` / `ProviderRouter` / `TASK_PRESETS`。
- Model gateway：`src/lib/ai/model-registry/`（OpenAI 唯一启用；Gemini/Anthropic/Qwen 预留抛错）。

## B. OpenAI API Architecture（仓库真实结构）

```
UI (assistant / supervisor / tender / sales)
  ↓
API Route (src/app/api/ai/*, projects/*, sales/*, …)
  ↓  withAuth / TenantContext / membership / quota precheck
Service / Skill / Workforce
  ↓
Agent Supervisor (LangGraph)        Agent Runtime V2 planner/verifier
  ↓ callSupervisorCompletion          ↓ createCompletion
Agent Core engine (function-calling loop)
  ↓ runAgent / runAgentStream
Unified Model Runtime (src/lib/ai/client.ts)
  ↓ getClient() 单例 OpenAI SDK
Model Registry / ProviderRouter / TASK_PRESETS
  ↓
OpenAI Chat Completions  （GPT-6 + tools 时改走 Responses）
  ↓
Tools: ToolRegistry → pre-execute-guard → canInvokeTool → approval-gate
Memory: user-memory / corporate-memory accessClass + org isolation
```

旁路（不经 `client.ts`，本轮不强制重构）：

1. `src/app/api/sales/cockpit/weekly-report/route.ts`
2. `src/lib/sales/ai-quote-parser.ts`（chat + whisper）
3. TTS / Transcribe fetch
4. 部分 vision / image edit 直连

## C. Workload Classification

### Tier A — GPT-6 Astra Recommended（Phase 1 才打开 flag）

| Workflow | 理由 |
|---|---|
| Supervisor planner / observer / repair | 多步编排、工具仲裁、失败修复 |
| Runtime V2 Planner | FDE Observe→Plan |
| Tender understanding V2 | 长上下文证据接地、跨窗口综合 |
| Market intelligence research | 深度研究 + 已有主备超时 |
| Tender-analysis skill | 高价值标书交付物 |

建议：`gpt-6-astra` + `reasoning: high`。禁止默认 `max`。

### Tier B — GPT-6 Astra Medium（Phase 2，需 workflow allowlist）

- Runtime V2 verifier / coder 执行环
- 报价/方案策略（非简单改写）
- 供应商**推理层**（能力拟合、本地执行、贸易替代）— **不得进入 M1 score-contract**
- Bid qualification 中需要跨条款推理的步骤

建议：`reasoning: medium|high`，由 policy 按角色给出。

### Tier C — 继续低成本模型

标题、翻译、润色、短摘要、metadata、简单分类、caption、language-assist、conversation compressor、secretary briefing、weekly report、供应商 **classifier 标签**。

除非 benchmark 证明收益，否则不升级。

### Tier D — Deterministic / No LLM

- Supplier Intelligence M1：`score-contract` 测试明确禁止 `createCompletion`
- Discovery adapters / query plan / noise host filter
- Permission / org scoping / `canInvokeTool`
- Tender evidence verifier、状态机、排序过滤、regex 抽取
- Complexity router（Supervisor 规则路由）
- Work-order 映射、报价计算引擎

**不得因为 GPT-6 上下文变大而把这些逻辑改成模型调用。**

## D. Responses API Review

| 路径 | 本轮决策 |
|---|---|
| 无 tools 的 `createCompletion` / 招标 V2 / Supervisor 文本规划 | 保持 Chat Completions（官方允许 Astra 基本请求） |
| Agent Core / OpenAIProvider **有 tools** | GPT-6 时改 `responses.create`，映射回 Chat 形状 |
| 稳定旁路（周报、报价解析、TTS） | 不重构 |

## E. Parameter Compatibility

GPT-5.6 现状：

- `isReasoningModel` 仅匹配 `gpt-5.6` / `o*`
- **有 function tools 时 `reasoning_effort: "none"`** — 对 Astra 是 HTTP 400
- 推理模型去掉 `temperature`

GPT-6 Astra 官方约束：

- 不支持 `none`；档位 `low|medium|high|xhigh|max`
- 去掉 `temperature` / `top_p` / `logprobs`
- Tool calling **必须** Responses API

已在 `buildTuningParams` + `sanitizeReasoningEffort` 隔离，避免把 5.6 配置复制给 6。

## F. Context Strategy（审计标记）

| 来源 | 处置 |
|---|---|
| 当前任务指令、页面 context、完成标准 | **Keep** |
| Supervisor 计划、失败步骤、工具仲裁结果 | **Keep** |
| 招标证据窗口 / retrieved docs | **Retrieve**（V2 已分窗；禁止整包塞入） |
| 会话历史、旧工具结果 | **Compress**（已有 compressor / conversation summary） |
| 重复政策、过期记忆、越权 memory | **Remove** |
| Corporate memory | **Retrieve** + access-class + org isolation；GPT-6 **不得**直读越权数据 |

GPT-6 1.05M 窗口不是无限塞数据的许可。长上下文溢价（>272k input）会把整单翻倍计价。

## G. Tool Calling

已有（保持）：

- Schema：OpenAI function tools via `registry.toOpenAITools`
- 授权：`canInvokeTool` + membership + `maxRisk`（Mention Gateway 天花板 `l0_read`）
- 用户可控 ID：`scopeGuard` / pre-execute-guard
- 取消：`AbortSignal` 传到上游
- 超时：每轮 + 总超时
- 审批：高风险工具 server-side adjudication

本轮补强（仅 GPT-6 路径显式）：

- 超大 tool result 截断（24k chars）
- Astra 禁止 `reasoning_effort: none`
- 有 tools 时走 Responses

## H. Observability / Cost

已有，复用，不新建第二套日志：

- `recordAiCall` → `logger.info("ai.call")` → `AiUsageLedger`
- Supervisor `fallbackUsed` / `actualModel`
- Agent runtime model lifecycle events

本轮扩展字段（仍走同一 logger/ledger）：`workflow`、`reasoningEffort`、`cachedInputTokens`、`retryCount`、`toolCalls`。禁止记录 API key 与客户原文。

定价表补 `gpt-6-astra` $10 / $50 per 1M（standard）。账本 `pricingVersion` = `openai-usd-2026-09-gpt6-v1`。

## I. Guardrails already present

| 系统 | 上限 |
|---|---|
| Agent Core | max tool rounds 5；单轮 30s；总计 90s |
| Supervisor | maxSteps 5；maxReplans 2；maxSkillCalls 6；120s |
| Runtime V2 | maxSteps 8；maxToolCalls 12；maxRepairs 2 |
| Market research | 主备超时卡在 Vercel 300s 内 |
| Tender V2 | transient 1 次；structured 有界重试 |

Policy 层 `MODEL_GUARDRAILS` 作为 GPT-6 新路径默认值，**不删除**上述现网限制。

## J. Fallback（现网，不得删除）

- Supervisor：模型 403/404/timeout/429 → 一次 fallback 到 Chat
- Market intelligence：主模型失败 → reasoning 备用
- Intelligence report：primary → fallback 模型 + timeout
- Tender V2：`TRANSIENT_MODEL_ERROR` 有界重试；空结果不靠重试「猜一个」

GPT-6 增加：同模型对 429/5xx **再试一次**，然后走原 fallback。400/401/schema **不重试**。

## K. Feature flags（现网可复用模式）

已有：`AI_OPERATOR_*`、`AGENT_SUPERVISOR_*`、`AGENT_RUNTIME_V2_*`（fail-closed + org/user/role allowlist）。

GPT-6 新开关：`ENABLE_GPT6_ASTRA`（默认 0）。生产紧急回滚 = 关掉该变量，不必改代码、不必改 schema。

## L. Security

- 不降低 authorization / org scoping
- Memory / supplier-intel / mention-gateway 权限仍在服务端
- 模型不能自行决定工具权限
- 无 schema 变更

## M. 已知风险

1. Astra 比 Sol 约 2.5× list price；若误开 `OPENAI_CHAT_MODEL=gpt-6-astra` 会变成全局替换。Policy kill switch **不**拦截 Chat Registry 全局 env——运维规范禁止那样配。
2. Agent Core 流式 + GPT-6 tools：Responses 结果伪装成单块 stream，首 token 体验变差（仅 flag 打开且模型为 Astra 时）。
3. 真实 live benchmark 未在 CI 跑（成本/密钥）。
4. Frozen 目录内只改了既有 `model-resolve.ts` / `tender-analysis.ts` / `openai-provider.ts`，未新增 frozen 文件。
