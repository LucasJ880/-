# Design：项目页「问供应商要价」（W-1）

## Context

- 询价引擎已完整：`tender-rfq/service.ts prepareRfqRound`（轮次锁 → 供应商 → 已确认要求 + 关键事实 → `build.ts buildRfqDocument` → 建 `ProjectInquiry(draft)` + 询价项 → `requestApproval` 建 `tender.send_rfq`）→ 审批中心 approve → `pending-actions/executor.ts` 同步调用 `execute.ts execTenderSendRfq`（按组织 `mailboxEmail` 查 Gmail 授权，从 `fromEmail` 发出，写 threadId，轮次 → in_progress）→ cron `tender-rfq-inbound` 读回信入表并做催单扫描。
- 唯一调用方是 `muse-bridge/router.ts handleRfq`；Muse Connector 冻结后 Web 无入口。
- 旧路径 `items/[itemId]/email/send` 直发、无审批、无 threadId；`batch-followup-dialog.tsx` 的发送步骤也走它（且没传 `emailId`，本来就会 400）。
- 审批中心对 PendingAction 的可决策判定在 `capabilities/approvals/query.ts canDecidePending`，经 `getCapabilityApproval(access, "PENDING_ACTION:<id>")` 暴露为 `capabilities.canApprove`；approve 在请求内同步执行，响应 `message` 即执行器的「已发出 N/N：…」。
- 创建审批卡只在 Muse 开启时发 `approval.requested`，Web 端没有任何通知（T-1 的范围）。

## Goals / Non-Goals

- Goals：在项目页一屏发起询价；所有能前置判断的失败原因在点按钮之前就告诉用户并给出路；创建人原地批准；发出后一眼看到发了谁、在等谁、什么时候会自动催。
- Non-Goals：
  - 不改 `src/lib/tender-rfq/execute.ts`、`chase-pure.ts`、`chase-service.ts`、`chase-execute.ts`、`inbound-*.ts`、`build.ts`。
  - 不改 `src/lib/capabilities/approvals/*` 与 `src/app/(main)/capabilities/approvals/*`。
  - 不改 `src/lib/muse-bridge/*` 除 `router.ts handleRfq` 传 `source` 的一行。
  - 不动 `POST /api/projects/[id]/inquiries/batch-followup`、`src/lib/proactive/scanner.ts`（`contacted` 过滤问题归 T-2）。
  - 不加审批卡创建通知（T-1）。

## Decisions

### D1 入口直接复用 `prepareRfqRound`，加 `source`
Web 与 Muse 走同一个函数，保证轮次锁、只发已确认要求、敏感内容整单拦截完全一致。`source` 只影响审批卡 `source.toolName`（`tender_send_rfq_web` / `tender_send_rfq`），供审计区分。轮次标题改用 `createInquiry` 默认的「第 N 轮询价」——原代码是未插值的模板字符串「第 N 轮询价（Muse）」，界面上会出现字面的「N」。
否决：Web 另写一个生成器——两套规则必然漂移，违背「一个事实源」。

### D2 entry 的预判与 `prepareRfqRound` 共用加载器
把 `prepareRfqRound` 里「读轮次 + 待批发送卡 → `decideRoundLock`」与「读最新分析运行的要求 + 关键事实」抽成 `service.ts` 内两个导出的加载函数，entry 与 prepare 都调用；entry 再用 `buildRfqDocument` 做一次内存预构建（纯函数，不落库）拿到将包含 / 不会发出的条数与 `NO_CONFIRMED_REQUIREMENTS` / `SENSITIVE_LEAK`。发件授权用执行器同一个 `resolveSender` + `hasGmailComposeScope`，读信用 `hasGmailReadScope`。
否决：entry 调 `prepareRfqRound` 再回滚——会产生轮次与审批卡副作用；否决：entry 自己复制查询——判定与真正送审不一致时用户会「按钮可点，点了失败」。

### D3 审批能力取审批中心同一判定
rounds / entry 在服务端调用 `requireCapabilitiesAccess` + `getCapabilityApproval`，把 `capabilities.canApprove` 与 `payloadHash` 返回给前端；前端批准 / 驳回直接调既有 `/api/capabilities/approvals/{id}/approve|reject`。若用户不在审批中心可访问范围（无企业成员身份等），`canApprove` 记为 false，界面给审批中心链接。
否决：在 tender-rfq 下新增 approve 路由——会绕过审批中心的幂等、完整性校验与执行前重新授权。

### D4 不轮询：批准是同步执行
`approveApprovalItem` 在请求内调用执行器，响应已带发送结果；前端拿到响应后刷新轮次列表即可。任务书 §2.3 的「批准后轮询最长 60 秒」不需要，删去（记入报告「偏差」）。
否决：保留轮询——无收益，多一类前端状态。

### D5 不声称「已通知」
审批卡创建时 Web 端没有通知；`canApprove` 为 false 时文案改为「需要有审批权限的同事批准 → 去审批中心」。实际中 Web 创建的卡没有指定审批人，创建人本人即可批准（`canDecidePending` 规则），这一分支很少出现。
否决：本 change 顺手加通知——属 T-1，且需要先定收件人规则。

### D6 待批轮次隐藏手工「标记发送」「开始询价」
引擎建的轮次在批准前是 `draft` + 询价项 `pending`，原明细会对它显示「标记发送」与「开始询价」。手工标记后执行器会把该家当作「此前已发」跳过——供应商永远收不到邮件。故该轮有待批发送卡时隐藏这两个按钮，改显示审批面板。
否决：只加提示文字——提示挡不住误点，后果是静默漏发。

### D7 下线旧直发，同时处理它的唯一批量调用方
两条路由改为返回 410（保留文件，避免 404 被误认为网络问题）；删除 `EmailDraftDialog` 与 `BatchFollowupDialog`；首页 AI 建议「批量催促供应商」改为跳到该项目「标书与报价」tab。`getEmailDraftPrompt` 保留（agent 起草工具在用，不出站）。
否决：保留批量催促的发送步骤——它调用的就是被下线的接口，留着只会 410；否决：删除路由文件——旧客户端会得到 404。

### D8 纯函数集中在 `web-entry-pure.ts`
入口状态、错误码文案、按钮说明、状态行、耗时标签都是纯函数 + 真值表测试；页面和路由只拼装。零 LLM。

## 与八条硬纪律

| 纪律 | 关系 |
|---|---|
| 1 零 schema | 触碰（读）：不加 model / 字段 / migration；来源写进既有 `PendingAction.source`（JSON）；耗时用既有 `createdAt` / `executedAt` |
| 2 出站先审批 | 触碰：Web 入口只建 `tender.send_rfq`；批准走审批中心既有接口；下线绕过审批的 `email/send` |
| 3 禁止第三套队列 | 不涉及：无 cron / queue / worker；前端也不轮询 |
| 4 脱敏 | 触碰：预览按白名单组装，不含毛利 / 估值 / 我方报价；询价正文沿用生成器的敏感内容整单拦截；Muse 侧决定 A 不变 |
| 5 不爬登录页 | 不涉及 |
| 6 邮箱分离 | 触碰（读）：展示 `fromEmail`，授权检查按组织设置 `mailboxEmail`，与执行器同一函数；不从请求体取任何邮箱 |
| 7 确定性优先 | 触碰：全部判定查表；零新增 LLM 调用；下线的 `email/generate` 反而少一处 LLM |
| 8 测试注册 | 触碰：`web-entry-pure.test.ts` 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` |

## 验证方式

- `npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts`（入口状态六因 + 可发 + 只缺读信、七个错误码、状态行、耗时边界、预览白名单）。
- 回归：tender-rfq 与 muse-bridge 已注册测试全过（基线 21/21）。
- `bash scripts/check-test-registry.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate rfq-web-entry --strict`。
- staging 手工 12 步见任务书 §6（GATE-W，Evan）。

## Risks / Trade-offs

- `getCapabilityApproval` 依赖 tenant 上下文（当前组织）；用户在 A 组织页面看 B 组织项目时 `canApprove` 为 false——只影响是否原地批，审批中心仍可处理。
- entry 每次打开 bid tab 会读一次 Gmail 授权与要求表；数据量小（单项目），可接受。

## Migration Plan

无数据迁移。回滚 = 还原本 PR；旧 `email/send` 恢复需同时还原 `inquiry-detail.tsx` 与两个对话框。
