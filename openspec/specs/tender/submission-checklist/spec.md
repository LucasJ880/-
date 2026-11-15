# tender/submission-checklist Specification

## Purpose
规定招投标项目的交付前检查清单：它由招标分析里已经确认的强制提交类要求逐条生成（每条可回到原文），加上截标时间与招标文件写明的提交条件；人逐条标「备好了 / 不适用」。清单不调模型，也不替人判断某一条是否真的备好。

## Requirements

### Requirement: 清单由已确认的要求生成
清单 SHALL 只取自逐条带依据的分析（摘要里有逐条的提交清单）；当前可用的那份不是这一种、或者还没有可用的分析时，清单 SHALL 不可用，「提交」页签、模型生成清单的接口与自动触发 SHALL 与开关关闭时相同。清单 SHALL 取自项目当前可用的那份分析：强制的、类别属于提交类（提交、行政、报价、样品、深化图、保证金、保险）、且人已确认的要求，每条一项，带要求编号、中文与原文、出处页码。已驳回的 SHALL NOT 出现。还没确认的同类要求 SHALL 单列一组并标明「还没确认」，SHALL NOT 混进要备齐的那一组。生成 SHALL 是确定性的，SHALL NOT 调用模型。

#### Scenario: 确认、未确认、驳回
- **WHEN** 一份分析里有三条强制的提交类要求：一条已确认、一条还没确认、一条已驳回
- **THEN** 「要备齐的」里只有已确认的那一条；「还没确认」里有一条；驳回的不出现（`npx tsx src/lib/tender-submission-checklist/__tests__/checklist.test.ts`；`npx tsx src/lib/tender-submission-checklist/__tests__/checklist-db.isolated.test.ts`）

#### Scenario: 不是提交类、或不是强制的
- **WHEN** 一条已确认的强制要求类别是产品规格；另一条提交类要求不是强制的
- **THEN** 两条都不在「要备齐的」里（`checklist.test.ts`）

#### Scenario: 没有可用的分析
- **WHEN** 项目还没有等待审核或已批准的分析
- **THEN** 接口说不可用（没有分析）；模型生成清单的读取不带「已取代」，生成照常往下走（`checklist-db.isolated.test.ts`）

#### Scenario: 旧的分析
- **WHEN** 当前可用的那份分析不逐条带依据（要求只分成强制·通用 / 强制·技术）
- **THEN** 接口说不可用，不说成「没有提交类强制要求」；模型生成清单照旧；标状态 404；之后有了带依据的分析，清单才可用（`checklist-db.isolated.test.ts`；`checklist.test.ts`）

#### Scenario: 清单来自哪一份
- **WHEN** 清单所用的那份之后又发起了一次分析，还在进行或失败了
- **THEN** 清单仍按那一份，写明它的发起日期，以及之后那一次还在进行 / 失败了；已被取代的不提（`checklist-db.isolated.test.ts`；`submission-checklist-card.test.tsx`）

### Requirement: 废标风险与提交条件
清单 SHALL 另列：当前判为不满足的强制要求（任何类别，已驳回的除外），标为废标风险；截标时间与提问截止时间；招标文件里写明的提交方式、保证金、保险（分析里标为未找到的 SHALL 写明「招标文件里没有找到，请自行核对」，SHALL NOT 留空或编造）。清单 SHALL NOT 新增金额字段，SHALL NOT 读取或带出我方的成本、毛利、报价；要求与提交条件的文字 SHALL 照招标文件原文显示（原文里的金额照原文）。

#### Scenario: 不满足的强制要求
- **WHEN** 一条已确认的强制要求被判为不满足
- **THEN** 它出现在废标风险一组，带出处（`checklist.test.ts`）

#### Scenario: 原文里写了金额
- **WHEN** 一条报价类要求写着预算上限，保证金一项写着金额
- **THEN** 两段文字照原文显示，不改写、不另算；清单的字段里没有金额、毛利、报价，取数不读成本与报价（`checklist.test.ts`；`submission-checklist-card.test.tsx`）

#### Scenario: 招标文件里没写提交方式
- **WHEN** 分析里提交方式这一项是未找到
- **THEN** 清单写明没有找到、请自行核对（`checklist.test.ts`）

### Requirement: 逐条标状态
有项目写权限的人 SHALL 能把「要备齐的」里的一条标为备好了、不适用，或改回待办；状态 SHALL 存进这条要求在该次分析里的交付物行，重新读取时仍在。只有清单里实际存在的条目 SHALL 能被标；别的键 SHALL 被拒。每次修改 SHALL 留审计，审计与状态 SHALL 在同一个事务里（审计写不进去时状态不改）。两条要求的编号派生出同一个键时 SHALL 共用一个状态，只有前一条能标。系统 SHALL NOT 自行把任何一条标为备好了。重新分析产生新的一份分析后，状态 SHALL 从待办重新开始。

#### Scenario: 标为备好了
- **WHEN** 项目负责人把一条标为备好了，再读取清单
- **THEN** 这一条是备好了，进度是「1 / N」；审计里有一条记录（`checklist-db.isolated.test.ts`）

#### Scenario: 不在清单里的键
- **WHEN** 请求标一个不属于这份清单的键（别的项目的、还没确认的、编造的）
- **THEN** 返回 404，什么都没有写（`checklist-db.isolated.test.ts`）

#### Scenario: 重新分析之后
- **WHEN** 一条标为备好了之后，项目重新分析出了新的一份（要求都还没确认），之后确认并批准
- **THEN** 新的一份出来时这一条在「还没确认」里；确认之后它是待办；旧的那份上的状态留在库里（`checklist-db.isolated.test.ts`）

#### Scenario: 审计写不进去
- **WHEN** 审计表拒绝这个项目的写入，标一条状态
- **THEN** 请求失败，交付物上的状态没有改（`checklist-db.isolated.test.ts`）

#### Scenario: 编号派生出同一个键
- **WHEN** 两条已确认的要求编号是 `D.1` 与 `D-1`，标了前一条
- **THEN** 两条都是备好了，进度到齐，库里只有一行（`checklist-db.isolated.test.ts`；`checklist.test.ts`）

### Requirement: 权限与隔离
两个接口 SHALL 只对招投标项目、且开关对该项目的组织开启时可用，否则 SHALL 返回 404（即使库里有分析与已确认的要求）。读取 SHALL 要求项目读权限，修改 SHALL 要求项目写权限；读取结果里「能不能标」SHALL 与服务端的写权限一致。组织 SHALL 取自项目记录本身。别的组织的人 SHALL NOT 能读到或修改。

#### Scenario: 只读成员与别的组织
- **WHEN** 只读成员、项目操作员读取后尝试修改；别的组织的人读取与修改
- **THEN** 两人读取成功、知道自己不能标，修改被拒（403）；别的组织的人读写都被拒（403）（`checklist-db.isolated.test.ts`）

#### Scenario: 能标的人
- **WHEN** 项目管理员、组织管理员（都不是负责人）、超级管理员读取
- **THEN** 读取结果说能标（`checklist-db.isolated.test.ts`）

### Requirement: 取代模型生成的清单
清单可用时（开关开启且当前分析逐条带依据），「提交」页签 SHALL 显示这份清单，SHALL NOT 显示模型生成的「投标准备清单」；模型生成清单的接口 SHALL NOT 调用模型；项目页上的自动触发 SHALL NOT 为它发生成请求（包括文件解析完成后的强制刷新）。开关开启却没取到清单（出错、网络、超时）时，页签 SHALL 写明没取到并给重试，SHALL NOT 退回模型生成的那份。开关关闭时页面与接口 SHALL 与现在相同。

#### Scenario: 开关开启
- **WHEN** 开关开启、当前分析逐条带依据，请求生成模型清单
- **THEN** 接口不调用模型，返回已由确定性清单取代；自动触发不发生成请求；「提交」页签显示确定性清单、不显示模型那份（`checklist-db.isolated.test.ts`；`checklist.test.ts`；截图 `docs/acceptance/flow-h4b/tab.png`）

#### Scenario: 没取到
- **WHEN** 开关开启，取清单出错、网络失败或超时
- **THEN** 写明没取到、给一个重试；模型那份不显示（`submission-checklist-card.test.tsx`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭
- **THEN** 新接口 404，「提交」页签与模型清单的接口都与现在相同（`checklist-db.isolated.test.ts`；截图 `docs/acceptance/flow-h4b/flag-off.png`）
