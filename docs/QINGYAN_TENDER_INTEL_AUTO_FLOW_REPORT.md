# 情报自动流（包6）— 七槽位自动化 实施报告

日期：2026-08-17 · 分支 `feature/tender-intel-auto-flow` · base = main（含 #127）

## 1. 用户指令与设计裁决

指令：七个「企业历史情报」槽位做成自动流，不需要人工确认、自动进行分析。

裁决（保住证据纪律的自动化）：**人工确认从「可见性的门」降级为「可选的升级动作」**，
自动入库走 T4 冻结服务里**明文预留**的路径——`createOrObserveAwardRecord` +
白名单铁律「CANADABUYS_OPEN_DATA + reference number 允许落 SYSTEM_VERIFIED」。
政府公开披露的授标数据（带编号、带来源 URL）由确定性代码自动观察入 canonical，
**直接进入权威层**（统计/周期/可比价格全部自动点亮）；actor=system
（ai/agent 写门照旧拒绝——T3 硬禁一毫米没动）。Web 候选无权威编号，
不自动入库（防幻觉污染），仍走人工确认线。

## 2. 七槽位自动化矩阵

| 槽位 | 自动化方式 |
|---|---|
| 历史中标 | M1 权威候选自动观察（SYSTEM_VERIFIED）→ 投影自动含金额 |
| 采购机构画像 | 同上（buyerNameRaw 聚合，不依赖 T3 Buyer 表） |
| 竞争对手 | 同上（authoritative winner 聚合 = confirmed 列表自动增长） |
| 可比价格 | 同上（买家×范围×币种组满 3 样本自动出统计） |
| 采购周期 | 同上（同买家同范围时间序列满 3 样本自动出周期） |
| AI 投标策略 | **新增自动合成**：每次情报跑完，基于七域投影+分析摘要生成中文策略草案（AI_INFERRED 标签、显式数据缺口、禁 GO/NO-GO），落 `room.summaryJson.bidStrategyAuto`，第 7 槽自动渲染 |
| 供应链 | 唯一例外：无数据源（M3 海关未接），保持规划位——绝不编数据 |

叠加既有自动链：分析完成（双管线）→ 自动检索 → **自动观察入库 + 自动策略草案**
→ 槽位全自动点亮。人工确认仍可做（升级信任级/确认 Web 线索），但不再是前提。

## 3. 改动（SCHEMA_CHANGE = NONE）

- `orchestrate.ts`：M1 后自动观察 top5 带编号候选（幂等键 canadabuys:{reference}
  与人工确认同键——确认同一候选零重复）；检索后自动合成策略；
  `externalIntelStatus` 新增 autoObserved / strategyGenerated
- 新 `strategy.ts`：`synthesizeBidStrategyAuto`（zod 结构化 + M2.5 同款证据纪律
  prompt：不发明事实、UNKNOWN 域列为数据缺口、无 GO/NO-GO）
- `award-history` GET 返回 `bidStrategyAuto`；槽位组件渲染策略草案
  （AI 推断徽标 + 人审免责）；文案改自动流语义（确认=升级）

## 4. 证据

- 纯平面 **intel-auto-flow 14/14**（反例守卫：自动路径绝不产生 HUMAN_CONFIRMED /
  无 ai actor / Web 候选不自动观察 / awards 写门铁律回归钉）；
  obs-p5 14/14、intel-slots-p1p2 11/11、websearch 10/10 回归全绿；
  CI 子集 PASS；tsc 零错；eslint 零告警
- **真实 E2E 5/5**（隔离生产快照 + 真实出站 + 策略合成真实模型一次）：
  观察幂等 CREATED→ALREADY_OBSERVED 恒 1 条；SYSTEM_VERIFIED 自动进权威投影
  （含金额）；人工确认零重复且记录保持权威级；全自动链 autoObserved 计数落状态；
  **策略草案自动生成落库（AI_INFERRED）**
- 语义澄清（E2E 实证）：人工确认已被系统观察的同一候选 = 防重复 no-op
  （记录本已权威级，统计不变）——T4 冻结服务设计如此，未改动

## 5. 上线后行为

merge + deploy 即生效（零新 env）：下一个真实标分析完成后，若 M1 检索命中带编号
的政府披露记录，历史中标/买家/对手/价格/周期槽位**自动出现权威数据**；
AI 策略草案每次分析后自动更新。检索无命中时槽位如实显示暂无 + 原因。
回滚 = revert。

## 6. Gate

```
AF_SCHEMA_CHANGE        = NONE
AF_AUTO_INGEST          = M1 带编号候选 → SYSTEM_VERIFIED（T4 白名单铁律路径，actor=system）
AF_AI_WRITE_BAN         = 原样（ai/agent 写门拒绝，回归钉值守）
AF_WEB_CANDIDATES       = 不自动入库（人工确认线保留）
AF_STRATEGY_AUTO        = AI_INFERRED 草案每次情报跑自动生成（人审语义，禁 GO/NO-GO）
AF_PURE_SUITES          = 14/14 + 回归 35/35
AF_REAL_E2E             = PASS 5/5（隔离快照 + 真实出站 + 真实模型）
AF_NEW_ENV_REQUIRED     = NONE
AF_STATUS               = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
