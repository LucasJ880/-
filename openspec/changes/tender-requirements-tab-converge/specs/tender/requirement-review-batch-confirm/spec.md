## MODIFIED Requirements

### Requirement: 分析不再等待审核时不能批量确认
调用方要求「只在这份分析仍是等待审核时确认」时，若分析已被批准或已被新的分析取代，批量确认接口 SHALL 拒绝这次请求，SHALL NOT 确认任何要求，SHALL NOT 写审计，并 SHALL 返回原因。这个判断 SHALL 与确认本身是同一步完成的，不存在「先查到可以、随后被批准、仍然确认成功」的间隙。不带这项要求的请求 SHALL 保持本变更之前的行为。「招标要求」页签上不再有调用这个接口的界面（能力 `tender/requirements-tab`）。

#### Scenario: 面板开着时别人批准了分析
- **WHEN** 调用方（本变更之前是分析面板）拿到的分析还在等待审核，乙批准了这份分析，随后调用方带「只在等待审核时确认」提交批量确认
- **THEN** 接口返回 409，没有要求被确认，没有审计，响应里是「这份分析已经不是等待审核……」（`npx tsx src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm-db.isolated.test.ts`）

#### Scenario: 不带这项要求的调用
- **WHEN** 另一个调用方不带这项要求，对一份已批准的分析提交批量确认
- **THEN** 行为与本变更之前相同（`requirement-batch-confirm-db.isolated.test.ts`）

### Requirement: 计数与批准前的提示
投标合规矩阵顶部 SHALL 显示已确认、待确认、已驳回各几条，按这次分析的全部要求算。分析等待审核且还有待确认的要求时，矩阵上的「批准分析」旁 SHALL 显示提示：还剩几条没有确认、批准后不能再确认、没确认的不会进询价单。待确认为 0 时 SHALL NOT 显示这句提示。这句提示 SHALL NOT 增加批准所需的点击。

#### Scenario: 还有待确认的要求
- **WHEN** 等待审核的分析还有 4 条待确认的要求
- **THEN** 矩阵上「批准分析」旁显示「还有 4 条要求没有确认……」；全部确认后这句话消失（`npx tsx src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm.test.ts` 的提示文案；`npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge.test.ts` 的矩阵接线）

## REMOVED Requirements

### Requirement: 勾选后批量确认
**Reason**：FIX-22（Evan 2026-11-22）去掉了分析面板上的要求列表，要求只在投标合规矩阵一处列出；确认改为在矩阵上标注五态。勾选框、「全选待确认的」「取消全选」「确认选中的 N 条」随列表一起去掉。这条里的两句禁止是有意一起去掉的：「系统 SHALL NOT 提供不经过勾选就确认全部要求的操作」换成带确认框的批量标注（能力 `tender/requirements-tab`「批量标注先确认」，FIX-22 design D9、G2，推翻 RFQ-AUTO-4 D1 的取舍，原决定人 Lucas 2026-11-11）；「SHALL NOT 提供批量驳回」在新能力里重写为「SHALL NOT 提供批量的『这不是要求』」（`tender/requirements-tab`「『这不是要求』即驳回」）。
**Migration**：批量确认接口不变，仍可调用（「批量确认留审计」照旧）。页面上的确认改用矩阵：选五态即确认，「未标 N 条全部设为已有」「本组全部已有」「采纳全部历史建议」点后先确认。计数、全选、分批的纯函数保留，`requirement-batch-confirm.test.ts` 照跑；该测试的「面板源码」一段改为断言面板里已没有这些控件。

### Requirement: 提交与结果
**Reason**：这是面板上「确认选中的 N 条」的提交逻辑（分批、失败即停、显示实际条数），随要求列表一起去掉（FIX-22）。
**Migration**：批量确认接口本身不变。分批提交的纯函数保留，`requirement-batch-confirm.test.ts` 里用假接口跑分批的断言照旧通过。矩阵的批量标注一次请求最多 300 条，由矩阵写入接口整体校验（能力 `tender/requirements-tab`「矩阵写入接口」「批量标注先确认」）。
