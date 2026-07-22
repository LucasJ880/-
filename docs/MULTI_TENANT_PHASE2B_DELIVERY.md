# Phase 2B 交付说明：企业语义与业务配置层

分支：`feature/multi-tenant-phase2b-business-semantics`  
基线：Phase 2A `ec76347`（`feature/multi-tenant-phase2a`）

## 目标

每个企业拥有独立、可配置的：术语、业务对象、Brand Truth 读取面、Workspace 配置继承、Skill/知识绑定、经营指标定义。  
**不做**：知识图谱、图数据库、Supervisor/Runtime 重写、漂亮 Dashboard。

## 代码修改

| 模块 | 路径 |
|------|------|
| Glossary | `src/lib/glossary/service.ts` |
| 业务对象 | `src/lib/business-objects/registry.ts` |
| Brand Truth 统一读 | `src/lib/brand/org-brand-truth.ts` |
| 指标定义 | `src/lib/metrics/definitions.ts` |
| 配置继承 | `src/lib/tenancy/scoped-config.ts` |
| API | `/api/operations/glossary` `/metrics` `/brand-truth` |
| 经营中心 | 展示指标定义与 missing 状态 |
| Seed | `scripts/seed-org-semantics-phase2b.ts` |
| 审计 | `docs/BRAND_TRUTH_UNIFICATION_AUDIT.md` |
| 测试 | `src/lib/tenancy/__tests__/phase2b-semantics.test.ts` |

## 数据模型

Migration：`prisma/migrations/20260721200000_phase2b_business_semantics/`

- `OrganizationGlossaryTerm`（`scopeKey` = org \| workspaceId）
- `BusinessObjectDefinition`（`orgId+objectKey` 唯一）
- `BusinessMetricDefinition`
- `WorkspaceSkillBinding`
- `WorkspaceKnowledgeBinding`

## Seed

```bash
npx prisma migrate deploy
npm run seed:org:sunny-home-deco
npm run seed:org:mengxin-home-textile
npm run seed:org:semantics-phase2b
```

Sunny：SiteMeasure/量尺、窗饰 Order、投标/安装类指标  
梦馨：Sample/寄样、外贸 Order、询盘/样品/内容类指标  

## Brand Truth

- 事实主源：`MarketingBrandProfile`
- 语料视图：`BrandProfile`
- 统一入口：`getOrgBrandTruth(orgId)` → `GET /api/operations/brand-truth`
- 本阶段未合并表，先统一读取，避免双写漂移扩大

## 配置继承

`resolveScopedConfig({ orgId, workspaceId, projectId, configType, key })`  
返回 `{ value, sourceScope, sourceId, version }`  
`LOCKED_SECURITY_KEYS`：membership / 租户隔离 / l3 强制审批 — 下层不可关

## 已知限制

1. 指标仅定义列表，无实时数值计算  
2. Workspace Skill 绑定表已建，Agent Runtime 未全量改读绑定（执行时仍走 Phase 2A `canInvokeTool`）  
3. BrandProfile / MarketingBrandProfile 双表仍在，写路径未完全收敛  
4. 知识检索 workspace 过滤需在具体 search API 继续接线  
5. Glossary Workspace 覆盖需业务侧显式传 `workspaceId`

## 部署顺序

1. 合入并部署 Phase 2A  
2. `migrate deploy` Phase 2B migration  
3. 跑 semantics seed  
4. 生产设置解锁码环境变量（见 Phase 2A）  

## Phase 2C 建议

- EvaluationCase 自动执行  
- Agent 轨迹评分与工具结果验证  
- HumanFeedback → CandidatePractice → RolePlaybook  
- Skill 版本回归与成本/业务价值关联  

**优先级仍低于规则与权限收口（已完成的 2A）与语义配置（本阶段）。**
