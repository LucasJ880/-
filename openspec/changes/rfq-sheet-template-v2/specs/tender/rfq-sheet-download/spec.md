# Spec Delta

## MODIFIED Requirements

### Requirement: 没有可收入的要求时不生成
项目没有已确认且属于供应商侧的要求（含没有可用分析）时，接口 SHALL 返回 422、`errorCode: "NO_CONFIRMED_REQUIREMENTS"` 与说明「询价单没有生成，也没有保存文件：还没有已确认的、要问供应商的要求（规格、样品、质保这类）。请到「招标要求」确认后再生成；都确认过仍这样提示，请联系管理员。」；SHALL NOT 写文件，SHALL NOT 建生成记录与项目文件记录，SHALL NOT 把之前的询价单记录标为可能过期。

#### Scenario: 一条已确认的要求都没有
- **WHEN** 项目只有未确认的要求，生成 `supplier_rfq`
- **THEN** 422、`NO_CONFIRMED_REQUIREMENTS` 与上面那句说明（不再用询价单生成器的原句：它在「都确认了但没有一条属于供应商侧」时把人引去逐条确认）；生成记录数与项目文件记录数不变，之前那份询价单记录的过期标记不变（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

### Requirement: 菜单入口与说明
「一键生成文档」菜单 SHALL 有一项「供应商询价单 PDF」（对应 `supplier_rfq`），SHALL NOT 再有「国内供应商简报 PDF（China Brief）」与「供应商技术确认表 PDF」两项；「标书与报价」页签 SHALL NOT 再显示国内供应商简报面板。生成结束（成功或失败）后菜单 SHALL 收起下拉层；失败时 SHALL 在菜单下方原样显示接口返回的说明（下拉层是浮层，不收起会盖住这句话）；成功且接口带回提醒时 SHALL 在同一位置原样显示提醒。文件列表里之前生成的两类已停用文件 SHALL 标「已停用」（不再标「可能过期」）；标记 SHALL 在窄屏上长标题被截断时仍然可见。「项目文件可能已更新，此前生成的 PDF 可能过期。建议重新生成。」的提示 SHALL NOT 因已停用的旧文件而出现。空状态提示 SHALL 为「生成供应商询价单、内部分析或同事任务单，自动读取当前项目资料。生成后可直接下载发送。」。新建情报室的默认交付物清单 SHALL NOT 再含「国内供应商中文 PDF」一项；已建情报室里存下的清单 SHALL NOT 被改写。

#### Scenario: 菜单项与面板
- **WHEN** 读菜单、页签与情报室默认清单的源码
- **THEN** 菜单选项里有 `supplier_rfq` 与「供应商询价单 PDF」，没有 `tech_confirm`、`china_supplier_brief`；失败时显示的是接口响应里的 `error`，生成结束后无论成败都收起下拉层；列表里已停用类型的记录带「已停用」，标记不在被截断的标题里；页签不再引用简报面板；默认交付物清单里没有 `china_supplier_brief`，仍有「厂家询价表」（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts` 源码断言）

### Requirement: 询价单文件的内容来源
`POST /api/projects/{id}/generate-pdf`（`docType: "supplier_rfq"`）SHALL 生成一份供应商询价单 PDF，内容与发询价时的询价单用同一套规则排出：当前可用招标分析（该项目最新一份等待审核或已批准的分析）里已确认的供应商侧要求与可用的关键事实（人工确认或高置信）、组织询价设置里的发件抬头、展示发件人与回复截止提前量、组织投标档案里的默认经办人（像人名时）、项目的截标日期、对供应商的中性询价编号。发起人填写项（数量阶梯、目的地、范围说明、附加问题）与贸易条款 SHALL 一律为空。起草日期 SHALL 取生成当时组织时区的日期。

#### Scenario: 只收已确认的供应商侧要求
- **WHEN** 项目的当前可用分析里有 3 条已确认的供应商侧要求、1 条已确认的保险类要求、1 条未确认的要求，生成 `supplier_rfq`
- **THEN** 200，询价单里有那 3 条要求的编号与规格，没有保险类与未确认的那两条；抬头是组织询价设置里的发件抬头；贸易条款一栏是「请注明报价贸易条款」（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

#### Scenario: 组织没有配置询价设置或项目没有组织
- **WHEN** 项目所属组织没有保存过询价设置，或项目没有所属组织，生成 `supplier_rfq`
- **THEN** 发件抬头与回复截止提前量用询价设置的默认值（与起草询价读同一份设置、同一个回落），起草日期用系统默认时区；照常生成（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts`）

#### Scenario: 起草日期按组织时区
- **WHEN** 组织时区为 `America/Toronto`，在 UTC `2026-12-02T03:30:00Z` 生成
- **THEN** 询价单上的起草日期是 `2026-12-01`（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts`）

### Requirement: 询价单文件不输出什么
询价单文件 SHALL NOT 含 AI 分析综合里的任何文字（要求标题与说明、风险、报价关注、澄清问题），SHALL NOT 含项目 AI 上下文与项目描述，我方撰写的部分（标题、栏目名、固定文字、我方抬头）SHALL NOT 含项目名称。系统 SHALL NOT 读取项目记录上的我方报价、中标价、项目估值与预算，SHALL NOT 读取供应商库；询价设置里的展示发件人印在抬头；授权邮箱只用作邮箱格式检查的白名单，SHALL NOT 印出。要求的原文与译文是人工确认过的招标文本，照原样印出；关键事实按询价单生成规则取用（人工确认或高置信的；地点只印「城市, 省」）。这些招标文本只按「命中内部财务信息时不生成」里的既有检查把关，本能力不另加词表。招标身份（招标编号、采购方名称、截标日期、精确交货地址）与招标要求原文里恰好和项目名称相同的词，按 `tender/supplier-identity-guard` 处理。

#### Scenario: 分析综合里写着毛利与预算
- **WHEN** 项目的分析综合在技术要求说明里写着「毛利」「预算」与采购方名称，已确认的要求里没有这些词，生成 `supplier_rfq`
- **THEN** 200，询价单的渲染内容里没有「毛利」「预算」与采购方名称（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

#### Scenario: 生成代码不再读分析综合
- **WHEN** 读生成文件的源码
- **THEN** 供应商询价单的生成路径不引用分析综合的供应商询价表模板与简报正文拼装，也不拼接项目 AI 上下文（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts` 源码断言）

### Requirement: 命中内部财务信息时不生成
询价单内容命中询价单生成规则里的内部财务信息检查（发件抬头按全量敏感词表；要求的原文、译文与编号、交付要求、数量事实按「只属于我方内部的字段与词」，见 `tender/rfq-requirement-selection`「招标原文的内部字段检查」）时，接口 SHALL 返回 422、`errorCode: "SENSITIVE_LEAK"` 与说明「询价单没有生成，也没有保存文件：内容里有不能发给供应商的字样（如毛利、利润率、底价、我方预算）。请到「招标要求」在已确认的要求里找这些字样；组织管理员另请检查「询价与落地价设置」里的「发件显示名」。改不了的请联系管理员。」；SHALL NOT 写文件、SHALL NOT 建记录。说明 SHALL NOT 含命中的原文。

#### Scenario: 已确认的要求里写着底价
- **WHEN** 一条已确认的供应商侧要求的译文含「我方底价 12 元」，生成 `supplier_rfq`
- **THEN** 422、`SENSITIVE_LEAK` 与上面那句说明，响应里没有「12 元」；生成记录数不变（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

## ADDED Requirements

### Requirement: 生成结果里的缺译文提醒
`supplier_rfq` 生成成功且询价单里有要求没有中文译文时，响应 SHALL 带 `notices` 数组，其中一句为「有 {N} 条要求还没有中文译文，询价单里按原文印出并注明了。可以到「招标要求」的投标合规矩阵点「翻译成中文」后重新生成。」；没有这样的要求时 `notices` SHALL 为空数组。提醒 SHALL NOT 改变生成结果：文件照常保存。

#### Scenario: 生成成功并带提醒
- **WHEN** 项目有 1 条已确认要求的译文为空，生成 `supplier_rfq`
- **THEN** 200，`notices` 里有「有 1 条要求还没有中文译文」那一句，文件与记录照常写入，渲染内容里有「（暂无中文译文，以原文为准）」；全部有译文的项目 `notices` 为空数组（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）
