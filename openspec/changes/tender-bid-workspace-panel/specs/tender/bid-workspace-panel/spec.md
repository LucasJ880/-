# Spec Delta

## Purpose
规定项目页「投标工作区」面板的对外行为：何时出现、显示哪些判定与清单、谁能导入价格表与领取方名单、成本核算如何输入与显示。面板只显示与保存，不提供任何对外动作。

## ADDED Requirements

### Requirement: 开关关闭时面板不出现
面板 SHALL 只在投标工作区读取接口成功返回时渲染。接口返回 404 时面板 SHALL NOT 渲染任何内容，「标书与报价」页签的其它卡片 SHALL 与没有本面板时相同。

#### Scenario: 开关关闭
- **WHEN** 开关关闭，打开一个招投标项目的「标书与报价」页签
- **THEN** 页面上没有「投标工作区」面板（截图 `docs/acceptance/ti-4b/flag-off.png`；`npx tsx src/lib/tender-bid-workspace/__tests__/panel-helpers.test.ts` 的源码断言）

### Requirement: 显示判定、阻断项与三张清单
面板 SHALL 显示可投标判定（「不可投标」或「可提交 Owner 决定」）与每个阻断项的说明；SHALL 分别显示缺的材料、未接通的来源、等批准的动作三张清单；SHALL 显示十三个阶段各自的决定。面板 SHALL NOT 出现询问用户是否执行某个阶段的控件或文案。「可提交 Owner 决定」旁 SHALL 写明这不是批准。

#### Scenario: 渥太华项目
- **WHEN** 项目已存渥太华 18 行与 9 家领取方名单、截标时间已过
- **THEN** 面板显示「不可投标」、逐条阻断项、三张清单与 13 个阶段的决定（截图 `docs/acceptance/ti-4b/overview.png`）

### Requirement: 价格表的显示与粘贴导入
面板 SHALL 以表格显示已存的价格表行项（行号、说明、数量、单位、包装数、尺寸、是否带认证要求）。有项目写权限的人 SHALL 可以粘贴制表符或逗号分隔的表格并保存；粘贴解析 SHALL 按列「行号、说明、数量、单位、包装数、尺寸、最小尺寸、认证要求」读取，带引号的字段里的逗号 SHALL 不拆列，首行是表头时 SHALL 跳过。解析 SHALL NOT 改写单位或数量；解析不了的行 SHALL 逐行提示并 SHALL NOT 被保存。没有写权限的人 SHALL NOT 看到导入入口。

#### Scenario: 粘贴 18 行
- **WHEN** 粘贴渥太华 18 行的制表符分隔文本（含表头）
- **THEN** 解析出 18 行，单位与数量与原文一致，含逗号的说明 `Laundry Bags, Front Load` 保持为一个字段（`npx tsx src/lib/tender-bid-workspace/__tests__/panel-helpers.test.ts`）

#### Scenario: 某一行数量不是数字
- **WHEN** 粘贴内容里第 3 行的数量是 `abc`
- **THEN** 该行被标为解析失败并说明原因，其余行照常解析（同一测试）

### Requirement: 文件领取方的显示与粘贴
面板 SHALL 显示领取方数、竞争对手领取方数与投标人数（没有开标记录时显示「未知」），并常驻显示「领取文件不等于投标」的说明。有写权限的人 SHALL 可以粘贴公司名单（一行一个）与门户名称并保存；采集时间 SHALL 取保存时的当前时间并带时区。空行与重复的空白 SHALL 被忽略。

#### Scenario: 粘贴九家
- **WHEN** 粘贴 9 行公司名（中间夹一个空行）
- **THEN** 解析出 9 个条目；保存后面板显示领取方数 9、投标人数「未知」（同一测试；截图 `docs/acceptance/ti-4b/overview.png`）

### Requirement: 成本核算的输入与显示
面板 SHALL 让用户逐行填写采购类型、供应商报价、报价方式、币种、证据类别、关税率、运费与本地配送，并填写汇率（含来源与日期）、进口 GST、定价口径与预备金；点「计算」后 SHALL 显示核算表的行项、合计、假设与出处、阻断与提示四块。合计块 SHALL 写明「不含 HST」并同时显示毛利率与加成率。成本输入 SHALL 只保存在浏览器本地，面板 SHALL 写明这一点，并提供导出与导入。接口返回 403 时面板 SHALL 显示「需要财务查看权」且 SHALL NOT 显示核算表。没有填报价的行 SHALL 仍出现在核算表里并显示缺什么。计算成功后，面板顶部的判定 SHALL 改用接口随核算表一并返回的判定并标明「已计入本次成本核算」；保存工作区、清空输入或计算失败后 SHALL 回到未计入成本的判定。

#### Scenario: 负责人计算核算表
- **WHEN** 项目负责人填入一组成本输入并点「计算」
- **THEN** 面板显示 18 行的核算表与合计块，标明不含 HST（截图 `docs/acceptance/ti-4b/cost-sheet.png`）

#### Scenario: 成本输入组装
- **WHEN** 草稿里第 1 行填了报价 30.00 人民币、按件、关税率 18%，第 2 行什么都没填
- **THEN** 组装出的请求只含第 1 行；人民币的汇率、来源与日期取自草稿的汇率设置（`npx tsx src/lib/tender-bid-workspace/__tests__/panel-helpers.test.ts`）

### Requirement: 面板不提供对外动作
面板 SHALL NOT 含发送邮件、提交投标、建立或批准审批的控件，SHALL NOT 调用投标工作区三个接口以外的写接口。

#### Scenario: 源码断言
- **WHEN** 检查面板组件的源码
- **THEN** 只请求 `/api/projects/{id}/bid-workspace` 与 `…/bid-workspace/cost-sheet`；没有审批、发信、提交的调用（同一测试）
