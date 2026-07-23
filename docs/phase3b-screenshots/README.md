# Phase 3B-A — Preview 人工验收截图

请在 Vercel Preview（PR #17）完成下列验收后，将**脱敏**截图保存到本目录：

## Commit 5 / 5A

| 文件 | 验收点 |
|---|---|
| `daily-brief-real.png` | 「给我今日业务简报」→ 真实简报 + Run completed |
| `followup-calendar-pending.png` | 「周五提醒我跟进 ABC」→ 日历预览；确认前无日历事件 |
| `followup-sales-pending.png` | 「把 ABC 商机的下次跟进改到周五」→ 识别 ABC + sales 预览 |
| `email-draft-pending.png` | 「帮我回复客户，我们生产周期是 8 周」→ 正文含 8 周；无内部说明 |
| `email-clarify-no-purpose.png` | 「帮我发送邮件给客户」→ 追问目的 |
| `multiple-runs-refresh.png` | 连续两场景刷新 → Run 卡不串 |

## Commit 6

| 文件 | 验收点 |
|---|---|
| `run-completed-after-approval.png` | 确认 Gmail 草稿 → Run completed；Gmail 仅一个草稿 |
| `run-cancelled-after-reject.png` | 取消唯一 Action → Run cancelled |
| `run-partial-completion.png` | 双 Action：确认一项、取消一项 → partially_executed |
| `run-failed-manual-review.png` | 失败且不可自动重试（文案：检查后重新生成） |
| `run-safe-retry.png` | Prepare 失败后安全重试 → 新 Run；旧 Run 保持 failed |

另：手机 375px 下预览/确认/取消/重试按钮可访问（≥44px）。

**状态**：PNG 待 Preview 人工补齐。
