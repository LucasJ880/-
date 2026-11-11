# TI-1 报告：招标价格表行项

| 项 | 值 |
|---|---|
| change | `tender-price-schedule-lines` |
| TASKFLOW | TI-1（Phase F，Tender Intelligence Phase B 第一项） |
| 来源 | `docs/tender-intelligence-gap-analysis.md` §6 的 N1、N2、N11；Owner Gate A（Lucas 2026-11-11） |
| 分支 | `claude/tender-price-schedule-lines`（叠在 FIX-1 之上） |
| 性质 | 纯函数与测试。不接界面、不落库、不联网、不调模型；线上行为零变化 |

## 1. 交付清单

`src/lib/tender-price-schedule/`：

| 文件 | 内容 |
|---|---|
| `contract.ts` | 行项类型（行号、说明、数量、单位、包装数、尺寸、最小尺寸、强制认证闸、出处）；封闭的单位目录；结构校验；按行号集合的数量汇总 |
| `unit-conversion.ts` | 供应商按件报价换算到招标单位；已按招标单位报价不重复换算；成组单位缺包装数时拒绝；单价舍入到分后算行合计与总计（定点） |
| `dimension-match.ts` | 尺寸解析（定值、区间）与逐维对照：相符 / 不符 / 无法判断；支持最小尺寸 |
| `closing-time.ts` | 截标时间必须带时区；开放 / 已提交 / 已过期的推导 |
| `official-export.ts` | 按官方价格表原样导出：行数组与 CSV，六列，缺价拒绝 |
| `__tests__/fixtures/ottawa-18026.ts` | 渥太华 18026-93121-T01 回归夹具 |

## 2. 验收项对应

| 任务书验收项 | 测试 |
|---|---|
| A1 18 行不缺、不重、不乱序 | `schedule-contract.test.ts`：结构校验、行号重复 / 不连续 / 调换；`closing-and-export.test.ts`：导出恰好 18 行、行号与顺序不变 |
| A2 五组数量合计 | `schedule-contract.test.ts`：6,119 / 2,903 / 436 / 54 / 1,140；Each 与 Pack 不相加 |
| A8 枕套每包 2 件贯穿换算与导出 | `unit-conversion.test.ts`：件价 1.50 → 每包 3.00，2,349 包不变，4,698 件；`closing-and-export.test.ts`：导出第 10、11 行仍为 Pack |
| A9 36×39 不得满足 36×38 | `dimension-match.test.ts`：不符，并指出第 2 维 |
| A10 换算与舍入对到分 | `unit-conversion.test.ts`：22.48 / 3.34 / 0.13 → 53,210.16 / 7,845.66 / 38.74 → 61,094.56；`closing-and-export.test.ts`：总计等于各行合计之和 |
| A16 不带时区失败；过期判定 | `closing-and-export.test.ts`：`2026-11-10T15:00:00` 失败；已过截标且无回执 → 已过期；有回执 → 已提交；没有回执的提交记录仍为已过期 |

## 3. 测试输出（实际运行）

```text
tender-price-schedule contract: 20 passed
tender-price-schedule unit-conversion: 18 passed
tender-price-schedule dimension-match: 19 passed
tender-price-schedule closing-and-export: 24 passed
```

门禁：

```text
bash scripts/check-test-registry.sh → OK 测试注册校验通过：已注册 564 个；历史欠账基线剩余 68 条（只减不增）
bash scripts/test-runtime-architecture.sh → runtime-architecture repo conformance 结果: 9 通过, 0 失败；guards PASS
npm run typecheck → 通过（tsc --noEmit，退出码 0）
npm run lint:baseline → PASS（无新增 error fingerprint / 无 count 上升）
openspec validate tender-price-schedule-lines --strict → Change 'tender-price-schedule-lines' is valid
```

四个新测试已登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`ci/test-registry-baseline.txt` 没有新增。

## 4. 几条规则的取舍

- **单位目录是封闭的**：`Each`、`Pack`、`Box`、`Roll`、`Pair`、`Set`、`Case`、`Bag`、`kg`、`m`、`ft`、`sqft`。目录外的单位校验失败并指出行号，不猜。
- **尺寸按位置比较，不换位，不设容差**。`36 x 38` 对 `38 x 36` 判不符。这会把「长宽写反」报出来让人看一眼；招标没写容差时系统不替发标方放宽。
- **截标前一律是「开放」**，即使已经有带回执的提交记录。「已提交」只在截标后出现。这是按规格字面实现的；如果希望截标前有回执就显示「已提交」，需要改规格。
- **校验只报告，不修正**：行号不连续、调换顺序都算无效，不自动重排——顺序本身是招标事实。

## 5. 夹具

- 来源：Lucas 2026-11-11 提供的 Skill 包 `assets/ottawa-bedbug-case.json`。原件不在仓库里。
- 招标编号、发标方、18 个行项与数量是公开的招标事实，原样保留。
- Skill 样例里一家竞争对手与两家出口商的名称没有入库，用 `COMPETITOR_A`、`EXPORTER_A`、`EXPORTER_B` 代替（Lucas 2026-11-11 确认按此处理）。`grep -rn 'Amcan\|Huierjia\|Jianjin' src/` 无命中。
- 夹具是历史回归样例，不是报价，不是合规证明。

## 6. 没做的

- 没有从招标文件里自动抽取行项。现有分析入库时仍丢弃数量与单位（FIX-2，落点待 Owner Gate B 定数据库方案）。
- 没有落库、接口、页面、开关：本次的代码线上不可达。
- 没有回填发标方的 xlsx 工作簿；导出是行数组与 CSV。
- 成本、关税、运费、毛利在 TI-2；文件领取方、进口线索、认证核验、可投标判定在 TI-3。
- 没有改现有的截标时间读写（`Project.closeDate`、`parseBusinessDateTime`）。
