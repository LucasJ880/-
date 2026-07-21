# Brand Truth Unification Audit

> 审计日期：2026-07-21  
> 分支：`feature/multi-tenant-phase2b-business-semantics`  
> 目标：Organization 级 Brand Truth 单一真相源（SSOT）基线

## Executive Summary

青砚**不存在** `CompanyProfile` 模型。品牌/公司信息分散为：

| 层 | 模型 | 角色 |
|---|---|---|
| A | `BrandProfile` | 运营品牌语料（内容 / Skill 注入） |
| B | `MarketingBrandProfile` | 企业事实 / Brand Truth（增长门禁） |
| C | `Company` + `User.companyIdsJson` | 平台联合品牌 UI |
| D | `Organization` | 租户壳（name/code/industryPackId） |

**结论**：以 `MarketingBrandProfile` 升格为 Organization 事实主源；`BrandProfile` 降为语料视图；统一经 `getOrgBrandTruth(orgId)` 读取。本阶段先建兼容层，不重做营销中心。

## 模型与字段（摘要）

### BrandProfile
`brandName`, `tagline`, `positioning`, `sellingPoints`, `targetAudience`, `toneOfVoice`, `serviceScope`, `caseStudies`, `forbiddenClaims`

### MarketingBrandProfile
`legalName`, `brandName`, NAP, `timezone`, `industry`, `productsJson`, `serviceAreasJson`, `targetAudiencesJson`, `competitorsJson`, `forbiddenContextsJson`, `validation*`, `productMarketingContextJson`

### Company
平台 cobrand：`name`, `slug`, `logoUrl` — **与 Organization 无 FK**

## 使用面

- 对话 / Skill `{{brandContext}}` → 只读 BrandProfile
- 增长门禁 / 体检 / 活动 → 只读 MarketingBrandProfile
- PMC / Agent brand tool → 双表聚合
- 配置健康 → Organization，不查品牌表

## 重复与风险

`brandName`、客群、服务区、禁忌双写；梦馨 seed 仅有 BrandProfile；内容红线硬编码不读档案禁忌。

## Phase 2B 落地原则

1. **一个 Organization 只有一个企业事实主源**（MarketingBrandProfile 升格语义）
2. 语料面（BrandProfile）通过统一读取器投影，禁止再当事实源
3. 新增 `src/lib/brand/org-brand-truth.ts` 作为唯一读取入口
4. 写路径：事实字段只写 MBP；语料字段写 BP；`brandName` 过渡期双写同步
5. `Company` 短期保留为 cobrand，不并入事实主源
6. 不做知识图谱 / 不重做整个营销中心

## 兼容与迁移

见交付文档 `docs/MULTI_TENANT_PHASE2B_DELIVERY.md`。
