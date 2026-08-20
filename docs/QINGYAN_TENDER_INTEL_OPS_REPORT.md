# 情报运维双件套 — 供应商价格带对标 + 公告盯梢 实施报告

日期：2026-08-20 · 分支 `feature/tender-intel-ops` · base = main（含 #134/#135/#136）

## 1. 供应商价格带对标（阶段3 首源=CanadaBuys 兑现）

- 发现并验证联邦「Contracts over $10,000」**全量**资源
  `fac950c0-00d5-4ec1-a4d3-9cbebf98a305`（1.31M 行；我们原用的 `7f9b18ca` 是
  Legacy 子集）。查询语法实测=field-scoped JSON q（全文 q 在此资源失灵）。
- `searchContractsByVendor`（flag 门 fail-closed）+ `summarizeVendorContracts`
  纯汇总；env `EXTERNAL_INTEL_CONTRACTS_RESOURCE_ID` 预留位兑现为默认全量。
- 编排联动：房间存在 `incumbentLead` → 自动拉该供应商联邦合同价格带 →
  入策略备忘录输入（pricingStrategyZh 带来源引用）+ 落
  `room.summaryJson.vendorPriceBenchmark`。
- **实证**：Meltwater 334 条命中，精确含用户手工验证的 ESDC $42,540.75；
  60 样本中位 **$38,693**——给 Halifax 报价策略一个比手工估带更硬的锚。

## 2. 公告盯梢（Halifax 时效：提问截止 2026-08-28）

- `watch.ts`：归一摘要（剥 script/style/空白坍缩 → sha256）变更检测；
  变化 → 站内通知（sourceKey 按内容 hash 幂等，重复 tick 零打扰）；
  基线首抓只记 hash 不通知。诚实文案：「页面有更新（可能是 Addenda/Q&A）」。
- `GET/POST/DELETE /api/projects/[id]/tender-watch`（写权限门 + URL 校验）；
  小时级 cron `/api/cron/tender-watch`（cron 鉴权 + automation registry 登记）；
  情报 tab 盯梢卡（设 URL/状态/停止）。
- P11-BUDGET-06 探针如实更新：不变量=禁第二套 tender **分析/队列** cron；
  watch 为零队列消费的通知监视器，显式白名单，其余新增照旧拦截。

## 3. 证据

- 纯平面 intel-ops 11/11；t5-p11 44/44（探针白名单化后）；CI 子集 PASS；
  tsc 零错；eslint 零告警
- **真实 E2E 6/6**（隔离快照 + 真实 CKAN 出站 + 注入 fetch 的通知链）：
  334 条命中/ESDC 点对上/中位合理；盯梢基线→变更恰 1 条通知→重复幂等

## 4. Gate

```
OPS_SCHEMA_CHANGE   = NONE
OPS_VENDOR_BENCH    = 全量资源默认 + incumbentLead 自动联动（flag fail-closed）
OPS_WATCH           = 小时级变更检测 + hash 幂等通知（第二套队列禁令不破，探针白名单值守）
OPS_REAL_E2E        = PASS 6/6（真实出站 + 通知链）
OPS_NEW_ENV         = NONE（cron 用现有 CRON_SECRET；资源 id 内置默认）
OPS_STATUS          = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
