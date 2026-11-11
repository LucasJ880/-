# Proposal：招标分析保留数量与单位，价格表可以从分析带入

TASKFLOW：FIX-2（Phase F 续）
来源：交接文档 §0.5b 第 2 项；Lucas 2026-11-11「PR 开了之后，就做 FIX-2」。

## Why

招标分析（V2）抽出的每条要求与数量类事实本来就带着数量和单位的原文，但入库时被丢掉了；投标工作区的价格表因此只能从发标方的文件里手工复制粘贴，一个标几十行就要转录几十行。

## What Changes

- 让招标分析入库时保留数量线索：每条带数量的要求、每条数量类事实，记下说明、数量原文、单位原文、页码、来自哪条要求。存在该次分析「价格与评标」一节已有的结构化字段里，不新增表与字段。
- 新增一个纯函数，把数量线索变成价格表粘贴框认得的行：数量取原文里能确定的那个数字，单位按一张固定的对照表规整（`EA`、`pcs` → `Each` 等），其余原样保留；同一行重复出现的只留一条。
- 新增接口 `GET /api/projects/{id}/bid-workspace/schedule-candidates`：返回当前有效的那份分析里的数量线索、生成的粘贴文本、没能带入的条目及原因。已被人驳回的要求对应的线索不返回。
- 在投标工作区的「粘贴导入」里加一个按钮「从招标分析带入」：把生成的文本填进粘贴框，下方列出每一行对应的原文与页码。**不自动保存**——人核对、修改后仍点原来的「保存」。
- 说明清楚带不进来的情形：数量看不出一个确定的数字（「按需」「待定」「100–200」）的不带入并列出；这份分析是在本功能之前做的，提示重新分析。

## 受影响的 Muse 意图

无。不改 muse-bridge 的代码；Muse 通道没有新增内容。

## Out of scope

- 自动把带入的行保存进价格表：不做。分析的抽取会漏、会错，行项是报价的基础，必须有人看过。
- 用模型把招标文件里的价格表整表还原：不做（确定性优先；不新增模型调用）。本次只保留现有分析已经抽出来的东西。
- 改招标分析的抽取提示词、让它多抽或抽得更准：不做。
- 尺寸、包装数、认证要求这几列的带入：不做（分析结果里没有可靠的对应字段），带入后这几列为空，由人补。
- 给本功能之前做的分析补数据：做不到，需要重新分析。
- V1 分析引擎的结果：不涉及（它没有数量与单位字段）。
- schema 变更、定时任务、新的功能开关：都没有（沿用 `TENDER_BID_WORKSPACE_ENABLED`）。

## Capabilities

### New Capabilities

- `tender/price-schedule-prefill`：招标分析保留数量线索；数量线索到价格表行的确定性转换；带入接口；工作区里的带入按钮。

### Modified Capabilities

无。价格表的保存、校验、粘贴导入的规则都不变。

## Impact

- `src/lib/tender-auto-analysis/v2-map.ts`：「价格与评标」一节的结构化字段从空改为带数量线索。
- 新增 `src/lib/tender-bid-workspace/schedule-prefill.ts`（纯函数）与读取函数；新增路由 `src/app/api/projects/[id]/bid-workspace/schedule-candidates/route.ts`。
- `src/components/tender/bid-workspace-panel.tsx`：粘贴导入区多一个按钮与一段说明。
- 不改 `prisma/schema.prisma`、`src/lib/tender-understanding/**`（抽取与提示词）、`src/lib/tender-bid-workspace/paste-import.ts`、`store.ts`、`src/lib/tender-price-schedule/**`、价格表的保存接口。
