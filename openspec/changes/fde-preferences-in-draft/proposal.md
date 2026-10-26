# Proposal: fde-preferences-in-draft

**TASKFLOW：** B-3（已确认偏好接入草稿模板层）。状态列在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase B 表。本分支叠在 B-2（`claude/fde-fact-proposals`）之上；B-3 依赖 B-1。
**受影响的 Muse 意图：** 无。
**已决定（不重开）：** 偏好来源选 (b)（用户，2026-10-26）：放进 `revenue_spine.policy` 新段，不经 employee-ai。

## Why

F3：企业对 FDE 草稿的固定口径（问候、结束语、落款敬语、先问 / 不问哪些、禁用词）今天没有地方配置，审批人只能每封手改。B-3 让老板或管理员把这些偏好写进 `revenue_spine.policy`（写入即"已确认"），草稿模板直接引用；任务书原写的 employee-ai confirmed 偏好与代码不符（只有个人、自由文本的两条规则，见 HANDOFF "B-3 预研事实"），用户已选 (b)。

## What Changes

- **新增 policy `fde` 段**（与 `notify` / `autonomy` 同级）：
  - `fde.useConfirmedPreferences`：布尔，默认 `false`。只认布尔值；存量 policy 没有这一段时视为关闭。
  - `fde.preferences`：
    - `greeting.zh` / `greeting.en`：问候模板，必须含且只含一个 `{name}`。草稿没有联系人名时沿用默认问候。
    - `closing.zh` / `closing.en`：结束语，替换"期待您的回复。" / "We look forward to hearing from you."。
    - `valediction.zh` / `valediction.en`：落款敬语。英文替换 "Best regards,"；中文默认没有这一行，配置后加在署名前。
    - `priorityQuestions`：必问字段（RFQ 字段名）。这些字段缺失时按列出顺序先问，其余缺失字段按默认顺序补到 `followUp.maxQuestionsPerReply`。
    - `skippedQuestions`：不追问的非必填字段。
    - `bannedPhrases`：`[{ phrase, replacement }]`，整词替换模板句子里的禁用词（英文不区分大小写）。
- **校验每条偏好**（纯函数，确定性）：
  - 每个文案值（问候、结束语、敬语、替换词）都要过草稿守卫（`checkDraftGuardrails`）与买家原话风险检查（`unsafeToRepeat`）；
  - 文案值不得含数字（含全角）与数字词、不得换行、不得超长；禁用词不得含数字或换行；替换词不得含任何禁用词；
  - 字段名必须是可追问的 RFQ 字段；必填字段不能免问；与必问冲突的免问忽略。
  - 违规项逐条忽略，其余照用。
- **接入首封回复草稿模板**（`reply-draft.ts`、`rfq/missing-info.ts`）：
  - 开关关闭时，草稿主题与正文字节级不变；用本 change 实施前生成的金样本锁定。
  - 禁用词替换只作用于模板自己的句子。不碰：参考值原句（MOQ / 大货周期 / 装运港 / 含数字的样品说明）、"需内部确认"段、买家需求复述行、展会参考款行、参考项目、署名块、主题；句子里嵌着的专名（组织名、买家公司名、买家产品名、展会名、联系人名、参考款）与链接也不碰。
  - 替换后草稿过不了守卫、替换前能过时，这一封不做替换并记一次审计（不让配置错误把每封草稿都拦在审批外）。
  - 守卫顺序不变：模板生成 → 可选 LLM 润色 → `checkDraftGuardrails`。
  - 开启偏好时润色稿还要满足两条，否则回退模板：偏好问候、结束语、敬语原样保留；去掉原样保留的保护行后，禁用词不比模板草稿多。
- **接入 FDE 起草流程**（`fde/inbound-sales.ts`）：
  - 每次起草解析一次偏好，同时用于追问、草稿与审核用中文版；
  - 有违规偏好时写一条 AuditLog `revenue_spine.draft_preferences.ignored`：只记键名与原因，不记文案；同一组织同一组违规只记一次；
  - FDE 运行事件"回复草稿已生成"里列出生效与忽略的偏好键名。
- **新增测试**：
  - 偏好合并与校验；
  - 追问排序；
  - 草稿模板与禁用词替换；
  - 润色回退；
  - 关闭时的金样本比对；
  - 审计去重；
  - 接入点静态断言。
  - 全部注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- **写** `docs/QINGYAN_ORG_COCKPIT_B-3_REPORT.md` 并更新状态列。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **来源是 policy，不是 employee-ai confirmed 偏好**（用户决定 b）。"已确认"指老板或管理员经 `PUT /api/revenue/policy`（既有 admin / boss 角色门）写入。`preference-learner`、`EmployeeAiProfile` 不读不写。
2. **开关位置**：开关是 `OrgBusinessRule(revenue_spine.policy)` 里的 `fde.useConfirmedPreferences`，不在 `settingsJson`。口径与 B-5 偏差 6 相同。
3. **【GATE 注意项】不做设置界面**：`notify` / `autonomy` 也没有界面，同样经 API 写入；开启方式写进报告。
4. **【GATE 注意项】只接首封回复草稿**：
   - 任务书 What 只点名 `reply-draft.ts`；无回复跟进草稿（`fde/no-reply-followup.ts`）不读偏好。
   - 开启后，首封与跟进的问候、结束语会不一致；跟进草稿还会追问免问字段（如目标价）。接入跟进草稿另开 change。
5. **违规偏好在起草时判定并审计**：
   - 存量 policy、seed 脚本直接写入的 policy 都能覆盖到；
   - 按组织与违规指纹去重；
   - `PUT` 接口的权限与校验不变、不拦截违规偏好；GET / PUT 的响应多出合并后的 `fde` 段。
6. **"默认追问集"的口径**：
   - 拆成必问（`priorityQuestions`）与免问（`skippedQuestions`）；
   - 只能在既有可追问字段里选，不新增问题模板；
   - 追问上限仍为 `maxQuestionsPerReply`。
7. **偏好文案禁止数字**：比守卫更严，保证偏好里不出现金额、数量、天数（config 第 7 条）。
8. **B-1 段落分类器不变**：自定义问候或敬语不在分类器词表里时（如 "Greetings {name},"），改稿 diff 会把该段记为正文段。草稿照发时不受影响。
9. **数字词也算数字**：`three days`、`ten dollars`、`三天`、`五美元` 这类写法同样忽略；宁可多拦，误拦的偏好记审计，管理员换个说法即可。
10. **清空偏好的写法**：列表写 `[]`、文案写 `{ "en": null }` 才清空；写 `null` 或不写沿用当前值（与 policy 其它段的合并规则一致）。

## Capabilities

### New Capabilities
- `revenue-spine/fde-draft-preferences`：FDE 首封回复草稿的团队偏好。包括：
  - 默认关闭与关闭时字节级不变；
  - 偏好的作用范围（问候、结束语、敬语、追问、禁用词）；
  - 校验与违规忽略；
  - 守卫与润色顺序；
  - 违规审计。

### Modified Capabilities
（无。）

## Impact

- 新文件：
  - `src/lib/revenue-spine/draft-preferences.ts`
  - `src/lib/revenue-spine/__tests__/draft-preferences.test.ts`
  - `src/lib/revenue-spine/__tests__/fixtures/draft-golden-cases.ts`
  - `src/lib/revenue-spine/__tests__/fixtures/draft-golden-pre-b3.json`
  - `docs/QINGYAN_ORG_COCKPIT_B-3_REPORT.md`
- 修改：
  - `src/lib/revenue-spine/policy.ts`（`fde` 段类型、默认值、合并）
  - `src/lib/revenue-spine/rfq/missing-info.ts`（`buildClarifyingQuestions` 可选偏好参数）
  - `src/lib/revenue-spine/reply-draft.ts`（可选偏好输入、润色回退条件）
  - `src/lib/revenue-spine/fde/inbound-sales.ts`（解析、传入、审计、事件）
  - `scripts/test-all.sh`、`scripts/test-ci-unit.sh`
  - `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md`（状态列）、`docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`
- 零 schema；不新增队列 / 调度 / cron；不新增 LLM 调用（润色是既有调用，只在开启偏好时多一句约束）；无外发。
- 不改：`preference-learner`、employee-ai、审批 UI、无回复跟进草稿、`PUT /api/revenue/policy`。

## Out of scope

- 不读、不改 employee-ai：`preference-learner`、`EmployeeAiProfile`、`RolePlaybook`、`practice-miner`。
- 不做个人偏好：偏好按组织生效。
- 不接无回复跟进草稿（`fde/no-reply-followup.ts`）与外贸收件箱草稿（`trade/inquiry-design.ts`）。
- 不做设置界面；不改 `PUT /api/revenue/policy` 的权限与校验（响应随合并后的 policy 多出 `fde` 段）。
- 不新增问题模板、不改追问上限、不改"价格永远需内部确认"。
- 不让偏好改写需求复述、参考值原句（MOQ / 大货周期 / 装运港 / 样品说明）、署名块与主题。
