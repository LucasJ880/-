## Purpose
平台 super_admin 以一个企业里的岗位组合只读预览系统：看到的导航、页面、首页、通知、设置、搜索、审批与 AI 工具，与持这些岗位的企业成员相同，期间不能改任何数据。预览只存在于浏览器的一枚签名 cookie 里，到期或退出即恢复本人身份。

## ADDED Requirements

### Requirement: 只有平台 super_admin 能开启预览
开启预览的接口 SHALL 只允许平台 super_admin，其他人 SHALL 收到 403，`code` 为平台管理员要求码。开启 SHALL 同时满足：企业存在（否则 404）、企业是岗位模式、本人是该企业 active 成员、所选岗位非空且都是该企业 active 岗位（否则 400，`code` 依次为 `PREVIEW_ORG_NOT_POSITION_MODE`、`PREVIEW_NOT_MEMBER`、`PREVIEW_POSITION_INVALID`）。所选岗位 SHALL 可以是一位成员当前的全部岗位，也可以是手选的组合。成功时 SHALL 写一枚 httpOnly cookie，2 小时后过期，并返回企业、岗位与到期时间。企业详情页「岗位」一节 SHALL 提供「以 TA 的岗位预览」与「按岗位组合预览」两个入口。

#### Scenario: 非平台 super_admin 被拒
- **WHEN** 运行 `npx tsx src/lib/preview/__tests__/preview-db.isolated.test.ts`（本机隔离库），以平台角色 `admin`、持 `owner` 岗位的 `user` 分别请求开启预览
- **THEN** 都返回 403，不写 cookie，测试通过

#### Scenario: 开启条件
- **WHEN** 同一测试中，super_admin 分别对旧模式企业、本人不是成员的企业、含停用岗位的组合、Sunny 的 `accounting` 请求开启
- **THEN** 前三次依次返回 400 与对应 `code`；最后一次返回 200，响应带企业、岗位与到期时间，写入 httpOnly cookie（同一测试覆盖）

### Requirement: 预览身份
预览有效期间，系统 SHALL 把该用户当作：平台角色 `user`；预览企业的 active 成员，成员角色 `org_member`，不是企业所有者；有效权限 = 所选岗位在预览企业的权限；企业处于岗位模式。对其他企业 SHALL 当作非成员、无权限。本人提交的记录、本人是指定审批人、本人所在的工作区与项目成员关系 SHALL 照旧按本人计算。

#### Scenario: 以会计岗位预览 Sunny
- **WHEN** 运行同一隔离库测试，super_admin 以 Sunny 的 `accounting` 开启预览后，同一会话请求鉴权、权限判定、成员解析，并以另一企业为目标请求
- **THEN** 平台角色为 `user`；持 `accounting` 的键、不持招投标与报价让利审批的键；成员角色为 `org_member`；另一企业判为非成员（同一测试覆盖）

### Requirement: 跟随预览判定的面
预览有效期间，下列面 SHALL 按预览身份判定，结果与持同样岗位的企业成员相同（本人相关的部分除外）：侧栏与手机底栏、路由门、首页岗位卡与「等你 N 件」、通知类型开关与筛选、设置页卡片、全局搜索、审批中心与「待我确认」、AI 工具列表、AI 作业的可读域、平台管理员页门与 Autopilot 页门。平台 super_admin 的跨企业访问与平台控制台入口 SHALL 在预览期间不可用。

#### Scenario: 会计看到的
- **WHEN** 运行同一隔离库测试，以 Sunny `accounting` 预览后，路由门判定 `/bids` 与 `/accounting`，取侧栏判定输入、首页岗位卡、审批中心列表与 AI 工具列表
- **THEN** `/bids` 302 到落地页、`/accounting` 放行；判定输入只含会计的键；审批中心看不到他人的让利审批与询价卡，看得到质保邮件卡；平台管理员页被拒（同一测试覆盖）

#### Scenario: 老板看到的
- **WHEN** 同一测试中，以 Sunny `owner` + `bids` 预览
- **THEN** `/bids` 放行，审批中心「待我审批」照常判定能批，与持这两个岗位的成员相同（同一测试覆盖）

### Requirement: 预览只读
预览期间，所有非 GET / HEAD / OPTIONS 的 API 请求 SHALL 在进入处理逻辑之前返回 409，响应体为 `{ error, code: "PREVIEW_READONLY" }`，数据 SHALL NOT 改变。退出预览与登出 SHALL 豁免。预览期间的 GET 请求 SHALL NOT 改写本人的当前企业。客户端在预览期间 SHALL NOT 发出自动写请求（回写当前企业、标已读），AI 对话输入 SHALL 禁用并说明原因。

#### Scenario: 预览中提交被拒
- **WHEN** 运行 `npx tsx src/lib/preview/__tests__/preview.test.ts`，带有效预览 cookie 的 POST / PUT / PATCH / DELETE `/api/**` 请求经过代理，另有退出预览与登出请求
- **THEN** 前者都返回 409 `PREVIEW_READONLY`；退出与登出照常通过，测试通过

#### Scenario: 预览不改当前企业
- **WHEN** 运行同一隔离库测试，super_admin 的当前企业为梦馨时以 Sunny 预览，请求当前企业接口与 AI 工具列表，再退出预览
- **THEN** 预览期间当前企业返回 Sunny；库里的当前企业仍是梦馨（同一测试覆盖）

### Requirement: 横幅与退出
预览期间，每个已登录页面顶部 SHALL 常驻横幅：「正在以〈企业 · 岗位名〉预览（只读）」、剩余分钟数、「退出预览」。退出 SHALL 清掉预览 cookie 并回到首页。登出 SHALL 同时清掉预览 cookie。当前用户接口 SHALL 返回预览的企业名、岗位名与到期时间，供横幅显示。

#### Scenario: 退出
- **WHEN** 运行同一隔离库测试，预览中调用退出接口，再请求当前用户接口与路由门
- **THEN** cookie 被清；当前用户接口不再带预览信息，平台角色恢复 `super_admin`；路由门恢复放行（同一测试覆盖）

### Requirement: 预览失效
下列任一情况 SHALL 按无预览处理，读取恢复本人身份：签名不符、已过期、不属于当前会话用户、本人已不是平台 super_admin、本人已不是预览企业的 active 成员、企业已不是岗位模式、所选岗位有任何一个已停用。写拒绝 SHALL 只看签名、过期与会话用户：这三项都满足时一律拒写，直到退出或过期。

#### Scenario: 失效回退
- **WHEN** 运行 `npx tsx src/lib/preview/__tests__/preview.test.ts`，分别给出篡改过的、过期的、属于另一用户的预览 cookie；另在隔离库测试里撤掉本人的平台 super_admin 后请求
- **THEN** 都按无预览处理；被篡改、过期与他人的 cookie 不触发拒写（同一组测试覆盖）

### Requirement: 预览审计
开启与退出预览 SHALL 各写一条审计记录，含操作人、企业与岗位集合；记录 SHALL NOT 含 cookie 内容。到期自然失效不写记录。

#### Scenario: 开启与退出留痕
- **WHEN** 运行同一隔离库测试，开启再退出一次预览
- **THEN** 审计里有一条开启、一条退出，各带企业与岗位，不含 cookie 值（同一测试覆盖）

### Requirement: 预览不扩大可见内容
预览身份 SHALL NOT 看到本人身份看不到的内容。预览 cookie SHALL NOT 能被页面脚本读取，任何接口响应 SHALL NOT 返回 cookie 的值。409 响应 SHALL NOT 含被拒请求的业务内容。

#### Scenario: cookie 不出现在响应里
- **WHEN** 运行同一隔离库测试，开启预览后请求当前用户接口、当前企业接口，并发一个被拒的写请求
- **THEN** 三个响应体都不含 cookie 值；开启接口的 `Set-Cookie` 带 `HttpOnly`（同一测试覆盖）

### Requirement: 只影响带预览 cookie 的浏览器会话
预览 SHALL 只作用于带这枚 cookie 的浏览器请求。同一用户在别的浏览器或设备上的会话、Muse 与微信通道、定时任务与系统流程 SHALL NOT 受影响。

#### Scenario: 不带 cookie 的请求照旧
- **WHEN** 运行同一隔离库测试，预览开启后，以同一用户的会话、不带预览 cookie 请求路由门与权限判定
- **THEN** 平台角色为 `super_admin`，全部放行（同一测试覆盖）
