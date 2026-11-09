# Design：组织级竞争对手 / 采购机构画像（P2-0b）

## Context

- 授标事实唯一来源：`AwardRecord`（经人工确认或权威公开来源写入，`listAwardsForOrg` 读，org 隔离）。
- 现有投影 `deriveAwardIntelligence` 已给出竞争对手名单与买家规律，但只到"名字 + 次数"，页面需要按对手 / 按机构展开的明细。
- 「历史中标」页已经在用 `/api/org/tender-awards`；两张新页不改它。

## Decisions

### D1 新纯函数，口径与投影一致
已确认 = ACTIVE + HUMAN_CONFIRMED / SYSTEM_VERIFIED；其余（AI 提取、疑似重复）只算线索、不给金额；撤回不计。我方按组织名 + `normalizeVendorName` 判断：竞争对手里排除，采购机构的中标方里保留并标「我方」（机构视角下我方中标是事实）。周期直接复用 `deriveBuyerCycle`，不另写一套。
否决：在 `deriveAwardIntelligence` 里加明细字段——它是七域投影，返回体已经很大，"历史中标"页不需要这些明细。

### D2 我方项目只统计可见的
机构页的"我方项目"要查 `Project`，按仓库约束经 `buildProjectVisibilityWhere(user)`，再加 `orgId + workDomain=tender + clientOrganization 非空`；最多 500 个（按更新时间），超出时页面说明。结果分类：已有结果按结果；放弃且无结果 → 未投；其余 → 进行中。
否决：直接 `db.project.findMany({ orgId })`——会绕开可见性过滤层。

### D3 开关关闭时降级
`T4_AWARD_INTELLIGENCE_SCHEMA_READY` 关 → 不碰 AwardRecord；竞争对手页显示"尚未启用"；机构页只显示我方项目并提示。

### D4 周期采购收起而不删
从 `IntelHubShell` 页签与侧栏注册表移除 `nav-intel-series`；页面与 `matchPaths` 保留（直接访问仍归在"智能调查室"下高亮）。等招标雷达有系列数据再放回。

## Risks / Trade-offs

- 现有去重规则把"同一中标方 + 同一机构"的第二条记录标为疑似重复（即使招标编号不同），这些记录在两页里只算线索。规则本身不在本次改动范围，报告里单列。
- 机构名合并依赖 `normalizeBuyerName`；写法差别很大的同一机构（如缩写）不会合并。

## Migration Plan

无 schema / 数据迁移；纯代码，随部署生效；回滚 = 还原文件。
