# Proposal: fde-preferences-in-followup

**TASKFLOW：** B-3 后续（B-3 偏差 4 的补齐，不是任务书新编号）。状态列沿用 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 的 B-3 行。本分支叠在 B-3（`claude/fde-preferences-in-draft`）之上。
**受影响的 Muse 意图：** 无。
**已决定（不重开）：** 偏好来源是 `revenue_spine.policy` 的 `fde` 段（用户 2026-10-26 选 b，B-3 已实现）；改进项顺序按推荐（用户 2026-10-26 第二轮）。

## Why

B-3 只让首封回复草稿读偏好，开启后同一个买家收到的首封与无回复跟进问候、敬语不一致，跟进还会追问老板设为免问的字段（如目标价）。本 change 让无回复跟进草稿用同一份已校验的偏好。

## What Changes

- **接入无回复跟进草稿**（`fde/no-reply-followup.ts`）：开关开启时，跟进草稿使用与首封同一份解析结果：
  - 问候模板（有联系人名时）；
  - 敬语：英文替换 "Best regards,"，中文替换"祝好！"；
  - 结束语：配置后在敬语前加一行（跟进草稿默认没有结束语行）；
  - 必问 / 免问：追问排序与首封同一规则，上限仍为 3；
  - 禁用词：只替换模板句子；署名块、偏好行、主题，以及嵌着的专名（组织名、对外英文名、联系人名、产品 / 参考款说法、展会名）与链接原样保留。替换后多出守卫违规时，这一封不替换，按引起违规的键名记审计。
- **开关关闭时跟进草稿逐字节不变**：用本 change 实施前生成的跟进金样本（10 例）锁定。
- **共用实现**：把首封草稿里"保护行替换 + 多出违规时退回"的逻辑抽成 `reply-draft.ts` 的导出函数，首封与跟进共用；首封行为不变（B-3 金样本与测试锁定）。
- **违规审计**：跟进起草时也按 B-3 同一规则记违规偏好审计（同组织同一组违规只记一次）。
- **新增测试**：
  - 跟进模板与偏好；
  - 关闭时的跟进金样本比对；
  - 接入点静态断言；
  - 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- **写报告并更新状态**：`docs/QINGYAN_ORG_COCKPIT_C-2_REPORT.md` 与 HANDOFF。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **不是任务书条目**：任务书 B-3 What 只点名 `reply-draft.ts`。本 change 补齐 B-3 报告偏差 4 列出的不一致，按用户"改进项按推荐顺序做"开出。
2. **结束语在跟进里是新增一行**：跟进草稿默认没有"期待您的回复"这类结束语行；只有配置了结束语偏好才在敬语前加一行。不配置时不加。
3. **跟进不经 LLM 润色**：跟进草稿本来就只用模板，所以没有润色回退判定。
4. **审核用中文对照同样用偏好**：英文跟进附的中文对照用中文偏好，与首封一致。

## Capabilities

### New Capabilities
- `revenue-spine/fde-followup-draft-preferences`：无回复跟进草稿使用 `policy.fde` 偏好。包括：
  - 默认关闭与关闭时字节级不变；
  - 作用范围（问候、敬语、结束语、追问、禁用词）；
  - 保护范围；
  - 退回与审计。

### Modified Capabilities
（无。B-3 的 `revenue-spine/fde-draft-preferences` 不修改：它约束首封草稿，本 change 新增跟进草稿的能力，两者共用同一份偏好解析。）

## Impact

- 新文件：
  - `src/lib/revenue-spine/__tests__/followup-preferences.test.ts`
  - `src/lib/revenue-spine/__tests__/fixtures/followup-golden-cases.ts`
  - `src/lib/revenue-spine/__tests__/fixtures/followup-golden-pre-c2.json`
  - `docs/QINGYAN_ORG_COCKPIT_C-2_REPORT.md`
- 修改：
  - `src/lib/revenue-spine/fde/no-reply-followup.ts`（可选偏好输入、解析与审计接入）
  - `src/lib/revenue-spine/reply-draft.ts`（抽出共用的保护行替换与退回函数，行为不变）
  - `scripts/test-all.sh`、`scripts/test-ci-unit.sh`
  - `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`
- 零 schema；不新增队列 / 调度 / cron（沿用 `revenue-spine` 定时任务）；无新 LLM 调用；无新外发路径（跟进草稿仍经审批）。

## Out of scope

- 不改 `policy.fde` 的字段与校验规则（B-3 已定）。
- 不改跟进的时机、次数、去重与审批流程。
- 不接外贸收件箱草稿（`trade/inquiry-design.ts`）与报价跟进。
- 不做设置界面。
