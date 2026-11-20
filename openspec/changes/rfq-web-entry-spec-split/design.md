# Design：拆短 `tender/rfq-web-entry`「原地审批与待批轮次保护」

## Context

校验器对每条要求的正文（标题与场景之间的文字）有 500 字上限（`MAX_REQUIREMENT_TEXT_LENGTH`），strict 下超限即失败。`openspec/specs/tender/rfq-web-entry/spec.md` 第 6 条「原地审批与待批轮次保护」正文 522 字：351 字是 RFQ-AUTO 时写的「能批的人原地批准 / 驳回、不能批的人看到什么、待批轮次不能手工标记发送」，171 字是 CHAIN-4a 加的「询价单 PDF 对不上时只给驳回」例外。

## Goals / Non-Goals

**Goals**：`openspec validate tender/rfq-web-entry --type spec --strict` 通过；规范性语句与场景逐字保留（新条开头补主语、原条换名除外）。

**Non-Goals**：
- 不改 `openspec/specs/tender/rfq-supplier-attachment/spec.md`。
- 不改 `src/components/tender/**`、`src/lib/tender-rfq/**` 里任何代码或测试。
- 不改本规格其它 12 条要求。

## Decisions

### D1：按「一件事一条」拆出 CHAIN-4a 的例外

把例外那句整段搬进新要求「询价单 PDF 对不上时只给驳回」，原条删去这句；挂在原条下的场景「询价单 PDF 对不上时只给驳回」随之搬到新条下。原条剩下的正文仍是一件事（原地审批与待批轮次保护）。

- 备选 A：把原条压缩措辞到 500 字以内。否决：要改写规范性语句，改写本身就有改变含义的风险，审查也只能逐字比对改写前后。
- 备选 B：按三件事拆成三条（原地审批 / PDF 例外 / 待批轮次保护）。否决：要给原条改名（RENAMED），波及引用它的交接文档与报告；两条就够过限，拆三条只是多挪一次。

### D2：REMOVED 原条、ADDED 两条，原条换名「询价卡的原地审批与待批轮次保护」

本想原条用 MODIFIED、不改名，但 OpenSpec 1.15 的校验器不允许 MODIFIED 丢掉现有场景（「MODIFIED … omits scenario(s) the current spec still has」，archive 会拒绝），也不允许同一个名字既在 REMOVED 又在 ADDED（「Requirement present in both ADDED and REMOVED」）——两条都实测过。所以：REMOVED「原地审批与待批轮次保护」（写明 Reason 与 Migration），ADDED「询价卡的原地审批与待批轮次保护」（原条去掉例外后的正文与四个场景）与「询价单 PDF 对不上时只给驳回」。新名字只在原名前加「询价卡的」，读者一看就知道是同一条。引用旧名字的只有交接文档 §0.5h（说它超长，本 change 合并后那句话本身就过时，归档时一并改）。

- 备选 A：原条 MODIFIED 保留 PDF 那个场景、新条另写一个不同名的场景。否决：原条正文不再说 PDF 例外，场景却还在描述它，正文与场景对不上；同一行为写两遍。
- 备选 B：RENAMED + MODIFIED。否决：校验器沿改名链照样比对场景，同样不允许丢。

### D3：新条第一句写出它约束的是谁

移出的那句原来以「例外（CHAIN-4a）：」开头，依赖上一句的「批准并发送」语境。新条开头改为「待批询价卡带询价单 PDF、且读卡时……」——只是把主语补全，「SHALL NOT 显示」「SHALL 仍看到」「看到……」三个规范性语句与其中的文字逐字不变。

## 八条硬纪律

1. 零 schema：不涉及（不改 `prisma/`）。
2. 出站先审批：不涉及（只搬规格文字，审批与发送行为不变）。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：不涉及（零新增模型调用）。
8. 测试注册：不涉及（不新增测试文件）。

## 验证方式

- `npx openspec validate rfq-web-entry-spec-split --strict` valid。
- 归档后 `npx openspec validate tender/rfq-web-entry --type spec --strict` valid、`npx openspec validate --specs --strict` 全过。
- 一段 python 脚本比对归档前后：两条的规范性句子（按「SHALL」切分）与场景文字合起来与原条逐字相同（除新条开头补的主语），场景总数不变。
- 新条场景引用的两条测试命令照旧通过：`npx tsx src/lib/tender-rfq/__tests__/attachment.test.ts`、`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/attachment-db.isolated.test.ts`。

## Risks / Trade-offs

- 拆开后读者看「询价卡的原地审批与待批轮次保护」时不再直接看到 PDF 例外；新条由 CLI 追加在规格末尾，不与它相邻。可接受：新条第一句写明它是哪一条的例外，标题自带含义；原条不加反向引用（会再次逼近上限）。
- 原条换了名字：外部引用旧名的只有交接文档（见 D2）；代码与测试不引用要求名。
