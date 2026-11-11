# Design：招标分析保留数量与单位，价格表从分析带入（FIX-2）

## Context

读代码确认的现状：

- V2 分析的结果里，每条要求有 `quantity`、`unit`（都是原文字符串，可空）；提示词还要求把价格表的行、数量上限抽成 `quantity` 类型的事实（`claim` 是那一行的说法，`rawValue` 是原文值）。
- `src/lib/tender-auto-analysis/v2-map.ts` 把结果映射成入库的形状时，要求只留了类别、原文、是否强制、页码；事实只留了说法与原文。**数量与单位在这里被丢掉。**
- `TenderExtractedRequirement` 没有数量或单位的列。同一次分析的各节（`TenderAnalysisSection`）有一个 `structuredJson` 列，已有几节在用（风险、关键事实、提交清单）；「价格与评标」一节现在传的是 `null`。对外的序列化（`serializeSection`）不输出这一列。
- 投标工作区的价格表（TI-4b）只有「粘贴导入」：前端用 `parseSchedulePaste` 解析制表符分隔的文本，人看过解析结果后点保存，经既有接口与结构校验落库。列序固定：行号、说明、数量、单位、包装数、尺寸、最小尺寸、认证要求。数量只接受数字，单位要在封闭的目录里（`Each`、`Pack`、`Box`、`Roll`、`Pair`、`Set`、`Case`、`Bag`、`kg`、`m`、`ft`、`sqft`）。

## Goals / Non-Goals

**Goals**

- 分析已经抽到的数量与单位不再丢。
- 人不用从招标文件里手工转录价格表的行。
- 看不准的不猜；每一行都有人看过才进价格表。

**Non-Goals（具体到文件）**

- 不改 `prisma/schema.prisma`。
- 不改抽取：`src/lib/tender-understanding/**`（提示词、契约、归一、去重）一行不动。
- 不改价格表的规则：`src/lib/tender-price-schedule/**`、`src/lib/tender-bid-workspace/paste-import.ts`、`store.ts`、`contract.ts`、保存接口 `src/app/api/projects/[id]/bid-workspace/route.ts`。
- 不改询价、自动起草、Muse。

## Decisions

### D1 存在「价格与评标」一节的结构化字段里

`structuredJson = { scheduleCandidates: { version: 1, items: [...] } }`。每项：`source`（`requirement` / `fact`）、`code`（要求编号，事实为空）、`description`、`quantityText`、`unitText`、`page`。

- 否决：给 `TenderExtractedRequirement` 加 `quantity` / `unit` 两列。最直接，但违反零 schema，要生产迁移；而且数量类事实不是要求，放不进去。
- 否决：放进分析的 `summaryJson`。那里已经有摘要、分析师综合等内容，对话上下文会整块读它；数量线索可能有上百条，会把提示词撑大。
- 否决：新增一种节（新的 `sectionKey`）。节的种类对应报告的章节，界面按它渲染；多一种会多出一章空白。
- 带 `version`：以后改形状时读取方能认出旧数据。没有 `scheduleCandidates` 这个键 = 分析是在本功能之前做的（与「有键但清单为空」区分）。

### D2 入库时原样保存，转换放在读取时

入库只存原文（数量原文、单位原文）；「取哪个数字」「单位怎么规整」在带入时算。

- 否决：入库时就算好数字与单位。规则以后会调（对照表加一项、范围怎么处理），算好的结果改不了，原文可以重新算。

### D3 数量：原文里恰好一个数字才取

去掉千分位逗号后找数字。恰好一个 → 取；零个 → 「没有数字」；`100-200`、`100 to 200`、`between … and …` → 「是一个范围」；其余多个 → 「有不止一个数字」。

- 否决：取第一个数字。`3 lots of 50`、`100-200` 取第一个都是错的，而且错得不显眼。
- 否决：范围取上限 / 下限 / 中间值。这是报价上的判断，不该由系统做。
- 代价：`approx. 120 per year` 这类能带入，`120 (2 per room)` 这类带不进来——列在「没带入」里，人自己填。

### D4 单位：固定对照表，认不出的原样保留

`ea / each / pc / pcs / piece(s) / unit(s) → Each`；`pk / pack(s) / pkg → Pack`；`bx / box(es) → Box`；`rl / roll(s) → Roll`；`pr / pair(s) → Pair`；`set(s) → Set`；`cs / case(s) → Case`；`bag(s) → Bag`；`kg(s) / kilogram(s) → kg`；`m / meter(s) / metre(s) → m`；`ft / foot / feet → ft`；`sqft / sq ft / sf / square feet → sqft`。不分大小写，去掉末尾的句点。

- 否决：模糊匹配或让模型判断。`LF`（延长英尺）与 `ft` 不是一回事，认错了数量就差出去了。认不出的留原文，既有校验会把它标红，人来改。

### D5 带入只填粘贴框，不保存

按钮把生成的文本放进既有的粘贴框，后面的解析、预览、保存、校验全是既有流程。

- 否决：一键生成价格表并保存。分析会漏行、会把上限当数量；价格表是报价的基础。
- 否决：做一个专门的逐行勾选界面。粘贴框本来就能改、能删行，够用；专门的界面是下一步的事。
- 粘贴框里已经有内容时先确认再替换。

### D6 只读接口单独一条，不并进工作区的主接口

`GET /api/projects/{id}/bid-workspace/schedule-candidates`，点按钮时才请求。

- 否决：并进 `GET …/bid-workspace` 的响应。每次打开项目页都会多读一节的 JSON，而带入是偶尔才点一次的动作。

读取时：取项目最新一份等待审核或已批准的分析（与询价单取要求用的是同一条规则）；来自要求的线索，按要求编号对一下现在的审核状态，已驳回的不返回。

### D7 接口与界面的门槛

读权限即可看（它只读招标文件里的数量）；沿用投标工作区的功能开关 `TENDER_BID_WORKSPACE_ENABLED`，关闭时 404。按钮只对能保存价格表的人显示（与「粘贴导入」同一个条件）。

## 与八条硬纪律的关系

1. **零 schema**：遵守。数量线索存在既有的 `TenderAnalysisSection.structuredJson`（同一列已有三节在用），不新增表、列、迁移。
2. **出站先审批**：不涉及。没有任何对外发送；价格表本身也不出站。
3. **禁止第三套队列**：遵守。没有新增后台执行；入库仍在既有的分析流程里。
4. **脱敏**：遵守。数量与单位来自招标文件；接口的响应不含任何金额（毛利率、估值、我方报价都不在其中）；Muse 通道没有新增内容。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。数量的取法与单位的对照都是查表；不新增模型调用，不改提示词。
8. **测试注册**：两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-bid-workspace/__tests__/schedule-prefill.test.ts`（新）：从分析结果收集数量线索（含被取代的、不带数量的）；数量的取法逐条；单位对照逐条；去重；生成的文本交给既有的 `parseSchedulePaste` 逐项相同；说明里有制表符 / 换行 / 引号；读旧数据（没有键、形状不对、版本不认识）；接线的源码断言。
- `npx tsx src/lib/tender-bid-workspace/__tests__/schedule-prefill-db.isolated.test.ts`（新，本地隔离库，经真实路由处理函数）：有线索、被驳回的不返回、没有分析、旧分析、另一个项目的不返回、权限与开关、接口不写库。
- `npx tsx src/lib/tender-auto-analysis/__tests__/v2-map.test.ts` 等读到 `v2-map.ts` 的既有测试：不改断言即通过（`grep -rln "v2-map" src --include=*.test.ts` 全部重跑）。
- 全量：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`。
- 真实应用截图（本地库、演示数据）两张，存 `docs/acceptance/fix-2/`：带入后的粘贴框与原文对照、保存后的价格表。
- 开 PR 前请一个不带结论的独立审查（重点：多租户隔离、取数字的规则有没有会悄悄取错的情形、生成的文本会不会被解析成别的行）。
- `openspec validate analysis-quantity-unit-prefill --strict`。

## Risks / Trade-offs

- **分析抽得不全或不准，带入的行就不全或不准。** 界面写明「需要逐行核对」，每一行旁边有原文与页码；不保存。
- **数量类事实常常没有单位**，带入后单位一列为空，既有的解析会报「缺单位」，人来补。
- **上限、估计量被当成数量**（`up to 500`、`approx. 120 per year`）。原文就在旁边；这是人核对时要看的。
- **本功能之前做的分析没有数量线索**，要重新分析才有。
- **隔离库测试在 CI 里跳过**（仓库现状）：本地跑并在报告里写明。

## Migration Plan

无数据迁移。上线后新做的分析才带数量线索；旧分析的行为与现在相同（按钮会提示重新分析）。回滚 = 回滚代码；已经存下的数量线索留在 JSON 里，没有读取方，不影响任何东西。

## Open Questions

无。
