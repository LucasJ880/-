# Qyane GPT-6 Astra — Rollout Plan

## 铁律

1. 默认 **关闭**。现网继续 `gpt-5.6-sol` / `gpt-5.6-terra`。
2. 紧急回滚：`ENABLE_GPT6_ASTRA=0`（无需 deploy 改模型常量、无需 schema）。
3. 禁止把 `OPENAI_CHAT_MODEL` 改成 `gpt-6-astra`（那是全局替换）。
4. 本 PR 保持 Draft，不 merge 即不视为生产启用。

## Phase 0 — 本 PR（已完成代码）

- [x] 审计文档
- [x] Model Policy + kill switch
- [x] Astra 参数隔离（无 `none` / 无 temperature）
- [x] Responses 适配（仅 GPT-6 + tools）
- [x] Phase 1 接线（supervisor / planner / researcher）
- [x] 失败分类与有界 retry
- [x] 复用 `recordAiCall` 成本字段
- [x] 单元测试 + failure tests + benchmark harness
- [ ] Live benchmark（隔离环境，见 Benchmark 文档）
- [ ] Final Review

## Phase 1 — Preview / 单一组织

配置示例（Preview，非 Production）：

```
ENABLE_GPT6_ASTRA=1
ENABLE_GPT6_ASTRA_ORG_ALLOWLIST=<preview-org-id>
ENABLE_GPT6_ASTRA_WORKFLOWS=supervisor,planner,researcher
ENABLE_GPT6_ASTRA_ROLLOUT_PCT=0
```

观察：

- Supervisor 计划是否更稳、是否更多澄清问题（Astra 更爱提问 — 必要时补 follow-through prompt）
- Tender V2 UNKNOWN 纪律、schema pass
- 延迟与 429
- 账本 `model=gpt-6-astra` 成本

回滚：去掉 allowlist 或 `ENABLE_GPT6_ASTRA=0`。

## Phase 2 — Coding / 采购推理 / 方案

仅当 Phase 1 指标不差于当前模型：

```
ENABLE_GPT6_ASTRA_WORKFLOWS=supervisor,planner,researcher,coder,supplier_intelligence,proposal
```

仍然：

- Supplier Intelligence **score-contract 保持确定性**
- 招标证据门不放宽
- coder 走 Agent Core 时必须走 Responses（已接线）

## Phase 3 — 其余 workflow

用 40 条 benchmark 决定。默认 **不** 升级：

- chat / fast / summarizer / classifier
- language-assist、caption、周报旁路
- verifier 不得在证据不足时升 PASS（现网已有守卫）

## 监控

Vercel / 应用日志事件：`ai.call` 字段 `model` `workflow` `reasoningEffort` `cachedInputTokens` `retryCount` `elapsedMs`。

告警建议（运维侧，本 PR 不新建系统）：

- `gpt-6-astra` 失败率 > 基线 + 10pt
- 单 org 日成本异常跳升
- 400 含 `temperature` / `none`（应已被 compat 挡住）

## Rollback 矩阵

| 症状 | 动作 |
|---|---|
| 任意生产事故 | `ENABLE_GPT6_ASTRA=0` |
| 单角色质量差 | `OPENAI_MODEL_SUPERVISOR=gpt-5.6-terra` 等 |
| 单组织问题 | 从 ORG_ALLOWLIST 移除 |
| Chat 被误配成 Astra | 恢复 `OPENAI_CHAT_MODEL=gpt-5.6-sol` |

Fallback 链（代码内）：Astra → 同模型 1 retry → 原 Chat/terra fallback → 调用方降级。

## 安全签字

- [ ] 无 schema 变更
- [ ] 无权限放宽
- [ ] 工具仍服务端授权
- [ ] Memory access-class 仍过滤
- [ ] 日志无客户原文 / 无 API key
