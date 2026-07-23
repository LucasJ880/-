# Phase 3B-A — Preview 人工验收截图

Preview：`https://git-feature-phase-3b-ai-task-loop-lucas-9039s-projects.vercel.app`  
Thread：`cmrxu4aem0003jy04kzfs5su8`（Sunny）  
验收日：2026-07-23

截图均为脱敏测试数据（`preview-a@example.test` 等）。

## Commit 5 / 5A

| 文件 | 验收点 | 结果 |
|---|---|---|
| `daily-brief-real.png` | 「给我今日业务简报」→ 真实简报 + Run completed | **PASS** |
| `followup-calendar-pending.png` | 「周五提醒我跟进…」→ 日历预览；确认前无新事件 | **PASS**（确认前 count=8） |
| `followup-sales-pending.png` | 「把…商机下次跟进改到周五」→ 识别客户 + sales 预览 | **PASS**（确认后 `nextFollowupAt` 更新；Run completed） |
| `email-draft-pending.png` | 「生产周期是 8 周」→ 正文含 8 周；Gmail 草稿待确认 | **PASS** |
| `email-clarify-no-purpose.png` | 「帮我发送邮件给客户」→ 追问目的；无空泛草稿 | **PASS** |
| `multiple-runs-refresh.png` | 连续多场景刷新 → Run 卡不串 | **PASS** |

## Commit 6

| 文件 | 验收点 | 结果 |
|---|---|---|
| `run-completed-after-approval.png` | 确认日历 Action → Run completed；日历 +1（8→9）；重复确认幂等 | **PASS**（日历路径；重复 `decision=approve` → 200/executed，count 仍为 9） |
| `run-cancelled-after-reject.png` | 取消唯一 Gmail Action → Run `cancelled` / `all_actions_rejected` | **PASS** |
| `run-partial-completion.png` | 双 Action：确认商机、取消日历 → `partially_executed`；日历不增 | **PASS**（calendar count 仍为 9） |
| `run-partial-pending-dual.png` | 双卡待确认中间态（`followup_actions_2`） | **PASS**（证据） |
| `run-failed-manual-review.png` | 失败且不可自动重试 | **NOT REPRODUCIBLE IN PREVIEW**（未安全制造 Prepare/外部失败） |
| `run-safe-retry.png` | Prepare 失败后安全重试 | **NOT REPRODUCIBLE IN PREVIEW**（同上；保留自动化并发/幂等测试） |

| `mobile-375px.png` | 375×812 下确认/取消/发送触控高度 ≥44px | **PASS**（确认/取消/发送 h=44） |

跨 org（梦馨）→ 待补（账号 `canSelfSwitchOrg=false`，需 DB 切 `activeOrgId`）。

## 运维备注（非代码缺陷）

1. 测试账号 `PLATFORM_SUPPORT` + `canSelfSwitchOrg=false`，UI 无法自助切公司；验收时 DB 固定 `activeOrgId=Sunny`。
2. 预验收商机 stage 须落在 `ACTIVE_STAGES`（`new_lead`…`negotiation`）；初始 `following` 会被判为无活跃商机（数据问题，已修正为 `negotiation`/`quoted`）。
3. Sunny 配额曾 hardLimit=0，临时上调后简报可跑。

**状态**：Commit 5 全过；Commit 6 核心收敛 + 375px 已过；失败/安全重试标 NOT REPRODUCIBLE；跨 org 待补。截图未 commit。
