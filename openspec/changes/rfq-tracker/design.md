# Design：询价追踪页（T-2）

## Context

- 任务书 `docs/QINGYAN_T-1_T-2_RFQ_TRACKING_TASKBRIEF.md` §3 写于 T-1 之前；之后又有 RFQ-AUTO-1（轮次跟进授权：授权生效的轮次，扫描起草的催单可自动批准，间隔用批准时定格的天数）。本设计按现在的代码对齐。
- 催单判定：`chase-pure.ts` 的 `decideChases` / `decideNoResponse`（不改）；`chase-service.ts` 的 `runForItems` 按轮次算间隔（授权生效 → 定格天数；否则 `resolveChaseAfterDays(负责人偏好, 组织设置)`）。
- 在途条目：`chase-service.ts` 的 `loadItems`（未导出）：近 90 天发出、`sent / replied / quoted`、轮次不是已取消 / 已完成、带待批卡状态与催单记录。
- 审批：W-1 `web-entry-approval.ts` 的 `loadRfqApprovalInfo`（能不能批、哈希）与 `loadRfqSendEmails`（T-1 已支持催单卡的单封正文，任务书里的「扩展」已不需要）。
- 比价：`compare-service.ts` 的 `loadCompareMatrix({ projectId, orgId, inquiryId })`。
- 首页：`proactive/scanner.ts` 的 `checkSupplierNoResponse` 还在查 `pending / contacted`（早已不用的状态）；`dashboard-ai-suggestions.tsx` 对 `send_followup_email` 有 W-1 留下的兼容分支（顺带把销售的「发送跟进邮件」按钮误写成「去询价轮次处理」）。

## Goals / Non-Goals

**Goals**：一页回答每家「现在什么状态、系统下一步做什么（哪天）、要不要我动手」，并能原地批卡、催单。

**Non-Goals（具体到文件）**
- 不改 `chase-pure.ts` 的判定与常量，不改 `execute.ts`、`chase-execute.ts`、`inbound-parse.ts`。
- 不改 `compare.ts`、`landed-cost.ts`、`compare-service.ts` 的计算。
- 不改审批中心与 approve / reject 接口。
- 不改 `prisma/schema.prisma`。

## Decisions

### D1 下一步日期：由判定函数反推，并用判定函数对照测试

`nextChaseOutlook` 只读 `chase-pure` 导出的常量与函数，算出「下一次扫描会起草 / 标未响应」的时刻；测试对每个用例在 `at` 与 `at − 1ms` 各跑一次 `decideChases`，前者起草（或标未响应）、后者 `not_due`。

- 否决：另写一套天数逻辑。页面说「11-09 催」而 cron 在别的时间催，人就不会再信这一页。

### D2 间隔天数与扫描同一来源

把 `runForItems` 里算间隔的那三行抽成导出的 `chaseDaysForRound(orgSettingsJson, ownerId, followUp)`，扫描与追踪都调它；扫描的行为不变（测试覆盖）。

- 否决：追踪页只用 `resolveChaseAfterDays`（任务书原写）。授权生效的轮次用的是定格天数，会对不上。

### D3 `loadItems` 导出并可按项目过滤；项目按读权限筛

加可选的 `projectIds`；不传时与原来完全相同（Muse 与 cron 不传）。追踪先按**项目读权限同一规则**（`projectReadWhere`：平台超管全部；否则已派发、且负责人 / 该组织 org_admin / 项目 active 成员）+ `workDomain: "tender"` + 有在途询价，求出项目 id（再截上限），再取条目；另查近 14 天标为 `no_response` 的条目（只显示，不参与判定）。

- 否决：`buildProjectVisibilityWhere`（任务书原写的可见规则）。它对所有组织成员放行，普通成员就能看到所有项目的报价；而项目里的询价与比价接口用的是项目读权限（独立审查 H1）。
- 否决：先按更新时间截 200 个项目再筛在途。没有询价的老项目会挤掉有在途询价的（审查 M2）。

### D4 价格直接取比价矩阵，按白名单组装

对至少一家已报价的轮次调 `loadCompareMatrix`，按 `itemId` 对上行；最多 50 轮（按最近报价时间），其余只显示原币种报价并写「落地价请到比价面板查看」。返回只放报价字段与矩阵行的 `landedCad` / `flags` / `blockers`。

- 否决：追踪页自己换汇。和比价面板对不上就是 bug（任务书 §5 第 9 条）。

### D5 接口位置

`GET /api/org/tender-rfq/tracker`（`/api/org/` 在 `apiFetch` 的组织作用域里，组织由服务端解析）；`POST /api/projects/[id]/tender-rfq/chase`（项目写权限，复用 `draftChasesForProject({ manual: true })`）。审批信息按项目所属组织取（`loadRfqApprovalInfo`）。

### D6 页面

`/bids/rfq`（与 `/bids` 同一个 `canAccessBidWorkspace` 门禁）；「全部批准」前端顺序调用既有 approve 接口，逐张显示结果；approve 是同步执行，响应即结果，不轮询。`/bids` 顶部汇总卡只有计数。

### D7 首页建议与旧接口

`checkSupplierNoResponse` 改查 `status: "sent"` 且 `sentAt` 早于负责人的催单天数（`resolveChaseAfterDays`）；动作改 `open_rfq_tracker` → `/bids/rfq?project={id}`；移除 `send_followup_email` 的兼容分支。batch-followup 返回 410（Evan 拍板 ②；它每次调用都跑一次模型）。

## 与八条硬纪律的关系

1. **零 schema**：只读，复用 PendingAction。
2. **出站先审批**：「现在就催」只建 `tender.send_chase` 审批卡；批准走既有接口。
3. **禁止第三套队列**：不新增 cron / 队列 / 轮询；「全部批准」是前端顺序调用。
4. **脱敏**：追踪页是内部页面，显示供应商报价与落地价（可见范围 = 项目里的询价明细；决定 A 只约束 Muse 通道）；SHALL NOT 显示估值、我方报价、中标价、毛利、价格情景；汇总卡与通知无金额。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及（催单执行器不改）。
7. **确定性优先**：全部查表，零模型；下线 batch-followup 反而少一处模型调用。
8. **测试注册**：新测试注册进两个脚本。

## 验证方式

- `npx tsx src/lib/tender-rfq/__tests__/tracker-pure.test.tsx`（新）：一致性表、分类、汇总文案、跨时区日期、报价列（齐全 / 缺落地价参数 / 最便宜 / 只有总价 / 只有单价，与同一轮 `buildCompareMatrix` 对照）。
- `npx tsx src/lib/tender-rfq/__tests__/tracker-db.isolated.test.ts`（新，隔离库，真实路由）：可见范围、组织、白名单、与比价矩阵一致、现在就催（起草 / 跳过 / 不发信 / 写权限）、`loadItems` 不传 `projectIds` 与原来相同、扫描间隔不变、首页建议、batch-followup 410。
- 改动前新测试失败；变异核对；独立审查；真实浏览器截图 `docs/acceptance/t-2/`。
- 全量门禁同前；`grep -rn '"contacted"' src/lib/proactive src/app/api/projects` 为空。

## Risks / Trade-offs

- **独立审查之后改的（详见报告）**：价格按项目读权限可见（H1）；待批卡也写出不批时哪天标未响应（M1）；先筛有在途询价的项目再截上限（M2）；按轮次的读取并发、汇总卡不算间隔（M3）；按项目进来默认第一个有内容的页签、可看全部，首页建议只算招投标项目（M5）；汇总卡文案不自相矛盾；全部批准进行中不显示单张面板；读取失败不清空页面；已批准执行中的卡算活着；矩阵算不出时写明；销售「发送跟进邮件」到客户页。
- **接口没有工作区门禁**：`/api/*` 不走路由门，任何登录者都能调追踪接口，但只能看到自己有项目读权限的项目（与项目里的询价明细一致）。
- **扫描停了没有提示**：催单扫描挂在收信之后，收信失败（如邮箱授权失效）扫描不跑，过期的「下次自动催」会一直写「今天」。
- **跟进授权生效的轮次**：间隔取定格天数（与扫描同一来源）；首页建议按负责人的催单天数，可能与这类轮次的天数不同。

- **一次读取较重**：可见项目的在途条目 + 待批卡 + 最多 50 轮比价矩阵 + 审批信息。只在打开页面时。
- **授权生效的轮次**：扫描起草的催单可能被自动批准并发出，页面写「下次自动催 X」仍然对。
- **「未响应」只显示近 14 天的**：更早的不在页面上。

## Migration Plan

零 schema。合并后有招投标中心权限的人就能看到 `/bids/rfq`。batch-followup 合并即下线（W-1 已删掉唯一调用方）。回滚 = 回滚代码。
