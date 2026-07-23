# Phase 3B-A — Preview 人工验收截图

Preview：`https://git-feature-phase-3b-ai-task-loop-lucas-9039s-projects.vercel.app`  
Thread：`cmrxu4aem0003jy04kzfs5su8`（Sunny `cmrtcnz1c0001sbjcy87hemyl`）  
验收日：2026-07-23

截图均为脱敏测试数据（`preview-a@example.test` 等），不含真实客户邮箱/电话/地址/Token/敏感报价。

## Commit 5 / 5A

| 文件 | 验收点 | 结果 |
|---|---|---|
| `daily-brief-real.png` | 「给我今日业务简报」→ 真实简报 + Run completed | **PASS** |
| `followup-calendar-pending.png` | 「周五提醒我跟进…」→ 日历预览；确认前无新事件 | **PASS**（确认前 count=8） |
| `followup-sales-pending.png` | 「把…商机下次跟进改到周五」→ 识别客户 + sales 预览 | **PASS** |
| `email-draft-pending.png` | 「生产周期是 8 周」→ 正文含 8 周；Gmail 草稿待确认 | **PASS** |
| `email-clarify-no-purpose.png` | 「帮我发送邮件给客户」→ 追问目的；无空泛草稿 | **PASS** |
| `multiple-runs-refresh.png` | 连续多场景刷新 → Run 卡不串 | **PASS** |

## Commit 6

| 文件 | 验收点 | 结果 |
|---|---|---|
| `run-completed-after-approval.png` | 确认日历 → completed；日历 8→9；重复确认幂等 | **PASS** |
| `run-cancelled-after-reject.png` | 取消唯一 Gmail Action → cancelled | **PASS** |
| `run-partial-completion.png` | 双 Action：确认一项取消一项 → `partially_executed` | **PASS** |
| `run-partial-pending-dual.png` | 双卡待确认中间态 | **PASS** |
| `gmail-draft-pending-final.png` | Gmail 终验：确认前 awaiting；正文含 8 周 | **PASS**（pending 阶段） |
| `run-failed-manual-review.png` | Gmail 确认执行失败 → failed + 不可自动重试 | **PASS**（环境 OAuth scope 阻断外部草稿；产品 fail-closed 正确） |
| `run-safe-retry.png` | Prepare 失败后安全重试 | **NOT REPRODUCIBLE IN PREVIEW** |
| `mobile-375px.png` | 375×812 触控高度 ≥44px | **PASS** |

## 跨公司隔离

| 文件 | 验收点 | 结果 |
|---|---|---|
| `cross-company-thread-404.png` | 梦馨下访问 Sunny Thread → 不可见/404 | **PASS** |
| `cross-company-pending-action-denied.png` | 梦馨下 approve Sunny PA → 403 `ORG_CONTEXT_MISMATCH` | **PASS** |
| `cross-company-return-to-sunny.png` | 恢复 Sunny 后原 Thread/Run/PA 可见且状态未变 | **PASS** |

## Preview 11

**NOT REPRODUCIBLE IN PREVIEW**

未为了制造 Prepare 失败而破坏共享 Preview 数据。安全重试由自动化测试覆盖：

- 原子占位
- 并发仅创建一个 Run
- retry attempt 上限
- manual review 边界

本项不阻断合入。

## Gmail Executor 终验说明

| 检查项 | 结果 |
|---|---|
| 确认前 Run = awaiting_approval；无 `ai_email_draft_create` 审计 | PASS |
| 确认后外部 Gmail 草稿新增 | **BLOCKED**：`Request had insufficient authentication scopes`（账号仅有 `gmail.send`，缺少 `gmail.compose`/`gmail.modify`） |
| 邮件未发送 | PASS（0 发送审计；fail-closed） |
| 重复确认 | PASS（`duplicate: true`，status 仍 `failed`，无二次副作用） |
| Run / actionSummary | `failed`；`executed=0` / `failed=1`；`safeToRetry=false`；文案「请检查后重新生成」 |

`gmail-draft-completed.png` 未产出（外部草稿未创建成功）。阻塞属 OAuth 配置/重授权运维项，不在本 PR 功能代码范围。

## 运维备注

1. 跨 org 验收：仅临时改 `activeOrgId`（Sunny↔梦馨 `cmrv37moo0001sbskqeknr5km`），未改 `orgAccessMode` / `canSelfSwitchOrg`，已恢复 Sunny。
2. 预验收商机 stage 须在 `ACTIVE_STAGES` 内。

**状态**：Preview 主路径 + 跨公司隔离已完成；Gmail 外部草稿成功路径被 OAuth scope 阻断；Preview 11 保持 NOT REPRODUCIBLE。
