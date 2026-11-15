# Spec Delta

## Purpose

日常只用少数几个入口的成员，侧栏把常用入口固定在最上面、其余收进「更多」；谁用这种布局、常用是哪几项、「更多」怎么展开，都由一处规则决定，且不减少任何人能点到的入口。

## ADDED Requirements

### Requirement: 两段式布局的判定
桌面侧栏 SHALL 在且仅在以下情况使用「常用 + 更多」两段式布局：岗位模式下，企业已开外贸模块、当前用户持 `trade.read`、企业未开窗饰模块、且当前用户不是平台 super_admin；旧模式下，当前用户的平台角色为 `trade`。模块是否已开 SHALL 与导航入口的模块判定同口径（企业未配置模块清单时视为全部已开）。判定 SHALL NOT 依赖由岗位派生的平台角色。其余情况 SHALL 使用按分组排列的全量布局。

#### Scenario: 判定真值表
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/trade-layout.test.ts`
- **THEN** 岗位模式下四个条件全部满足时为两段式，任一不满足（未开外贸模块 / 不持 `trade.read` / 已开窗饰模块 / 平台 super_admin / 未配置模块清单）时为全量布局；旧模式下平台角色 `trade` 为两段式，`boss`、`sales`、`user`、空值为全量布局，测试通过

#### Scenario: 梦馨老板兼外贸业务员
- **WHEN** 家纺外贸企业里持 `owner` 与 `trade_rep` 岗位的成员加载侧栏（不论其平台角色是 `boss` 还是 `user`）
- **THEN** 侧栏为两段式（同一测试与 `npx tsx src/lib/authorization/__tests__/mengxin-positions.test.ts` 覆盖）

#### Scenario: 窗饰企业与平台管理员不变
- **WHEN** 窗饰企业的任一岗位（含持 `trade.read` 的老板）或平台 super_admin 加载侧栏
- **THEN** 侧栏为按分组的全量布局，`npx tsx src/lib/navigation/__tests__/position-nav.test.ts` 的各岗位侧栏入口快照不变

### Requirement: 常用段的内容与顺序
两段式布局的第一段标题 SHALL 为「常用」，内容 SHALL 为下列入口里当前用户可见的那些，按此固定顺序：今日询盘、询盘收件箱、线索资产、外贸报价、寄样、货号、客户与商机、知识库。不可见的入口 SHALL 跳过，SHALL NOT 用别的入口补位。

#### Scenario: 老板兼外贸业务员的常用段
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/trade-layout.test.ts`，以家纺外贸企业「老板 + 外贸业务员」的输入分区
- **THEN** 常用段依次为今日询盘、询盘收件箱、线索资产、外贸报价、寄样、货号、客户与商机、知识库，共 8 项

#### Scenario: 纯外贸业务员的常用段
- **WHEN** 运行同一测试，以家纺外贸企业只持 `trade_rep` 的输入分区
- **THEN** 常用段为上述 8 项去掉「客户与商机」后的 7 项，顺序不变；「外贸 AI 对话」「外贸获客」在「更多」里

### Requirement: 更多段的折叠与分组
两段式布局里，不在常用段的入口 SHALL 全部归入「更多」。「更多」SHALL 默认折叠，展开或折叠的状态 SHALL 按浏览器记住。展开后，入口 SHALL 按全量布局的分组与组内顺序排列，每个分组 SHALL 带其分组小标题；带子项的入口 SHALL 保持原有的展开方式。侧栏收窄为图标栏时，展开「更多」后其余入口的图标 SHALL 出现。

#### Scenario: 更多按分组排列
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/trade-layout.test.ts`，以「老板 + 外贸业务员」的输入分区
- **THEN** 「更多」里的 30 个一级入口按 工作区、管理入口、AI 工作中心、业务运营、供应商、品牌增长、系统管理 的顺序分成 7 组，组内顺序与全量布局相同

#### Scenario: 默认折叠并记住
- **WHEN** 两段式用户第一次打开页面，然后点开「更多」再刷新
- **THEN** 第一次只看到常用段与一个「更多」开关；刷新后「更多」保持展开

### Requirement: 两段式不减少可达入口
对任一身份，两段式布局里常用段与更多段的入口 SHALL 互不重复，合起来 SHALL 等于该身份在全量布局下的全部可见入口（含子项）。

#### Scenario: 入口集合相等
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/trade-layout.test.ts`
- **THEN** 对「老板 + 外贸业务员」与纯外贸业务员两种输入，常用 ∪ 更多 的入口 key 集合等于全量布局的可见入口 key 集合，两段没有重复项，测试通过

### Requirement: 分组小标题清晰可读
桌面侧栏的分组小标题（两种布局、所有企业）SHALL 使用不小于 12px 的字号与设计规范登记的侧栏弱化色，SHALL NOT 使用低于该颜色的透明度。

#### Scenario: 小标题样式
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/trade-layout.test.ts`
- **THEN** 源码断言通过：侧栏分组小标题的样式为 12px 字号与侧栏弱化色，不再是 10px 与 30% 透明度
