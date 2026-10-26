# Design: fde-preferences-in-draft

## Context

- 首封回复草稿由 `fde/inbound-sales.ts` Step 5–6 生成：
  1. `buildClarifyingQuestions(missing, lang, maxQuestionsPerReply)` 产出追问；
  2. `buildReplyDraft(input)` 拼模板；
  3. 可选 `polishReplyDraftWithLlm`；
  4. 守卫 `checkDraftWithReferenceLines` → `checkDraftGuardrails`。
  - 英文草稿还会另生成一份中文版，只进审批预览。
- 模板里与偏好相关的固定文案：
  - 问候：英文 `Dear ${name},`；中文 `${name}，您好：`，没有联系人名时为 `您好：`。
  - 结束语：`期待您的回复。` / `We look forward to hearing from you.`。
  - 敬语：英文 `Best regards,`；中文没有。
  - 署名：`signOff(senderName, orgName, signatureLines(policy))`，署名附加行来自 `commercialFacts.signature`（B-2 可提案）。
- policy 存在 `OrgBusinessRule(revenue_spine.policy)`，合并函数 `mergeRevenueSpinePolicy` 逐字段白名单。`notify` / `autonomy` 是同级开关段，只认布尔值。
- 写入口 `PUT /api/revenue/policy` 已限定 admin / boss；没有设置界面。

## Goals / Non-Goals

**Goals**
- 老板或管理员写进 policy 的措辞偏好，进入首封回复草稿的模板层；
- 关闭时草稿字节级不变；
- 偏好不能绕过守卫，违规偏好可追溯。

**Non-Goals**
- 不读、不改 `src/lib/employee-ai/**`（`preference-learner.ts`、`context-builder.ts` 等）；不做个人偏好；
- 不改 `src/lib/revenue-spine/fde/no-reply-followup.ts`（跟进草稿）与 `src/lib/trade/inquiry-design.ts`（外贸收件箱草稿）；
- 不做设置界面，不改 `src/app/api/revenue/policy/route.ts`；
- 不改 `rfq/missing-info.ts` 的 `QUESTION_TEMPLATES` 与 `MISSING_FIELD_TIERS`；
- 不改 `src/lib/revenue-spine/fde/draft-diff.ts` 的段落分类词表；
- 不改 `checkDraftGuardrails` 的规则本身。

## Decisions

### D1：policy 新段 `fde`，合并只做形状校验

```ts
interface DraftPreferenceText { zh: string | null; en: string | null }
interface FdeDraftPreferences {
  greeting: DraftPreferenceText;
  closing: DraftPreferenceText;
  valediction: DraftPreferenceText;
  priorityQuestions: string[];
  skippedQuestions: string[];
  bannedPhrases: Array<{ phrase: string; replacement: string }>;
}
interface FdePolicy { useConfirmedPreferences: boolean; preferences: FdeDraftPreferences }
```

- 默认：开关 `false`，偏好全空。
- 合并规则：
  - 开关只认布尔值；
  - 文案键：字符串保留原样，空串或非字符串视为未配置（`null`）；`greeting` 等按语言逐键覆盖；
  - 数组整体替换，只保留字符串项（`bannedPhrases` 只保留 `phrase` 为字符串的对象，`replacement` 非字符串记为空串）；
  - 存量 policy 没有 `fde` 时用 `base.fde ?? 默认`，与 `autonomy` 同一写法。
- 内容校验不放在合并里：合并在 GET / PUT / 加载时都会跑，静默丢弃会让违规无从追溯。
- **否决**：
  - 放进 `businessProfile.commercialFacts`：那里是商务事实（B-2 会起卡改写），措辞偏好不是事实，混在一起会让提案与偏好互相覆盖。
  - 用 `settingsJson.revenue_spine.fde`：草稿读取口径都在 `OrgBusinessRule`，另开一处要多一套读写与版本。

### D2：`resolveDraftPreferences(policy)` 是唯一的校验与解析入口

- 新模块 `src/lib/revenue-spine/draft-preferences.ts`。
  - 它 import `reply-draft` 的守卫与 `inquiry-risks` 的 `unsafeToRepeat`；
  - `reply-draft` 只 import 它的类型，不形成运行时循环。
- 开关关闭时返回 `null`：调用方不传偏好，所有既有代码路径原样执行。这是"字节级不变"的结构保证。
- 开启时返回：
  - `greeting` / `closing` / `valediction`（按语言，已校验）；
  - `priorityQuestions` / `skippedQuestions`（`RfqField[]`）；
  - `bannedPhrases`；
  - `applied`：生效键名；
  - `ignored`：`[{ key, reason }]`。
- 键名格式：`greeting.en`、`closing.zh`、`priorityQuestions[1]`、`bannedPhrases[0]`。
- 校验规则（违规逐条忽略）：

| 对象 | 规则 |
|---|---|
| 问候 / 结束语 / 敬语 / 替换词 | 去首尾空白；≤ 120 字符；不含换行与数字；`checkDraftGuardrails` 无违规；`unsafeToRepeat` 为假 |
| 问候 | 含且只含一个 `{name}` |
| 结束语 / 敬语 / 替换词 | 不含 `{` `}` |
| 禁用词 | 2–60 字符；不含换行与数字；同一词只算一次 |
| 必问 | 必须在 `MISSING_FIELD_TIERS` 里；去重；最多 13 个（字段总数） |
| 免问 | 同上，且不能是必填字段，不能与必问重复 |
| 禁用词条数 | 最多 30 条，超出的逐条记"超出上限" |

- 守卫检查替换词时用 `{name}` 去掉后的文本；禁用词本身不过守卫（禁用词常常就是"free samples"这类承诺词）。
- 数字一律禁止：比守卫更严，保证偏好里不出现金额、数量、天数，也免得替换词造出守卫没覆盖的数字承诺。
- **否决**：
  - 在 `PUT /api/revenue/policy` 时拒绝违规偏好：seed 脚本与存量配置绕过 PUT，起草时仍要再判一次；只在一处判更简单。
  - 违规时整段偏好作废：一条写错就让其它合法偏好全部失效，老板难以定位。

### D3：追问排序在 `buildClarifyingQuestions` 里做

- 新增可选第 4 个参数 `prefs?: { priorityQuestions; skippedQuestions } | null`。不传时代码路径与今天一致。
- 排序规则：
  1. 候选 = 默认顺序（必填在前，再非必填）去掉免问字段；
  2. 先放必问里缺失的字段（按列出顺序），再放其余候选；
  3. 截到上限 `max`。
- **否决**：在 `buildReplyDraft` 里重排。`inbound-sales` 传进草稿的问题已经截到上限，排在上限之外的必问字段到了草稿里就拿不到了。

### D4：模板层应用偏好

- `ReplyDraftInput` 新增可选 `preferences?: ResolvedDraftPreferences | null`。不传或为 `null` 时一行逻辑都不变。
- 问候：偏好存在且有联系人名时，用模板替换 `{name}`；否则走默认问候。
- 结束语：替换默认结束语行。
- 敬语：英文替换 `Best regards,`；中文在署名前插一行。
- 禁用词：
  - 正文拼完后，对非保护行逐条替换。
  - 保护行在拼装时登记，包括：需求复述行、展会参考款行、参考项目、条款原句与样品说明（即 `referenceLines` 及 `termLines`）、署名块。
  - 主题不替换：主题由产品名（买家原话）与公司名组成，且用于邮件线程。
  - 匹配规则：英文整词、不区分大小写，边界同 `containsPhrase`；含中文的词按子串。按列出顺序逐条替换。
- 草稿对象新增可选 `preferences`：
  - `lines`：实际用到的问候、结束语、敬语行；
  - `bannedPhrases`；
  - `applied` / `ignored` 键名。
  - 只在传入偏好时出现。
- **否决**：
  - `buildReplyDraft` 内部自己读 `policy.fde`：追问在草稿之前已经生成，两处各读一次可能不一致；由调用方解析一次、显式传入，关闭时的路径也更容易证明不变。
  - 禁用词对整封正文替换：会改到买家的需求复述和参考值原句，前者改变买家原意，后者破坏"原句一字不差"的守卫前提。

### D5：润色回退条件

`polishReplyDraftWithLlm` 只在 `draft.preferences` 存在时追加两条判定：
- `lines` 里每一行必须原样出现在润色稿里；
- 润色稿不得命中任何禁用词（同一匹配函数）。

提示词只在这时追加一句：原样保留问候、结束语、敬语，且不得使用禁用词。开关关闭时提示词逐字不变。守卫仍在润色后运行。
- **否决**：润色后再做一次禁用词替换。替换后的句子没有经过 LLM 与守卫的同一轮判定，顺序就变成"润色 → 替换 → 守卫"，偏离任务书"守卫顺序不变"；回退模板更简单。

### D6：FDE 接入与审计

- `inbound-sales` 在 Step 5 前调用一次 `resolveDraftPreferences(policy)`。结果用在四处：
  1. 追问；
  2. 草稿；
  3. 审核用中文版的追问；
  4. 审核用中文版的草稿。
- 开启且 `ignored` 非空时，调用 `recordIgnoredDraftPreferencesSafe`：
  - 审计 action `revenue_spine.draft_preferences.ignored`，`targetType` `revenue_spine_policy`，`targetId` = orgId；
  - `afterData`：`{ fingerprint, ignored: [{ key, reason }], employeeKey }`；
  - 指纹 = 排序后的 `key|reason` 的 sha256 前 16 位；
  - 去重：同组织、同 action、`afterData` 含该指纹已存在则跳过（与跟进草稿守卫审计同一写法）；
  - 依赖可注入；任何异常吞掉并 `console.warn`，不影响起草。
- "回复草稿已生成"事件在开启时追加 `draftPreferences: { applied, ignored: 键名列表 }`。
- **否决**：
  - 每次起草都记一条审计：同一份错误配置每封询盘都记，刷屏；
  - 按商机去重：同样随询盘量增长，而违规是组织级配置问题。

### D7：字节级不变的验证方式

- 新增 `__tests__/fixtures/draft-golden-cases.ts`：一组覆盖面广的输入，包括：
  - 中文 / 英文；
  - 有 / 无联系人；
  - 官网 / 展会 / 展会参考款 / C 级只发目录；
  - 有 / 无商务事实与署名；
  - 有样品说明。
- 实施前，用当前代码生成 `draft-golden-pre-b3.json`（主题、正文、追问字段）并先单独提交。
- 测试对三种情况逐字节比对金样本：
  1. 不传偏好；
  2. policy 配满偏好但开关关闭；
  3. 开关开启但偏好全空。
- **否决**：只比较"传偏好 vs 不传偏好"两次输出。两次都跑改过的代码，证明不了与实施前一致；金样本用改动前的代码生成，才能证明默认路径没被顺手改到。

## 与八条硬纪律的关系

1. **零 schema**：偏好存在既有 `OrgBusinessRule(revenue_spine.policy)` 的 JSON 里；审计写既有 `AuditLog`。
2. **出站先审批**：不涉及新的外发；草稿照旧经 `sales.send_inquiry_reply` 审批。
3. **禁止第三套队列**：不新增 cron / 队列；偏好在既有起草调用链里同步解析。
4. **脱敏**：偏好禁止数字，不含金额；审计与事件只记键名与原因，不记文案、买家信息与正文。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：校验、排序、替换全是规则，不新增 LLM 调用；既有润色只在开启偏好时多一句约束与两条回退判定。偏好里不存金额。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

| 验证项 | 命令或做法 | 期望结果 |
|---|---|---|
| 偏好合并、校验、排序、模板、禁用词、润色回退、审计去重、接入点 | `npx tsx src/lib/revenue-spine/__tests__/draft-preferences.test.ts` | 全部通过，退出码 0 |
| 关闭时字节级不变 | 同上，金样本比对三种情况 | 主题、正文、追问字段与 `draft-golden-pre-b3.json` 逐字节相同 |
| 草稿既有行为 | `npx tsx src/lib/revenue-spine/__tests__/scoring-draft.test.ts`、`tricky-inquiries.test.ts`、`no-reply-followup.test.ts`、`fde/__tests__/draft-feedback.test.ts` | 全部通过 |
| 全量回归 | `npm test` 与基线比较 | 新增失败为 0 |
| 类型 / lint / CI 子集 | `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci` | 全部通过 |
| 规格 | `openspec validate fde-preferences-in-draft --strict` | 通过 |

## Risks / Trade-offs

- **首封与跟进口径不一致**：跟进草稿不读偏好。列为 GATE 注意项，建议后续 change 接入。
- **自定义问候 / 敬语不在 B-1 段落分类词表里**：只影响改稿 diff 的段落归类，不影响发送与守卫。
- **禁用词替换可能让句子不通顺**：例如替换成空串。属于企业自己的配置；替换词同样过守卫，最终草稿仍过守卫，且审批人可见。
- **润色回退变多**：开启偏好后，LLM 改写问候或用到禁用词就回退模板。模板本身就是合格草稿，只是少了润色。

## Migration Plan

- 无数据迁移、零 schema。存量 policy 没有 `fde` 段 → 关闭。
- 开启：`PUT /api/revenue/policy`，body `{ policy: { fde: { useConfirmedPreferences: true, preferences: {...} } } }`（admin / boss）。
- 回滚：再发布一版把开关设为 `false`，或把 `OrgBusinessRule` 回退到上一版本。

## Open Questions

无（来源已由用户决定为 b）。
