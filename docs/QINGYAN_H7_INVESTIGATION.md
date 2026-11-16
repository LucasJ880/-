# H7 只读调查：前接发现（P2-1～P2-3）

| 项 | 值 |
|---|---|
| 来源 | 交接文档 §0.5f 第 4 项「H7：范围大，涉及外部数据源……先做只读调查再定」；TASKFLOW Phase 2「标讯雷达」P2-1～P2-3 |
| 日期 | 2026-11-15 |
| 性质 | 只读调查：没有改代码、没有发请求、没有改任何开关或数据 |
| 结论一句话 | **P2-1 的大半已经由 PROC-1 做完**（不在 `tender-intel`）；缺的是「看新标」的视图、无模型的预评分、「跟这个标」建项与早报。Muse 已永久冻结，P2-3 与 GATE-2 的验收要改写成 Web 版 |

## 1. 已有什么

### 1.1 每天拉 CanadaBuys 新标：PROC-1 已经在拉

- `src/lib/procurement-records/source-fetch.ts`：`fetchCanadaBuysNotices` 拉 CanadaBuys 官方开放数据的两个 CSV（`newTenderNotice-…csv`、`openTenderNotice-…csv`），固定 User-Agent、30 秒超时、60 MB 上限；`TENDER_EXTERNAL_INTEL_ENABLED` 关着时一个请求都不发。只读公开数据，不碰登录页。
- `sources-pure.ts`：中英双语列名解析；幂等键 `canadabuys:{编号}:{修订号}`。
- `watch-config.ts`：每个组织自己的关键词（纺织 / 窗饰，中英法）、排除词、GSIN / UNSPSC、机构、地区；每次最多新建 5 条候选（上限 20）。
- `scan-run.ts`：挂在已有的 `tender-watch` cron 上（每小时 :25），认领 / 续跑，零模型调用；新候选通知监控开启人。
- 存进 `ProcurementInstrument(instrumentClass=SOLICITATION, triageStatus=CANDIDATE)` + 证据表，按组织去重（`@@unique([orgId, dedupeKey])`）。
- 页面：`/projects/intelligence/monitor`（候选列表，只有「关注 / 忽略」）。规格 `procurement/watch-scan`（10 条）。
- 默认排期是**每周一、周四 08:00（多伦多）**，星期几可配——「每天」是配置，不是新功能。
- 2026-11-09 上了生产（PROC-1 报告 §8a：新标 CSV 拉取成功，930 条里命中 13 条）。**GATE-R 业务验收仍待 Lucas。**

### 1.2 `tender-intel` 里的「CanadaBuys」是另一回事

`src/lib/tender-intel/canadabuys.ts` 查的是 open.canada.ca 的「1 万加元以上合同」（中标 / 合同历史），不是招标公告。它提供「候选 → 人工确认」契约与竞对 / 采购方画像（`org-profiles.ts`、`award-intelligence.ts`），可以作为 P2-2 的「采购方记忆」输入。

### 1.3 下游已有的

- 分析入队：`enqueueTenderPackageAnalysis` / `enqueueTenderPackageIfReady`（指纹幂等），分析完成有 `analysis.ready` 通知（P0-7）。
- 早报：`/api/cron/daily-brief` 每小时跑、在组织本地 07:00 出早报（秘书早报会调模型；COLLAB-2 的未读邮件摘要是确定性的）。
- 项目与公告的关联表：`ProcurementTenderLink`（项目 ↔ 公告，CURRENT / PREDECESSOR / RELATED_HISTORY）；现在只能关联**已有**项目。

## 2. 缺什么

| 项 | 缺的 |
|---|---|
| P2-1 | 「每天」的排期预设；只看新标的视图（候选列表现在把公告、合同、信息公开请求混在一起，也不按截标日过滤）；GATE-R 业务验收 |
| P2-2 | 公告级的预评分（现在的 `priority.ts` 是给信息公开请求排序用的，不是投标适配度）；召回评估脚本；「10 个历史已投标」的名单 |
| P2-3 | 「跟这个标」：候选 → 建招投标项目 + 关联 + 改为关注；自动拉公告附件；早报里的新标段落；Muse 冻结后的 Web 版入口 |

Muse 侧只有词汇：`follow_tender` 意图没有处理代码（落到「未开放」），`brief.daily` 事件没人发。

## 3. 八条纪律怎么卡

| 纪律 | 对 H7 的约束 |
|---|---|
| 1 零 schema | 不建「公告」「评分」新表；复用 PROC-1 的表要按 PROC-1 的语义写，不能拿它存别的；预评分**读时计算**，不覆盖 `priorityJson` |
| 2 出站先审批 | 拉公开数据不是对外发送；给本组织成员的早报不需要审批卡 |
| 3 不开第三套队列 | 不加 cron、不加任务表；`ProcurementScanRun` 只许扫描步骤用；入队只用现有的 `enqueueTenderPackage*`；早报挂已有的 `daily-brief` cron |
| 4 脱敏 | 早报与通知不输出毛利、估值、我方报价 |
| 5 不爬登录页 | 附件只拉公开列出的；要登录的门户一律「需人工上传」 |
| 7 确定性优先 | 预评分是纯函数、不调模型；新标早报不喂进会调模型的秘书早报，单独出确定性通知 |
| 8 测试注册 | 照常 |

## 4. 建议的切法（每个 ≤ 8 条任务）

按依赖与价值排序；前三个只用已经在生产里的 PROC-1 数据，不碰外部域名、不改开关。

1. **`tender-notice-follow`（P2-3a，先做）**：候选上的「跟这个标」——鉴权用 `requireInstrumentAccess`；建 `Project(workDomain=tender)`（负责人 = 点的人，预填招标编号、截标日、采购方、公告链接）+ `ProcurementTenderLink(CURRENT)` + 改为关注；同一组织同一公告只建一次（锁 + 审计幂等键）；有文件后走现有入队。人点了才建，不自动跟。
2. **`tender-notice-daily-view`（P2-1 收尾）**：排期加「每天」预设；候选页加「新标」筛选（只看公告、没过截标日、按发布日 / 分数排）；显示公告链接。不加拉取器、cron、表。
3. **`tender-notice-fit-score`（P2-2）**：纯函数预评分（关键词 / 类目命中、同采购方的中标与我方投标历史、过往业绩重叠、截标前剩余天数），每项写原因；读时计算；召回脚本跑 Lucas 指定的 10 个历史投标。
4. **`tender-morning-brief`（P2-3b）**：在已有 `daily-brief` cron 的 07:00 加一步：每个组织前 N 条新标（确定性），站内通知（每组织每人每天一条），可选并进 COLLAB-2 的邮件摘要（只发本组织成员）；`brief.daily` 只在 `MUSE_BRIDGE_ENABLED` 时发。
5. **`tender-notice-package-fetch`（P2-3c，可选）**：只拉公告页公开列出的附件，挂外部情报开关、限大小与类型，进项目文件后走现有入队；要登录的标「需人工上传」。是否要做取决于下面第 4 问。

P2-4（`watch.ts` 结构化 diff）另立，不在这一批。

## 5. 待定的问题与我的建议

Lucas 已授权「按推荐走」；下表写明哪些我直接按建议做，哪些按交接文档 §0.5f 必须 Lucas 明确同意。

| # | 问题 | 建议 | 谁定 |
|---|---|---|---|
| 1 | P2-1 算不算 PROC-1 已交付 | 算；补「每天」预设与新标视图即可（切法 2） | 按建议做 |
| 2 | Muse 冻结后 P2-3 / GATE-2 的验收 | 改写成 Web：站内「今日新标」/ 07:00 邮件摘要 → 一键跟进 → `analysis.ready` 通知；`brief.daily` 只在 `MUSE_BRIDGE_ENABLED` 时发 | 按建议做（在对应 change 的 proposal 里改 TASKFLOW 验收） |
| 3 | 生产里 `TENDER_EXTERNAL_INTEL_ENABLED` 是否开着 | 仓库里没有记录；切法 1～4 不依赖它（只用已入库的公告） | **Lucas 告知**（生产开关） |
| 4 | 要不要自动拉附件 | 先不做：「跟这个标」建项后提示上传文件包；等确认 CanadaBuys 哪些附件公开可下再做切法 5 | 按建议做 |
| 5 | 开放数据的许可（Open Government Licence – Canada） | 仓库里没有记录；展示时注明来源与链接；存原始行沿用 PROC-1 现状 | **Lucas 确认**（法务） |
| 6 | 排期 | 每天 06:00 多伦多（赶在 07:00 早报之前）；默认仍是周一、周四，组织自己改成每天 | 按建议做（不动生产配置） |
| 7 | 预评分的召回名单 | 需要 10 个历史已投标项目的 id | **Lucas 提供** |
| 8 | 跟进的语义 | 负责人 = 点的人；`intakeStatus = dispatched`；最低角色 = 组织成员；必须人点；同一组织同一公告一个项目 | 按建议做 |
| 9 | 早报发给谁 | 监控开启人 + 组织里有招投标权限的人；站内为主，邮件并进 COLLAB-2 摘要 | 按建议做 |
| 10 | 每次新建候选上限 | 默认 5 偏少（实测一次命中 13）；每天跑之后每次量会变小，先不改 | 按建议做 |
| — | GATE-R（PROC-1 业务验收） | H7 的结果要靠 PROC-1 的数据；建议 Lucas 先看一次 `/projects/intelligence/monitor` 的候选质量 | **Lucas** |

## 6. 下一步

切法 1（`tender-notice-follow`）只用已入库的公告、默认只在已开启监控的组织里出现、零 schema、不碰外部域名，可以先做；其余按上表顺序。需要 Lucas 的三件事（生产开关的现值、许可确认、召回名单）不挡切法 1、2。
