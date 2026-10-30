# INSTALL-2j 报告 — 返修时间确认邮件（审批后发给客户）

change：`openspec/changes/install-2j-repair-visit-email/`（proposal / specs：新能力 `installation/repair-visit-email` 5 条 / design D1–D5 / tasks 6/6）
来源：Lucas 2026-10-29——"给客户发返修时间确认邮件（对外发送，要走审批）"。
零 schema：审批在既有 `PendingAction`，发送记 `AuditLog(install.repair_visit_email.sent)`。批准前零出站；发件身份只读组织设置。

## 1. 做了什么

| 场景 | 之前 | 现在 |
|---|---|---|
| 排好返修 | 客户只能靠电话 / 销售口头得知 | 排期成功后自动生成"返修时间确认邮件"审批（批准人 = 排期的人），排期接口响应带预览 |
| 批准 | — | 维修单详情"返修时间确认邮件"卡片：收件人、主题、邮件预览、「批准发送」；批准后以组织发件身份发给客户档案邮箱 |
| 改期 | 没有书面通知 | 每个返修时间一封：改期后为新时间生成新审批，主题改为 "Your repair visit has been rescheduled — …"；改期前生成的审批再批准时拒发 `SCHEDULE_CHANGED` |
| 缺资料 | — | 客户没有邮箱 / 缺报修电话 / 缺报修邮箱 → 不生成审批，卡片列出原因；补齐后点「生成确认邮件」 |
| 发送前校验 | — | 维修单未关闭（`REPAIR_CLOSED`）、预约与时间未变（`SCHEDULE_CHANGED`）、收件人仍是客户档案邮箱（`RECIPIENT_MISMATCH`）、组织发件身份（`NO_ORG_SENDER`，不回落个人邮箱）、同一时间只发一封（`ALREADY_SENT`） |
| 审批渠道 | — | 对外发送类：不能微信回数字确认，只能在网页看完预览后批准 |

邮件（英文）：客户名、维修单号、工艺单号、地址（工艺单优先）、企业时区的日期与到达时间段（如 "Wednesday, November 4, 2026"、"10:00 AM – 12:00 PM"）、各行位置 + 问题英文说明（如 "Den — Size adjustment / remake"）、"如时间不合适请致电 / 发邮件"的报修联系方式。不含金额、维修单备注、问题描述原文、照片、出单信息、员工姓名、中文问题标签。

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/install/repair-visit-email.ts`（新） | 问题类型英文说明、企业时区日期 / 时间格式化、`renderRepairVisitEmail`、`repairVisitEmailBlockers` |
| `src/lib/install/repair-visit-email-service.ts`（新） | 生成审批（幂等键按维修单 + 预约 + 开始时间）、当前返修时间的状态（复用 `deriveWarrantyStatus`） |
| `src/lib/pending-actions/exec-install-repair-visit-email.ts`（新） | 执行器：校验顺序、advisory lock、审计 |
| `src/lib/pending-actions/types.ts`、`executor.ts`、`src/lib/ai-grader/actions/wechat-confirm-policy.ts` | 登记动作类型 `install.send_repair_visit_email`（对外发送类） |
| `src/app/api/install/repairs/[id]/schedule/route.ts` | 排期成功后生成，响应带 `visitEmail`（生成失败不影响排期） |
| `src/app/api/install/repairs/[id]/route.ts` | 详情带 `visitEmail` |
| `src/app/api/install/repairs/[id]/visit-email/route.ts`（新） | 重新生成（`install.task.assign`；`NO_SCHEDULE` / `ALREADY_SENT`） |
| `src/components/install/repair-pages.tsx` | 详情"返修时间确认邮件"卡片 |
| `src/components/accounting/warranty-panel.tsx` | `WarrantyApprove` 加可选 `label` / `footer`（默认质保文案不变） |
| 测试 | 新增 `repair-visit-email.test.ts`（21）、`repair-visit-email-db.isolated.test.ts`（26）并注册；`wechat-confirm-policy.test.ts`（类型数 18 → 19、对外发送类加一项） |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/repair-visit-email.test.ts` | 21 passed（首次 / 改期主题、多伦多时区日期与时间段、跨 UTC 日期、英文问题说明、联系方式、HTML 同内容、同输入同输出、转义、不出内部信息、生成条件） |
| 隔离库 + 真实路由 `repair-visit-email-db.isolated.test.ts` | 26 passed（见 §3.1） |
| `wechat-confirm-policy.test.ts` / `muse-bridge-pure.test.ts` | 11 / 67 passed（新类型属对外发送类，Muse 不能直接批） |
| 回归 | `repair-dispatch-db` 54、`repair-close-db` 77 全过 |
| 浏览器走查（本地 `next dev` + Playwright，浏览器时区 America/Toronto） | 9/9（见 §3.2） |
| `npm run typecheck` | 0 error |
| 改动文件 eslint | 0 error |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS |
| `bash scripts/check-test-registry.sh` | OK（494 注册） |
| `openspec validate install-2j-repair-visit-email --strict` | valid |

### 3.1 隔离库端到端覆盖

- [1] 排期 200 + `visitEmail` pending_approval（预览收件人 = 客户档案邮箱、首次主题），审批人 = 运营主管，发送 0；详情是同一审批。
- [2] 未配置组织发件身份批准 → `NO_ORG_SENDER`，发送 0。
- [3] 配置后重新生成并批准 → 发送 1、审计（维修单 / 预约 / 时间 / 消息 id）、审批 executed、详情 sent；再生成 409 `ALREADY_SENT`；同一时间第二条审批 → `ALREADY_SENT`。
- [4] 改期 → 新审批、改期主题；再改期后批准上一条 → `SCHEDULE_CHANGED`；批准最新一条 → 发送（改期主题）。
- [5] 客户没有邮箱 → 排期 200 + blocked、无审批；出单·Vinyl 重新生成 403；补邮箱后运营主管重新生成 → pending。
- [6] 没有返修安排 → 409 `NO_SCHEDULE`；关闭不返修后批准待发审批 → `REPAIR_CLOSED`；已关闭的维修单详情不带 `visitEmail`。
- [7] 所有发出的邮件不含金额、问题描述原文、备注、员工名、照片地址；含英文问题说明与工艺单地址。

### 3.2 浏览器走查

| 检查 | 结果 |
|---|---|
| 未排返修时没有确认邮件卡片 | ✓ |
| 安排返修后卡片：收件人、首次主题、预览（10:00 AM – 12:00 PM、Den / Kitchen 英文说明、地址） | ✓（`01-scheduled-preview.png`） |
| 预览不含内部备注 / 问题描述 / 员工名 / 金额；底部说明为返修文案 | ✓ |
| 批准（未配置组织发件身份）→ 接口 400、页面红字 `NO_ORG_SENDER` | ✓（`02-approve-no-sender.png`） |
| 刷新后"发送失败"+「生成确认邮件」→ 点后出现新的待批准预览 | ✓（`03-regenerated.png`） |

### 3.3 全量 `npm test`

隔离库、`NODE_OPTIONS=--max-old-space-size=8192`：**504/513**（2i 时 502/511；+2 为本 change 新登记的 `repair-visit-email`、`repair-visit-email-db.isolated`）。9 个失败与 2a–2i 报告记录的同一批环境性失败完全一致、与本 change 无关（Mention Gateway M2-A、Sunny 工艺单 DB 端到端 `NO_BINDING`、Phase3A-3 / 3A-4 Governance / 3A-4 Acceptance / 3A-5、Autopilot A2-P0、T4 矩阵、报价 PDF 分页）。套件内类型检查与测试注册校验（494）通过；rebase 到含 CAL-3（#346）的 main 后重跑 typecheck、lint:baseline、test:ci、注册校验（496）与安装 / 审批相关测试，全部通过；INSTALL-1 / 2a–2j 全部安装测试 0 失败（`repair-visit-email` 21、`repair-visit-email-db.isolated` 26、`repair-dispatch-db` 54、`repair-close-db` 77）。

## 4. 判断点

1. **一个返修时间一封**（D1）：改期不作废旧审批，而由执行器校验"预约与开始时间未变"拒发；不需要改写别的审批状态。
2. **复用质保邮件的预览批准组件与状态推导**（D5）：只加可选文案参数，质保邮件行为不变。
3. **不抄送、不发站内通知**（Out of scope）：质保邮件的抄送设置不用于本邮件；失败原因直接显示在详情卡片与审批记录上。

## 5. 上线后 / 已知限制

- 组织发件人未配置时所有对外邮件都发不出（`NO_ORG_SENDER`），老板需在 设置 → 邮件 → 组织发件人 配置。
- 已经排好的返修不会补发；需要时在维修单详情点「生成确认邮件」。
- 不做中文邮件、短信 / 微信、客户在线确认或改约、首装预约确认邮件。
