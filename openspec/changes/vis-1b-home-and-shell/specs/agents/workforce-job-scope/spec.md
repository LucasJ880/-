# Spec Delta

## Purpose

workforce 作业按工作域对人可见：`/workforce` 列表与详情、首页「需要你」只给当前用户看得见对应业务入口的作业，不再把全组织的招标、销售、交付作业混给每个人。

## ADDED Requirements

### Requirement: 工作域按导航入口判定可读
作业的工作域 SHALL 按既有解析规则确定：显式标记优先，其次所属项目的工作域，再次历史销售工具证据。可读判定如下：
- 投标域：侧栏「招投标中心」可见时可读；
- 交付域：「运营中心」或「项目列表」任一可见时可读；
- 销售域：「销售首页」可见时可读；
- 通用域：「AI 任务」可见时可读；
- 解析不出工作域的作业：只对管理层可读。

平台 super_admin SHALL 可读全部作业。

#### Scenario: 对照表
- **WHEN** 运行 `npx tsx src/lib/workforce-runtime/__tests__/readable-domains.test.ts`
- **THEN** 只持 `bids` 岗位可读投标、交付（「项目列表」可见）与通用域；只持 `ops_staff` 可读交付与通用域；只持 `sales_rep` 只可读销售域（`/workforce` 页面本身不放行纯销售，见 `navigation/position-based-visibility`）；`owner` 可读全部且可读解析不出的作业；测试通过

### Requirement: /workforce 列表与详情只含可读作业
`GET /api/workforce/jobs` SHALL 只返回当前用户可读工作域的作业，计数与分页基于过滤后的结果。`GET /api/workforce/jobs/<id>` 对不可读的作业 SHALL 返回 404，与作业不存在时的响应相同，SHALL NOT 泄露作业是否存在。

#### Scenario: 运营看不到投标作业
- **WHEN** 只持 `ops_staff` 岗位的成员请求 `GET /api/workforce/jobs`，组织里有投标域与交付域作业各一条
- **THEN** 响应只含交付域那一条（`readable-domains.test.ts` 用注入的作业列表覆盖过滤）

#### Scenario: 打开不可读作业详情
- **WHEN** 只持 `ops_staff` 岗位的成员请求一条投标域作业的 `GET /api/workforce/jobs/<id>`
- **THEN** 返回 404

### Requirement: 首页需要你作业同口径
首页「等你拍板」里状态为需要你的作业 SHALL 只含当前用户可读工作域的作业，判定与 `/workforce` 列表相同。

#### Scenario: 老板的需要你
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/waiting.test.ts`，以只可读交付域的输入组装等你拍板
- **THEN** 投标域的需要你作业不出现在条目与总数里，测试通过
