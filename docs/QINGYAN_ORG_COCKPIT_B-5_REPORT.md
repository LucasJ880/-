# B-5 完成报告：分级自治，内部动作按 policy 自动化（openspec change `fde-internal-autonomy`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §B-5；已决定 D-4。
分支：`claude/fde-internal-autonomy`。叠在 B-4 `claude/fde-score-calibration` 之上，PR base = B-4 分支，依次合并后改回 `main`。B-5 本身只依赖 B-1。
OpenSpec change：`openspec/changes/fde-internal-autonomy/`（proposal / `specs/revenue-spine/internal-autonomy/spec.md` / design / tasks，`openspec validate --strict` 通过）。

---

## 1. 做了什么

任务书三条的落点：

| 任务书 | 结论 |
|---|---|
| 1. disqualified + `decline` → 自动关闭 | **FDE 已经实现**：判不合格后转 `disqualified`、不起草、关闭 FDE 行动，`decline` 本身就是开关。本 change 只给这次流转的审计补 `policyKey = businessProfile.excludedCategoryAction` |
| 2. 陈旧商机 → 自动转 `stale` + 通知负责人（F7） | **本 change 的主体**，见下表 |
| 3. 配额命中 → health `quota_hit` + 通知 admin（F6） | **既有代码已满足**：<br>- FDE 运行经 `createAgentRun` 预留配额；<br>- 硬限额写 `QUOTA_HARD_LIMIT_BLOCKED`，并通知 owner / admin；<br>- A-2 健康度读取它。<br>本 change 只加静态断言锁定链路 |

| 文件 | 内容 |
|---|---|
| `src/lib/revenue-spine/autonomy.ts`（新） | 判定纯函数 `decideAutoStale`、查询条件构造函数、在途审批引用解析、标题遮盖、汇总通知、依赖可注入的执行器 `runAutoStale`、dogfood 计划 `planAutonomyEnable` |
| `src/lib/revenue-spine/policy.ts`（改） | `autonomy.autoStale`：默认 `false`，只认布尔值，存量 policy 无此段时为关闭 |
| `src/lib/revenue-spine/transition.ts`（改） | 可选 `policyKey` 写进审计 `afterData`；不传时审计字段与原来逐字相同 |
| `src/lib/revenue-spine/fde/inbound-sales.ts`（改） | `decline` 判不合格时透传 `policyKey` |
| `src/app/api/cron/revenue-spine/route.ts`（改） | 开关保护的自动搁置步骤：<br>- 放在 next action 重算之前；<br>- 受维护预算约束；<br>- 单独兜错（`autoStaleError`）；<br>- 修正头注释 |
| `scripts/seed-revenue-autonomy.ts`（新） | D-4 dogfood：默认 dry-run；`--write` 为 `--org-code`（缺省 `sunny-home-deco`）发布一版 policy，只设 `autonomy.autoStale = true`；已开启不重复发布 |
| 测试（新，已注册进两个测试脚本） | `src/lib/revenue-spine/__tests__/autonomy.test.ts` 41 条 |

### 自动搁置的规则

1. **开关生效**：`policy.autonomy.autoStale = true`，且 `staleAfterDays ≥ max(14, 最后一次无回复跟进 + 7)`。默认 21 天、跟进 3 / 7 / 14 天，刚好满足。
2. **候选**：
   - 开放阶段、客户未归档；
   - **由 Revenue Spine 维护**（`stageChangedAt` 非空）。Sunny 窗饰车道的同名阶段不处理。
3. **最后活动**：`max(lastInteractionAt, stageChangedAt, 最新 CustomerInteraction)` 早于 `staleAfterDays` 天前。
4. **买家**：最后来信为空或早于同一时点，且不在等我们回复。
5. **在途审批**：没有 `pending` / `approved` 的审批动作。识别依据：
   - 商机 id；
   - 报价 id（映射到商机）；
   - 目标 / 资源引用。
   - 在途审批读不全时，本轮该组织不搁置。
6. **执行**：
   - 每组织每轮最多读 500 个候选、流转 200 个，被跳过的不占名额；
   - 流转前重读再判；
   - 经 `transitionOpportunity`：来源 `system`，`policyKey = autonomy.autoStale`，原因写明天数。
7. **通知**：每个负责人每轮一条汇总，类型 `followup`；无负责人时通知创建人；标题里的邮箱 / 电话遮盖；只有一个商机时点击进商机详情。

## 2. 怎么验的

| # | 验证 | 结果 |
|---|---|---|
| 1 | `autonomy.test.ts` 单独运行 | 41 / 41；`revenue-spine` 既有 14 个非 DB 测试与 B-1 两个测试全过 |
| 2 | 任务书验收"每条自动流转都有 AuditLog（带 policy 键名）" | 自动搁置：执行器传给 `transitionOpportunity` 的参数逐项断言（source / actor / policyKey / 原因）；`transition.ts` 源码断言 `policyKey` 写进 `afterData`。FDE `decline`：源码断言透传 |
| 3 | 任务书验收"policy 未配置时零行为" | 默认 policy、`autoStale` 非布尔值、阈值过低（0 / 10 / 20 天）：执行器零依赖调用；定时任务源码断言开关保护 |
| 4 | 任务书验收"`ALLOWED_TRANSITIONS` 不放宽" | 流转规则表逐项快照相同；每个开放阶段本来就允许转 `stale`；`opportunity-stage.ts` 无改动 |
| 5 | GATE-B3"可在 company.log 时间线看到" | 流转审计动作不在 A-2 时间线排除名单里（A-2 时间线收录组织内全部审计，排除名单之外的都进） |
| 6 | 交叉审查的反例全部入测 | 旧车道商机、近期人工推进、其它入口的互动、买家等回复、报价让利在途、读不全不搁置、流转前重读、部分写入、失败隔离、标题遮盖、名额不被跳过项占用、边界 = cutoff |
| 7 | 无外发 / 无新 cron | 源码断言自治模块不建审批、不发送、不调执行器、不调 LLM、无写方法；`vercel.json` 仍 23 条 cron |
| 8 | 配额链路 | 源码断言：FDE `createAgentRun` → `reserveQuota(DAILY_AGENT_RUNS)` → `evaluateQuota` → 硬限额审计 + `notifyQuotaHardLimitBlocked`（owner / admin）→ A-2 `quotaAuditWhere` / `quotaNotificationWhere` |
| 9 | seed 脚本 | 计划函数：保留其余覆盖、已开启返回 null；源码断言默认 dry-run、只发布 policy 规则；`--help` 退出 0。无 DB 环境，真实写入留 staging |
| 10 | `npm run typecheck`（全量） | 退出 0 |
| 11 | `npm run lint:baseline` | PASS |
| 12 | `npm test` 对比基线 | 本分支 428/442（B-4 分支 427/441 + B-5 的 1 项，全 PASS）；14 项失败与基线逐条一致 |
| 13 | `npm run test:ci` | `CI unit subset PASS`，含 B-5 测试 |
| 14 | `bash scripts/check-test-registry.sh` | B-5 测试已注册；仍有 `main` 上既有的 2 个 trade 测试未注册（不是本 change 引入，另一会话在处理） |
| 15 | `git diff --stat claude/fde-score-calibration -- prisma/ vercel.json src/lib/revenue-spine/opportunity-stage.ts` | 空 |
| 16 | `openspec validate fde-internal-autonomy --strict`；`/opsx:verify` | valid。verify 结果：<br>- tasks 5/5；<br>- 12 条 requirement / 27 个 scenario 均有测试断言；<br>- design D1–D6（含 D2b）与实现一致；<br>- 无 CRITICAL / WARNING |

## 3. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **第 1 条已由 FDE 实现，不重复做**：只补审计键名；来源保持 `fde`（FDE 在本次运行里判定），不改成 `system`。
2. **第 3 条已由既有代码满足，不改代码**：只加静态断言。
3. **"无买家回信"**：最后来信为空或早于阈值；最后活动本来就包含来信，这一条是双重保险。
4. **"无 pending 草稿"扩成"无在途审批"**：
   - 范围：`pending` 与 `approved` 两种状态；识别询盘回复、跟进草稿、报价让利、Grader 内部备注；
   - 读不全时不搁置。
5. **通知按负责人每轮汇总**（不逐条），类型用既有 `followup`。
6. **policy 在 `OrgBusinessRule`**；seed 脚本经既有发布函数生成新版本，可回滚。
7. **【GATE 注意项】company.log 的操作人显示为负责人**：
   - `AuditLog.userId` 有外键，机器流转一直记在负责人名下。来源 `system` 与 `policyKey` 在 `afterData` 里，但 A-2 时间线只显示"操作人 · 动作代码"，看上去与人工流转一样。
   - 开启后第一轮每个组织最多 200 条，会占满时间线前几页。
   - 建议后续在 A-2 时间线加动作中文标签与来源显示（HANDOFF 已记为改进点）。
8. **只处理 Revenue Spine 维护的商机**（`stageChangedAt` 非空）。
9. **买家在等我们回复的商机不搁置**。
10. **最低天数** `max(14, 最后无回复跟进 + 7)`：阈值过低视为关闭。

## 4. 交叉审查（独立审查代理，只给代码与规格）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 阻塞 | Sunny 窗饰车道商机（共用 `quoted` / `negotiation`，从不写 `lastInteractionAt` / `stageChangedAt`）只按创建时间判断：30 天前建、昨天刚报价的也会被搁置，并从 `/sales` 看板与销售首页消失。dogfood 组织 sunny-home-deco 正好启用了这个车道 | 候选要求 `stageChangedAt` 非空（只有 intake 与 `transition.ts` 写）；测试覆盖 |
| 2 | 阻塞 | 只看 `lastInteractionAt ?? createdAt`。人工推进阶段与不经 `logRevenueInteraction` 的互动（报价邮件、外贸收件箱）都不算，刚被推进到 `quoting` 的商机也会被搁置；`stale` 回不到 `quoting`，绕路还会重复记 `RFQ_RECEIVED` | 最后活动取 `max(lastInteractionAt, stageChangedAt, 最新 CustomerInteraction)`（对候选 id 一次 `groupBy _max`）；where 与判定同步；测试覆盖 |
| 3 | 应修 | 在途审批漏判：报价让利（只有 `quoteId`）、Grader 内部备注（`targetType/targetId`）；扫描 2000 行无排序、超限静默丢行 | `approvalRefsOfPayload` 识别 `quoteId` / 目标 / 资源引用，报价经 `SalesQuote.opportunityId` 映射；按创建时间倒序读上限 + 1，读满本轮不搁置 |
| 4 | 应修 | 自动搁置与 next action 共用组织级 try：一出错就跳过该组织本轮的 next action 与跟进草稿 | 单独兜错，写 `autoStaleError`；源码断言 |
| 5 | 应修 | `staleAfterDays` 无下限：写成 0 会把所有开放商机（含 FDE 未跑完的新询盘）全部搁置；过小会打断 3 / 7 / 14 天跟进 | 低于 `max(14, 最后无回复跟进 + 7)` 视为关闭；测试覆盖 0 / 10 / 20 天 |
| 6 | 应修 | 通知直接拼商机标题，intake 在无公司名和姓名时标题就是邮箱或电话；测试用的是虚构标题，没测到 | 标题遮盖邮箱（`[邮箱]`）与 8 位以上数字的电话（`[电话]`）；用 intake 格式标题测试，数量区间不误伤 |
| 7 | 应修 | company.log 操作人显示为负责人，与人工流转分不出来 | 列为偏差 7（GATE 注意项），时间线显示改进留给后续 change |
| — | 可选 | 竞态（候选读出后、流转前刚来信）；被跳过的候选占用 200 名额导致后面的饿死；买家在等我们回复的也会被搁置；部分写入（阶段已写、重算下一步抛错）不通知；边界 = cutoff 与定时任务失败隔离没有测试 | 全部处理：流转前重读再判；读 500、只按流转数计名额；等回复的不搁置；部分写入按已搁置计并通知；补边界与失败隔离测试 |
| — | 可选 | 多商机汇总通知没有 `entityType`，点击无反应；页头不处理 `revenue_opportunity`（既有问题） | 单商机时关联到商机；多商机从 `/revenue` Stale 队列查看。页头路由是既有问题，记入已知限制 |

审查同时独立确认了以下几点：
- 自动搁置与 FDE `decline` 两条路径的 `policyKey` 都写进了 `afterData`，不传时审计字段与原来逐字相同；
- where 的 `lt cutoff` 与判定的边界一致；
- Prisma 查询形状有效：`nulls`、关系过滤、`groupBy`；
- 通知入参类型匹配，`sourceKey` 按"每轮 × 每人"唯一；
- seed 脚本读 active 规则的口径与 `loadActiveRuleConfig` 一致，保留其余覆盖、幂等、默认 dry-run；
- 八条硬纪律无违反。

## 5. staging 待验项（GATE-B3 的 B-5 部分）

- 对 sunny-home-deco 跑 `npx tsx scripts/seed-revenue-autonomy.ts`（看计划），再加 `--write` 开启 dogfood。
- 等一轮 `revenue-spine` 定时任务，核对以下几点：
  - 被搁置的商机各有一条 `revenue_spine.opportunity.transition` 审计，`afterData.source = system`、`policyKey = autonomy.autoStale`，并能在 company.log 时间线看到；
  - 负责人收到汇总通知；
  - Sunny 窗饰车道商机一个都没被动。
- 自动关闭：在 `excludedCategoryAction = decline` 的组织里，用只命中不做类目的测试询盘走一遍。确认 `disqualified` 流转审计带 `policyKey = businessProfile.excludedCategoryAction`，且没有草稿。
- 性能：候选查询（`orgId, stage` 索引 + 时间过滤）与 `CustomerInteraction.groupBy`（`opportunityId` 索引）跑 `EXPLAIN ANALYZE`。

## 6. 已知限制

- 搁置后的商机下一步是"激活或关闭"，由人决定。买家经已链接线索回信到搁置商机时，与人工搁置的处理相同；新询盘照常新建商机。
- 识别不到商机或报价引用的审批动作类型，不算在途。
- 部分写入时（阶段已写、重算下一步失败），原有的 `next_action:*` 行动保持打开，由人处理。
- 页头通知不处理 `revenue_opportunity` 跳转（既有问题）；多商机汇总通知点击无跳转。
