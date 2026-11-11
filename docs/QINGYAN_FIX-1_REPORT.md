# FIX-1 报告：询价单按类别筛要求时认得入库的写法

| 项 | 值 |
|---|---|
| change | `rfq-requirement-category-match` |
| TASKFLOW | FIX-1（Phase F，Tender Intelligence 前置修复） |
| 来源 | `docs/tender-intelligence-gap-analysis.md` §8 第 1 项；Owner Gate A 第 8 项（Lucas 2026-11-11） |
| 分支 | `claude/rfq-requirement-category-match` |
| 性质 | 零 schema、零模型调用、不触碰出站与审批 |

## 1. 缺陷

询价生成器只收类别在大写清单（`PRODUCT`、`TECHNICAL`…）里的已确认要求，比较区分大小写。库里的类别是小写（V2 分析入库时 `toLowerCase`）或旧式代码（V1 分析写 `mandatory_technical` / `mandatory_general`），询价服务把库里的值原样传入。结果：用真实分析数据发起询价，全部要求被判为「不属于供应商侧」，返回 `NO_CONFIRMED_REQUIREMENTS`，项目页显示「还没有已确认的要求」，询价发不出去。

原有 21 项测试全部使用大写样例，所以没有发现。

## 2. 复现（改之前）

只读脚本直接调用生成器：

```text
测试里用的大写 → ok，行项 2 条
V2 入库值（小写） → 失败 NO_CONFIRMED_REQUIREMENTS
V1 入库值（旧式代码） → 失败 NO_CONFIRMED_REQUIREMENTS
```

先加测试、不改实现时，`npx tsx src/lib/tender-rfq/__tests__/build.test.ts` 在第一条新用例处失败：

```text
AssertionError [ERR_ASSERTION]: 小写入库的类别照常进入询价单（3 条）
```

## 3. 改动

- `src/lib/tender-rfq/build.ts`
  - 新增类别归一：去首尾空白 → 转大写 → 旧式代码映射 → 得到标准类别，或「不属于供应商侧」。
  - 旧式代码映射表只有一项：`mandatory_technical` → 技术类。`mandatory_general` 不在表里，不进询价单。
  - 类别判定与行项上的类别都改用归一后的值；「请随报价提供」清单读的是行项类别，随之对小写入库的样品 / 图纸 / 安全 / 质保生效。
- `src/lib/tender-rfq/__tests__/build.test.ts`：新增 10 项。

没有改：入库写法（`v2-map` 仍写小写）、询价服务、Web 入口、审批、发送、回信、催单、比价；数据库与接口结构。

## 4. 测试（改之后，实际运行）

```text
build.test.ts: tender-rfq: 31 passed
round-pure.test.ts: tender-rfq round-pure: 31 passed
inbound-parse.test.ts: tender-rfq inbound-parse: 38 passed
inbound-apply.test.ts: tender-rfq inbound-apply: 72 passed
landed-cost.test.ts: tender-rfq landed-cost: 70 passed
compare.test.ts: tender-rfq compare: 47 passed
interpretation-guard.test.ts: 29 passed
notes-parse.test.ts: tender-rfq notes-parse: 17 passed
chase-pure.test.ts: tender-rfq chase: 55 passed
chase-execute.test.ts: tender-rfq chase execute: 23 passed
web-entry-pure.test.ts: W-1 web-entry-pure: 122 passed
tracking-notify-pure.test.ts: T-1 tracking-notify-pure: 127 passed
tracking-notify-wiring.test.ts: tracking-notify-wiring: 67 passed, 0 failed
tracking-notify.test.ts: T-1 tracking-notify: 33 passed
```

`build.test.ts` 由 21 项变为 31 项，原 21 项不变。新增 10 项：

| 用例 | 对应规格 |
|---|---|
| 小写入库的类别照常进入询价单（3 条） | 类别判定不区分写法 |
| 带空白与混合大小写与大写判定相同 | 同上 |
| 分析契约 21 个类别大小写两种写法判定一致 | 同上（双源一致） |
| 分析契约里供应商侧类别恰为 10 个 | 只收已确认的供应商侧要求 |
| 旧式代码 `mandatory_technical` 进入，行项类别为技术类 | 旧式类别代码的归属 |
| 旧式代码 `mandatory_general` 不进入，记 `not_supplier_facing` | 同上 |
| 未知与空类别不进入，记 `not_supplier_facing` | 未知类别不进入 |
| 小写 `samples` 触发样品提示，行项类别为标准写法 | 行项类别与附件提示 |
| 全部非供应商侧 → `NO_CONFIRMED_REQUIREMENTS` | 没有可收入的要求时不生成 |
| 归一不放进未确认的要求 | 只收已确认的供应商侧要求 |

同一只读脚本改后的输出：

```text
测试里用的大写 → ok，行项 2 条
V2 入库值（小写） → ok，行项 3 条
V1 入库值（旧式代码） → ok，行项 1 条
```

门禁：

```text
bash scripts/check-test-registry.sh → OK 测试注册校验通过：已注册 560 个；历史欠账基线剩余 68 条（只减不增）
openspec validate rfq-requirement-category-match --strict → Change 'rfq-requirement-category-match' is valid
npm run typecheck → 通过（tsc --noEmit，退出码 0）
npm run lint:baseline → PASS（无新增 error fingerprint / 无 count 上升；current errors=38，baseline errors=53）
```

## 5. 上线后可见的变化

- 要求已确认的招投标项目，「问供应商要价」从「还没有已确认的要求」变为可以发起；入口上「已确认要求 N 条」显示真实条数。Muse `rfq` 意图同样改正，响应结构不变。
- 询价邮件正文里会出现此前带不上的要求。出站仍然只经 `tender.send_rfq` 审批卡，批准前零出站。

**首次使用请核对**：修复后第一次发询价时，在审批卡上把正文从头看一遍，确认带上的要求都适合发给供应商。尤其是 V1 引擎分析的老项目——`mandatory_technical` 一类按技术类进入，粒度比 V2 粗。

## 6. 没做的

- 没有用生产数据复现；复现用的是与入库写法一致的构造数据。
- 「没有可发要求」的提示文案没有区分「没确认」与「确认了但都不属于供应商侧」。
- 数量与单位在入库时被丢弃的问题不在本次范围（FIX-2）。
- 没有回填或迁移任何数据。
