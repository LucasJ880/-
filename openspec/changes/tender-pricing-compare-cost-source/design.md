# Design：比价矩阵里选定的供应商落地价，作为报价表助手的成本来源（FLOW-H2）

> **状态：四件套待 Lucas 审，未实施。** 涉及价格计算，按约定先审。末尾「待审问题」Q1–Q5 每条都写了推荐；审的时候只要回「都按推荐」或逐条改。

## Context

- **报价表助手**：卡片 `src/components/tender/pricing-helper-card.tsx`（挂在工作台页签），接口 `src/app/api/projects/[id]/pricing-helper/route.ts`。三项人工输入：竞品价、我方成本 `ourCostCad`、目标毛利 `targetMarginPct`，存在 `BidIntelligenceRoom.summaryJson.pricingInputs`。GET 要项目读权限，POST 要写权限。计算在 `src/lib/tender-pricing/calc.ts`：只按售价算毛利 `(p − K) ÷ p`，成本底线 `K ÷ (1 − m)`。
- `ourCostCad` 还被两处读：情报备忘录（`src/lib/tender-intel/orchestrate.ts:439`）、标书草稿取数（`src/lib/tender-bid-draft/gather.ts:131`）。填进来的数字会照常流到这两处——这是保存成本本来的效果，本次不改。
- **落地价**：`src/lib/tender-rfq/landed-cost.ts` 的 `normalizeQuote`（纯函数）：币种按组织设置的汇率换 CAD；按贸易条款加内陆 / 海运 / 保险 / 关税 / 清关（EXW 全加，FOB / FCA 加海运起，CIF / CIP / DAP 只加关税与清关，DDP 不加）。**没有 GST/HST**——这是对的（进口 GST/HST 可抵扣），但比价矩阵结论写的是「到目的地含税」，容易被读成含 GST。逐项金额在函数里算了，只返回总价和文字假设。
- **比价矩阵**：`compare-service.ts` 的 `loadCompareMatrix`（指定轮次或最新一轮的已报价条目；数量 = 询价单正文里的首档数量）→ `compare.ts` 的 `buildCompareMatrix`。不落库，每次现算。没有网页上的矩阵界面；Muse 通过 `projectScenariosForMuse` 取（决定 A：取 supplierItemId > 推荐 > 最低价）。
- **选定**：`InquiryItem.isSelected`，每轮只有一条（`inquiry/service.ts` 的 `selectItem`，事务里先清再设），只有已报价的能选定。人在询价区点「选定」。
- **TI-2 成本核算表**（`src/lib/tender-bid-cost/`）是另一套：按价格表逐行、两种口径（按售价 / 按成本）、算 GST 进项抵扣、限财务角色、开关 `TENDER_BID_WORKSPACE_ENABLED`。与询价报价没有连接。本次不碰。

## Goals / Non-Goals

**Goals**

- 人在报价表助手上看到「比价矩阵里选定那一家，到加拿大的落地价是多少、含哪几项、不含 GST/HST」，一键填进我方成本，保存后知道这个成本是从哪一轮哪一家来的。
- 矩阵变了，人知道自己的成本过时了。

**Non-Goals（具体到文件）**

- 不改 `src/lib/tender-pricing/calc.ts` 的计算（只在卡片上加换算显示）。
- 不改 `src/lib/tender-bid-cost/**`、`src/lib/tender-bid-workspace/**`（TI-2）。
- 不改 `src/lib/muse-bridge/**`；`projectScenariosForMuse` 的取法不变（决定 A）。
- 不改 `src/lib/inquiry/service.ts`（选定的写入）。
- 不改 `src/lib/tender-intel/orchestrate.ts`、`src/lib/tender-bid-draft/**`（它们读 `ourCostCad` 的方式不变，不读来源）。
- 不改 `prisma/schema.prisma`。

## Decisions

### D1 只取人工选定，按轮次从新到旧找第一轮有选定的

「所选供应商」= 人点过「选定」的那一条。最新一轮没有选定、更早一轮有，就用更早那一轮，并写明「之后还有第 M 轮尚未选定」。

- 否决：选定 > 推荐 > 最低价（Muse 的取法）。推荐和最低价是代码挑的，没人拍板；拿它当成本，备忘录和标书草稿会把它当成我方成本往下用。Muse 那边只是给人看情景，可以这样取；这边是写进成本，应当要人选过（Q1）。
- 否决：只看最新一轮。新开了一轮、还没回价，成本建议就没了，人会以为功能坏了。

### D2 复用比价矩阵的取数与换算，不另算

按 D1 找到的那一轮调用 `loadCompareMatrix({ projectId, orgId, inquiryId })`，`orgId` 取服务端鉴权得到的项目组织，从矩阵行里按 `itemId` 取那一条。数量、汇率、关税率、贸易条款处理全部与矩阵一致。

- 否决：直接从 `InquiryItem` 读单价乘数量。会和矩阵算出两个数。

### D3 逐项金额：在纯函数里多返回一项

`normalizeQuote` 多返回 `breakdownCad: { goods, inland, freight, insurance, duty, clearance }`（不加的项为 null）。总价、假设文字、警告、阻断项不变。卡片按这几项列出来，海运与关税单独一行，并固定写「不含 GST/HST（进口 GST/HST 可抵扣，不计入成本）」。

- 否决：只显示总价和假设文字。纪律要求「区分毛利率、成本加成、海运、关税及可抵扣税款」，一个总价看不出来。
- 否决：解析假设文字拿金额。文字是给人看的，格式会变。

### D4 只建议；按钮只填输入框

建议一行 + 按钮「用这个作为我方成本」，按钮只改表单里的值，人点「保存并重算」才写入。读取时永远按已保存的计算。已保存的是手填数字也照样显示建议，但不动它。

- 否决：没有保存过成本时自动用建议。人看到情景表会以为成本是自己定的；也违背「手填可覆盖」的本意——要人知道这是哪来的（Q2）。

### D5 来源由服务端核对后才记

保存请求可以带 `ourCostSource: { kind: "rfq_compare", inquiryItemId }`。服务端按 D1、D2 重新算一遍：这一条必须是当前登录者有权写的这个项目里、某一轮的选定条目，且重新算出的落地价与 `ourCostCad` 相差不到 0.005；满足才在 `pricingInputs` 里写 `ourCostSource: { kind: "rfq_compare", inquiryId, inquiryItemId, roundNumber, supplierName, landedCadTotal, quantityBasis, recordedAt }`。否则写 `{ kind: "manual" }`。请求里只认 `inquiryItemId`，不认金额、轮次、组织。

- 否决：请求带什么就记什么。来源就成了客户端说了算，违背「成本参数必须能追溯来源」。
- 否决：另建一张表记来源。零 schema；`pricingInputs` 本来就是这几项输入的家。

### D6 矩阵变了只提示

读取时，已保存的来源是比价矩阵、而当前建议的条目或落地价（到分）与记下的不同，返回一句：「比价矩阵现在是 B 家第 N 轮 Y CAD，已保存的我方成本是 X CAD（按 A 家第 M 轮）」。手填的不提示。

- 否决：自动跟着矩阵改。人可能是有意保留旧数字（例如已经和供应商谈定）。

### D7 毛利率写清楚，成本加成只做换算显示

「毛利」列改为「毛利率（按售价）」，目标毛利输入框旁显示「相当于成本加成 X%」（`m ÷ (1 − m)`）。计算不变。

- 否决：加一个口径切换（按售价 / 按成本）。那是另一套计算，TI-2 已经有，这里只要别让人把两者弄混。

### D8 数量口径照矩阵，写在建议上

落地总价按询价单首档数量算（供应商给了总价就用供应商的总价）。建议上写「按询价单首档数量 Q」或「按供应商报价总价」。不换算到招标总量（Q4）。

- 否决：按招标价格表的总量重算。询价首档数量与招标总量的对应关系现在没有可靠来源，硬算就是编数字。

### D9 可见范围与现在的「我方成本」相同

建议在读取接口里返回，项目读者都能看到——与现在的 `ourCostCad`、情景表毛利一样；落地价按纪律第 4 条本来就允许出现在 Muse 通道。写来源要写权限（沿用 POST）。

- 否决：只给财务角色看建议。卡片上的成本本身就对读者可见，单藏建议没有意义；要收紧应当连成本与毛利一起收，另定（Q3）。

### D10 新开关，默认关

`TENDER_PRICING_COMPARE_SOURCE_ENABLED`（可配组织名单 `TENDER_PRICING_COMPARE_SOURCE_ORG_ALLOWLIST`），与 FLOW-H3 / H5 的开关同一写法。关闭时：GET 不返回建议与过时提示，POST 忽略 `ourCostSource`，D7 的文字也不显示——卡片与现在完全相同。只有比价矩阵结论的措辞（D3 的一部分）不跟开关：它是更正一句会误导人的文字。

- 否决：措辞也跟开关。Muse 和接口里那句「含税」在开关关着的组织里会一直误导下去。

## 与八条硬纪律的关系

1. **零 schema**：遵守。来源写在既有的 `summaryJson.pricingInputs` 里。
2. **出站先审批**：不涉及。没有对外动作。
3. **禁止第三套队列**：不涉及。
4. **脱敏**：建议里只有供应商名、轮次、数量口径、金额与换算假设；不带邮件正文、联系方式、备注原文（spec 有一条 SHALL NOT）。Muse 通道只多了一句措辞更正。毛利仍只在报价表助手里，不进 Muse。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。全部复用纯函数换算，不调模型。
8. **测试注册**：两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`（新，纯逻辑 + 接线 + 卡片呈现）：取哪一轮哪一条；逐项金额加起来等于总价（EXW / FOB / CIF / DDP）；不含 GST/HST 的文字；来源核对（相同 / 差一分 / 改过）；过时提示；成本加成换算；按钮只填输入框；开关。
- `npx tsx src/lib/tender-pricing/__tests__/compare-cost-source-db.isolated.test.ts`（新，隔离库，真实路由）：spec 每个场景；读取前后什么都没变；别的组织 403；伪造来源（别的项目、别的组织、没选定、金额不对）。
- 既有：`landed-cost.test.ts`、`compare.test.ts`、`pricing-helper.test.ts` 不变地通过（措辞那一条按新文字更新断言）。
- 改动前的代码上新测试失败；变异核对；独立审查；真实浏览器截图 `docs/acceptance/flow-h2/`。
- 全量门禁：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate tender-pricing-compare-cost-source --strict`。

## Risks / Trade-offs

- **首档数量 ≠ 招标总量**：建议的落地总价可能和项目实际要报的量对不上。只写明口径，不换算（D8、Q4）。
- **报价表助手读取多一串查询**（开关开着时）：找选定条目一次，加上比价矩阵取数（项目、轮次、条目、组织设置、发送卡）。只在卡片打开时。
- **组织设置缺参数**（汇率、海运估算、关税率）时没有数字，只有原因。现在很多组织可能还没填，开了开关多半先看到「换算不出」。
- **备忘录与标书草稿不知道来源**：它们照旧只读数字。
- **「到分」的核对**：汇率或参数在人点按钮和点保存之间被改，来源会记成手填。少见，且偏保守。

## Migration Plan

零 schema，无回填。合并后照常部署，开关默认关，线上无变化。回滚 = 关开关；措辞更正回滚代码。

## 待审问题（每条都有推荐）

| # | 问题 | 推荐 | 另一种 |
|---|---|---|---|
| Q1 | 「所选供应商」指什么？ | **只认人工「选定」**（D1）。没选定就提示去选，不给数字 | 选定 > 推荐 > 最低价（和 Muse 一样）：没人选也有数字，但数字是代码挑的，会流进备忘录与标书草稿 |
| Q2 | 填入方式 | **按钮填输入框，人保存**（D4） | 没保存过成本时自动用建议 |
| Q3 | 谁能看到 | **与现在的「我方成本」相同：项目读者**（D9）。另外提醒：现在成本与毛利本身就对所有项目读者可见，要不要收紧到财务角色是另一个决定，本次不动 | 建议只给财务角色看 |
| Q4 | 数量口径不一致 | **照矩阵（询价首档数量或供应商总价），写明口径，不换算**（D8） | 加一个「按 N 倍」的人工系数；或在首档数量与招标总量不同时不给填入按钮 |
| Q5 | 顺手更正矩阵结论里的「含税」 | **更正，且不跟开关**（D10）：改为「到目的地，含关税，不含 GST/HST」。Muse 解读里的这句话会跟着变 | 不改，或跟开关走 |
