# Phase A：账号矩阵运营中心 — 代码审查报告

**日期：** 2026-07-29  
**仓库：** `青砚-visualizer-templates`  
**范围：** 只读审查；**未修改任何代码 / 未执行 migration**  
**结论：** `PASS`（可进入 Phase B 设计与实现）

---

## 1. 本阶段结论

```text
PASS
```

现有运营矩阵具备可复用的账号台账、内容日历、视频资产、发布任务、Postiz/PostFlow 通道与增长中心模型。  
本轮指令目标（Playbook / 继承上下文 / 审批状态机 / 安全熔断 / Inbox 底座）与现有架构**兼容**，应以**增量扩展**实现，禁止重建第二套发布或 CRM 系统。

---

## 2. 当前运营矩阵架构

```text
BrandProfile (org 品牌语料)
        │
MatrixAccount (groupName + personaNotes + tier + publishChannel)
        │
ContentPlanItem (按 groupName 选题) ──dispatch──► VideoAsset
        │                                              │
        └──────────── fanoutAndDispatch ───────────────┘
                              │
                    generateCaptionVariants(personaNotes)
                              │
                         checkContentRules
                              │
                         PublishJob (每账号一条)
                              │
              ┌───────────────┼───────────────┐
           postiz          postflow         manual
         (API 派发)      (worker claim)     (无自动派发)
```

并行存在、**尚未打通到矩阵发布**：

```text
MarketingBrandProfile / MarketingPlan / MarketingCampaign
  → MarketingContentAsset / MarketingPublication（可选关联 PublishJob）
  → MarketingLeadAttribution（活动 → 销售机会）
```

核心库：

| 文件 | 职责 |
|---|---|
| `src/lib/operations/service.ts` | fanout、审核通过派发 |
| `src/lib/operations/content-plan.ts` | AI 选题 |
| `src/lib/operations/caption-variants.ts` | 每账号文案变体 |
| `src/lib/operations/content-rules.ts` | 确定性规则 pass/review/block |
| `src/lib/operations/ai-review.ts` | 品牌 AI 复核（只升 review） |
| `src/lib/operations/postiz.ts` | Postiz API 客户端 |
| `src/lib/operations/publishers.ts` | 通道派发适配 |
| `src/lib/operations/brand-context.ts` | 品牌上下文 |

---

## 3. 已有页面与 API

### 页面（`src/app/(main)/operations/`）

| 路由 | 用途 |
|---|---|
| `/operations` | 内容运营入口 |
| `/operations/matrix` | 矩阵账号登记 / Postiz 导入 / tier |
| `/operations/calendar` | 内容日历 |
| `/operations/assets` | 视频资产 |
| `/operations/review` | 发布审核队列 |
| `/operations/brand` | BrandProfile |
| `/operations/dashboard` | 矩阵看板 |
| `/operations/intelligence` | 市场情报 |
| `/operations/growth/*` | 增长中心（品牌事实、计划、活动、指标等） |
| `/operations/center` | 企业经营入口（另一条管理线） |

**缺失（本轮需补）：**  
`/operations/matrix/[accountId]`、`/operations/matrix/[accountId]/playbook`、Social Inbox 页面。

### API（`src/app/api/operations/`，26 个 route）

关键矩阵相关：

| Method | Route | 用途 |
|---|---|---|
| GET/POST | `/api/operations/matrix-accounts` | 账号列表/创建 |
| PATCH/DELETE | `/api/operations/matrix-accounts/[id]` | 更新/删除 |
| GET/POST | `/api/operations/postiz/integrations` | Postiz 集成列表/导入 |
| GET/POST | `/api/operations/content-plan` | 日历 |
| POST | `/api/operations/content-plan/generate` | AI 选题 |
| PATCH/DELETE | `/api/operations/content-plan/[id]` | 审批/编辑 |
| POST | `/api/operations/content-plan/[id]/dispatch` | 扇出 |
| GET/POST | `/api/operations/video-assets` | 资产 |
| POST | `/api/operations/video-assets/[id]/fanout` | 直接扇出 |
| GET | `/api/operations/publish-jobs` | 任务列表 |
| POST | `/api/operations/publish-jobs/[id]/approve` | 审核通过 |
| POST | `/api/operations/publish-jobs/[id]/reject` | 驳回 |
| POST | `/api/operations/worker/claim\|report` | PostFlow worker |
| GET/PUT | `/api/operations/brand-profile` | 品牌语料 |

---

## 4. 现有 Postiz 连接状态

| 项 | 现状 |
|---|---|
| 客户端 | `src/lib/operations/postiz.ts` |
| 环境变量 | `POSTIZ_API_URL` / `POSTIZ_API_KEY`；前端外链 `NEXT_PUBLIC_POSTIZ_URL` |
| 导入 | 仅 `facebook` / `instagram` 标为可导入 |
| 发布 | `upload-from-url` → `createPost`；成功后本地 job → `queued` |
| 缺口 | **无** Postiz → `published` 回写；**无** 显式幂等键字段；**无** 平台能力注册表；**无** OAuth 健康检查模型 |
| 合规 | Postiz 作为外部通道调用，**未**将 AGPL 源码并入主仓（应继续保持） |

国内平台：`publishChannel = postflow | manual`；不得宣传为稳定官方 API。

---

## 5. 内容日历与发布状态

### ContentPlanItem.status

`proposed` → `approved` → `dispatched` / `skipped`

### PublishJob.status（当前）

```text
draft | review | blocked | queued | processing | published | failed | canceled
```

现有流转要点：

- 规则 `block` → `blocked`
- 规则 `review` / premium 抽检 / AI flag → `review`
- 规则 pass 且未抽检 → 创建后可直接 `dispatch` → `queued`
- 人工 approve → `queued`/`failed`
- PostFlow：`queued` → `processing` → `published`/`failed`
- Postiz：成功后停在 `queued`（**状态语义不完整**）

与指令推荐状态机对比：**缺**  
`ai_reviewed` / `needs_revision` / `pending_human_approval` / `approved` / `paused_by_safety`  
（Phase C 需扩展或映射，避免破坏现有队列语义）

### 分层

- `tier=premium`：100% 进人工审核队列（`sampledForReview`）
- `tier=matrix`：每 20 条抽 1
- 自动发布「管理员显式开启」开关：**不存在**（默认行为接近「低风险可直发」）

### personaNotes 今日用法

- 选题：组内第一条非空 `personaNotes` 作为组 persona
- 文案：每账号传入 `personaNotes`
- **无**结构化 Playbook、版本、审批、继承解析器

---

## 6. 当前权限

| 能力 | 规则 |
|---|---|
| 进入运营导航 | `canAccessOperationsWorkspace`（管理层 / platform `operations` / operations.* 权限） |
| 矩阵写操作（账号、导入、日历写、fanout、审核） | `canManageUsers` = `admin` \| `super_admin` \| `boss` |
| 多数 GET | 登录 + org；不要求 boss |
| PostFlow worker | `POSTFLOW_WORKER_TOKEN` |

**缺口（相对指令）：**

- `operations` 角色可进入口，但**多数写 API 会 403**（需 boss/admin）
- 未区分「运营人员 / 销售人员 / Playbook 批准人 / 解除熔断人」细粒度
- AI PendingAction 审批与矩阵发布审批**未统一**

Phase B/C 需扩展权限，但不得破坏现有 boss/admin 管理路径。

---

## 7. 可直接复用的模型

| 模型 | 复用方式 |
|---|---|
| `MatrixAccount` | 扩展字段（健康/熔断）；1:1 Playbook |
| `BrandProfile` | 品牌级事实层 |
| `MarketingBrandProfile` | 增长侧企业事实（解析优先级低于/并列需在 `resolveEffectiveAccountContext` 中明确） |
| `ContentPlanItem` | 选题；扩展 mode / campaign 关联 |
| `VideoAsset` | 不变 |
| `PublishJob` | 扩展状态 + 快照 JSON + 审计；**不新建第二套发布任务** |
| `MarketingPlan` / `MarketingCampaign` | 活动上下文输入；不复制 |
| `MarketingContentAsset` / `MarketingPublication` | 可选关联层 |
| `MarketingLeadAttribution` | **扩展**归因字段，不建第二套归因系统 |
| `PendingAction` | Playbook AI 草稿 / 精品号批准提议 |
| 销售 CRM（Customer / Opportunity / Quote 等） | Inbox 转换目标 |
| `content-rules` / `caption-variants` / Postiz client | 增强而非替换 |

---

## 8. 可能冲突的命名

| 候选名 | 冲突 | 建议 |
|---|---|---|
| `Playbook` | 已有 `SalesPlaybook`、`RolePlaybook` | 使用 **`MatrixAccountPlaybook`** / **`MatrixGroupPlaybook`** |
| `AccountGroup` | 不存在实体；现用 `groupName` 字符串 | Phase B：新增 `MatrixAccountGroup` + 可选迁移 `groupName`→`groupId`，或先保留 `groupName` 并加 `MatrixGroupPlaybook.groupName` |
| `SocialConversation` / `SocialMessage` | **不存在** | 可按指令新增 |
| `PublishJobAuditLog` | **不存在** | 可新增；注意与通用 `AuditLog` 并存（矩阵专用索引更清晰） |

`personaNotes`：**保留**，不批量覆盖；Playbook 生效后作为降级摘要或同步只读镜像（Phase B 定策略）。

---

## 9. 数据库迁移风险

| 项 | 说明 |
|---|---|
| Active 链 | 仅 3 条：greenfield baseline + Phase4 workDomain + Phase5 handoff |
| Legacy | `prisma/migrations_legacy_pre_greenfield_baseline/` 不执行 |
| 生产 | Phase 5D 已成功 deploy Phase4/5；**后续增量必须新 migration，禁止改已部署 SQL** |
| 本轮约束 | **不执行生产 migrate**，除非单独明确批准 |
| 兼容 | 新表/新字段尽量 nullable 或安全默认；旧账号无 Playbook 仍可打开矩阵页 |
| 空库重放 | 新 migration 必须可在 greenfield 链上从空库顺序执行 |

建议 migration 命名示例（Phase B 起）：

```text
YYYYMMDDHHMMSS_matrix_account_playbook
YYYYMMDDHHMMSS_publish_job_safety_audit
YYYYMMDDHHMMSS_social_inbox_base
```

---

## 10. 本次预计新增与修改文件（Phase B–E 预估）

### Phase B（Playbook）

**新增（预计）**

- `prisma/migrations/..._matrix_account_playbook/migration.sql`
- `prisma/schema.prisma`（`MatrixAccountPlaybook`，可选 `MatrixGroupPlaybook`）
- `src/lib/operations/playbook/*`（CRUD、校验、版本、resolveEffectiveAccountContext）
- `src/app/api/operations/matrix-accounts/[id]/playbook/route.ts`（及 approve/reject/versions）
- `src/app/(main)/operations/matrix/[accountId]/page.tsx`
- `src/app/(main)/operations/matrix/[accountId]/playbook/page.tsx`
- `src/components/operations/playbook-*.tsx`
- AI skill：`marketing-account-playbook`（或 `src/lib/operations/playbook/ai-draft.ts`）
- 测试：`src/lib/operations/__tests__/playbook-*.test.ts`

**修改（预计）**

- `src/app/(main)/operations/matrix/page.tsx`（完整度/审批列、入口）
- `src/lib/navigation/registry.ts`（如需子导航）
- `src/lib/rbac/*`（Playbook 批准权限，最小增量）

### Phase C

- 扩展 `PublishJob` 字段与状态；`content-plan.ts` / `caption-variants.ts` / `service.ts`
- `evaluatePublishSafety`；审批状态机模块
- `PublishJobAuditLog`

### Phase D

- `MatrixAccount` 健康/熔断字段；Postiz 幂等/错误映射/能力表
- publishers / postiz 增强

### Phase E

- `SocialConversation` / `SocialMessage`
- Inbox API + 简易页面 + CRM 转换 + 归因扩展

---

## 11. 本轮明确不做 / 延后

| 项 | 原因 |
|---|---|
| 重写运营模块 / 第二套 PublishJob / 第二套 CRM / 第二套 Campaign | 指令禁止 |
| Fork/合并 Postiz、TryPost、Posthive 源码 | AGPL / 边界 |
| 自建 Instagram/Facebook 发布引擎 | Postiz 负责 |
| 浏览器自动化宣称官方能力 | 仅保留 postflow/manual |
| 一次性接通全部平台评论/私信 | Phase E 只做底座 |
| 生产 migration（未经批准） | 发布安全 |
| 真实社媒发布 / 真实客户私信测试 | 除非指定测试号 |
| 完整 MMM / 广告预算控制 | 超出本轮 |
| 将 `groupName` 强行破坏性迁移为强制 FK（若做分组表，需兼容旧字符串） | 风险控制 |

---

## 12. Phase B 实施方案（确认后执行）

### 12.1 数据

1. 新增 `MatrixAccountPlaybook`（1:1 `accountId`，含 version/status/validation/JSON 分区字段）  
2. 新增 `MatrixGroupPlaybook`（`orgId + groupName` 唯一，或后续再引入 Group 实体）  
3. `MatrixAccount` **暂不删除** `personaNotes`；可选增加 `playbookId` 冗余或仅 relation  
4. Playbook 状态：`draft` / `pending_approval` / `approved` / `rejected`（与指令 validation 对齐）

### 12.2 解析器

```ts
resolveEffectiveAccountContext({ orgId, accountId, campaignId?, contentPlanItemId? })
```

优先级：

```text
任务明确输入 > 单账号 Playbook > 账号组策略 > BrandProfile > MarketingBrandProfile
```

输出含 `sourceTrace`（禁止静默覆盖）。

### 12.3 API / UI

- Playbook CRUD + 完整度 + 提交审批 + 批准/驳回 + 新版本  
- AI 仅产草稿 / PendingAction，**不得**覆盖已批准版本  
- 矩阵列表展示完整度、审批状态（成功率/熔断列可先占位，Phase D 填实）

### 12.4 测试

组织隔离、继承/覆盖、未批准限制（为 Phase C 自动发布预埋）、AI 草稿不自动批准。

---

## 13. 风险与依赖（不隐藏）

| 风险 | 说明 |
|---|---|
| Postiz 状态回写缺失 | 影响「发布成功率 / 熔断」准确性，Phase D 必须补 |
| 权限过粗 | operations 角色写能力不足；需产品确认是否放宽 |
| 双品牌表 | BrandProfile vs MarketingBrandProfile 优先级必须在解析器写死并单测 |
| 状态机扩展 | 新旧 PublishJob.status 需兼容映射，避免卡死现有 review 队列 |
| 小红书 | 仍依赖 postflow/manual，能力表只能标 `testing`/`manual` |
| 环境变量 | Postiz/PostFlow 需人工配置；不得伪造「已连接」 |
| 生产 migrate | Phase B 可提交 migration 文件，**默认不部署生产** |

---

## 14. 下一阶段建议

**请确认本报告后，进入 Phase B：Account Playbook**（模型 + migration 文件 + API + UI + 解析器 + 测试）。  

Phase B **不包含**：完整发布状态机重写、熔断、Social Inbox（属 C/D/E）。

---

## 15. 审查文件索引（只读）

- `prisma/schema.prisma`（Matrix* / Marketing* / PendingAction）
- `prisma/migrations/*`（active 3 链）
- `src/lib/operations/*`
- `src/app/(main)/operations/**`
- `src/app/api/operations/**`
- `src/lib/rbac/workspace-policy.ts` / `roles.ts`
- `docs/PHASE5_PRODUCTION_MIGRATION_RUNBOOK.md`（生产 migrate 约束背景）
