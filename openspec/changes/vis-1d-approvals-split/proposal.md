# Proposal：审批中心与「待我确认」按岗位收口（VIS-1d）

TASKFLOW：VIS-1d（Phase V「可见性收口」；任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`，Lucas 2026-11-08 拍板判断点 1–7）。依赖 VIS-1a / 1b / 1c（#393、#400、#410）。

## Why

审批中心对企业管理员列出全企业所有来源的审批（招投标询价、营销、外贸营收、销售折扣混在一起），AI 助手「待我确认」、侧栏红点、运营看板与 Muse 审批收件箱又各自按「企业管理员 = 全企业」另拼一份范围。审批要按「本人相关 ∪ 本岗位负责的业务类型」收口，并让这几处用同一个集合函数。

## What Changes

**审批可见集合**
- 新增审批可见集合（代码常量 + 纯函数）：一条审批对某人可见，当且仅当满足下列任一条件。
  - 本人提交，或本人是指定审批人。
  - 本人是审批所在工作区的成员，或是审批所属项目的负责人 / 项目管理员。
  - 按类型的可见岗位条件放行。
  - 平台 super_admin 全部可见。
- 新增「审批类型 → 可见岗位条件」对照：业务页面经路由门放行 ∧ 持该类型的审批键（有审批键的类型）。
  - 销售折扣、签约改价、折扣设置、取消工艺单、质保邮件、返修上门邮件按各自审批键。
  - 外贸营收类按营收中心 ∧ `trade.settings.manage`。
  - 招投标询价 / 催单与项目智能体审批按招投标中心。
  - 营销按品牌增长，产品内容按产品内容页。
- 保留没有业务归属的草稿对企业处理人可见：助手、Grader、日历等草稿（不在对照里的类型）仍对企业所有者与成员角色 `org_admin` 可见，与执行期认的处理人相同。
- 保留旧模式不变：行业包没有岗位模板的企业（旧模式）没有岗位键可对照，审批中心、「待我确认」、收件箱与批准入口的行为全部照旧。
- 收回企业管理员看全企业：岗位模式企业里，企业成员角色 org_owner / org_admin 本身不再看到全企业的业务类型审批。**BREAKING**

**审批中心**
- 改审批中心列表按可见集合过滤；在查询里过滤 PendingAction，不再取 200 条后在内存里过滤。
- 改审批详情：不可见的返回 404（与「不存在」同一错误）。批准 / 驳回 / 撤回 / 重试都经详情加载，不可见的一律批不了。
- 改审批中心的幂等重放：先经详情判可见，再读幂等缓存。

**待我确认与审批收件箱**
- 改 AI 助手「待我确认」列表与侧栏红点数为「既有处理人范围 ∩ 可见集合 ∩ 当前企业」，两者用同一个查询条件函数。红点数 = 列表中未过期的条数；解析不出当前企业时只数本人的个人草稿。
- 改运营看板的待审批、审批收件箱（`/api/agent/approvals` 与 Muse）为同一个查询条件函数，收件箱改为只含当前企业。
- 改 AI 助手与审批端口的批准 / 驳回：看不见的审批一律按「不存在」拒绝，端口在返回任何状态之前判；Muse `approve` 先判可见再判网页预览。

**测试**
- 新增纯函数表驱动测试：类型对照、可见集合与查询条件同义（小求值器跑样例行）、按身份的可见类型。
- 新增隔离库测试：本机 Postgres 16 跑真实查询，覆盖审批中心列表 / 详情 / 批准、「待我确认」列表 / 红点、收件箱。
- 新测试注册进 `scripts/test-all.sh`（纯函数测试另进 `scripts/test-ci-unit.sh`）。

## Capabilities

### New Capabilities
- `approvals/visibility`：审批的可见集合、按类型的可见岗位、没有业务归属的草稿、审批中心与「待我确认」/ 收件箱同一集合。

### Modified Capabilities
- 无（现有主规格没有规定审批中心的可见集合；`cockpit/posts-overview`「等你 N 件的组成与去重」写的「与审批中心待我审批同口径」照旧成立）。

受影响的 Muse 意图：
- `status`（项目待批数）、`ask`（最早待批 id）、`next_step`：经审批收件箱取「该用户可见的待批动作」；
- `approve`、`reject`：经审批端口，看不见的按「不存在」拒绝（`approve` 先判可见再判网页预览）；
- `chase`：起草催单时的自动批准经审批端口，批准人看不见那张卡时留作待批。

## Impact

- 新增：
  - `src/lib/approval/audience.ts`（类型对照、可见集合、PendingAction 查询条件，纯函数）；
  - `src/lib/approval/audience-server.ts`（按用户与企业取判定输入）；
  - `src/lib/approval/pending-mine.ts`（「待我确认」列表与红点数）；
  - 对应测试。
- 修改：
  - 审批中心：`src/lib/capabilities/approvals/query.ts`、`decision.ts`（幂等缓存在详情之后）；
  - 判定输入缓存：`src/lib/navigation/context-server.ts`、`route-gate.ts`（加载器类型加按企业取）；
  - 团队审批范围：`src/lib/marketing/team.ts`（抽出共用条件）；
  - 待我确认：`src/app/api/ai/pending-actions/route.ts`、`count/route.ts`、`[id]/route.ts`；
  - 运营看板：`src/lib/operations/dashboard/build-dashboard.ts`；
  - 收件箱与端口：`src/lib/approval/port.ts`、`src/app/api/agent/approvals/route.ts`、`src/lib/muse-bridge/router.ts`（传企业；`approve` 先判可见）；
  - 测试与 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 硬纪律：零 schema、不新增权限键、零新增 LLM 调用、不触碰出站（只收窄谁能看见与谁能批）、不新增队列 / cron。

## Out of scope

- 以岗位预览：VIS-1e。
- 执行器的批准权限规则（`canDecideTeamApproval`、各类型批准时的键校验）：不改。本次只保证「看不见的批不了」。
- 已知的执行器问题另立，不在本 change 修：
  - 创建人批不了自己的企业级草稿；
  - 多位持键人只存第一位为审批人；
  - 销售 / 订单的键校验在认领之后，失败会消耗审批卡。
- 审批卡的生成、通知与落点（`cockpit/waiting.ts` 落点表）。
- 工作区（Workspace）审批角色规则；新增权限键或岗位模板。
