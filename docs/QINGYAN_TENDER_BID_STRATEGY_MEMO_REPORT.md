# 批次一 — 投标策略备忘录 v2 + 合规矩阵 实施报告

日期：2026-08-20 · 分支 `feature/tender-bid-strategy-memo` · base = main（含 #125）
对标样本：用户提供的 HRM-2026-0395 人工深度分析（评分演算/竞争格局/Go-No-Go 门/
RFI/报价与 teaming 策略/合规矩阵）。

## 1. 改动（SCHEMA_CHANGE = NONE）

**B · 投标策略备忘录 v2**（`strategy.ts` 新增，`tender-bid-strategy-memo/v2`）：
- 输入=文档接地：本单 canonical 事实（80 条）+ 强制要求（40 条）+ 综合层 +
  组织授标投影 + **incumbentLead**（人工记录的现任供应商线索）+ 既有澄清（防重复）
- 输出八节：summary / **评分演算**（权重在场做真实数学，缺席入数据缺口不猜）/
  **竞争格局**（如实引用线索置信度）/ **风险门**（已满足/需解决/高风险三态，
  评估而非裁决）/ 报价策略 / **策略级 RFI** / teaming 建议 / 数据缺口
- 纪律：AI_INFERRED 人审语义；**禁整体 GO/NO-GO 裁决**（prompt 铁律+反例守卫）；
  不发明事实。数组 schema 逐项过滤（坏一项不丢整组——E2E 实测教训）
- 接线：orchestrate 每次情报跑自动生成，落 `room.summaryJson.bidStrategyMemo`；
  工作台指挥台与情报第 7 槽优先渲染备忘录（老草案存量兜底）

**C · 投标合规矩阵**：
- `GET/POST /api/projects/[id]/bid-fit`：最新有效 run 的要求清单（Mandatory 优先，
  cap 300）+ 标注矩阵（run.summaryJson.bidFitMatrix，additive JSON 零 schema）；
  写权限门 + 五态白名单（已有/可开发/需 Partner/需 RFI/No-Go）+ 跨项目写入防护
- `BidFitMatrixCard` 挂招标要求 tab：强制优先视图、未标计数、五态汇总条
  （No-Go 红显）；**人工判定为准，AI 不代填**（反例守卫）

## 2. 证据

- 纯平面：bid-strategy-memo 10/10 + auto-flow 14/14（探针如实迁移 v2）+
  slots/deck 套件全绿 + CI 子集 PASS + tsc 零错 + eslint 零告警
- **真实模型 E2E 5/5**（隔离生产快照 + Halifax 真实数据 86 事实 + 已记录的
  Meltwater 线索）：备忘录 v2 落库、**8 条风险门 + 6 条策略级 RFI**、
  无整体裁决字段；实录节选——竞争格局精确引用「Meltwater News Canada Inc.，
  HIGH_UNCONFIRMED」及证据链；评分演算诚实列出已知三条评分事实
  （含「美国供应商 Stage 3 得 0 分」）并明示缺总权重
- 首轮 E2E 抓到 schema 数组级 catch 吞组缺陷 → 已修（逐项过滤）并复跑全绿

## 3. 待批次二的已知边界

评分总权重（70/10/10/10）与现任供应商未进 canonical 事实层（抽取分类学盲区）
——备忘录当前靠 incumbentLead 人工记录与部分已抽事实工作，批次二（抽取扩容
+ tender-eval 基准复跑）后将全自动。

## 4. Gate

```
B1_SCHEMA_CHANGE   = NONE
B1_MEMO_V2         = 八节结构 + 文档接地输入 + AI_INFERRED（禁整体裁决，反例守卫值守）
B1_FIT_MATRIX      = 五态人工标注 + 写权限门 + 跨项目防护（AI 不代填）
B1_REAL_E2E        = PASS 5/5（真实模型 + Halifax 真实数据 + Meltwater 线索入面）
B1_PURE_SUITES     = 全绿；CI 子集 PASS
B1_STATUS          = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
