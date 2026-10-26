# B-3 完成报告：已确认偏好接入草稿模板层（openspec change `fde-preferences-in-draft`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §B-3；偏好来源按用户 2026-10-26 选的 (b)：放进 `revenue_spine.policy` 新段，不经 employee-ai。
分支：`claude/fde-preferences-in-draft`。叠在 B-2 `claude/fde-fact-proposals` 之上，PR base = B-2 分支，依次合并后改回 `main`。
OpenSpec change：`openspec/changes/fde-preferences-in-draft/`（proposal / `specs/revenue-spine/fde-draft-preferences/spec.md` / design / tasks，`openspec validate --strict` 通过）。

---

## 1. 做了什么

老板或管理员把措辞偏好写进 `revenue_spine.policy` 的 `fde` 段（写入即"已确认"），FDE 首封回复草稿在模板层引用。开关默认关闭，关闭时草稿逐字节不变。

| 文件 | 内容 |
|---|---|
| `src/lib/revenue-spine/policy.ts`（改） | `fde` 段：`useConfirmedPreferences`（只认布尔，默认 `false`）+ `preferences`（问候 / 结束语 / 敬语按语言、必问、免问、禁用词）；合并只做形状 |
| `src/lib/revenue-spine/draft-preferences.ts`（新） | `resolveDraftPreferences`：逐条校验，违规项忽略、其余照用；违规审计（键名 + 原因，按组织 + 指纹去重，依赖可注入，失败不影响起草） |
| `src/lib/revenue-spine/rfq/missing-info.ts`（改） | `buildClarifyingQuestions` 可选偏好：必问在前、去掉免问，上限不变 |
| `src/lib/revenue-spine/reply-draft.ts`（改） | `buildReplyDraft` 可选 `preferences`：问候（有联系人名时）/ 结束语 / 敬语；禁用词只替换模板句子；替换后过不了守卫则这封不替换。`polishReplyDraftWithLlm`：开启偏好时偏好行必须原样保留、禁用词不得变多 |
| `src/lib/revenue-spine/fde/inbound-sales.ts`（改） | 解析一次偏好，追问 / 草稿 / 审核用中文版共用；违规与"本封未替换"记审计；运行事件只记键名 |
| 测试（新，已注册进两个测试脚本） | `draft-preferences.test.ts` 45 条；金样本 `__tests__/fixtures/draft-golden-cases.ts` + `draft-golden-pre-b3.json`（10 例，用改动前代码生成，单独提交 `3a3b10b8`） |

### 偏好的规则

1. **开关**：`fde.useConfirmedPreferences` 只认布尔值。关闭时不解析偏好，调用方不传，代码路径与改动前相同。
2. **校验**（违规项逐条忽略）：
   - 问候 / 结束语 / 敬语 / 替换词：过草稿守卫与买家原话风险检查；不含任何数字字符（含全角、½、③、Ⅲ）、数字词（three / a week / 三天 / 五百 / 壹佰 / 十来天 / 百分之 …，常见客套话放行）、商务条款用语（起订 / 交期 / 价 / 折 / 送 / 免费 / 样品 …，MOQ / price / delivery / guarantee …）、换行、控制字符；≤ 120 字；
   - 问候含且只含一个 `{name}`，其它文案不含花括号；
   - 必问 / 免问：必须是可追问的 RFQ 字段；必填不能免问；与必问冲突的免问忽略；
   - 禁用词：2–60 字，不含数字 / 换行；替换词含任何禁用词（会链式替换）的整条忽略；最多 30 条。
3. **作用范围**：只有问候、结束语、敬语、追问顺序与免问、禁用词替换。禁用词不替换：参考值原句、"需内部确认"段、需求复述、参考款、参考项目、署名块、偏好行、主题，以及句子里嵌着的专名（组织名、买家公司名、买家产品名、展会名、联系人名、参考款）与链接。替换后多出守卫违规时，这一封不替换，按引起违规的禁用词键名记审计。
4. **守卫顺序不变**：模板 → 可选润色 → 守卫。
5. **审计**：`revenue_spine.draft_preferences.ignored`，目标 `revenue_spine_policy` / 组织 id，只记键名与原因，同组织同一组违规只记一次。

### 开启方式（没有设置界面）

```http
PUT /api/revenue/policy        （admin / boss）
{ "policy": { "fde": {
    "useConfirmedPreferences": true,
    "preferences": {
      "greeting":   { "en": "Hi {name},", "zh": "尊敬的{name}：" },
      "closing":    { "en": "Looking forward to working with you." },
      "valediction":{ "en": "Kind regards,", "zh": "顺祝商祺" },
      "priorityQuestions": ["quantity", "incoterm"],
      "skippedQuestions":  ["targetPrice"],
      "bannedPhrases": [{ "phrase": "inquiry", "replacement": "request" }]
} } } }
```

- 清空：列表写 `[]`，文案写 `{ "en": null }`；写 `null` 或不写沿用当前值。
- 关闭：`"useConfirmedPreferences": false`，或把 `OrgBusinessRule(revenue_spine.policy)` 回退到上一版本。


## 2. 怎么验的

| # | 验证 | 结果 |
|---|---|---|
| 1 | `draft-preferences.test.ts` 单独运行 | 45 / 45；`scoring-draft` 21、`tricky-inquiries` 27、`no-reply-followup` 7、`draft-feedback` 95、`fact-proposals` 37、`fact-extract` 61 全过 |
| 2 | 任务书验收"关闭时草稿字节级不变" | 金样本 10 例（中英文 / 有无联系人 / 官网 / 展会 / 参考款 / C 级只发目录 / 有无商务事实）用改动前的代码生成并单独提交（`3a3b10b8`）；不传偏好、配满偏好但关闭、开启但全空三种情况，主题 / 正文 / 追问字段逐字节相同。独立审查另用改动前的代码树做了 1944 组差分，开关关闭时 `cmp` 完全一致 |
| 3 | 任务书验收"开启时有偏好 → 模板体现" | 问候、结束语、敬语、必问 / 免问、禁用词逐项断言；没有联系人名时沿用默认问候 |
| 4 | 任务书验收"守卫测试全绿" | 10 例金样本输入配满偏好时守卫违规均为空；守卫在禁用词替换之后、润色之后都照跑（源码断言顺序） |
| 5 | "偏好不能注入商务承诺" | 守卫、数字（含全角 / ½ / ③ / Ⅲ）、数字词、商务条款用语逐条入表；替换后拼出承诺 → 本封不替换并按键名记审计；替换词含禁用词（链式）整条忽略 |
| 6 | 违规审计 | 只含键名与原因、不含文案；同组织同一组违规只记一次；失败吞掉；去重查询形状与跟进草稿守卫审计一致 |
| 7 | 变异检查 | 把默认 "Best regards," 改一个空格 → 金样本失败；免问过滤失效 → 排序测试失败；去掉"需内部确认"段保护 → 测试失败；数字判断退回 `\d` → 全角测试失败 |
| 8 | `npm run typecheck`（全量） | 退出 0 |
| 9 | `npm run lint:baseline` | PASS |
| 10 | `npm test` 对比基线 | 本分支 431/445（B-2 分支 430/444 + B-3 新增 1 项，全 PASS）；14 项失败与基线逐条一致 |
| 11 | `npm run test:ci` | `CI unit subset PASS`，含 B-3 新测试 |
| 12 | `bash scripts/check-test-registry.sh` | B-3 新测试已注册；仍有 `main` 上既有的 2 个 trade 测试未注册（不是本 change 引入） |
| 13 | `git diff --stat claude/fde-fact-proposals -- prisma/ vercel.json` | 空 |
| 14 | `openspec validate fde-preferences-in-draft --strict`；`/opsx:verify` | valid。verify 结果：<br>- tasks 5 / 5；<br>- 9 条 requirement / 29 个 scenario 均有测试断言；<br>- design D1–D7 与实现一致（两轮审查后同步）；<br>- 无 CRITICAL / WARNING。<br>未验证：真实 DB 下的审计去重查询与 FDE 全链路（容器无 DB），留 staging |

## 3. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **来源是 policy，不是 employee-ai confirmed 偏好**（用户决定 b）。"已确认"指老板或管理员经 `PUT /api/revenue/policy`（既有 admin / boss 角色门）写入。`preference-learner`、`EmployeeAiProfile` 不读不写。
2. **开关位置**：`OrgBusinessRule(revenue_spine.policy)` 的 `fde.useConfirmedPreferences`，不在 `settingsJson`（与 B-5 偏差 6 同口径）。
3. **【GATE 注意项】没有设置界面**：与 `notify` / `autonomy` 一样经 API 写入，见第 1 节开启方式。
4. **【GATE 注意项】只接首封回复草稿**：无回复跟进草稿不读偏好。开启后首封与跟进的问候、结束语不一致，跟进草稿还会追问免问字段（如目标价）。接入跟进草稿另开 change。
5. **违规偏好在起草时判定并审计**：存量 policy、seed 脚本直接写入的都能覆盖；`PUT` 接口不拦截，GET / PUT 的响应多出合并后的 `fde` 段。
6. **"默认追问集"** = 必问 + 免问，只在既有可追问字段里选，不新增问题模板，上限仍为 `maxQuestionsPerReply`。
7. **偏好文案禁止数字**，比守卫更严。
8. **B-1 段落分类器不变**：自定义问候或敬语不在分类器词表里时（如 "Greetings {name},"），改稿 diff 会把该段记为正文段。
9. **【GATE 注意项】数字词与商务条款用语也拦，宁可多拦**：常见客套话放行；仍会误拦"一对一"、"一条龙"、"每一件产品"、"送"字句等，误拦的偏好记审计，管理员换个说法即可。
10. **清空偏好的写法**：列表写 `[]`、文案写 `{ "en": null }` 才清空；写 `null` 或不写沿用当前值。
11. **【GATE 注意项】"需内部确认"段整行不替换**：这一行里的 "revert to you"、"尽快" 等措辞也不随禁用词替换，保证"需内部确认"的口径一字不变。

## 4. 交叉审查（独立审查代理两轮，只给代码与规格）

### 第一轮

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 阻塞 | 禁用词能改写"需内部确认"段（`需内部确认 → 没有问题`、`will confirm → have approved`），违反 spec 的 MUST NOT，守卫也拦不住 | "需内部确认"段抽成常量加入保护行；测试：禁用这些词时正文与不传偏好相同 |
| 2 | 阻塞 | 全角数字（"３天"）通过"不含数字"校验进了草稿 | 数字判断改为 Unicode 数字类；测试 |
| 3 | 应修 | 数字词（three days、ten dollars、三天、五美元）把天数和金额带进草稿 | 新增数字词规则 |
| 4 | 应修 | 禁用词把目录链接改坏（`catalog → brochure`） | 先挡住链接与嵌着的专名再替换 |
| 5 | 应修 | spec 没覆盖 policy 接口响应多出 `fde`；proposal 写"响应不变"不准 | spec 补"偏好经 policy 接口读写"，proposal 改措辞 |
| — | 可选 | 联系人名 / 替换词里的 `$` 被当替换模式；替换拼出承诺后每封都被拦且无审计；链式替换；行首空格；专名被替换；润色按次数比较可被挪动绕过；跟进草稿问免问字段；清空写法；测试缺口 | 全部处理：函数式替换；拼出承诺时本封不替换并记审计；链式整条忽略；行首去空格；专名与链接挡住；润色去掉保护行后再比较；后两项写进偏差 4、10；补测试 |

### 第二轮（只审第一轮的修复）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 应修 | 数字词仍漏：中文不带单位的数词（"起订五百，交期十五"）、大写数字、½ / ③ / Ⅲ、"a week"、"买一送一"、"打对折" | 数字类改为 `\p{N}`；中文数词连着两个以上或后跟单位都拦（含大写）；英文补 a week / fortnight / couple / third / quarter；新增商务条款用语规则；常见客套话白名单 |
| 2 | 应修 | spec 的润色判定没跟上代码（去掉保护行后再比较） | 改写该要求并补"润色挪动禁用词"场景 |
| — | 可选 | 专名按子串挡（"Re" 挡住 received）；占位符可被输入里的同形片段或纯数字款号拆坏；常见结束语误拦；替换前已有违规时不退回；退回审计指纹固定看不出是哪条；"需内部确认"段整行保护的副作用；ignored 顺序；spec 两个场景说法冲突 | 拉丁专名按词边界；一次扫描 + 私用区分隔符 + 还原找不到时原样保留；客套话白名单；替换多出违规（替换前已有的不算）就退回；逐条试出引起违规的禁用词、按键名记审计；整行保护写进偏差 11；ignored 按原顺序；spec 场景统一为"不是布尔值时沿用当前值" |

审查同时独立确认了以下几点：
- 金样本是真的：生成提交只新增两个 fixture，用改动前的代码重生成逐字节相同；
- 关闭路径：1944 组差分完全一致；开启但全空时只多出 `draft.preferences`；关闭时无审计、事件无偏好键、润色提示词不变；
- 保护行与实际行字符串一致（中英文）；
- 守卫顺序不变；`mergeFdePolicy` 对垃圾值、存量 policy 稳健；
- 审计 `afterData` 是字符串列，`contains` 指纹去重有效；
- 八条硬纪律无违反。

## 5. staging 待验项（GATE-B2 的 B-3 部分）

- 用第 1 节的 `PUT` 给测试组织开启偏好（问候 `Hi {name},`、免问 `targetPrice`、禁用词一条），再加一条含数字的结束语。下一封 FDE 草稿应满足：
  - 体现问候与禁用词替换，不问目标价；
  - 含数字的结束语被忽略，并产生一条 `revenue_spine.draft_preferences.ignored` 审计（只含键名与原因）；
  - 运行事件"回复草稿已生成"里有 `draftPreferences` 键名。
- 关闭开关后，草稿回到默认模板。
- 审核用中文版（英文询盘）同样体现中文偏好。

## 6. 已知限制

- 跟进草稿不读偏好（偏差 4）。
- 数字词与商务条款用语是词表规则，宁可多拦；写法千变万化，最终仍靠草稿守卫与人工审批兜底。
- 模板句子里的禁用词替换可能让句子不通顺（如替换成空串）。属于企业自己的配置，审批人可见。
- 开启偏好后，LLM 润色改写了偏好问候或多用了禁用词就回退模板，润色比例会下降。
