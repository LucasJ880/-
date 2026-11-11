# TI-2 报告：逐行投标成本核算表

| 项 | 值 |
|---|---|
| change | `tender-bid-cost-sheet` |
| TASKFLOW | TI-2（Phase F，Tender Intelligence Phase B 第二项） |
| 来源 | `docs/tender-intelligence-gap-analysis.md` §3.3、§6 的 N7、§17.2；Owner Gate A（Lucas 2026-11-11：核算表要「表现出来」） |
| 分支 | `claude/tender-bid-cost-sheet`（叠在 TI-1 之上） |
| 性质 | 纯函数与测试。不接界面、不落库、不联网、不调模型；线上行为零变化 |

## 1. 交付清单

`src/lib/tender-bid-cost/`：

| 文件 | 内容 |
|---|---|
| `contract.ts` | 输入输出类型与词表：采购类型、报价证据类别、关税依据、运费方案、分摊方法、预备金口径、定价口径 |
| `line-cost.ts` | 逐行直接成本：采购数量与起订量、货值折加元、关税依据分级、进口 GST 两种去向、缺参数不出数 |
| `freight.ts` | 运费方案互斥与混合声明；整票费用按体积 / 重量 / 货值 / 数量分摊，余数归最后一行 |
| `pricing.ts` | 情景计算：分摊 → 预备金 → 两种定价口径 → 毛利率与加成率 → 合计；假设与出处清单 |
| `reconcile.ts` | 两套情景对账：11 个分项的差额、报价差额、口径差异；不给胜出者 |
| `sheet-view.ts` | 核算表视图：行项（进口 / 本地分组与小计）、合计、假设与出处、阻断与提示 |
| `render-markdown.ts` | Markdown 渲染：只排版，每个数字取自视图 |

样例：`docs/acceptance/ti-2/ottawa-sample-cost-sheet.md`——渥太华 18 行加一组合成成本输入生成的完整核算表。**合成数据，不是报价。** 该文件由 `sheet-view.test.ts` 生成并逐字校验，改了计算或版式而没重新生成，测试会失败。

## 2. 验收项对应

| 任务书验收项 | 测试 |
|---|---|
| A10 换算与舍入对到分 | `pricing.test.ts`：合计各项等于各行舍入值之和；`sheet-view.test.ts`：渥太华样例的合计块等于 18 行之和、每行五个分项相加等于直接成本；`freight.test.ts`：分摊后各行之和等于整票金额 |
| A11 本地设备不计中国海运与进口关税 | `line-cost.test.ts`：本地行带关税率或海运费即拒绝；`freight.test.ts`：国际段费用不分摊到本地行 |
| A12 GST / ITC 与 HST 不重复，现金流单列 | `line-cost.test.ts`：可抵扣只进现金流（4.96），不可抵扣进成本（169.08）；`sheet-view.test.ts`：报价标明不含 HST，表内没有 HST 金额 |
| A13 两套模型对账，不给「胜出者」 | `reconcile.test.ts`：预备金口径不同的两套模型列出差额并写明口径不同；结果里没有胜出 / 推荐 / 更优的字段或措辞 |
| A14 运费方案互斥，除非声明混合 | `freight.test.ts`：整柜与拼柜同时计入被拒绝；声明混合并附说明后可算；`sheet-view.test.ts`：说明显示在核算表上 |

A8（每包 2 件贯穿成本）在 `line-cost.test.ts` 里也有一条：2,349 包 × 2 件 × 1.50 = 7,047.00，按包报价 3.00 得到同一货值。

## 3. 测试输出（实际运行）

```text
tender-bid-cost line-cost: 27 passed
tender-bid-cost freight: 17 passed
tender-bid-cost pricing: 23 passed
tender-bid-cost reconcile: 10 passed
tender-bid-cost sheet-view: 26 passed
```

门禁：

```text
bash scripts/check-test-registry.sh → OK 测试注册校验通过：已注册 569 个；历史欠账基线剩余 68 条（只减不增）
bash scripts/test-runtime-architecture.sh → runtime-architecture repo conformance 结果: 9 通过, 0 失败；guards PASS
npm run typecheck → 通过（tsc --noEmit，退出码 0）
npm run lint:baseline → PASS（无新增 error fingerprint / 无 count 上升）
openspec validate tender-bid-cost-sheet --strict → Change 'tender-bid-cost-sheet' is valid
```

五个新测试已登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`ci/test-registry-baseline.txt` 没有新增。

## 4. 金标数字的来源，与一分钱的差别

金标输入移植自 Skill 包 `assets/sample_cost_inputs.json`（两行合成数据），期望值取自 Skill 包 `scripts/cost_model.py` 的输出（2026-11-11 本地运行）：

| 项 | Skill 样例 | 本实现 |
|---|---|---|
| 进口行：货值 / 关税 / 进口 GST 现金流 / 直接成本 | 84.00 / 15.12 / 4.96 / 164.12 | 相同 |
| 本地行：直接成本 | 750.00 | 相同 |
| 单位报价 | 22.48 / 513.70 | 相同 |
| 行合计 | 224.80 / 1,027.40 | 相同 |
| 报价总计 / 直接成本总计 | 1,252.20 / 914.12 | 相同 |
| **合计利润** | **313.04** | **313.03** |

差的这一分钱：样例用合计报价与合计成本重新算合计利润（1,252.20 × 0.98 − 914.12 = 313.036 → 313.04）；本实现取两行利润之和（56.18 + 256.85 = 313.03）。取后者是为了让表上的合计与各行相加对得上——这是核算表最容易被质疑的地方。`pricing.test.ts` 里两种算法的结果都有断言。

## 5. 实施中对规格的三处补充

写代码时发现三处对外行为规格没有写到，已先补进规格增量再继续（`openspec validate --strict` 通过）：

- **成本为空的行不参与运费分摊**，此时核算表提示「补齐后各行的分摊额会变化」。否则一行缺关税率会让整张表算不出来。
- **本地运费方案的费用分摊到全部行**；国际段方案（整柜、拼柜、空运）只分摊到进口行。
- **自相矛盾的输入整体拒绝**：行号重复、起订量或整包装件数不是正整数、各种比率为负或不小于 100%。新增一条 Requirement。

另改了一个 Scenario 的措辞：混合运费的说明显示在「假设与出处」与「阻断与提示」两块，不是「运费一栏」——说明是情景级的，放不进逐行的列里。

## 6. 几条规则的取舍

- **缺参数的行为空，不是 0。** 表上显示「—」，合计块标「不完整」，阻断块一次列全缺什么。不会停下来问，也不会编数。
- **关税「已核实」只校验四项齐全**（HS 编码、原产地、来源、日期），不校验税率对不对。归类是否正确由报关行或人工判断。
- **「其它」一列合并了三项**：其它不可回收成本、不可抵扣的进口环节税、计入成本的预备金。这样每行五个分项相加等于直接成本；后两项在合计块分列。
- **两个比率的口径**：毛利率 =（价 − 成本）÷ 价；加成率 =（价 − 成本）÷ 成本；另列「扣按售价预备金后的利润率」。样例里三者是 27.0% / 37.0% / 25.0%。

## 7. 没做的

- 没有界面、接口、落库、开关：本次的代码线上不可达。接界面时须按财务访问规则授权，不沿用定价助手「能读项目就能看」的口径。
- 没有查询任何税则、汇率、运价来源；这三样都是调用方给的输入。
- 没有把核算结果写回报价引擎或项目财务；没有替换现有的落地成本模块与定价助手。成本分项名称已与报价引擎的成本类别对齐，写回留给持久化那个 change。
- 没有 PDF 或 xlsx；渲染只有 Markdown。
- 低 / 基准 / 高三套情景的并排展示没有做：现在能分别算出任意多套情景并两两对账，并排版式留给界面。
- 任务书验收项 A15（评标总价、实付、预算估计互不相加）不在本次范围，归 TI-3。
