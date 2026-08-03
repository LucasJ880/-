# 投标工作流 Phase 1 — 审计结论与实施计划

**基线：** `f277518`（与 `origin/main` 同步）  
**工作区：** `/Users/user/Desktop/青砚-bid-workflow`  
**日期：** 2026-08-03

## 审计结论（实施前）

### 可直接复用

| 能力 | 路径 |
|---|---|
| 投标主实体 | `Project`（`workDomain=tender`、`tenderStatus`、`aiAdviceStatus`、日期/金额字段） |
| 供应商主实体 | `Supplier` + `InquiryItem`（询价间接关联） |
| 情报建议 | `ProjectIntelligence` |
| 活动流 | `AuditLog` + `lib/activity/*` + `system-events` |
| 任务 | `Task` + `onStageAdvancedTasks` / `/api/tasks` |
| PDF | `lib/projects/generate/generate-docs.ts` |
| 导航 | `lib/navigation/registry.ts` |
| Timeline | `components/tender/project-timeline.tsx`、`activity-timeline` |

### 需扩展（additive）

- `Project.bidPhaseStatus`（Phase 1 工作流状态，不覆盖 `tenderStatus`）
- `BidIntelligenceRoom`（1:1 Project）
- `BidIntelligenceModule`（8 固定模块）
- `BidIntelligenceFact`（来源+可信度）
- `ProjectSupplierLink`（项目↔供应商 M2M）
- `ProjectJoinBrief`（内部成员加入简报）

### 重复/冲突（本轮不新建第二套）

- 不建 `BidWorkspace` 第二项目系统
- 不启用 baseline Bid Data 全表应用层（Requirement/Lock 仍延后）
- 不新建第二权限体系 / 第二 Runtime / 第二 PDF 引擎
- `SalesOpportunity` 留在业务运营

### 唯一主对象

**`Project`（`workDomain=tender`）** + 可选 `BidIntelligenceRoom` 附属。

### 迁移风险

- Additive only；不 DROP；不绑 build
- 隔离库验证前不部署生产 migrate
- `bidPhaseStatus` 默认可空，旧行兼容

### 实施顺序

1. Schema + migration + checksum  
2. 领域 lib（状态、启动调查幂等、模块常量）  
3. API  
4. 导航一级栏目  
5. 页面（列表/调查室/智能 hub/供应商关联）  
6. 中文 PDF docType  
7. 测试 + Draft PR  
