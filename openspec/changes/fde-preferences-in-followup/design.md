# Design: fde-preferences-in-followup

## Context

- 无回复跟进由 `revenue-spine` 定时任务调用 `draftNoReplyFollowUps(orgId)`（`fde/no-reply-followup.ts`），对到期商机逐个：
  1. `buildClarifyingQuestions(missing, lang, 3)` 生成追问；
  2. `buildNoReplyFollowUpDraft(input)` 拼模板（纯函数，按第几次跟进分三种正文）；
  3. 过守卫，过不了记 `FOLLOW_UP_GUARDRAIL_AUDIT_ACTION` 审计并跳过；
  4. 英文跟进另生成中文对照；
  5. 建审批。
- 跟进模板的固定文案：
  - 问候：英文 `Dear ${name ?? "there"},`；中文 `${name}，您好：` / `您好：`；
  - 敬语：英文 `Best regards,`；中文 `祝好！`；
  - 没有结束语行；没有 LLM 润色。
- B-3 已有：`resolveDraftPreferences(policy)`（校验与审计）、`replaceBannedPhrases`（挡专名与链接）、首封里"保护行替换 + 多出违规退回 + 逐条试出引起违规的键名"的内联实现。

## Goals / Non-Goals

**Goals**
- 跟进草稿与首封用同一份偏好、同一套规则；
- 关闭时跟进草稿逐字节不变；
- 首封行为不变（B-3 金样本与测试照过）。

**Non-Goals**
- 不改 `src/lib/revenue-spine/draft-preferences.ts` 的校验规则与 `policy.ts` 的 `fde` 段；
- 不改跟进时机（`noReplyFollowUpDue`）、去重键、审批参数；
- 不改 `src/lib/trade/inquiry-design.ts`、报价跟进；
- 不改 `polishReplyDraftWithLlm`。

## Decisions

### D1：把"保护行替换 + 退回"抽成共用函数

`reply-draft.ts` 新增导出：

```ts
export function applyBannedPhrasesSafely(input: {
  lines: readonly string[];
  phrases: ReadonlyArray<{ phrase: string; replacement: string; key?: string }>;
  kept: ReadonlySet<string>;
  keepTerms: readonly (string | null | undefined)[];
  violationsOf: (body: string) => string[];
}): { body: string; violations: string[]; skipped: string[] };
```

- 非保护行做替换。替换后比替换前多出违规时，退回替换前的正文与违规，逐条试出引起违规的键名（单条都不引起时记全部）。
- `buildReplyDraft` 改为调用它：
  - 保护行集合、专名列表、违规函数（`checkDraftWithReferenceLines(subject + body, referenceLines)`）照旧；
  - 不传偏好时不调用，代码路径不变。
- **否决**：在跟进模块里复制一份。两处规则一旦漂移，首封与跟进的保护范围就不一致，这正是本 change 要消除的问题。

### D2：跟进模板接受可选偏好

- `NoReplyFollowUpInput` 新增可选 `preferences?: DraftTemplatePreferences | null`。不传或为 `null` 时一行逻辑都不变。
- 问候：有联系人名且配置了对应语言的模板时，用模板（函数式替换 `{name}`）。
- 结束语：配置时在敬语前插一行。
- 敬语：英文替换 `Best regards,`，中文替换 `祝好！`。
- 禁用词：
  - 保护行 = 署名块（`signOff(...)` 的各行）+ 偏好行；
  - 专名 = 组织名、对外英文名、联系人名、产品说法、展会名；
  - 违规函数 = `checkDraftGuardrails(subject + body)`（与原先一致）；
  - 主题不替换。
- 草稿对象只在传入偏好时带 `preferences: { lines, bannedPhrases, keptLines, bannedPhrasesSkipped? }`，与首封同形。
- **否决**：让跟进读首封草稿的偏好结果（从载荷里取）。跟进是定时任务按当时的 policy 起草，偏好可能已改；按当时 policy 解析才对。

### D3：起草流程接入

- `draftNoReplyFollowUps` 在组织级（循环外）解析一次偏好。
- 有违规项时调用 `recordIgnoredDraftPreferencesSafe`（同一套指纹去重）。
- 每个商机的追问与草稿（含中文对照）传入偏好。
- 草稿 `bannedPhrasesSkipped` 非空时按键名记审计。
- 守卫判定与原先相同：草稿违规时记跟进守卫审计并跳过。
- **否决**：每个商机各解析一次。同一轮同一份 policy，没有必要。

### D4：字节级不变的验证方式

- `__tests__/fixtures/followup-golden-cases.ts` 共 10 例：
  - 第 1 / 2 / 3 次跟进 × 中英文；
  - 有无联系人、有无展会、有无追问、有无署名、有无对外英文名。
- 用改动前的代码生成 `followup-golden-pre-c2.json`，并单独提交。
- 测试三种情况逐字节比对：
  - 不传偏好；
  - 配满偏好但关闭；
  - 开启但全空。
- B-3 的首封金样本与 `draft-preferences.test.ts` 照跑，证明 D1 的抽取不改首封。

## 与八条硬纪律的关系

1. **零 schema**：不涉及 schema；偏好仍在 `OrgBusinessRule(revenue_spine.policy)`。
2. **出站先审批**：跟进草稿照旧经 `sales.send_inquiry_reply` 审批，本 change 不加外发路径。
3. **禁止第三套队列**：沿用 `revenue-spine` 定时任务，不新增 cron / 队列。
4. **脱敏**：偏好不含数字与商务条款用语（B-3 校验）；审计只记键名与原因。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：纯模板与规则，不新增 LLM 调用（跟进本来就不润色）。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

| 验证项 | 命令或做法 | 期望结果 |
|---|---|---|
| 跟进偏好、禁用词、退回、接入点 | `npx tsx src/lib/revenue-spine/__tests__/followup-preferences.test.ts` | 全部通过 |
| 跟进关闭时字节级不变 | 同上，跟进金样本三种情况 | 与 `followup-golden-pre-c2.json` 逐字节相同 |
| 首封不变 | `npx tsx src/lib/revenue-spine/__tests__/draft-preferences.test.ts` | 45 条全过（含首封金样本） |
| 既有跟进测试 | `npx tsx src/lib/revenue-spine/__tests__/no-reply-followup.test.ts` | 全过 |
| 全量 / 类型 / lint / CI 子集 | `npm test`、`npm run typecheck`、`npm run lint:baseline`、`npm run test:ci` | 与基线一致 / 通过 |
| 规格 | `openspec validate fde-preferences-in-followup --strict` | 通过 |

## Risks / Trade-offs

- **[跟进的结束语是新增行]**：配置了结束语时，跟进多一行。这是与首封统一口径的代价，不配置时不出现。
- **[专名挡住后，产品说法里的禁用词不替换]**：与首封同一取舍，不改买家的说法。
- **[D1 抽取可能改到首封]**：B-3 金样本、45 条测试与审查差分兜底。

## Migration Plan

无数据迁移。已开启 `fde.useConfirmedPreferences` 的组织，下一轮跟进起草即生效；关闭开关即恢复默认模板。
