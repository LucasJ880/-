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

## ADDED Requirements

### Requirement: 生成结果里的缺译文提醒
`supplier_rfq` 生成成功且询价单里有要求没有中文译文时，响应 SHALL 带 `notices` 数组，其中一句为「有 {N} 条要求还没有中文译文，询价单里按原文印出并注明了。可以到「招标要求」的投标合规矩阵点「翻译成中文」后重新生成。」；没有这样的要求时 `notices` SHALL 为空数组。提醒 SHALL NOT 改变生成结果：文件照常保存。

#### Scenario: 生成成功并带提醒
- **WHEN** 项目有 1 条已确认要求的译文为空，生成 `supplier_rfq`
- **THEN** 200，`notices` 里有「有 1 条要求还没有中文译文」那一句，文件与记录照常写入，渲染内容里有「（暂无中文译文，以原文为准）」；全部有译文的项目 `notices` 为空数组（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）
