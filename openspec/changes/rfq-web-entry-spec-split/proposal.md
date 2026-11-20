# Proposal：拆短 `tender/rfq-web-entry`「原地审批与待批轮次保护」（CHAIN-4c）

TASKFLOW：CHAIN-4c（新增一行；Phase F（续）— 情报串联的后续；交接文档第四十四次 §0.5h「之后还有什么」第 4 条，Lucas 2026-11-20「拆短 tender/rfq-web-entry 里 522 字的那条要求，让 openspec validate --strict 对这份规格通过，不改行为」）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

CHAIN-4a 归档（LucasJ880/-#527）的 MODIFIED 增量把「原地审批与待批轮次保护」的正文从 351 字撑到 522 字，超过校验器的 500 字上限，`openspec validate --specs --strict` 因此 143 过 1 不过，不能再当 GATE 用。

## What Changes

- 移除「原地审批与待批轮次保护」，拆成下面两条新增要求（OpenSpec 不允许 MODIFIED 丢场景、也不允许同名既删又加，所以原条换一个名字重新加，见 design D2）。
- 新增要求「询价卡的原地审批与待批轮次保护」：原条去掉 CHAIN-4a 那句例外后的正文（351 字，与 CHAIN-4a 之前的原条逐字相同）加一句不含 SHALL 的指引「带询价单 PDF 的卡对不上时的例外，见「询价单 PDF 对不上时只给驳回」。」（共 390 字），四个场景逐字不变。
- 新增要求「询价单 PDF 对不上时只给驳回」：承接移出的那句例外（只把开头「例外（CHAIN-4a）：卡带……」补全为「本条是「询价卡的原地审批与待批轮次保护」的例外（CHAIN-4a）：待批的发询价卡带……」，规范性语句逐字不变），并带走原来挂在原条下面的场景「询价单 PDF 对不上时只给驳回」（逐字不变）。

## Out of scope

- 不改 `tender/rfq-supplier-attachment`（「卡上提前说附件已变」的说明文字照旧由它规定，新要求照旧引用它）。
- 不改其它规格里接近 500 字的要求（本规格「生成并送审」473 字、「可选供应商与默认条款」452 字，都没超）。
- 不改任何代码、测试、界面文字。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/rfq-web-entry`：一条要求拆成两条（REMOVED 1 条、ADDED 2 条），行为不变。

## Impact

- 只改 `openspec/changes/rfq-web-entry-spec-split/**`；归档后改 `openspec/specs/tender/rfq-web-entry/spec.md`。
- 不改任何行为：本规格的要求数 13 → 14、场景总数 35 不变，规范性语句只搬位置，不增不减；不改代码、测试与其它规格。
- 零 schema、零代码、零依赖。
