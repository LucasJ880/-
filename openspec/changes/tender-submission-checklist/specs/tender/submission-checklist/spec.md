## Purpose
规定招投标项目的交付前检查清单：它由招标分析里已经确认的强制提交类要求逐条生成（每条可回到原文），加上截标时间与招标文件写明的提交条件；人逐条标「备好了 / 不适用」。清单不调模型，也不替人判断某一条是否真的备好。

## ADDED Requirements

### Requirement: 清单由已确认的要求生成
清单 SHALL 取自项目当前可用的那份分析：强制的、类别属于提交类（提交、行政、报价、样品、深化图、保证金、保险）、且人已确认的要求，每条一项，带要求编号、中文与原文、出处页码。已驳回的 SHALL NOT 出现。还没确认的同类要求 SHALL 单列一组并标明「还没确认」，SHALL NOT 混进要备齐的那一组。生成 SHALL 是确定性的，SHALL NOT 调用模型。

#### Scenario: 确认、未确认、驳回
- **WHEN** 一份分析里有三条强制的提交类要求：一条已确认、一条还没确认、一条已驳回
- **THEN** 「要备齐的」里只有已确认的那一条；「还没确认」里有一条；驳回的不出现（`npx tsx src/lib/tender-submission-checklist/__tests__/checklist.test.ts`；`npx tsx src/lib/tender-submission-checklist/__tests__/checklist-db.isolated.test.ts`）

#### Scenario: 不是提交类、或不是强制的
- **WHEN** 一条已确认的强制要求类别是产品规格；另一条提交类要求不是强制的
- **THEN** 两条都不在「要备齐的」里（`checklist.test.ts`）

#### Scenario: 没有可用的分析
- **WHEN** 项目还没有等待审核或已批准的分析
- **THEN** 清单为空，并说明要先完成招标分析（`checklist.test.ts`；`checklist-db.isolated.test.ts`）

### Requirement: 废标风险与提交条件
清单 SHALL 另列：当前判为不满足的强制要求（任何类别，已驳回的除外），标为废标风险；截标时间与提问截止时间；招标文件里写明的提交方式、保证金、保险（分析里标为未找到的 SHALL 写明「招标文件里没有找到，请自行核对」，SHALL NOT 留空或编造）。清单 SHALL NOT 包含金额、毛利、我方报价。

#### Scenario: 不满足的强制要求
- **WHEN** 一条已确认的强制要求被判为不满足
- **THEN** 它出现在废标风险一组，带出处（`checklist.test.ts`）

#### Scenario: 招标文件里没写提交方式
- **WHEN** 分析里提交方式这一项是未找到
- **THEN** 清单写明没有找到、请自行核对（`checklist.test.ts`）

### Requirement: 逐条标状态
有项目写权限的人 SHALL 能把「要备齐的」里的一条标为备好了、不适用，或改回待办；状态 SHALL 存进这条要求在该次分析里的交付物行，重新读取时仍在。只有清单里实际存在的条目 SHALL 能被标；别的键 SHALL 被拒。每次修改 SHALL 留审计。系统 SHALL NOT 自行把任何一条标为备好了。重新分析产生新的一份分析后，状态 SHALL 从待办重新开始。

#### Scenario: 标为备好了
- **WHEN** 项目负责人把一条标为备好了，再读取清单
- **THEN** 这一条是备好了，进度是「1 / N」；审计里有一条记录（`checklist-db.isolated.test.ts`）

#### Scenario: 不在清单里的键
- **WHEN** 请求标一个不属于这份清单的键（别的项目的、还没确认的、编造的）
- **THEN** 返回 404，什么都没有写（`checklist-db.isolated.test.ts`）

#### Scenario: 重新分析之后
- **WHEN** 一条标为备好了之后，项目重新分析并批准了新的一份
- **THEN** 新清单里这一条是待办（`checklist-db.isolated.test.ts`）

### Requirement: 权限与隔离
两个接口 SHALL 只对招投标项目、且开关对该项目的组织开启时可用，否则 SHALL 返回 404。读取 SHALL 要求项目读权限，修改 SHALL 要求项目写权限。组织 SHALL 取自项目记录本身。别的组织的人 SHALL NOT 能读到或修改。

#### Scenario: 只读成员与别的组织
- **WHEN** 只读成员读取后尝试修改；别的组织的人读取
- **THEN** 只读成员读取成功、修改被拒（403）；别的组织的人被拒（`checklist-db.isolated.test.ts`）

### Requirement: 取代模型生成的清单
开关开启时，「提交」页签 SHALL 显示这份清单，SHALL NOT 显示模型生成的「投标准备清单」；模型生成清单的接口 SHALL NOT 调用模型，打开项目页 SHALL NOT 自动触发它。开关关闭时页面与接口 SHALL 与现在相同。

#### Scenario: 开关开启
- **WHEN** 开关开启，请求生成模型清单
- **THEN** 接口不调用模型，返回已由确定性清单取代；「提交」页签显示确定性清单（`checklist-db.isolated.test.ts`；截图 `docs/acceptance/flow-h4b/checklist.png`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭
- **THEN** 新接口 404，「提交」页签与模型清单的接口都与现在相同（`checklist-db.isolated.test.ts`；截图 `docs/acceptance/flow-h4b/flag-off.png`）
