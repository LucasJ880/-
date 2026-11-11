## Purpose
平台 super_admin 以一个企业里的岗位组合只读预览系统：看到的导航、页面、首页、通知、设置、搜索、审批与 AI 工具，与持这些岗位的企业成员相同，期间不能改任何数据。预览只存在于浏览器的一枚签名 cookie 里，到期或退出即恢复本人身份。

## ADDED Requirements

### Requirement: 开启与退出预览
开启接口 SHALL 收企业与岗位 key 列表，只允许平台 super_admin，其他人 SHALL 收到 403，`code` 为 `PLATFORM_ADMIN_REQUIRED`。成功时 SHALL 写一枚 httpOnly cookie，2 小时后过期，返回 `{ orgId, orgName, positions: [{ key, name }], expiresAt }`。退出接口 SHALL 只需登录会话，清掉 cookie，返回 `{ ok: true }`。所选岗位 SHALL 可以是一位成员当前的全部岗位，也可以是手选的组合。企业详情页「岗位」一节 SHALL 提供「以 TA 的岗位预览」与「按岗位组合预览」两个入口，开启或退出后整页回到首页。

#### Scenario: 非平台 super_admin 被拒
- **WHEN** 运行 `npx tsx src/lib/preview/__tests__/preview-db.isolated.test.ts`（本机隔离库），以平台角色 `admin`、持 `owner` 岗位的 `user` 分别请求开启预览
- **THEN** 都返回 403，`code` 为 `PLATFORM_ADMIN_REQUIRED`，不写 cookie，测试通过

#### Scenario: 开启成功
- **WHEN** 同一测试中，super_admin 以窗饰企业（与 Sunny 同一行业包）的 `accounting` 请求开启
- **THEN** 返回 200 与企业、岗位、到期时间，写入 httpOnly cookie（同一测试覆盖）

### Requirement: 开启条件
开启 SHALL 依次校验：企业存在，否则 404；企业是岗位模式，否则 400 `PREVIEW_ORG_NOT_POSITION_MODE`；本人是该企业 active 成员，否则 400 `PREVIEW_NOT_MEMBER`；岗位 key 有 1–10 个，且都是该企业 active 的人类岗位，否则 400 `PREVIEW_POSITION_INVALID`。

#### Scenario: 不满足条件的开启
- **WHEN** 运行同一隔离库测试，super_admin 分别对不存在的企业、旧模式企业、本人不是成员的企业、空岗位列表、11 个岗位、含停用岗位的组合请求开启
- **THEN** 依次返回 404 与 400 及对应 `code`，都不写 cookie（同一测试覆盖）

### Requirement: 预览身份
预览有效期间，系统 SHALL 把该用户当作：平台角色 `user`；预览企业的 active 成员，成员角色 `org_member`，不是企业所有者；有效权限 = 所选岗位在预览企业的权限；企业处于岗位模式；当前企业为预览企业。对其他企业 SHALL 当作非成员、无权限，团队审批的处理人范围 SHALL 只按预览身份计算。本人提交的记录、本人是指定审批人、本人所在的工作区与项目成员关系 SHALL 照旧按本人计算。

#### Scenario: 以会计岗位预览
- **WHEN** 运行同一隔离库测试，以窗饰企业 `accounting` 开启预览后，同一会话请求鉴权、权限判定、成员解析、当前用户接口，并以另一企业为目标请求
- **THEN** 平台角色为 `user`；持 `accounting` 的键、不持招投标与报价让利审批的键；成员角色为 `org_member`；当前企业为预览企业；另一企业判为非成员（同一测试覆盖）

### Requirement: 其他能力中的平台 super_admin 规定
预览有效期间，其他能力里给平台 super_admin 的放行与全权 SHALL NOT 适用，一律按有效平台角色 `user` 判定。包括：审批可见全部、入口与路由门一律放行、通知类型与全局搜索不受限、AI 作业全部可读、AI 平台工具档、跨企业访问、平台控制台入口、Autopilot 入口。

#### Scenario: 平台特权在预览中不可用
- **WHEN** 运行同一隔离库测试，以窗饰企业 `accounting` 预览后，请求平台管理员页门、Autopilot 页门、另一企业的资源与 AI 平台工具档
- **THEN** 都按非平台 super_admin 被拒（同一测试覆盖）

### Requirement: 跟随预览判定的面
预览有效期间，下列面 SHALL 按预览身份判定，结果与持同样岗位的企业成员相同（本人相关的部分除外）：侧栏与手机底栏、路由门、首页岗位卡与「等你 N 件」、通知类型开关与筛选、设置页卡片、全局搜索、审批中心与「待我确认」、AI 工具列表、AI 作业的可读域。

#### Scenario: 会计看到的
- **WHEN** 运行同一隔离库测试，以窗饰企业 `accounting` 预览后，路由门判定 `/bids` 与 `/accounting`，取侧栏判定输入、首页岗位卡、审批中心列表、「待我确认」与 AI 工具列表
- **THEN** `/bids` 302 到落地页、`/accounting` 放行；判定输入只含会计的键；审批中心与「待我确认」看不到他人的让利审批与询价卡，审批中心看得到质保邮件卡（同一测试覆盖）

#### Scenario: 老板看到的
- **WHEN** 同一测试中，以窗饰企业 `owner` + `bids` 预览
- **THEN** `/bids` 放行，审批中心「待我审批」照常判定能批，与持这两个岗位的成员相同（同一测试覆盖）

### Requirement: 预览只读
预览期间，任一路径上的非 GET / HEAD / OPTIONS 请求 SHALL 在进入处理逻辑之前返回 409，响应体为 `{ error: "预览中为只读，不能修改数据。退出预览后再操作。", code: "PREVIEW_READONLY" }`，数据 SHALL NOT 改变。退出预览、登出、登录三个接口 SHALL 豁免。预览期间的 GET 请求 SHALL NOT 写业务数据：不改当前企业、不生成每日简报与它的通知、不建或改技能配置；审计记录照写。客户端 SHALL NOT 发出自动写请求（回写当前企业、标已读），AI 对话输入 SHALL 禁用并说明原因。

#### Scenario: 预览中提交被拒
- **WHEN** 运行 `npx tsx src/lib/preview/__tests__/preview.test.ts`，带有效预览 cookie 的 POST / PUT / PATCH / DELETE 请求经过代理，路径分别是业务 API、公开分享链接的签字接口与页面路径；另有退出预览、登出、登录请求
- **THEN** 前者都返回 409 `PREVIEW_READONLY`；退出、登出、登录照常通过，测试通过

#### Scenario: GET 不写业务数据
- **WHEN** 运行同一隔离库测试，super_admin 的当前企业为家纺企业时以窗饰企业预览，请求当前企业接口、AI 工具列表与每日简报，再退出预览
- **THEN** 预览期间当前企业返回窗饰企业；库里的当前企业仍是家纺企业；没有新增简报通知（同一测试覆盖）

### Requirement: 横幅与失效
预览期间，每个已登录页面顶部 SHALL 常驻横幅：「正在以〈企业 · 岗位名〉预览（只读）」、剩余分钟数、「退出预览」。当前用户接口 SHALL 返回 `preview: { state, orgId, orgName, positions, expiresAt }`。下列任一情况 SHALL 判为失效，读取恢复本人身份：本人已不是平台 super_admin、已不是预览企业的 active 成员、企业已不是岗位模式、所选岗位有任一停用。失效时 `state` SHALL 为 `invalid`，横幅改为「预览已失效 · 退出」。签名不符、已过期、不属于当前会话用户的 cookie SHALL 当作不存在。

#### Scenario: 退出与失效
- **WHEN** 运行同一隔离库测试，预览中分别停用所选岗位、把本人移出企业、把企业改为旧模式、撤掉本人的平台 super_admin，每次后请求当前用户接口与路由门；最后调用退出接口
- **THEN** 前四次 `state` 为 `invalid`，判定恢复本人身份；退出后 cookie 被清，当前用户接口不再带预览，平台角色恢复（同一测试覆盖）

### Requirement: 写拒绝只看签名
写拒绝 SHALL 只看 cookie 的签名、过期与会话用户：三项都满足时一律拒写（含失效状态），直到退出、登出、重新登录或过期。登出与登录 SHALL 清掉预览 cookie。

#### Scenario: 无效 cookie 不拒写
- **WHEN** 运行 `npx tsx src/lib/preview/__tests__/preview.test.ts`，分别带篡改过的、过期的、属于另一用户的预览 cookie 发写请求
- **THEN** 都不被 409 拒绝，按无预览处理，测试通过

### Requirement: 预览审计
开启、退出、带有效预览时登出 SHALL 各写一条审计记录：动作为 `PREVIEW_STARTED` 或 `PREVIEW_ENDED`，含操作人、企业与岗位集合；记录 SHALL NOT 含 cookie 内容。到期自然失效与重新登录不写记录。

#### Scenario: 开启与退出留痕
- **WHEN** 运行同一隔离库测试，开启再退出一次预览
- **THEN** 审计里有一条 `PREVIEW_STARTED`、一条 `PREVIEW_ENDED`，各带企业与岗位，不含 cookie 值（同一测试覆盖）

### Requirement: 预览不扩大可见内容
预览身份 SHALL NOT 看到本人身份看不到的内容。预览 cookie SHALL NOT 能被页面脚本读取，SHALL NOT 能当作登录会话使用；任何接口响应 SHALL NOT 返回 cookie 的值。409 响应 SHALL NOT 含被拒请求的业务内容。

#### Scenario: cookie 不出现在响应里、不能当会话
- **WHEN** 运行同一隔离库测试，开启预览后请求当前用户接口、当前企业接口，并发一个被拒的写请求；另在纯函数测试里把预览 cookie 的值当会话 token 校验
- **THEN** 三个响应体都不含 cookie 值；开启接口的 `Set-Cookie` 带 `HttpOnly`；当会话校验时被拒（同一组测试覆盖）

### Requirement: 只影响带预览 cookie 的浏览器会话
预览 SHALL 只作用于带这枚 cookie 的浏览器请求。同一用户在别的浏览器或设备上的会话、Muse 与微信通道、定时任务与系统流程 SHALL NOT 受影响。

#### Scenario: 不带 cookie 的请求照旧
- **WHEN** 运行同一隔离库测试，预览开启后，以同一用户的会话、不带预览 cookie 请求路由门、权限判定与当前用户接口
- **THEN** 平台角色为 `super_admin`，全部放行（同一测试覆盖）
