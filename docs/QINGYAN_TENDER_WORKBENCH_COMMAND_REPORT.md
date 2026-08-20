# 工作台指挥台重构 实施报告

日期：2026-08-18 · 分支 `feature/tender-workbench-command` · base = main（含 #128）

## 1. 诊断（用户报告：AI 简报多而无关键信息；情报/项目摘要要跳转）

- 工作台 14+ 卡竖排瀑布；「AI 简报」= 两张泛文本 LLM 散文卡，硬字段
  （截止/金额/要求数/风险数/状态）一个不在
- 情报摘要卡读 BidToGo 遗留 `project.intelligence`（上传型恒空）→
  永远「尚未生成」+ 跳转按钮；完全没接 #126/#128 的真情报数据
- 项目摘要（30 秒看懂）只在情报 tab 渲染
- **数据层已富（brief 投影/分析统计/情报状态/策略草案全在），工作台还在用空壳卡**

## 2. 改动（SCHEMA_CHANGE = NONE）

- **新聚合端点** `GET /api/projects/[id]/workbench-summary`（读权限门）：
  硬字段 + 最新分析真实计数（要求/强制/澄清/风险；**无 run 时 null 而非 0**，
  禁假数据）+ 30 秒看懂（复用 `getExecutiveBrief`，同源同 readiness 语义）+
  情报态（externalIntelStatus / 候选计数 / bidStrategyAuto 首段）
- **新组件** `workbench-command-deck.tsx` 三卡一次请求：
  A 关键信息条（十项硬字段：采购方/编号/截止倒计时（临近变色）/金额/
  分析状态/要求（强制）/风险/澄清/外部情报/投标结果）；
  B 项目摘要内联（oneLiner/采购内容/主要阻塞/下一步 + stale 徽标，零跳转）；
  C 情报摘要真数据（AI 策略草案首段+2 要点 + 检索状态行；「打开情报」降为次要链接）
- **workbench-tab 重整**：指挥台置顶（tender 项目）；待你处理上移；
  两张泛文本 AI 卡合并入默认折叠的 `<details>`（内容不删）；
  BidToGo 空壳情报卡整体退役（含组件定义删除）

## 3. 证据

- 探针 11/11（含反例守卫：不读遗留 intelligence 字段 / 计数 null≠0 /
  单次聚合请求）；tender-detail-ia 36/36 原样；CI 子集 PASS；tsc 零错；
  eslint 仅存量 img 警告
- `VISUAL_SMOKE = PENDING_FINAL_REVIEW`：UX 改版请在 PR 的 qingyan-staging
  预览上人工过目（布局取舍属产品判断，staging 一键可看）

## 4. Gate

```
WB_SCHEMA_CHANGE   = NONE
WB_ZERO_JUMP       = 十项关键信息 + 项目摘要 + 情报摘要全部工作台内联
WB_NO_FAKE_DATA    = counts null≠0 / readiness 语义沿用 / 诚实空态（反例守卫值守）
WB_PROSE_DEMOTED   = 泛文本 AI 简报默认折叠（内容保留）
WB_LEGACY_RETIRED  = BidToGo 空壳情报卡删除
WB_PURE_SUITES     = 11/11 + IA 36/36 + CI 子集 PASS
WB_VISUAL_SMOKE    = PENDING_FINAL_REVIEW（staging 预览人工过目）
WB_STATUS          = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
