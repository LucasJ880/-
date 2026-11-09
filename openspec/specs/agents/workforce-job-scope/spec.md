# agents/workforce-job-scope Specification

## Purpose
workforce 作业按工作域对人可见：`/workforce` 列表与详情、首页「需要你」只给当前用户看得见对应业务入口的作业，不再把全组织的招标、销售、交付作业混给每个人。

## Requirements

### Requirement: 工作域按导航入口判定可读
作业的工作域 SHALL 按既有解析规则确定：显式标记优先，其次所属项目的工作域，再次历史销售工具证据。作业对当前用户是否可读 SHALL 按下表判定：
- 投标域 SHALL 在侧栏「招投标中心」可见时可读；
- 交付域 SHALL 在「运营中心」或「项目列表」任一可见时可读；
- 销售域 SHALL 在「销售首页」或「外贸」任一可见时可读；
- 通用域与解析不出工作域的作业 SHALL 只对管理层可读。

平台 super_admin SHALL 可读全部作业。对照表 SHALL 是代码常量，判定 SHALL NOT 调用 LLM。

#### Scenario: 对照表
- **WHEN** 运行 `npx tsx src/lib/workforce-runtime/__tests__/readable-domains.test.ts`
- **THEN** 结果如下，测试通过：
  - 只持 `bids`：可读投标、交付（「项目列表」可见）；
  - 只持 `ops_staff`：可读交付；
  - 只持 `sales_rep`：可读销售（`/workforce` 页面本身不放行纯销售，见 `navigation/position-based-visibility`）；
  - 梦馨只持 `trade_rep`：可读销售（「外贸」可见）；
  - Sunny 持 `owner`：可读投标、交付、销售、通用与解析不出的作业；
  - 只持 `accounting`、只持 `installer`、只持 `fulfillment_vinyl`、无岗位：都不可读。

#### Scenario: 通用域不对一线可读
- **WHEN** 只持 `ops_staff` 岗位的成员面对一条所属项目工作域为 `general` 的旧作业
- **THEN** 该作业不可读（同一测试覆盖）

### Requirement: /workforce 列表只含可读作业
`GET /api/workforce/jobs` SHALL 只返回当前用户可读的作业，每页至多 `limit` 条，顺序沿用既有的最近更新在前。服务端 SHALL 分批扫描并跳过不可读的作业来凑满一页，一次请求 SHALL 至多扫描 5 批、每批 `limit + 1` 行。扫到上限仍不满一页时，响应 SHALL 返回已凑到的作业（可能为空）与非空的 `nextCursor`。响应形状 SHALL 保持 `{jobs, nextCursor}`。

#### Scenario: 运营看不到投标作业
- **WHEN** 只持 `ops_staff` 岗位的成员请求 `GET /api/workforce/jobs`，组织里有投标域与交付域作业各一条
- **THEN** 响应只含交付域那一条（`readable-domains.test.ts` 用注入的读取器覆盖）

#### Scenario: 跳过一整批不可读作业
- **WHEN** 只持 `ops_staff` 岗位的成员以 `limit = 20` 请求，最近更新的 21 条都是投标域，其后有 3 条交付域
- **THEN** 一次请求返回这 3 条交付域作业，`nextCursor` 为空（同一测试覆盖）

#### Scenario: 扫描到上限
- **WHEN** 只持 `ops_staff` 岗位的成员以 `limit = 20` 请求，组织里有 300 条作业且全是投标域
- **THEN** 响应 `jobs` 为空，`nextCursor` 非空且指向第 105 条（5 批 × 21 行；同一测试覆盖）

### Requirement: 列表游标
凑满一页时 `nextCursor` SHALL 指向本页最后一条；扫到上限时 SHALL 指向最后扫描到的那一行。其后还有未扫描的行时 `nextCursor` SHALL 非空，确定没有时 SHALL 为空。本页恰好在一批的最后一行凑满、无法确定其后是否还有时，`nextCursor` MAY 非空，下一页则返回空列表与空游标。

#### Scenario: 恰好在批尾凑满
- **WHEN** 只持 `ops_staff` 岗位的成员以 `limit = 20` 请求，前 21 行里只有第 2 到第 21 行是交付域，读取器在第 21 行后不再有数据
- **THEN** 返回这 20 条；`nextCursor` 为空，或指向第 21 行且用它再请求时返回空列表与空游标（`readable-domains.test.ts` 覆盖）

### Requirement: /workforce 页面有游标时不显示空态
`/workforce` 页面在本页为空但 `nextCursor` 非空时 SHALL 显示「加载更多」，SHALL NOT 显示空态。

#### Scenario: 空页仍可继续加载
- **WHEN** 运行 `npx tsx src/lib/workforce-runtime/__tests__/readable-domains.test.ts`
- **THEN** 源码断言 `src/app/(main)/workforce/page.tsx` 只在 `nextCursor` 为空时渲染空态，测试通过

### Requirement: 不可读的作业详情返回 404
`GET /api/workforce/jobs/<id>` 对不可读的作业 SHALL 返回 404，与作业不存在时的响应相同，SHALL NOT 泄露作业是否存在。

#### Scenario: 打开不可读作业详情
- **WHEN** 只持 `ops_staff` 岗位的成员请求一条投标域作业的 `GET /api/workforce/jobs/<id>`
- **THEN** 返回 404（源码断言详情接口与列表用同一判定函数）

### Requirement: 首页需要你作业同口径
首页「等你拍板」里状态为需要你的作业 SHALL 只含当前用户可读的作业，判定 SHALL 与 `/workforce` 列表使用同一函数。

#### Scenario: 只可读交付域时的需要你
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/waiting.test.ts`，以只可读交付域的输入组装等你拍板
- **THEN** 投标域的需要你作业不出现在条目与总数里，测试通过
