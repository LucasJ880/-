# Phase 2A 交付说明：规则、服务与 Agent 权限收口

## 范围（本轮五项）

1. 折扣与核心规则租户化（版本 / 归属 / 生效）
2. TenantContext 高风险入口铺开 + 开发规范
3. Agent 工具改用 orgRole（`canInvokeTool`）
4. Industry Pack Registry（轻量，禁止静默家纺回退）
5. 禁止静默业务回退

## 数据模型

- `Organization.industryPackId`
- `QuoteDiscountSettings`：每 org 一行（`orgId` unique）+ `version` / `effectiveAt` + 解锁码哈希列
- `OrgBusinessRule`：规则版本库（`quote_margin` / `quote_auto_send` / `project_risk` / `agent_tool_policy` / `quote_discounts` 快照等）
- `AgentApprovalSettings`：增加 `version` / `effectiveAt` / `updatedById`

迁移链（解锁码列）：

1. `20260721190000_phase2a_org_rules_industry_pack` — 创建旧列 `lineDiscountUnlockCode`
2. `20260721210000_rename_line_discount_unlock_hash` — 重命名为 `lineDiscountUnlockCodeHash`

运行时与 Prisma schema 仅使用 `lineDiscountUnlockCodeHash`。Seed 可通过 `ensureBaselineOrgRules` 幂等补齐缺失的平台默认规则（不覆盖管理员已改规则）。

## Industry Pack

Registry：`src/lib/industry-packs/registry.ts`

- `generic_business_v1`
- `window_covering_services_v1`（Sunny）
- `home_textile_trade_v1`（梦馨）

未知 / 未配置：**不**回退家纺。

## 验收对照

| 条件 | 实现要点 |
|------|----------|
| Sunny 改折扣不影响梦馨 | 折扣按 `orgId` 读写 |
| 同一用户两企业不同角色 | `OrganizationMember.role` + `TenantContext.orgRole` |
| 平台管理员无 membership 不能调企业工具 | `canInvokeTool` + Agent 入口 403 |
| 高风险工具经 TenantContext + orgRole | `tool-registry.execute` |
| 未配置 Pack 不回退家纺 | `resolveIndustryPack` / `getIndustryPack` 抛错或 missing |
| Sunny 术语不进梦馨 | Pack 按 org 加载；产品内容 job 禁止默认 home_textile |
| 跨租户测试 | `src/lib/tenancy/__tests__/phase2a-*.test.ts` |

## 部署

```bash
npx prisma migrate deploy
npm run seed:org:sunny-home-deco
npm run seed:org:mengxin-home-textile
```

全新空库需支持 `vector` 扩展（Neon 默认具备）。本地无 pgvector 时，至少验收解锁码迁移链：

`20260721180000` → `20260721190000`（旧列）→ `20260721210000`（Hash 列）。

### 解锁码安全

- 字段：`lineDiscountUnlockCodeHash`（bcrypt）；`depositOverrideCode` 亦存哈希（注释标明）
- API / 审计 / 错误信息**永不**返回明文或哈希，仅 `hasLineDiscountUnlockCode` 等布尔
- Seed：
  - Sunny：`SUNNY_LINE_DISCOUNT_UNLOCK_CODE`；非生产可缺省示例 `Sunny2026`（仅首次）
  - 梦馨：`MENGXIN_LINE_DISCOUNT_UNLOCK_CODE`（无 Sunny 默认，企业独立）
  - **已有哈希绝不覆盖**；生产未设环境变量时跳过，不写入可猜测默认码
- 若曾写入临时明文哈希（如开发验收用 `Mengxin2026`）：仅改 Vercel 环境变量并重跑 seed **不会**轮换；须经受控管理接口或一次性安全脚本主动更新哈希，并验证旧码失效

### 基线规则 Seed

`ensureBaselineOrgRules` 幂等补齐平台默认规则：

- `created`：首次写入
- `kept_existing`：已有且仍为平台默认
- `updated_by_admin`：企业已定制，跳过不覆盖
- 各企业独立写入平台默认，不把 Sunny 阈值复制给梦馨

## Phase 2B（下阶段，本轮不做）

企业 Glossary、标准业务对象、Brand Truth、Workspace 规则/Skill/知识库、经营指标等。
