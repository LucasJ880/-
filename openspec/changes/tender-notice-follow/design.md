# Design：采购监控里的新标可以「跟这个标」（P2-3a）

## Context

- 候选来自 PROC-1：`ProcurementInstrument`（`instrumentClass = SOLICITATION` 是招标公告），字段有正式编号、标题、采购执行 / 购买机构、发布与截标时间、分诊状态；每条带来源证据 `ProcurementSourceEvidence`（CanadaBuys 的规范化 JSON 里有公告链接）。按组织隔离（`@@unique([orgId, dedupeKey])`）。
- 鉴权：`requireInstrumentAccess(user, id, minRole)`——按服务端载入行上的 orgId 校验成员关系，非成员 404、角色不足 403；暗合并闸 `schemaGate("write")`。
- 关联：`ProcurementTenderLink`（`@@unique([projectId, instrumentId])`，relation CURRENT / PREDECESSOR / RELATED_HISTORY），现有 `POST …/tender-link` 只能关联已有项目。候选列表 `listCandidates` 已经带出每条的关联。
- 新建项目：`POST /api/projects` 在一个事务里建项目 + 创建者 project_admin + 测试 / 正式两个环境 + 讨论区系统消息 + 台账 `project.created`（台账闸开时，与业务写同事务）。
- 分析：上传文件后 `files/process-next` 调 `enqueueTenderPackageIfReady`（指纹幂等），无需新入口。

## Goals / Non-Goals

**Goals**：候选里的招标公告一键变成招投标项目，字段预填、关联好、只建一次。

**Non-Goals（具体到文件）**：不改 `src/lib/procurement-records/scan-run.ts`、`source-fetch.ts`、`sources-pure.ts`、`priority.ts`、`watch-config.ts`（拉取、解析、优先级、配置）；不改 `src/app/api/projects/route.ts`（手工新建）；不改 `src/lib/tender-auto-analysis/**`（入队）；不改 `prisma/schema.prisma`。

## Decisions

### D1 只建一次：锁公告行 + 两道查

事务里先 `SELECT … FROM "ProcurementInstrument" WHERE id = ? AND "orgId" = ? FOR UPDATE` 锁住这条公告，然后：
1. 不是招标公告 → 400（D4）。
2. 指向**还在的**项目的「本项目」关联（最早一条，与候选卡片「已跟进」一致）→ 返回那个项目（`created: false`）。项目被删了的关联不算（关联表对项目没有外键）。
3. 本组织里由跟标建出、还在的项目（`sourceMetadataJson` 里的公告 id）→ 返回它。这样关联被人手工改成「前序 / 历史」后再跟，也不会建第二个（独立审查 H2）。
4. 都没有：判截标（D4），再建项目 + 关联 + 改关注，同一事务提交。

两人同时点，第二个人在锁上等，拿到锁后看到关联，返回同一个项目。

- 否决：只靠应用层先查后建。两个请求同时查都看不到关联，会建出两个项目。
- 否决：拿 `ExternalReference` 做唯一键。它是全局唯一（`[system, externalId]`），不分组织，两个组织跟同一条公告会撞。
- 否决：审计日志当幂等账本。审计是事后记录，挡不住并发。

### D2 建项目的步骤与手工新建相同

在服务里按 `POST /api/projects` 同样的步骤建：项目（`workDomain = tender`、负责人 = 点的人）+ 创建者 project_admin + 两个环境 + `onProjectCreated` + 台账（`isLedgerProducerActive()` 时，同事务，actor 取服务端用户）。把这个服务加进台账测试的「producer 静态纪律」清单。

- 否决：从服务端再调一次 `POST /api/projects`。要伪造请求、拿不到同一个事务，锁就白加了。
- 否决：把手工新建的路由抽成公共函数。会动到台账测试按路由文件做的静态检查和手工新建的行为，不在这次范围；两处步骤相同由测试对照（D6）。

### D3 预填哪些字段

| 项目字段 | 来自 |
|---|---|
| 名称 | 公告标题；没有标题用正式编号 |
| `solicitationNumber` | 正式编号 |
| `closeDate` / `publicDate` | 截标时间 / 发布时间 |
| `clientOrganization` | 购买机构，没有就用采购执行机构 |
| `sourcePlatform` | 证据来自 CanadaBuys 时「CanadaBuys」，否则按来源（人工导入写「人工导入」） |
| `sourceMetadataJson` | `{ procurementInstrumentId, noticeUrl, jurisdiction, origin }` |
| `intakeStatus` | 默认 `dispatched`（和手工新建一样，大家都看得到） |

- 否决：同时把公告全文塞进项目描述。原始资料、证据、推断要分开；公告原文仍在 PROC-1 的证据里，项目只带链接与来源。

### D4 什么情况不能跟

- 不是招标公告（合同、call-up、其它）→ 400「只有招标公告可以跟」，即使有人手工关联过。
- 没跟过且已过截标时间 → 409「已截标」；跟过的截标后再点返回原项目（让人能打开）。截标时间未知的可以跟（项目里 `closeDate` 为空）。
- 只读成员 → 403；非成员 → 404（沿用 `requireInstrumentAccess`）；闸关闭 → 503。
- 组织已归档 → 403（与手工新建相同）。

- 否决：已截标也允许跟。截标后建项没有意义，还会触发分析与催单等下游。

### D5 页面

候选卡片上（只对招标公告）：没截标、还没「本项目」关联、看的人不是只读成员 → 「跟这个标」；有关联 → 「已跟进 · 打开项目」（最早一条；候选列表的关联按建立时间排，并去掉指向已删项目的）。其它类别不显示。监控接口多返回 `canFollow`（只读成员为假）。成功提示在重新读取之后再显示（每次接口调用开始时会清空提示）。

### D7 截标日程

建项时截标日已知 → 提交后调 `syncProjectMilestoneCalendars`（与改截标日的 PATCH、文件元数据回填相同），失败不影响建项。文件元数据回填在截标日已有时不再写，所以不在这里同步，负责人就收不到截标提醒（独立审查 M2）。

- 否决：等上传文件后再同步。回填会跳过已有的截标日，永远不会同步。

- 否决：在项目新建页加「从公告导入」。多一步选择，且发现新标的地方就是监控页。

### D6 测试

- 纯函数：字段映射（D3）、能不能跟（D4）、按钮状态（D5）。
- 隔离库：真实接口；建出的项目字段、成员、环境、关联、分诊；再点返回同一个；并发两次只建一个；跨组织 404、只读 403、已截标 409、非招标 400；新项目的成员 / 环境与手工新建的项目逐项相同。

## 与八条硬纪律的关系

1. 零 schema：只写已有的 `Project`、`ProjectMember`、`Environment`、`ProcurementTenderLink`、`ProcurementInstrument.triageStatus` 与审计；不改 `prisma/schema.prisma`。
2. 出站先审批：不涉及（不对外发送任何东西）。
3. 禁止第三套队列：不涉及（同步建项；分析仍走现有入队）。
4. 脱敏：不涉及（公告是公开信息；不输出毛利、估值、报价）。
5. 不爬登录页：不涉及（不发任何外部请求，只用已入库的公告）。
6. 邮箱分离：不涉及。
7. 确定性优先：全部确定性代码，不调模型。
8. 测试注册：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/procurement-records/__tests__/tender-follow-pure.test.ts`
- 隔离库 `npx tsx src/lib/procurement-records/__tests__/tender-follow-db.isolated.test.ts`
- 台账静态纪律 `npx tsx src/lib/project-ledger/__tests__/p1-pure.test.ts`（清单加入新服务）
- 门禁：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate tender-notice-follow --strict`；本地 `next build --webpack`（客户端引用链）
- 真实浏览器截图 `docs/acceptance/p2-3a/*.png`

## Risks / Trade-offs

- **建项的步骤有两份**（手工新建与跟标）：以后改手工新建要同步改这里。测试逐项对照两者建出的成员与环境；台账静态纪律覆盖两处。
- **跟了之后公告又修订**：项目字段是跟的那一刻的快照，不随公告修订自动改（P2-4 的修订监控另做）。
- **与手工关联并发**：PROC-1 的 `POST …/tender-link` 本来就允许一条公告关联多个「本项目」，且不加锁；它与跟标同时发生时可能出现两条「本项目」关联。跟标与卡片都取最早一条，结果一致；不改 PROC-1 的关联规则（不在范围）。
- **截标日显示**：项目页把 `closeDate` 按 UTC 取日期显示（既有写法），多伦多晚上截标的会显示成次日；PROC-1 解析 CanadaBuys 不带时区的时间用服务器本地时区。都是既有行为，另记。
