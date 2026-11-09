# procurement/watch-scan Specification

## Purpose
在青砚 Tender 类目下按组织配置采购监控，定时或立即只读扫描加拿大官方开放数据，把招标 / 合同 / call-up 标准化去重为采购工具，保存来源证据，给出可解释优先级，并对实质变化发站内通知。

## Requirements

### Requirement: 暗合并闸
`PROCUREMENT_RECORDS_SCHEMA_READY` 未设为真值时，所有采购监控与资料申请接口 SHALL 返回 200 `{ available: false, reason: "SCHEMA_NOT_READY" }`（写接口返回 503 同一 reason），定时任务步骤 SHALL 跳过，且对新表零访问。

#### Scenario: 闸关闭
- **WHEN** 环境未设 `PROCUREMENT_RECORDS_SCHEMA_READY`，请求 `GET /api/procurement/watch`
- **THEN** 返回 `available:false, reason:"SCHEMA_NOT_READY"`；`procurement-pure.test.ts` 覆盖闸解析，`procurement-records-db.isolated.test.ts` 覆盖接口

### Requirement: 监控配置与启停
`GET /api/procurement/watch` SHALL 返回本组织的监控配置（关键词、排除词、机构、地区、回看天数、上限、来源开关、时区、排程）、启用状态、启用人与时间、下一次运行时间、最近一次运行与最近一次**实际成功**运行，以及每个来源的能力说明与最近结果。`PUT` SHALL 只允许 `org_admin` 及以上保存；新建监控 SHALL 默认 `enabled=false`；`POST …/enable` 与 `…/disable` SHALL 只允许 `org_admin` 及以上，启用写入启用人与时间并计算下一次运行；停用 SHALL 把排队中的运行标为 CANCELLED、保留全部候选与案件。配置里的上限 SHALL 有服务端上界（每轮新候选展示 ≤ 20、自动申请卡 ≤ 10、每来源页数 ≤ 20、墙钟 ≤ 240 秒）。

#### Scenario: 新建默认未启用
- **WHEN** org_admin 首次 `PUT` 保存配置
- **THEN** 响应 `enabled:false`，`nextRunAt:null`，cron 不扫描该监控；`procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 普通成员不能启用
- **WHEN** `org_member` 调用 `POST /api/procurement/watch/enable`
- **THEN** 403，配置不变；`procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 配置已启用但从未成功运行
- **WHEN** 监控刚启用、尚无成功运行
- **THEN** `GET` 返回 `enabled:true` 且 `lastSuccessAt:null`，UI 分别显示「配置已启用」与「尚无成功运行」

### Requirement: 多伦多本地时间排程
排程 SHALL 以本地墙钟（缺省周一、周四 08:00，`America/Toronto`）表达，下一次与最近到期槽位按当前日期计算并正确处理夏令时；槽位键 SHALL 用本地日期时间，跨夏令时稳定；只补跑最近一个错过的槽位，且槽位须晚于启用时间。

#### Scenario: 夏令时切换
- **WHEN** 当前时间为 2026-11-01（夏令时结束）前后，计算下一槽位
- **THEN** 2026-11-02（周一）08:00 本地对应 13:00Z，2026-10-29（周四）08:00 本地对应 12:00Z；`procurement-pure.test.ts` 覆盖，且 3 月切换同样覆盖

#### Scenario: 重启后不重复补跑
- **WHEN** 同一槽位已有运行行，cron 再次 tick
- **THEN** 不创建第二个运行；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 单轮执行、认领与续跑
定时与手动扫描 SHALL 在后台执行（定时由既有 `tender-watch` 定时任务驱动，手动在响应返回后执行，未执行时由定时任务接手）；同一监控同一槽位 SHALL 只有一个运行；运行中 SHALL 按来源刷新心跳与进度；心跳超过 10 分钟的运行 SHALL 可被下一轮接管并跳过已完成来源；墙钟预算耗尽 SHALL 把运行放回排队（待续）而不是标成功。一轮步骤为：认领 → 读配置与已有状态 → 刷新已关注合同 → 分页获取新候选 → 标准化与去重 → 保存证据与变化 → 排序与草拟 → 持久化 → 通知。

#### Scenario: 两个 worker 并发
- **WHEN** 两个执行同时处理同一到期槽位与同一批来源记录
- **THEN** 只有一个运行行、一个采购工具、零重复申请卡与零重复通知；`procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 租约过期接管
- **WHEN** 运行处于 RUNNING 且心跳已超过 10 分钟
- **THEN** 下一轮接管，`attempt` 加 1，已完成来源不重跑，写入结果与一次完整运行相同；`procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 立即扫描不阻塞请求
- **WHEN** 用户点「立即扫描」
- **THEN** 接口立即返回排队中的运行 id；已有未失联的排队或运行中运行时返回该运行而不新建

### Requirement: 官方来源与覆盖结果
扫描 SHALL 只使用官方公开数据或公开页面：CanadaBuys 招标公告开放数据（发现新候选）、Open Government 合同披露（关键词发现与已知合同 / call-up 刷新）、Completed ATI 摘要（既有披露检索，未配置资源时 SKIPPED）、CanadaBuys 合同历史公开页（仅哈希变更检测）。每个来源每轮 SHALL 记录 `SUCCESS` / `PARTIAL` / `UNAVAILABLE` / `PARSE_FAILED` / `SKIPPED` 与获取数、匹配数、新候选数、是否截断、说明；「成功但零结果」与「无法获取」SHALL 可区分。任一来源失败 SHALL NOT 清空既有候选或把未知字段改为 0，整轮状态为 PARTIAL 而非 SUCCEEDED。扫描 SHALL NOT 访问需要登录的页面，SHALL NOT 把二级聚合站结果标为官方。

#### Scenario: CSV 改版
- **WHEN** CanadaBuys CSV 缺少编号列
- **THEN** 该来源为 `PARSE_FAILED`，整轮 PARTIAL，既有候选不变；`procurement-pure.test.ts` 与 `procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 成功零结果
- **WHEN** 来源返回合法数据但无关键词命中
- **THEN** 该来源 `SUCCESS` 且 `matched:0`，与 `UNAVAILABLE` 区分显示

#### Scenario: 省市门户
- **WHEN** 查看来源能力列表
- **THEN** 省市门户、MERX、Bonfire、Ariba 显示「仅人工链接导入」，不显示「已支持自动申请」

### Requirement: 采购工具身份与去重
采购工具 SHALL 按「组织 + 司法辖区 + 规范采购机构 + 采购工具类别 + 规范正式编号」去重，原始编号、平台别名、修订后缀与来源 SHALL 保留；同标题不同正式编号 SHALL 保持独立；不同来源的同一合同 SHALL 合并到同一采购工具并各自保留证据；同一来源记录内容变化 SHALL 生成新证据版本并更新变更时间，不生成新采购工具；内容不变 SHALL 只更新核查时间；同号同类但机构无法确定为别名时 SHALL 新建并标记待人工复核。call-up SHALL 关联到父 SO；Tender 与历史合同的「前序 / 相关」SHALL 用显式关系保存，SHALL NOT 当作编号别名。contracting / buying / records holder 机构 SHALL 分别保存；current expiry、剩余 options、确认重招日期未知 SHALL 为 null。

#### Scenario: 同标题不同编号
- **WHEN** 两条记录标题相同、正式编号不同
- **THEN** 生成两个采购工具；`procurement-pure.test.ts` 覆盖

#### Scenario: 修订不变新标
- **WHEN** 同一招标的修订 001 被扫描到
- **THEN** 仍是同一采购工具，新增一条证据版本；`procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 到期不推重招
- **WHEN** 种子合同只有公开到期日
- **THEN** `confirmedRetenderDate` 与 `remainingOptions` 为 null

### Requirement: 候选优先级与上限
每个候选 SHALL 给出五个维度（业务匹配、重复采购迹象、准备时间、资料缺口、资料持有机关清楚）的分数与中文理由；SHALL NOT 输出中标概率；资格、原产地、认证等无证据时显示「未知」。每轮新候选展示数与自动申请卡数 SHALL 受配置上限约束（缺省 5 与 3），超出时记录截断数，剩余候选下轮继续。用户 SHALL 能把候选设为关注 / 忽略、关联到 Tender、或「准备申请」。

#### Scenario: 超过上限
- **WHEN** 一轮命中 8 个新候选，上限 5
- **THEN** 保存 5 个，运行 `truncated:true` 并记录 3 个待续；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 扫描通知
一轮有实质变化（新候选、证据版本变化、新申请卡）时 SHALL 给监控启用人与组织 owner 发一条站内通知，sourceKey 由变化集合的哈希决定；无变化 SHALL NOT 通知。通知摘要 SHALL NOT 含申请人资料。

#### Scenario: 连续两次扫描同一数据
- **WHEN** 同一来源数据连续扫描两次
- **THEN** 只有第一次产生通知；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 种子导入
种子脚本 SHALL 默认 dry-run，`--write` 才写入；三条联邦研究种子与联邦 ATI 规则 SHALL 幂等导入（重复导入更新而非新增），种子规则为未核实状态；可选历史案件 SHALL 以「带来源说明的待核实历史记录」导入，SHALL NOT 创建附件、回执或已核实状态，SHALL NOT 预填申请人地址。

#### Scenario: 重复导入
- **WHEN** 种子脚本 `--write` 连续执行两次
- **THEN** 采购工具仍为 3 条；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 前序供应商与进口线索
Tender 详情的「历史采购与资料申请」卡 SHALL 汇总关联合同及其下 call-up 的供应商（来自已入库的合同披露或人工导入）：按规范化名称分组，给出合同数、最近合同日期、按口径与币种分列的合同披露值（整数分，不跨口径相加，未知金额不计入、不当作 0），并标出「上一次谁供货」（前序 / 相关 / call-up 中合同日期最近的一份，当前合同不算）。确认上轮中标 SHALL 由用户点按钮，经既有人工确认路由写入（携带合同披露 reference_number 与来源链接，没有证据时不编造）；系统 SHALL NOT 自动把供应商写成上轮中标方。进口 / 海关线索 SHALL 只列官方公开来源的人工检索指引（Canadian Importers Database、CID 开放数据、Statistics Canada CIMT），写明各自能查到与查不到什么，并说明加拿大不公开逐票报关记录、需登录或付费的商业提单库不接入；SHALL NOT 发起出站请求。

#### Scenario: 上一次谁供货
- **WHEN** Tender 关联了一份前序 SO，其下有一笔更晚的 call-up
- **THEN** 卡片显示该供应商 2 份合同 / call-up、合同披露值按口径合计，「最近一次」为该 call-up；确认上下文带该 call-up 的合同披露 reference_number；`procurement-pure.test.ts` 与 `procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 海关数据
- **WHEN** 用户查看进口线索
- **THEN** 只出现 canada.ca / statcan.gc.ca 的官方来源，并写明逐票报关记录不公开、商业提单库不接入；`procurement-pure.test.ts` 覆盖
