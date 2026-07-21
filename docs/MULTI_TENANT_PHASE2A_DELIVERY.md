# Phase 2A 交付说明：规则、服务与 Agent 权限收口

## 范围（本轮五项）

1. 折扣与核心规则租户化（版本 / 归属 / 生效）
2. TenantContext 高风险入口铺开 + 开发规范
3. Agent 工具改用 orgRole（`canInvokeTool`）
4. Industry Pack Registry（轻量，禁止静默家纺回退）
5. 禁止静默业务回退

## 数据模型

- `Organization.industryPackId`
- `QuoteDiscountSettings`：每 org 一行（`orgId` unique）+ `version` / `effectiveAt` / `lineDiscountUnlockCode`
- `OrgBusinessRule`：规则版本库（`quote_margin` / `quote_auto_send` / `project_risk` / `agent_tool_policy` / `quote_discounts` 快照等）
- `AgentApprovalSettings`：增加 `version` / `effectiveAt` / `updatedById`

迁移：`prisma/migrations/20260721190000_phase2a_org_rules_industry_pack/`

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

### 解锁码安全

- 字段：`lineDiscountUnlockCodeHash`（bcrypt）；`depositOverrideCode` 亦存哈希（注释标明）
- API / 审计 / 错误信息**永不**返回明文或哈希，仅 `hasLineDiscountUnlockCode` 等布尔
- Seed：
  - Sunny：`SUNNY_LINE_DISCOUNT_UNLOCK_CODE`；非生产可缺省示例 `Sunny2026`（仅首次）
  - 梦馨：`MENGXIN_LINE_DISCOUNT_UNLOCK_CODE`（无 Sunny 默认，企业独立）
  - **已有哈希绝不覆盖**；生产未设环境变量时跳过，不写入可猜测默认码

## Phase 2B（下阶段，本轮不做）

企业 Glossary、标准业务对象、Brand Truth、Workspace 规则/Skill/知识库、经营指标等。
