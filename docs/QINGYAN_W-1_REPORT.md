# W-1 报告：项目页「问供应商要价」——询价 Web 入口

| 项 | 值 |
|---|---|
| TASKFLOW | W-1（新增 Phase W「先把已建好的用起来」） |
| OpenSpec change | `openspec/changes/rfq-web-entry/`（能力 `tender/rfq-web-entry`） |
| 任务书 | `docs/QINGYAN_W-1_RFQ_WEB_ENTRY_TASKBRIEF.md`（Evan 2026-11-06 拍板：保留 `MUSE_BRIDGE_ENABLED` 旁路；旧单封直发直接下线） |
| 分支 | `claude/w1-rfq-web-entry`（基于 main `6c5a08b6`） |
| 状态 | `[G]` 等审：代码、纯测试与门禁完成；staging 手工验收（GATE-W）待 Evan |

## 1. 用户现在会怎么用

1. 打开投标项目 →「标书与报价」→「供应商询价」。主按钮 **问供应商要价**，旁边一行实时说明：
   - 能发：「将从 project@sunnyshutter.ca 发出 · 已确认要求 12 条 · 回复截止 11-13」；
   - 不能发：按钮灰掉，说明为什么并给出路——待批发送卡（去批准，页内跳到那一轮）/ 轮次锁（查看第 N 轮）/ 没有已确认要求或要求里有内部内容（去「需求」）/ 授权邮箱未连接或缺发信权限（去邮箱设置）/ 没有可发的供应商（去补供应商）；
   - 授权邮箱缺读信权限：不挡发送，提醒「回信不会自动进表」。
2. 点按钮 → 右侧抽屉一屏三块：**问哪几家**（常用供应商默认勾选并标「常用」，没邮箱 / 停用的灰显带「补邮箱」链接，最多 8 家）、**条款**（贸易条款默认你的偏好、目的地、补充说明、最多 5 条附加问题）、**会发出什么**（发件抬头、回复截止、包含几条已确认要求、几条不会发出）。
3. **生成并送审** → 结果页：第 N 轮已生成、实际贸易条款、每家收件人可展开看正文；有权批的人原地 **批准并发送 / 驳回**，没权的人看到「需要组织管理员批准」+ 审批中心链接（不声称已通知任何人）。
4. 批准在请求内同步执行；抽屉关闭，结果（「已发出 3/3：…」或失败原因）留在该轮卡片上直到手动关掉。卡片显示「已发出 3 家 · 已报价 1 · 等回复 2（截止 11-13）」「从发起到发出：4 分 12 秒」，以及「回信每 10 分钟自动检查并进表；3 天没回会自动起草催单给你批」。
5. 待批的轮次默认展开、显示同一审批面板；批准前不显示「标记发送」「开始询价」「添加供应商」。驳回后该草稿轮标为已取消。

## 2. 改了什么

**服务层**
- `src/lib/tender-rfq/service.ts`：`PrepareRfqInput.source: "web" | "muse"`（写入审批卡 `source.toolName`：`tender_send_rfq_web` / `tender_send_rfq`）；轮次锁与要求加载抽成 `loadRfqRoundLockState` / `loadRfqRequirementInputs` 供入口预判复用；轮次标题用默认「第 N 轮询价」（原硬编码 `第 N 轮询价（Muse）` 未插值）；`source=web` 时贸易条款按显式选择（不回退偏好）；审批卡没建成时取消刚建的草稿轮。
- `src/lib/muse-bridge/router.ts`：`handleRfq` 传 `source: "muse"`（唯一一行改动）。
- 新增 `src/lib/tender-rfq/web-entry-pure.ts`（纯函数，前后端共用）、`web-entry.ts`（只读组装入口响应）、`web-entry-approval.ts`（按项目所属企业取审批中心同一 `canApprove`，读审批卡里每家正文）。

**API**
- `GET /api/projects/[id]/tender-rfq/entry`（项目读权限）：零副作用。
- `POST /api/projects/[id]/tender-rfq/rounds`（项目写权限 + zod）：自由文本先判敏感词 → `prepareRfqRound(source=web)` → 一张 `tender.send_rfq`；写 AuditLog（`source: "web"`）；失败返回 `userMessage`（人话 + 出路）。
- `…/items/[itemId]/email/send`、`…/email/generate`：鉴权后返回 410「单封直发已下线，请用项目页『问供应商要价』」，不发信、不调 LLM、不写数据。

**界面**
- 新增 `rfq-web-entry-drawer.tsx`、`rfq-approval-panel.tsx`、`rfq-round-status-line.tsx`、`rfq-web-entry-types.ts`；改 `project-inquiry-section.tsx`、`inquiry-detail.tsx`、`dashboard-ai-suggestions.tsx`（「批量催促」→「去询价轮次处理」跳 bid tab）。
- 删除 `email-draft-dialog.tsx`、`batch-followup-dialog.tsx`（后者的发送步骤就是调 `email/send`，且未传 `emailId`，现状已 400）。

## 3. 测试与门禁（实际运行，Node 24.22.2）

| 检查 | 结果 |
|---|---|
| `npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts`（新增） | 80 passed |
| tender-rfq 其余纯测试 build / round-pure / inbound-parse / inbound-apply / landed-cost / compare / interpretation-guard / notes-parse / chase-pure / chase-execute | 21 / 31 / 38 / 54 / 70 / 47 / 29 / 17 / 55 / 23 passed |
| muse-bridge muse-bridge-pure / advisory / next-step / prefs | 67 / 70 / 59 / 30 passed |
| `bash scripts/check-test-registry.sh` | OK，已注册 541 |
| `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` | exit 0 |
| `npm run lint:baseline` | PASS（errors 38 ≤ 基线 53，无新增 fingerprint）；改动文件单独 `eslint` 0 问题 |
| `bash scripts/test-runtime-architecture.sh` | PASS（无新增架构面） |
| `npm run test:ci`（`scripts/test-ci-unit.sh` 全量） | CI unit subset PASS，exit 0（§3.1） |
| `openspec validate rfq-web-entry --strict` | valid |

新测试注册进 `scripts/test-all.sh`（紧跟催单执行器测试）与 `scripts/test-ci-unit.sh`。

### 3.1 test:ci

`NODE_OPTIONS=--max-old-space-size=4096 bash scripts/test-ci-unit.sh`（`set -euo pipefail`，任一失败即退出）：末尾 `runtime-architecture guards PASS`、`OK 测试注册校验通过：已注册 541 个`、`CI unit subset PASS`，退出码 0；其中 `W-1 web-entry-pure: 80 passed`。

### 3.2 独立审查

另起一个审查 agent，只给任务书、OpenSpec 四件套与 diff（不给实现思路）。结论 0 阻断 / 6 应修 / 若干建议；6 条应修全部修正，建议修了 6 条，详见 `design.md` D9–D13：「不指定」贸易条款被个人默认覆盖、原地审批后状态与结果丢失、自由文本敏感词提示指错地方、入口与送审的供应商就绪规则不一致（末尾空格）、super_admin / 多组织拿不到原地批准、APPROVED / EXPIRED 卡文案错误；入口加载失败时待批保护失效、审批人文案不准、无可发供应商仍可点、孤儿草稿轮、AuditLog 无来源、Gmail 英文错误直出。

## 4. 与任务书的偏差

| 任务书 | 实际 | 原因 |
|---|---|---|
| 批准后前端轮询最长 60 秒 | 不轮询 | approve 在请求内同步执行到 `execTenderSendRfq`，响应已带发送结果 |
| 没权批的人看到「已通知 X」 | 「需要组织管理员批准」+ 审批中心链接 | Web 端建卡不发任何通知（只有 Muse 钩子），通知归 T-1 |
| （未提） | 待批轮次隐藏「标记发送」「开始询价」「添加供应商」 | 手工标记后执行器把该家当「此前已发」跳过 → 供应商静默收不到 |
| 只下线两条路由与「邮件」按钮 | 另删批量催促对话框，首页建议改为跳 bid tab | 它的发送就是调已下线的 `email/send` |
| 轮次来源写进标题 | 只写审批卡 `source.toolName` + AuditLog | 原标题是未插值模板，界面显示字面「N」 |

## 5. 已知局限与遗留

- **验收第 9 步需要拍板**：Web 建的审批卡没有指定审批人，按审批中心现有规则（`canDecidePending`）创建人本人可以批准自己发起的对外询价，所以 org_member 也会看到「批准并发送」。与 Muse 路径一致；若要「对外邮件不能自批」需另开 change。
- 供应商列表只取前 100 家（按更新时间），搜索只在这 100 家里过滤；组织供应商超过 100 家时需要服务端搜索。
- 往已发出的轮次追加供应商仍不支持（`rfq-add-supplier-to-round`）。
- 审批卡创建时不通知审批人（T-1）；跨项目「谁没回」追踪页与 `contacted` 状态过滤错误（T-2）。
- 本地沙箱没有数据库与 Prisma 引擎（`binaries.prisma.sh` 被代理拦截，只生成了类型），DB 相关路径由类型检查与纯测试覆盖，端到端以 staging 手工验收为准。

## 6. 上线与 GATE-W（Evan，staging）

无迁移、无新开关、无新 env、无新 cron。前置同 GATE-1：授权邮箱 lucas@ 已连接 Gmail（compose + readonly）、project@ 设为「以此地址发送」、`tender-rfq-settings` 已配；staging 打开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD=1` 与 `QINGYAN_ALLOW_CRON_NON_PROD=1`，用自己的测试供应商邮箱。手工步骤见任务书 §6 第 4–12 步。回滚 = 还原本 PR。
