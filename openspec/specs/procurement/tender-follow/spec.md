# procurement/tender-follow Specification

## Purpose
规定从采购监控的招标公告一键建招投标项目：谁能点、建出什么、怎么保证同一组织同一公告只建一次、什么情况不能跟、候选卡片上显示什么。

## Requirements

### Requirement: 一键跟标建项
组织成员（org_member 及以上）对本组织采购监控里的招标公告 SHALL 能「跟这个标」：建一个招投标项目（负责人为操作人，成员与环境和手工新建的项目相同），名称、招标编号、截标日、发布日期、采购方、来源平台与公告链接从公告预填；公告关联到该项目（关联类型「本项目」）并改为「关注」。项目 SHALL 不带任何文件；截标日已知时 SHALL 写进负责人的日程（与改截标日相同）。新建 SHALL 返回 201 `{ ok, projectId, created: true }`，并记两条审计：建项目、跟标。

#### Scenario: 跟一条 CanadaBuys 新标
- **WHEN** 组织成员对一条未截标的 CanadaBuys 招标公告点「跟这个标」
- **THEN** 201，新建招投标项目，招标编号、截标日、采购方、公告链接与公告一致；公告关联为「本项目」、分诊为「关注」；截标日进了负责人的日程（`npx tsx src/lib/procurement-records/__tests__/tender-follow-pure.test.ts`；`npx tsx src/lib/procurement-records/__tests__/tender-follow-db.isolated.test.ts`）

#### Scenario: 项目动态写明来源
- **WHEN** 跟标建出项目后打开项目
- **THEN** 「最近变化」写「从采购监控跟进了采购公告「公告标题」」，不出现内部动作名（`tender-follow-pure.test.ts`）

#### Scenario: 与手工新建相同
- **WHEN** 跟标建出项目
- **THEN** 操作人是项目管理员，有测试与正式两个环境，和手工新建的项目逐项相同（`tender-follow-db.isolated.test.ts`）

### Requirement: 同一公告只建一个项目
同一组织的同一条公告 SHALL 最多有一个经跟标建出的项目：再次跟标或并发跟标 SHALL 返回 200 `{ ok, projectId, created: false }`。返回哪个项目：先看指向还在的项目的「本项目」关联（最早的一条，与候选卡片一致），没有再看跟标建出、还在的项目（关联被改成前序 / 历史也认得出）；项目已删的关联 SHALL NOT 算数。已跟过的公告截标后再点 SHALL 仍返回原项目。

#### Scenario: 再点一次
- **WHEN** 已跟过的公告再点「跟这个标」
- **THEN** 返回同一个项目，`created` 为假，项目数不变（`tender-follow-db.isolated.test.ts`）

#### Scenario: 关联被改、项目被删
- **WHEN** 跟标建出的项目的关联被手工改成「前序」后再跟；或那个项目被删后再跟
- **THEN** 前者返回原项目、不新建；后者新建一个（`tender-follow-db.isolated.test.ts`）

#### Scenario: 两人同时点
- **WHEN** 两个请求同时跟同一条公告
- **THEN** 只建一个项目，两个请求返回同一个项目（`tender-follow-db.isolated.test.ts`）

### Requirement: 不能跟的情况
不是招标公告 SHALL 返回 400（即使已有关联）；没跟过且已过截标时间 SHALL 返回 409 并写明已截标（截标时间未知的可以跟）；只读成员 SHALL 返回 403；非本组织成员 SHALL 返回 404 且不泄露公告是否存在；组织已归档 SHALL 返回 403；采购监控未启用（暗合并闸关闭）SHALL 返回 503。以上情况 SHALL NOT 建项目、SHALL NOT 改关联与分诊。

#### Scenario: 已截标
- **WHEN** 跟一条截标时间已过的公告
- **THEN** 409「已截标」，不建项目（`tender-follow-pure.test.ts`；`tender-follow-db.isolated.test.ts`）

#### Scenario: 别的组织
- **WHEN** 另一个组织的成员跟这条公告
- **THEN** 404，不建项目（`tender-follow-db.isolated.test.ts`）

### Requirement: 候选卡片上的按钮
采购监控的候选卡片 SHALL 只在招标公告、未截标、还没有指向还在的项目的「本项目」关联、且看的人不是只读成员时显示「跟这个标」；招标公告有这样的关联时 SHALL 显示「已跟进 · 打开项目」并链接到最早的那个项目；其它类别 SHALL NOT 显示跟标按钮或「已跟进」。监控接口 SHALL 返回 `canFollow`（只读成员为假）。

#### Scenario: 已跟进
- **WHEN** 候选已有「本项目」关联
- **THEN** 卡片显示「已跟进 · 打开项目」，链接到那个项目（`tender-follow-pure.test.ts`）

#### Scenario: 只读成员
- **WHEN** 只读成员打开采购监控
- **THEN** 监控接口 `canFollow` 为假，卡片上没有「跟这个标」（`tender-follow-pure.test.ts`；`tender-follow-db.isolated.test.ts`）
