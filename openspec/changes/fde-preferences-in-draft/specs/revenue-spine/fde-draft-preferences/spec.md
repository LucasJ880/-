# Spec Delta

## Purpose

FDE 首封回复草稿的团队偏好：老板或管理员在 `revenue_spine.policy` 里确认的问候、结束语、落款敬语、追问顺序与禁用词，在模板层进入草稿，默认关闭，关闭时草稿逐字节不变，偏好不能绕过草稿守卫。

## ADDED Requirements

### Requirement: 草稿偏好默认关闭，关闭时草稿不变

系统 SHALL 以 `revenue_spine.policy` 的 `fde.useConfirmedPreferences` 作为草稿偏好开关，默认关闭；只认布尔值（不是布尔值时沿用当前值），存量 policy 没有 `fde` 段时视为关闭。开关关闭时，FDE 首封回复草稿的主题与正文 MUST 与本 change 实施前字节级一致，追问的字段与顺序也不变。

#### Scenario: 存量 policy 没有 fde 段
- **WHEN** 组织的 policy 覆盖里没有 `fde` 段
- **THEN** 合并后 `fde.useConfirmedPreferences` 为 `false`，草稿与追问按默认模板生成

#### Scenario: 开关关闭但配了偏好
- **WHEN** policy 配了问候、结束语、敬语、必问、免问与禁用词，但 `fde.useConfirmedPreferences` 为 `false`
- **THEN** 草稿主题与正文与实施前生成的金样本逐字节相同

#### Scenario: 开关只认布尔值
- **WHEN** 当前关闭（默认）时，`fde.useConfirmedPreferences` 写成字符串 `"true"` 或数字 `1`
- **THEN** 沿用当前值，仍为关闭

### Requirement: 偏好只影响问候、结束语、敬语、追问与禁用词

开关开启时，系统 SHALL 只在模板生成阶段使用偏好，范围限于：问候模板、结束语、落款敬语、追问字段顺序与免问字段、禁用词替换。偏好 MUST NOT 改变需求复述、参考值原句、"需内部确认"段、署名块与主题。

#### Scenario: 问候模板生效
- **WHEN** 英文问候偏好为 `Hi {name},`，草稿联系人为 Cathy
- **THEN** 草稿第一行是 `Hi Cathy,`

#### Scenario: 没有联系人名
- **WHEN** 配了问候偏好，但草稿没有联系人名
- **THEN** 沿用默认问候（英文 `Dear there,`，中文 `您好：`）

#### Scenario: 结束语与敬语
- **WHEN** 英文结束语偏好为 `Looking forward to working with you.`，英文敬语偏好为 `Kind regards,`
- **THEN** 草稿用这两行替换默认结束语与 `Best regards,`，署名块不变

#### Scenario: 中文敬语
- **WHEN** 中文敬语偏好为 `顺祝商祺`
- **THEN** 中文草稿在署名前加这一行；未配置时中文草稿没有这一行

### Requirement: 必问与免问字段按偏好排序

开关开启时，系统 SHALL 先按 `priorityQuestions` 列出的顺序追问其中缺失的字段，再按默认顺序（必填在前）补齐其余缺失字段；`skippedQuestions` 里的字段不追问。追问总数上限仍为 `followUp.maxQuestionsPerReply`，问题文案仍用既有模板。

#### Scenario: 必问字段先问
- **WHEN** 必问为 `["incoterm", "quantity"]`，两者都缺失，上限 3
- **THEN** 前两个问题依次问贸易术语、数量，第三个是默认顺序里的下一个缺失字段

#### Scenario: 免问字段不问
- **WHEN** 免问为 `["targetPrice"]`，目标价缺失
- **THEN** 草稿不问目标价，空出的名额由下一个缺失字段补上

### Requirement: 禁用词替换不改事实与参考值

开关开启时，系统 SHALL 在模板自己的句子里整词替换 `bannedPhrases`（英文不区分大小写，中文按子串）。系统 MUST NOT 替换以下内容：
- 参考值原句（MOQ / 大货周期 / 装运港 / 含数字的样品说明）；
- "需内部确认"段；
- 买家需求复述行、展会参考款行、参考项目；
- 署名块、偏好问候 / 结束语 / 敬语本身、主题；
- 模板句子里嵌着的专名（组织名、买家公司名、买家产品名、展会名、联系人名、参考款）与链接。

替换后的草稿比替换前多出了草稿守卫违规时，系统 SHALL 这一封不做替换（替换前就有的违规照常保留），并按"违规偏好留审计"同一规则、以引起违规的禁用词键名记一次审计。

#### Scenario: 模板句子里的禁用词被替换
- **WHEN** 禁用词为 `inquiry` → `request`
- **THEN** 开场句 "We have received your inquiry" 变为 "We have received your request"

#### Scenario: 事实与参考值不替换
- **WHEN** 禁用词出现在买家需求复述行、参考值原句、署名块或主题里
- **THEN** 这些行原样保留；偏好问候、结束语与敬语本身也不替换

#### Scenario: "需内部确认"段不被改写
- **WHEN** 禁用词为 `需内部确认 → 没有问题`，或 `will confirm → have approved`
- **THEN** "需内部确认"段与不传偏好时逐字相同

#### Scenario: 链接与专名不替换
- **WHEN** 禁用词为 `catalog → brochure`，草稿里有目录链接；或禁用词是买家公司名、展会名里的词
- **THEN** 链接与专名原样保留，模板自己的词照常替换

#### Scenario: 替换后拼出承诺
- **WHEN** 禁用词为 `have received → guarantee`，替换后句子变成 "We guarantee your inquiry"
- **THEN** 这一封不做替换、草稿照常进审批，并记一次审计

### Requirement: 偏好值经守卫校验，违规项逐条忽略

系统 SHALL 在使用前校验每一条偏好，违规项逐条忽略、其余照用：
- 问候、结束语、敬语与替换词必须通过草稿守卫（与最终草稿同一套商务承诺规则）与买家原话风险检查，不得含任何数字字符（含全角、"½"、"③"、"Ⅲ"）、数字词（如 three、a week、三天、五百、壹佰、十来天）、商务条款用语（如起订、交期、价格、折扣、赠送、样品、免费、MOQ、price、delivery、guarantee）、换行或控制字符，不得超过长度上限；常见客套话（如"祝您一天愉快"、"十分感谢"、"one more thing"）不算数字词；
- 问候必须含且只含一个 `{name}`，其它文案不得含花括号；
- 禁用词不得含数字、换行或控制字符；替换词不得含任何禁用词（否则会链式替换）；
- 必问与免问的字段名必须是可追问的 RFQ 字段，必填字段不能免问，与必问冲突的免问忽略，重复项只算一次。

#### Scenario: 含商务承诺的偏好被忽略
- **WHEN** 英文结束语偏好为 `Free samples are available on request.`
- **THEN** 这条偏好被忽略，草稿用默认结束语，其它合法偏好照常生效

#### Scenario: 含数字的偏好被忽略
- **WHEN** 中文结束语偏好为 `我们 24 小时内回复。`、`我们３天内发货。`（全角数字）、`三天内发货。` 或 `每款起订五百，交期十五。`（数字词）
- **THEN** 这条偏好被忽略

#### Scenario: 商务条款用语被忽略
- **WHEN** 中文结束语偏好为 `买一送一` 或 `可以打对折`
- **THEN** 这条偏好被忽略

#### Scenario: 字段名不合法
- **WHEN** 免问里有必填字段 `quantity`，必问里有未知字段 `budget`
- **THEN** 两条都被忽略，数量照常追问

### Requirement: 守卫与润色顺序不变

系统 SHALL 保持既有顺序：模板生成 → 可选 LLM 润色 → 草稿守卫。开启偏好时，润色稿还 MUST 满足：
- 原样保留草稿实际使用的偏好问候、结束语与敬语；
- 两边都去掉原样出现的保护行（需求复述、参考值原句、"需内部确认"段、署名等不做替换的行）后，润色稿里禁用词出现次数不多于模板草稿。润色稿改写了某条保护行，那一行就算进比较。

任一不满足时回退模板草稿。开关关闭时润色的提示词与判定不变。

#### Scenario: 润色丢了偏好问候
- **WHEN** 草稿用了偏好问候，润色稿把问候改写了
- **THEN** 回退模板草稿

#### Scenario: 润色引入禁用词
- **WHEN** 润色稿把模板里已替换掉的禁用词又写了回去
- **THEN** 回退模板草稿

#### Scenario: 润色挪动禁用词
- **WHEN** 禁用词 `cotton` 原本只在需求复述行里，润色稿改写了这一行，并把 `cotton` 写进模板句子
- **THEN** 回退模板草稿

#### Scenario: 偏好草稿仍过守卫
- **WHEN** 开启偏好并生成草稿
- **THEN** 草稿守卫仍对最终草稿运行，参考值原句规则不变

### Requirement: 违规偏好留审计且不重复

开关开启且有违规偏好时，系统 SHALL 在 FDE 起草时写一条 AuditLog `revenue_spine.draft_preferences.ignored`：只记偏好键名与原因，不记文案；同一组织同一组违规只记一次。审计失败 MUST NOT 影响起草。开关关闭时不校验、不记审计。

#### Scenario: 首次遇到违规
- **WHEN** 开启偏好，结束语含数字
- **THEN** 产生一条审计，内容含键名 `closing.zh` 与原因，不含结束语原文

#### Scenario: 同一组违规不重复记
- **WHEN** 同一组织后续询盘再次起草，违规偏好没变
- **THEN** 不再产生新的审计

#### Scenario: FDE 运行事件列出偏好
- **WHEN** 开启偏好并起草
- **THEN** "回复草稿已生成"事件里列出生效与忽略的偏好键名

### Requirement: 偏好与审计不输出金额与文案

偏好值 SHALL NOT 含任何数字字符、数字词或商务条款用语，偏好 SHALL NOT 把金额、数量、天数或商务条款带进草稿。违规偏好的审计与 FDE 运行事件 SHALL NOT 包含偏好文案原文、买家信息或草稿正文，只含偏好键名与原因。

#### Scenario: 审计内容
- **WHEN** 结束语偏好 `Our price is the best in 2026.` 被忽略并记审计
- **THEN** 审计里只有键名 `closing.en` 与原因，没有这句原文

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/revenue-spine/__tests__/draft-preferences.test.ts`
- **THEN** 本能力全部断言通过，退出码 0

### Requirement: 偏好经 policy 接口读写

老板或管理员 SHALL 经既有 `PUT /api/revenue/policy`（body `policy.fde`）写入偏好与开关，权限与校验不变；`GET /api/revenue/policy` 的响应 SHALL 包含合并后的 `fde` 段。合并只做形状处理：开关只认布尔值，不是布尔值时沿用当前值；文案按语言逐键覆盖；列表整体替换，写 `[]` 表示清空，写 `null` 或不写表示沿用当前值。

#### Scenario: 写入后读回
- **WHEN** 管理员 PUT `{ policy: { fde: { useConfirmedPreferences: true, preferences: { greeting: { en: "Hi {name}," } } } } }`
- **THEN** 再 GET，响应的 `policy.fde` 里开关为 `true`、英文问候为 `Hi {name},`，其它偏好沿用原值

#### Scenario: 开关写错类型
- **WHEN** PUT 的 `fde.useConfirmedPreferences` 是字符串 `"false"`
- **THEN** 开关沿用当前值
