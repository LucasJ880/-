# 情报栏目 阶段1+2 — 七槽位接投影 + 我方结果回灌 实施报告

日期：2026-08-17 · 分支 `feature/tender-intel-slots-p1p2` · base = main（含 #126 情报闭环）

## 1. 背景（盘点结论）

包5 上线后采集管道已通，但：T4 七域确定性投影（`deriveAwardIntelligence` +
`/api/org/tender-awards`）**建成后零 UI 消费者**；事实层近乎空仓
（生产 AwardRecord=1 / Buyer=0 / MemoryClaim=0）；情报 tab 七槽位是静态「建设中」。
阶段方案（用户批准）：1+2 一批 = 接水管 + 灌第一桶金；阶段3 首源定 CanadaBuys（后续）。

## 2. 改动（SCHEMA_CHANGE = NONE）

**阶段1 · 接水管**
- 新 `src/components/tender-intel/org-award-intel-slots.tsx`：七槽位消费
  `/api/org/tender-awards` 投影——历史中标/采购机构画像/可比价格/竞争对手/
  采购周期五域渲染真实数据，四级证据徽标（CONFIRMED/SUPPORTED/INFERRED/UNKNOWN）；
  组件**零二次统计**（数字只来自投影层铁律：权威记录 only、币种不合并、
  样本不足=UNKNOWN+原因）；供应链/AI 策略两槽注明依赖（M3 / ≥4 域有数据）。
- `intel-tab.tsx`：静态 INTEL_FUTURE_SLOTS 退役；`data-intel-slot` 七键保留。
- T1A 探针 A6 如实更新（不变量=诚实空态，跟随组件迁移）。

**阶段2 · 第一桶金**
- 新 `src/lib/tender-intel/own-result-backfill.ts`（T0 §9.1 认可路径）：
  人工标记 won → 我方 AwardRecord（HUMAN_CONFIRMED / USER_ENTRY /
  幂等 sourceKey=`own-result:{projectId}`）；won/lost 均把买家
  （clientOrganization）沉淀 T3 Buyer canonical（createBuyer 幂等身份匹配，
  admin-only 写门无权限则显式跳过）。任何失败绝不影响结果标记。
- `markProjectTenderResult` 挂钩（fire-and-forget），返回值新增
  `canonicalBackfill` 供观测。
- **lost 不写对手事实**：结果表单不采集中标方名；对手 award 只走外部情报
  人工确认线。表单补「中标方（选填）」= P1 债。

## 3. 证据

- 纯平面：intel-slots-p1p2 **11/11**（含反例守卫 BF-06：回灌唯一调用方=人工
  结果标记服务，AI 自动写 canonical 硬禁不被触碰；SLOT-04：UI 零二次统计）；
  tender-detail-ia 36/36（A6 探针迁移后）；CI 单测子集 PASS；tsc 零错；eslint 零告警
- **真实 E2E 7/7**（隔离生产快照，`scripts/intel-slots-p1p2-e2e.ts`）：
  真实项目（HealthPRO，买家=达勒姆地区自治市）标记 won →
  AwardRecord 写入（E2E-02）→ 重复标记幂等恒 1 条（E2E-04）→
  **Buyer 表 0→1**（E2E-07）→ 七域投影当场亮起：历史中标 CONFIRMED 含我方
  事实（E2E-05）、买家画像出现达勒姆（E2E-06）

## 4. 上线后行为

- merge + deploy 即生效（零新 env；T4_AWARD_INTELLIGENCE_SCHEMA_READY 生产已配）：
  - 情报 tab 七槽位立即渲染投影（现有 1 条 AwardRecord 即刻可见）
  - 此后每次人工标记 won：+1 我方中标事实 + 买家入 T3；每次确认外部候选：+1 对手事实
  - 数据随观察期每单自然增长，槽位逐步点亮
- 回滚 = revert（无 env/schema 变更）

## 5. 遗留（P1）

- Outcome 表单补「中标方（选填）」→ lost 也能沉淀对手事实
- 我方组织名会出现在「竞争对手」域（投影按 winner 聚合，语义=中标方）；
  UI 侧过滤我方名 or 投影加 isOwnOrg 标记——留投影层小改
- 阶段3 首源 CanadaBuys 全量授标资源（用户已定）；阶段4 策略合成待 ≥4 域有数据

## 6. Gate

```
INTEL_P1P2_SCHEMA_CHANGE     = NONE
INTEL_P1P2_SLOTS_WIRED       = 5/7 真实投影 + 2 规划位（依赖注明）
INTEL_P1P2_NO_UI_MATH        = PASS（SLOT-04 反例守卫值守）
INTEL_P1P2_BACKFILL          = won→AwardRecord 幂等 + Buyer 0→1（human-only，BF-06 值守）
INTEL_P1P2_PURE_SUITES       = 11/11 + 36/36 + CI 子集 PASS
INTEL_P1P2_REAL_E2E          = PASS 7/7（隔离生产快照真实项目）
INTEL_P1P2_NEW_ENV_REQUIRED  = NONE
INTEL_P1P2_STATUS            = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
