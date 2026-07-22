# 青砚导航与信息架构审计

分支：`feature/navigation-information-architecture-redesign`  
基线：main @ `9931ef9`

## 1. 当前侧栏结构（问题态）

| 分组（i18n） | 实际中文 | 入口 | 问题 |
|---|---|---|---|
| nav_group_workspace | 经营 | `/` `/notifications` `/tasks` | 名称像经营，实为日常工作 |
| nav_group_sales | 收入增长 | `/sales/*` 等 | 业务模块与「增长」语义混淆 |
| nav_group_trade | 海外增长 | `/trade/*` `/product-content` | 产品内容误挂外贸 |
| nav_group_tender | 招投标 | `/projects` `/suppliers`… | OK 属业务，但与经营中心平级混乱 |
| nav_group_collaboration | 协同与知识 | `/organizations` `/knowledge` | 企业管理与知识混装 |
| nav_group_intelligence | 智能助手 | assistant / wechat / memory / agent-trace / ai-activity / **capabilities/runs** / **approvals** / reports | **中台入口埋在智能助手底部** |
| nav_group_operations | **品牌增长** | **经营中心** + 收件箱 + 发布 + 市场情报 | **经营中心被归入品牌增长** |
| nav_group_admin | 组织治理 | `/admin/*` + blinds | **平台运营与企业管理混淆** |
| 系统 | 帮助 / 设置 | `/help` `/settings` | OK |

## 2. 错误归类（必须修正）

| 入口 | 现状 | 应属 |
|---|---|---|
| `/operations/center` | 品牌增长分组 | **企业经营** 一级 |
| `/capabilities/runs` `/approvals` | 智能助手底部 | **企业能力中台** 一级 |
| `/agent-trace` `/ai-activity` | 智能助手 | 能力中台相关 / 可由运行中心承接 |
| `/product-content` | 外贸分组 | **品牌增长** |
| `/operations` 发布日历 | 与经营中心同组 | **品牌增长** |
| `/operations/intelligence` | 品牌增长组 | **品牌增长**（市场情报） |
| `/admin/*` | 「组织治理」 | **平台运营**（非企业管理） |
| `/organizations` | 协同 | **企业管理** |
| `/service-inbox` | 品牌增长组 | **工作台** 收件箱 |

## 3. 重复 / 冲突

- `/blinds-orders` 同时出现在销售与 admin
- `nav_ai_assistant` 同时用于 `/assistant` 与 `/trade/chat`
- 「经营」分组标题与「经营中心」语义冲突
- 英文：`nav_group_operations` = Brand Growth，中文却装经营中心

## 4. 权限与动态模块来源

| 来源 | 现状 |
|---|---|
| `user.role`（平台角色） | 侧栏主过滤（sales/trade/admin） |
| `modulesJson` | `navHrefAllowedByModules` |
| `orgRole`（OrganizationMember） | **侧栏几乎未用** |
| Workspace role | **导航未用** |
| Industry Pack | 间接通过 modules，未直接驱动导航 |
| feature flags | 无统一导航层 |

## 5. 处置建议

| 动作 | 入口 |
|---|---|
| **提升为一级** | 经营中心、企业能力中台、品牌增长、企业管理 |
| **移出品牌增长** | 经营中心、能力 runs/approvals、agent-trace、ai-activity |
| **移入工作台** | 首页、任务、通知/待办、收件箱、AI 助手 |
| **移入业务运营** | sales / trade / projects（按 modulesJson） |
| **移入品牌增长** | `/operations/growth`、发布、市场情报、产品内容、品牌档案 |
| **移入企业管理** | organizations、settings、知识（组织级） |
| **保留平台专属** | `/admin/*`（仅平台角色，不叫企业管理） |
| **新增占位** | `/capabilities` 总览、catalog、health；governance 轻量页（不实现 3A-4 配额） |
| **侧栏降级/移除** | 重复 blinds admin；trade/chat 与全局 assistant 二选一展示 |

## 6. 目标产品层级

```text
工作台 → 企业经营 → 企业能力中台 → 业务运营 → 品牌增长 → 企业管理
（平台运营：仅平台管理员，独立弱化分组）
```
