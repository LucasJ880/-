# Spec Delta

## MODIFIED Requirements

### Requirement: 四个询价通知类型
系统 SHALL 把以下四个通知类型登记进通知类型注册表，并在通知设置页与邮件里统一使用这些名称：

| 类型 | 名称 |
|---|---|
| `rfq_quote_received` | 供应商报价了 |
| `rfq_reply_received` | 供应商回信（无报价） |
| `rfq_chase_ready` | 催单待批 |
| `rfq_no_response` | 供应商未响应 |

这四个类型 SHALL 按 `notifications/preferences`「新增类型对老用户默认开启」判定开关：本次上线前保存过类型清单的用户一律视为开启；上线后在设置页关掉并保存的，视为关闭。

#### Scenario: 设置页列出新类型
- **WHEN** 招投标中心对其放行的用户（如持 `bids` 或 `owner` 岗位）打开通知设置页的类型开关列表（其余用户见 `notifications/type-visibility`）
- **THEN** 列表中出现"供应商报价了""供应商回信（无报价）""催单待批""供应商未响应"四项

#### Scenario: 十月保存过清单的老用户
- **WHEN** 用户 2026-10 保存过类型清单，清单里没有 `rfq_chase_ready`，定时检查为他负责的项目起草了催单
- **THEN** 他收到 `rfq_chase_ready` 通知

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/collab-preferences.test.ts`
- **THEN** 四个类型已登记、名称正确、对上线前保存的清单视为开启的断言全部通过，退出码 0
