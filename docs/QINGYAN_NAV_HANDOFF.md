# NAV 线交接说明（2026-11-15）

Phase N（导航与说明白话化 + 回复入口）到此告一段落。这份说明给下一个接手的人或下一次会话：现在是什么状态、还剩什么、从哪接。状态的唯一事实源仍是 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 Phase N 表；本文件只做索引，两者不一致时以 TASKFLOW 与 `git log --oneline --merges` 为准。

## 已合并并归档

| change | 做了什么 | 实施 PR | 归档 PR | 报告 |
|---|---|---|---|---|
| NAV-1a `nav-1a-single-name` | 一个入口一个名字 | #453 | #457 | `docs/QINGYAN_NAV-1a_REPORT.md` |
| NAV-1b `nav-1b-focused-sidebar-task-help` | 常用入口置顶 + 白话说明页 | #463 | #466 | `docs/QINGYAN_NAV-1b_REPORT.md` |
| NAV-1c `nav-1c-reply-entry` | 看到来信就能回 | #472 | #473 | `docs/QINGYAN_NAV-1c_REPORT.md` |
| NAV-6 `nav-6-inbox-reply-clarity` | 询盘收件箱里「谁回复了谁」说清楚 | #484 | 与本说明同一个 PR | `docs/QINGYAN_NAV-6_REPORT.md` |

四个 change 都没有开关，合并即生效；回滚 = revert 对应的实施 PR。任务书：`docs/QINGYAN_NAV-1_PLAIN_NAV_REPLY_TASKBRIEF.md`（NAV-6 没有任务书，口径在它归档后的 proposal 里）。

## 还没做、需要人来做的

1. **在 staging 走一遍真实发信。** NAV-1c 的「自己写回复 → 发送邮件」只在本机用「已在别处发送，标记」那条分支验过，没有在真实发信环境验过。步骤在 `docs/QINGYAN_NAV-1c_REPORT.md` §7（5 步，用内部邮箱）。
2. **通知梦馨一次。** 任务书要求三个 change 都上线后通知。建议在第 1 步走通之后发。要点：入口没有少，常用的在最上面；看到客户来信旁边就有「回复」；AI 没写好草稿也可以自己写；卡片上「买家已来信」「我方已回复」各指谁。
3. **向 Cathy 本人确认常用 8 项。** 清单是按任务书拍板定的，没有问过她本人。要改只动 `src/lib/navigation/trade-layout.ts` 里的 `FOCUSED_PRIMARY_KEYS` 一处。

## 没有验证过的

- 「发送邮件」在真实发信环境的表现（见上面第 1 条）。
- NAV-6 之后外贸助手、数字员工读到的阶段名由「已回复」变为「买家已来信」，没有在真实模型上对比过改名前后的回答。
- 生产数据：有多少商机只对上 `sourceTradeProspectId`、没有对上 `convertedToSalesOpportunityId`（这类商机在时间线上没有「回复」入口）。没有生产访问。

## 后续候选（都没有立项）

任务书附录的后续队列：NAV-2 窗饰「我想做什么」、NAV-3 审批草稿可改、NAV-4 按企业隐藏用不到的入口（要先向梦馨逐项确认）、NAV-5 手机端常用置顶。

实施中记下的：

- 只读外贸成员在收件箱的分析块里仍看得到「重新生成」「按建议生成报价草稿」，点了会被接口拒绝（`docs/QINGYAN_NAV-6_REPORT.md` §5 第 3 条）。今天没有只读的外贸岗位，不影响任何人。
- 询盘收件箱以外的外贸页面（线索详情、外贸报价、寄样）对只读成员的按钮显隐。
- 外贸看板漏斗里「已联系」「成交」与阶段表「已触达」「已转化」的名字不一致。
- 今日询盘接口直接给出线索 id（商机没有对应线索时，审批面的链接点过去是「没有找到这位买家的询盘会话」）。

## 接手时要知道的几件事

- **流程**：见 `CLAUDE.md` §3、§4。一个 change = 一个 PR；合并后归档走独立小 PR 并同步 TASKFLOW。
- **归档有先后**：一个 change 的增量规格如果改的是另一个 change 新加的要求，要等前一个先归档，否则 `openspec archive` 会拒绝（NAV-1c 归档等过 NAV-1b 归档）。
- **新能力的 Purpose 要写够 50 字**，否则归档出来的主规格过不了 `openspec validate --specs --strict`。主规格不能手改，要在归档前改 change 里的增量规格（NAV-6 归档时踩过）。
- **TASKFLOW 的 Phase N 表**，相邻两行分别在两个 PR 里改时会冲突，后合并的那个要把 main 合进来解一次。
- **`npm test` 在没有数据库 / Chromium / Gmail 的环境里固定有 13 项失败**（Agent Trace 只读查询、Phase3A 的 9 项、Gmail Draft OAuth Compose Scope、T4 授标情报真实 Postgres 矩阵、Quote Operations 客户报价 PDF 分页布局）。判断是不是自己弄坏的，办法是把失败的名字在 main 的干净检出上逐个重跑对比。
- **`tender-workforce/t1b-pure.test.ts` 偶发不退出**：NAV-6 时 CI 子集卡在它上面二十多分钟（打印完结果后进程没退出，当时本机负载高），单独运行正常。再出现值得单独查。
- **隔离库测试**（`*.isolated.test.ts`）需要 `DATABASE_URL` 指向一次性的 PostgreSQL，并设 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated`；不给库时它们跳过并退出 0，所以 `npm test` 通过不代表它们跑过。
- **截图用的演示数据**（虚构企业 Example Textiles / Example Blinds、账号 `*@fixture.test`）只存在于当时会话的本机临时库里，没有进仓库，也没有进任何共享环境。
