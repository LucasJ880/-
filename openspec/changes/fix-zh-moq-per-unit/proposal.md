# Proposal: fix-zh-moq-per-unit

**TASKFLOW：** 无（缺陷修复，不对应阶段任务；B-2 `fde-fact-proposals` 合并后触发频率上升，故先修）。
**受影响的 Muse 意图：** 无。本 change 不碰 `src/lib/muse-bridge/**`；只改 Revenue Spine 首封回复草稿里中文参考原句的措辞。

## Why

中文参考原句只翻译了 `per = "style"`，企业配置的其它起订量口径（如 `color`）原样漏进中文句子，买家中文邮件和审批人看的中文对照都会出现"起订量一般为每color 500 件"。B-2 把口径归一化为 `color / size / design / style / sku / item / order` 并在批准后写进 `commercialFacts.moq.per`，单位归一化为 `pcs / units / sets / m / kg`，合并后这类句子会成为常态。

## What Changes

- 在 Revenue Spine 回复草稿模块里新增起订量口径 → 中文对照表：`color → 色`、`size → 尺码`、`design → 款式`、`style → 款`、`sku → SKU`、`item → 品`、`order → 单`。
- 新增起订量单位 → 中文量词对照表：`pcs → 件`、`units → 件`、`sets → 套`、`m → 米`、`kg → 公斤`（覆盖 B-2 归一化后的全部单位）。
- 中文参考原句改用两张表生成：查表前去首尾空格、转小写；表里没有的口径 / 单位原样保留；未配置口径时仍写"每款"。
- 英文参考原句（`For reference, our MOQ is typically … per …`）逐字节不变。
- 参考原句仍由模板确定性生成、随草稿携带；守卫"先剔除原句再按最严规则检查"与"润色后原句必须一字不差保留"的契约不变。
- 在 `src/lib/revenue-spine/__tests__/scoring-draft.test.ts`（已在 `scripts/test-all.sh` 注册）新增测试：`per = color / size / style / order` 四种口径的中英文参考原句、未知口径原样保留、整封中文草稿与英文草稿的中文审核对照守卫通过。

## Capabilities

### New Capabilities
- `revenue-spine/draft-reference-lines`：首封回复草稿里企业确认过的参考值原句（起订量 / 大货周期 / 装运港）——中文措辞、英文措辞、与草稿守卫的白名单契约。本次只写入与起订量口径、单位措辞相关的 Requirement。

### Modified Capabilities
（无。`openspec/specs/` 目前只有 `qa/test-registry`，不涉及。）

## Impact

- `src/lib/revenue-spine/reply-draft.ts`：新增两张常量表与一个查表函数；中文分支的起订量一句改用查表；英文分支不动。
- `src/lib/revenue-spine/__tests__/scoring-draft.test.ts`：新增一条测试，多 import 两个已导出函数。
- 受影响的输出：中文首封回复草稿正文、英文草稿审批预览里的"中文对照"（`src/lib/revenue-spine/fde/inbound-sales.ts` 生成 `reviewZh`，本 change 不改该文件）。
- 现有配置 `per = "style"`、`unit = "pcs"` 的组织输出不变（`commercial-facts.test.ts` 的"每款 1,000 件"断言照旧通过）。
- B-3 `fde-preferences-in-draft` 的金样本 `draft-golden-pre-b3.json` 目前在任何分支上都还没生成；若 B-3 在合并本 change 之前生成了金样本且含 `每color`，B-3 合并本 change 后须按 `draft-golden-cases.ts` 里写明的命令重新生成。

## Out of scope

- 不改英文参考原句、大货周期句、装运港句。
- 不改守卫规则（起订量正则、数字承诺检查）与润色提示词。
- 不改 B-2 的口径 / 单位归一化表，不改商务事实配置的合并与校验逻辑。
- 不改 `src/lib/revenue-spine/rfq/heuristic-extractor.ts` 对买家来信里口径的抽取。
- 不改无回复跟进草稿（`src/lib/revenue-spine/fde/no-reply-followup.ts`，它不输出起订量原句）。
- 不新增 `colour` 等别名；口径别名归一化归 B-2。
- 不在本 change 内 archive；PR 合并后另开小 PR。
