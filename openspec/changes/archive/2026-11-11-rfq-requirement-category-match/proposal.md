# Proposal：询价单按类别筛要求时认得入库的写法

TASKFLOW：FIX-1（Phase F，Tender Intelligence 前置修复；来源 `docs/tender-intelligence-gap-analysis.md` §8 第 1 项，Owner Gate A 第 8 项已拍板）。

## Why

询价生成器只收类别在大写清单（`PRODUCT`、`TECHNICAL`…）里的已确认要求，且比较区分大小写；而分析结果入库的类别是小写（`product`）或旧式代码（`mandatory_technical`），中间没有转换。结果是：用真实分析数据发起询价，全部要求被判为「不属于供应商侧」，返回 `NO_CONFIRMED_REQUIREMENTS`，询价发不出去。

复现（2026-11-11，只读脚本直接调用生成器）：大写类别 → 行项 2 条；小写类别 → `NO_CONFIRMED_REQUIREMENTS`；旧式代码 → `NO_CONFIRMED_REQUIREMENTS`。现有 21 项测试全部使用大写样例，所以没有发现。

## What Changes

- 让询价单的类别判定不区分大小写、忽略首尾空白：`product`、`Product`、` PRODUCT ` 与 `PRODUCT` 判定相同。
- 把旧式类别代码 `mandatory_technical` 判为技术类（进入询价单），`mandatory_general` 判为非供应商侧（不进入）。
- 让询价单行项与「请随报价提供」清单按归一后的类别工作：小写入库的 `samples` / `shop_drawings` / `safety` / `warranty` 与大写一样触发对应的附件提示。
- 保持未知类别、空类别不进入询价单，并在排除清单里标 `not_supplier_facing`。
- 新增一组用入库真实写法的测试，并加一条「双源一致」断言：分析契约里的每个类别，小写写法与大写写法的判定结果必须相同。

不改的行为：只收已确认的要求；敏感内容整单拦截；一条都没有时仍返回 `NO_CONFIRMED_REQUIREMENTS`；数量阶梯、回复截止、编号问题的生成；审批、发送、回信入表、催单、比价。

## 受影响的 Muse 意图

- `rfq`：与 Web 入口共用同一询价生成流程，行为随之改正（能带上要求）；响应结构不变。
- 其它意图（`status` / `ask` / `compare` / `chase` / `price_scenario` / `next_step` / `preferences` / `set_preference` / `approve` / `reject`）不受影响。

## Out of scope

- 不改分析结果入库时的类别写法（`v2-map` 仍写小写；改它会影响 Bid-fit 分组、采购视图等已按小写工作的模块）。
- 不回填、不迁移任何已有数据；不动数据库结构。
- 不改「没有可发要求」时的提示文案，不区分「没确认」与「确认了但都不属于供应商侧」。
- 不处理数量与单位在入库时被丢弃的问题（FIX-2 另开）。
- 不改询价单以外按类别工作的模块。
- 不新增任何模型调用、出站动作、审批类型、定时任务。

## Capabilities

### New Capabilities

- `tender/rfq-requirement-selection`：询价单收入哪些招标要求——已确认状态与供应商侧类别的判定规则，以及不收入时如何留痕。

### Modified Capabilities

无。`tender/rfq-web-entry` 规定的是 Web 入口的对外行为，其中的不可发原因、提示文案与接口结构都不变。

## Impact

- 代码：`src/lib/tender-rfq/build.ts`（类别判定与行项类别）；测试 `src/lib/tender-rfq/__tests__/build.test.ts`。
- 调用方：`src/lib/tender-rfq/service.ts`（Web 与 Muse 共用）、`src/lib/tender-rfq/web-entry.ts`（「已确认要求 N 条」的计数随之变为真实条数）——都不需要改。
- 数据库、接口结构、环境变量、依赖：无变化。
- 上线后可见变化：此前因本缺陷显示「还没有已确认的要求」的项目，在要求已确认的前提下变为可以发起询价。出站仍然只经 `tender.send_rfq` 审批卡。
