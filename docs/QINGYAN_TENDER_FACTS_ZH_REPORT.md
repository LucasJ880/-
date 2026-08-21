# 事实层全面中文化实施报告（Lane 1）

日期：2026-08-21 · 分支 `feature/tender-facts-zh` · base = main `6bbbfb2d` · SCHEMA_CHANGE = NONE

## 1. 问题

#139 只中文化了要求层（`chineseTranslation`）；事实 claim（`tenderAnalysisFact.contentZh`）与
关键事实槽（`run.summaryJson.criticalFacts[*].text`）仍是 v2-map 直填的英文——简报「上一轮中标方」
显示英文句子、事实与可信度区块全英文。隔离快照实证：Halifax run **89 条事实全英文 + 16 个 KNOWN
关键事实槽全英文**。

## 2. 改动

- `requirement-translate.ts` 新增 **`translateAnalysisZh`**：要求 + 事实 claim + KNOWN 关键事实槽
  **一次合并分批**（共享总预算与 50 条/批、反向守卫、按类回写计数 byKind）；UNKNOWN 槽不碰；
  `TRANSLATE_MAX_ITEMS` 200→400 以容纳三类合计。
- 管线挂点（v2-resumable PERSIST）改调 `translateAnalysisZh`（同一注入面，telemetry 真实计数）。
- 存量补翻端点 `POST /bid-fit/translate` 扩到事实表与 `summaryJson.criticalFacts`（深拷贝翻译后整体
  写回；语义字段 statementKind/confidence/status 零触碰；频控不变）。矩阵卡按钮文案「翻译成中文
  （要求 + 事实）」并回显分类计数。

## 3. 证据

- 纯平面 bid-fit-usability **19/19**（新增 BF-13 合并翻译按类回写 + UNKNOWN 不碰；BF-14 挂点/端点覆盖
  守卫）；v2-resumable 42/42；tsc 零错；eslint 零告警。
- **真实 E2E 5/5**（隔离快照 + 真实模型，分支已删）：Halifax run 事实 **84/89**、关键事实槽 **16/16**
  翻成中文（28s，3 次调用）；现任供应商槽译文保留 "November 2021 / November 1, 2026"；statementKind/
  confidence 零漂移；幂等重跑零模型花费。

## 4. 上线后

新分析入库即全中文；存量项目（含 Halifax）在矩阵卡点一次「翻译成中文（要求 + 事实）」补翻三类。
无新 env / 无 schema；回滚 = revert。

## 5. Gate

```
FACTS_ZH_SCHEMA_CHANGE = NONE
FACTS_ZH_COVERAGE      = 要求 + 事实 claim + 关键事实槽（管线自动 + 存量按钮）
FACTS_ZH_PURE_SUITES   = 19/19 + resumable 42/42
FACTS_ZH_REAL_E2E      = PASS 5/5（84/89 事实 + 16/16 槽；语义零漂移；幂等）
FACTS_ZH_STATUS        = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
