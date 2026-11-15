## ADDED Requirements

### Requirement: 一键跟标建项
组织成员（org_member 及以上）对本组织采购监控里的招标公告 SHALL 能「跟这个标」：建一个招投标项目（负责人为操作人，成员与环境和手工新建的项目相同），名称、招标编号、截标日、发布日期、采购方、来源平台与公告链接从公告预填；公告关联到该项目（关联类型「本项目」）并改为「关注」。项目 SHALL 不带任何文件。

#### Scenario: 跟一条 CanadaBuys 新标
- **WHEN** 组织成员对一条未截标的 CanadaBuys 招标公告点「跟这个标」
- **THEN** 新建招投标项目，招标编号、截标日、采购方、公告链接与公告一致；公告关联为「本项目」、分诊为「关注」（`npx tsx src/lib/procurement-records/__tests__/tender-follow-pure.test.ts`；`npx tsx src/lib/procurement-records/__tests__/tender-follow-db.isolated.test.ts`）

#### Scenario: 与手工新建相同
- **WHEN** 跟标建出项目
- **THEN** 操作人是项目管理员，有测试与正式两个环境，和手工新建的项目逐项相同（`tender-follow-db.isolated.test.ts`）

### Requirement: 同一公告只建一个项目
同一组织的同一条公告 SHALL 最多有一个经跟标建出的项目：再次跟标或并发跟标 SHALL 返回已有的项目并标明不是新建；公告已有「本项目」关联时 SHALL 返回那个项目，不再新建。

#### Scenario: 再点一次
- **WHEN** 已跟过的公告再点「跟这个标」
- **THEN** 返回同一个项目，`created` 为假，项目数不变（`tender-follow-db.isolated.test.ts`）

#### Scenario: 两人同时点
- **WHEN** 两个请求同时跟同一条公告
- **THEN** 只建一个项目，两个请求返回同一个项目（`tender-follow-db.isolated.test.ts`）

### Requirement: 不能跟的情况
不是招标公告 SHALL 返回 400；已过截标时间 SHALL 返回 409 并写明已截标（截标时间未知的可以跟）；只读成员 SHALL 返回 403；非本组织成员 SHALL 返回 404 且不泄露公告是否存在；组织已归档 SHALL 返回 403；采购监控未启用（暗合并闸关闭）SHALL 返回 503。以上情况 SHALL NOT 建项目、SHALL NOT 改关联与分诊。

#### Scenario: 已截标
- **WHEN** 跟一条截标时间已过的公告
- **THEN** 409「已截标」，不建项目（`tender-follow-pure.test.ts`；`tender-follow-db.isolated.test.ts`）

#### Scenario: 别的组织
- **WHEN** 另一个组织的成员跟这条公告
- **THEN** 404，不建项目（`tender-follow-db.isolated.test.ts`）

### Requirement: 候选卡片上的按钮
采购监控的候选卡片 SHALL 只在招标公告、未截标、还没有「本项目」关联时显示「跟这个标」；有「本项目」关联时 SHALL 显示「已跟进 · 打开项目」并链接到该项目；其它类别 SHALL NOT 显示跟标按钮。

#### Scenario: 已跟进
- **WHEN** 候选已有「本项目」关联
- **THEN** 卡片显示「已跟进 · 打开项目」，链接到那个项目（`tender-follow-pure.test.ts`）
