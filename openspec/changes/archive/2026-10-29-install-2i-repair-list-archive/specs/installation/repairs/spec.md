# Spec Delta

## ADDED Requirements

### Requirement: 维修单列表分栏、分页与搜索
`GET /api/install/repairs` SHALL 接受 `tab`（`open` 进行中，默认；`archived` 已归档）、`page`（默认 1）、`pageSize`（默认 20，1–50）与 `q`。维修单一经关闭（返修完成、转入新单、已作废、关闭不返修）SHALL 只出现在已归档栏，未关闭的只出现在进行中栏。进行中按目标日升序，已归档按关闭时间倒序。`q` SHALL 对单号、工艺单号、客户名不分大小写包含匹配。响应 SHALL 含当前栏总数、页码、每页条数与按同一 `q` 计算的两栏总数；页码超出 SHALL 返回空列表与正确总数。列表 SHALL NOT 有条数上限。

#### Scenario: 关闭后自动归档
- **WHEN** 运营主管作废一张进行中的维修单
- **THEN** 进行中栏不再有它、总数减 1；已归档栏第一条是它（`repair-list-db.isolated.test.ts`）

#### Scenario: 分页
- **WHEN** 企业有 205 张进行中维修单，按每页 50 取第 5 页
- **THEN** 返回 5 条，总数 205，两栏总数中进行中为 205；取第 6 页返回空列表、总数仍为 205（`repair-list-db.isolated.test.ts`）

#### Scenario: 搜索
- **WHEN** 用客户名的一部分（大小写不同）、单号、工艺单号分别搜索
- **THEN** 两栏都只返回匹配的维修单，两栏总数按搜索结果计算（`repair-list-db.isolated.test.ts`、`repair.test.ts`）

#### Scenario: 非法参数
- **WHEN** `tab=foo`、`page=0`、`pageSize=500`
- **THEN** 按进行中、第 1 页、每页 50 返回（`repair.test.ts`）

### Requirement: 已归档维修单的结束情况
已归档栏每条 SHALL 另含关闭原因（返修已完成 / 转入 <单号> / 已作废 / 关闭不返修）、原因说明（作废与关闭不返修时）、关闭人姓名与关闭时间；SHALL NOT 标为已过目标日。页面 `/install/repairs` SHALL 有"进行中""已归档"两个页签（各带条数）、搜索框与翻页，栏、搜索词与页码 SHALL 写在地址里，刷新后保持。

#### Scenario: 查一张已作废的单
- **WHEN** 在已归档栏搜索已作废维修单的单号
- **THEN** 该条关闭原因为已作废，带原因说明、关闭人与关闭时间，不标已过目标日（`repair-list-db.isolated.test.ts`）

#### Scenario: 页面
- **WHEN** 运营主管打开 `/install/repairs?tab=archived&q=<客户名>`
- **THEN** 已归档页签选中、搜索框带客户名，只列匹配的已归档单与其结束情况；切回进行中页签地址同步变化（本地走查）

## MODIFIED Requirements

### Requirement: 维修单列表与详情
`GET /api/install/repairs` 与 `GET /api/install/repairs/{id}` SHALL 只对持 `install.task.read`（ORG）开放，其他人 403；他企业的维修单 SHALL 返回 404。列表按「维修单列表分栏、分页与搜索」分栏分页，每条含单号、工艺单号、客户名、提交人、填写日、目标日、是否已过目标日、行数、需工厂品类、是否已和客户确认与当前安装阶段；详情含表头、全部行（含问题照片代理地址）与当前安装阶段。页面 `/install/repairs`、`/install/repairs/{id}` 展示同样内容；`/install` 对 ORG 范围的人显示"返修单"入口。

#### Scenario: 安装工不能看
- **WHEN** 只持 `installer` 的小王请求维修单列表或详情
- **THEN** 返回 403（`repair-db.isolated.test.ts`）

#### Scenario: 出单岗查看
- **WHEN** 出单·Vinyl 打开通知里的维修单详情
- **THEN** 返回 200，含全部行与问题照片代理地址，阶段为返修待出单

#### Scenario: 他企业
- **WHEN** 另一企业的运营主管请求该维修单
- **THEN** 返回 404

### Requirement: 维修单的进度与可执行操作
`GET /api/install/repairs/{id}` SHALL 另返回：各需工厂品类的出单登记（预计备好日、备注、登记人、时间）与待登记品类；返修排期（预约、时间、安装工、是否完成）；关闭情况（原因：已完成 / 转入 <单号> / 已作废 / 关闭不返修，原因说明、操作人、时间）；当前用户可做的操作（可登记出单的品类、能否安排返修、能否作废、能否关闭不返修）。可执行操作 SHALL 与四个写接口使用同一判定：列出的操作调用接口成功，没列出的被拒绝。进行中栏 SHALL 另含待登记品类与返修时间；已关闭的维修单在已归档栏带关闭原因，SHALL NOT 标为已过目标日。

#### Scenario: 页面按钮与接口一致
- **WHEN** 对出单·Vinyl、出单·布帘、出单·Roller、运营主管、会计各取一次可执行操作，再逐一调用登记出单、安排返修、作废、关闭不返修
- **THEN** 每个人每个操作：列出 ⇔ 接口 2xx（`repair-dispatch-db.isolated.test.ts`、`repair-close-db.isolated.test.ts`）

#### Scenario: 返修中提交的维修单
- **WHEN** 运营主管查看在返修预约上提交的 `R-<单号>-2`
- **THEN** 可执行操作含关闭不返修，不含作废

#### Scenario: 关闭原因
- **WHEN** 维修单已作废，原因"Den 标错了"
- **THEN** 详情关闭情况为已作废、带原因说明与操作人，可执行操作为空；已归档栏该单关闭原因为已作废、不标已过目标日（`repair-close-db.isolated.test.ts`）
