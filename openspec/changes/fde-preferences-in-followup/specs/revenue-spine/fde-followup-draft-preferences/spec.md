# Spec Delta

## Purpose

无回复跟进草稿使用老板或管理员在 `revenue_spine.policy` 里确认的草稿偏好，与首封回复草稿口径一致；默认关闭，关闭时跟进草稿逐字节不变，偏好不能绕过草稿守卫。

## ADDED Requirements

### Requirement: 跟进草稿偏好默认关闭，关闭时跟进草稿不变

系统 SHALL 只在 `fde.useConfirmedPreferences` 为 `true` 时让无回复跟进草稿使用偏好。开关关闭时，跟进草稿的主题、正文与追问字段 MUST 与本 change 实施前逐字节一致，审核用中文对照也一样。

#### Scenario: 开关关闭但配了偏好
- **WHEN** policy 配了问候、结束语、敬语、免问与禁用词，但开关为 `false`
- **THEN** 跟进草稿与实施前生成的跟进金样本逐字节相同

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/revenue-spine/__tests__/followup-preferences.test.ts`
- **THEN** 本能力全部断言通过，退出码 0

### Requirement: 跟进草稿与首封使用同一份偏好

开关开启时，系统 SHALL 用与首封相同的偏好解析结果（同一套校验，违规项同样忽略）生成跟进草稿：
- 问候：有联系人名时用偏好问候模板，否则用默认问候；
- 敬语：英文替换 "Best regards,"，中文替换"祝好！"；
- 结束语：配置后在敬语前加一行，未配置时不加；
- 追问：必问字段先问、免问字段不问，上限仍为 3，问题文案与第 2 次跟进里列出的字段名同步变化。

#### Scenario: 问候与敬语
- **WHEN** 英文问候偏好为 `Hi {name},`、敬语为 `Kind regards,`，联系人为 Mark
- **THEN** 英文跟进第一行是 `Hi Mark,`，`Best regards,` 换成 `Kind regards,`，署名块不变

#### Scenario: 中文敬语与结束语
- **WHEN** 中文敬语为 `顺祝商祺`、中文结束语为 `盼复。`
- **THEN** 中文跟进把"祝好！"换成"顺祝商祺"，并在其前加一行"盼复。"

#### Scenario: 免问字段不问
- **WHEN** 免问为 `["targetPrice"]`，目标价缺失
- **THEN** 第一次跟进不问目标价，第二次跟进列出的待补信息里也没有目标价

### Requirement: 跟进草稿的禁用词替换不改专名与署名

开关开启时，系统 SHALL 在跟进草稿模板自己的句子里替换禁用词（规则与首封相同）。系统 MUST NOT 替换：署名块、偏好行、主题，以及句子里嵌着的组织名、对外英文名、联系人名、产品或参考款说法、展会名与链接。替换后的跟进比替换前多出草稿守卫违规时，系统 SHALL 这一封不做替换，并以引起违规的禁用词键名按 B-3 的违规审计规则记一次审计。

#### Scenario: 模板句子里的禁用词被替换
- **WHEN** 禁用词为 `quotation → offer`
- **THEN** 第一次英文跟进里 "To prepare an accurate quotation" 变为 "To prepare an accurate offer"

#### Scenario: 专名与署名不替换
- **WHEN** 禁用词出现在产品说法、展会名或署名块里
- **THEN** 这些内容原样保留

#### Scenario: 替换后拼出承诺
- **WHEN** 产品说法为 "samples kit"，禁用词为 `about → free`，替换后句子变成 "your email of November 1 free samples kit"
- **THEN** 这一封不做替换，并以这条禁用词的键名记一次审计

### Requirement: 跟进起草时的偏好审计不输出文案

跟进起草时，违规偏好与"本封未替换"的审计 SHALL 与首封使用同一动作、同一去重规则；审计 SHALL NOT 包含偏好文案原文、买家信息或草稿正文，只含键名与原因。审计失败 MUST NOT 影响起草。

#### Scenario: 违规偏好在跟进起草时也记审计
- **WHEN** 开启偏好、结束语含数字，组织里有到期的无回复跟进
- **THEN** 起草时调用同一套违规审计（同组织同一组违规只记一次），审计不含结束语原文
