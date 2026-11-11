# TI-3a 报告：竞争情报的线索契约

| 项 | 值 |
|---|---|
| change | `tender-competition-leads` |
| TASKFLOW | TI-3a（Phase F，Tender Intelligence Phase B 第三项的前半） |
| 来源 | `docs/tender-intelligence-gap-analysis.md` §6 的 N3、N4、N5、N6、N8 |
| 授权 | Lucas 2026-11-11：「其他你来主导，需要确定的按推荐做」——四件套未另等审核，实施后以 Draft PR 交付 |
| 分支 | `claude/tender-competition-leads`（叠在 TI-2 之上） |
| 性质 | 纯函数与测试。不接界面、不落库、不联网、不调模型；线上行为零变化 |

## 1. 交付清单

`src/lib/tender-competition/`：

| 文件 | 内容 |
|---|---|
| `document-holders.ts` | 文件领取方快照的校验与汇总：领取方数、我方条目、竞争对手领取方数；投标人数只来自开标记录，没有就是未知 |
| `company-identity.ts` | 公司名称三档比对（同名 / 建议 / 无关）；建议的确认与否决留痕；系统不自动合并 |
| `import-leads.ts` | 进口线索：初始状态只能是「线索，未证实当前供货」；人工用 12 个月内的证据才能确认；超过 12 个月标为历史 |
| `source-status.ts` | 数据来源的连接状态：已接通 / 未接通 / 仅人工 / 按纪律禁用；未接通不调用取数函数、不带记录 |
| `amount-measures.ts` | 历史金额九个口径；只在同口径同币种内相加；按口径分别汇总，不给跨口径的总数 |

## 2. 验收项对应

| 任务书验收项 | 测试 |
|---|---|
| A3 九家文件领取方不产生九个投标人 | `document-holders.test.ts`：领取方数 9，投标人数为未知（不是 0，也不是 9）；有开标记录时投标人数来自开标记录 |
| A4 别名可复核，不自动合并不同实体 | `document-holders.test.ts`：只差后缀只给建议；Pest 与 Pet 不建议；否决后不再建议；确认一对不波及相近的另一家 |
| A5 2024 年的运单只是关联线索 | `leads-and-sources.test.ts`：状态为线索、标为历史；用旧证据确认被拒；当期证据加确认人才升级 |
| A6 未接通的贸易数据连接器报「未接通」，不造数据 | `leads-and-sources.test.ts`：缺省未接通、记录为空、取数函数不被调用；与「查无结果」是两种状态 |
| A15 评标总价、实付、预算估计互不相加 | `amount-measures.test.ts`：混口径拒绝；按口径分别汇总；结果里没有跨口径总数 |

## 3. 测试输出（实际运行）

```text
tender-competition document-holders: 25 passed
tender-competition leads-and-sources: 24 passed
tender-competition amount-measures: 15 passed
```

门禁：

```text
bash scripts/check-test-registry.sh → OK 测试注册校验通过：已注册 572 个；历史欠账基线剩余 68 条（只减不增）
bash scripts/test-runtime-architecture.sh → runtime-architecture guards PASS
npm run typecheck → 通过（tsc --noEmit，退出码 0）
npm run lint:baseline → PASS（无新增 error fingerprint / 无 count 上升）
openspec validate tender-competition-leads --strict → Change 'tender-competition-leads' is valid
```

三个新测试已登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`ci/test-registry-baseline.txt` 没有新增。

## 4. 几条规则的取舍

- **投标人数没有记录时是「未知」，不是 0。** 0 是一个断言（没人投标），未知不是。领取方数与投标人数是两个字段，代码里没有从一个推另一个的函数。
- **名称比对不用相似度。** 建议只有两条确定性依据：只差公司后缀；一方按整词完整包含另一方（短的一方至少两个词）。`Pest` 与 `Pet` 只差一个字母，不会被建议。代价是商号与法定名称完全不同的同一家公司不会被发现，只能人工添加。
- **`X Inc.` 与 `X Ltd.` 只给建议，不判同名**——可以是两个不同的法人。
- **进口线索没有自动升级路径。** 同一对进口商 / 出口商出现多票历史运单，仍然是历史。
- **需要登录的门户恒为「按纪律禁用」**，配置成已接通也无效（硬纪律第 5 条）。真要改，应先改 `openspec/config.yaml`，再改这段代码与测试。
- **缺省清单里没有任何来源是「已接通」。** 状态是声明，不是探测；接通一个来源要由后续 change 显式改配置并带测试。

## 5. 复用

- 名称规范化：`src/lib/corporate-memory/normalize.ts`（授标记录的中标方名称用的同一规则）。
- 金额口径词表：`src/lib/procurement-records/labels.ts`，在其上补「授标值」「预算估计」。
- 时区校验：TI-1 的 `src/lib/tender-price-schedule/closing-time.ts`。
- 测试里的公司名全部虚构。

## 6. 没做的

- 没有接任何真实数据源；没有识别截图，快照条目由调用方给出。
- 没有落库、接口、页面、开关：本次的代码线上不可达。
- 进口线索没有写成供应商线索（`SupplierDiscoverySignal`）——那需要在供应商情报的平台目录里加一类，留给持久化那个 change。
- 可投标判定与阶段策略表在 TI-3b。
