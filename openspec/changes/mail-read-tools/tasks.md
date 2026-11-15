# Tasks

开工前先跑将要触碰模块的已注册测试并记下基线通过数：`tool-list-modules`、`pre-execute-guard`、`phase1-1-context-propagation`、`run-hooks`、`google-email-oauth`、`intent-router`、`tool-descriptor`、`m2c-tool-policy`。待拍板 A 对应 5.1 里「回复落库前省略原文、不抽取洞察」两项，待拍板 B 对应 4.1 里「写入封锁」一项；拍板结果与推荐不同时先改 specs 再动这两条。

## 1. 读接口、纯函数与开关

- [x] 1.1 扩 `src/lib/google-email.ts`（`GmailReadApi` 补 `messages.list` 与 `threads.get` 的完整邮件返回类型；新增邮箱搜索与线程读取两个函数，入口校验读信权限，不调用附件下载接口，不改 `EMAIL_SCOPES` 与既有函数）；新增 `src/lib/mail-read/` 纯函数（查询拼装、单封 6,000 / 整线程 20,000 字截断、错误码映射、回复原文省略）；在 `src/lib/env/runtime-isolation.ts` 加读信开关解析；新增并在 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 注册 `src/lib/mail-read/__tests__/mail-read-pure.test.ts`。verify：`npx tsx src/lib/mail-read/__tests__/mail-read-pure.test.ts` 与 `npx tsx src/lib/__tests__/google-email-oauth.test.ts` 通过；`git grep -nE "gmail\.modify|mail\.google\.com" -- src` 结果与 main 相同

## 2. 入口门与可见性

- [x] 2.1 `ToolEntryGate` 加 `mail`、`ToolExecutionContext` 加只读 `entryGate`（`types.ts`）；入口门加载函数支持声明「网页助手入口」并据开关与 `/settings/email` 放行判定算出 `mail`（`entry-gate.ts`、`entry-gate-server.ts`）；`registry.list` 在 `mail !== true` 时剔除 `mail_*`（`tool-registry.ts`）；引擎把入口门带进执行上下文（`engine.ts` 的 `buildToolContextBase`）；`toolRequiredModules` 加 `mail_` 前缀 → `sales` / `bids` / `trade`（`tool-auth.ts`）；新增并注册 `src/lib/agent-core/__tests__/mail-tool-visibility.test.ts`（先用两个占位工具定义跑通列表侧表格，3.1 接上真实工具后补执行侧）；`tool-list-modules.test.ts` 里「入口传入入口门」的源码正则按新签名更新。verify：`npx tsx src/lib/agent-core/__tests__/mail-tool-visibility.test.ts` 与 `npx tsx src/lib/agent-core/__tests__/tool-list-modules.test.ts` 通过，后者通过数不低于基线

## 3. 两个读信工具

- [x] 3.1 新增 `src/lib/agent-core/tools/mail.ts`（工厂函数 + 可注入依赖；`mail_search`、`mail_read_thread`；执行顺序：入口判定 → 参数 → 授权状态 → 客户解析与可见性 → 读 Gmail → 写审计 → 返回；成功返回带 `untrusted: true`、`source: "gmail"`；错误码放在返回数据里）；`tools/index.ts` 引入、`tools/_policy.ts` 登记两条（`l0_read`、`allowRoles: "*"`）、`streaming.ts` 补「搜索邮箱」「读取邮件」；新增并注册 `src/lib/agent-core/tools/__tests__/mail-tools.test.ts`；补全 `mail-tool-visibility.test.ts` 的执行侧。verify：`npx tsx src/lib/agent-core/tools/__tests__/mail-tools.test.ts`、`npx tsx src/lib/agent-core/__tests__/mail-tool-visibility.test.ts`、`npx tsx src/lib/runtime-architecture/__tests__/tool-descriptor.test.ts`、`npx tsx src/lib/mention-gateway/__tests__/m2c-tool-policy.test.ts` 通过；启动时没有「tools have no policy」告警提到 `mail_`

## 4. 不可信内容

- [ ] 4.1 `buildOperatorSystemPrompt` 加可选入参，读信可用时追加固定规则一节、不可用时输出与现在逐字相同（`prompts/operator-system.ts`）；引擎的流式与非流式两条运行路径加「读信工具成功返回后，本轮拒绝非只读工具，返回 `UNTRUSTED_CONTENT_WRITE_BLOCKED`」（`engine.ts`，不改 `approval-gate.ts`、`pre-execute-guard.ts`）；新增并注册 `src/lib/agent-core/__tests__/mail-untrusted-guard.test.ts`（固定提示、写入封锁三个场景、中高风险工具清单与平台默认强制审批清单冻结）。verify：`npx tsx src/lib/agent-core/__tests__/mail-untrusted-guard.test.ts`、`npx tsx src/lib/agent-core/__tests__/pre-execute-guard.test.ts`、`npx tsx src/lib/agent-core/__tests__/phase1-1-context-propagation.test.ts`、`npx tsx src/lib/agent-core/__tests__/run-hooks.test.ts` 通过；`git diff --stat main -- src/lib/agent-core/approval-gate.ts src/lib/agent-core/pre-execute-guard.ts` 为空

## 5. 网页助手接线

- [ ] 5.1 `src/app/api/ai/threads/[threadId]/messages/route.ts`：以网页助手入口取入口门（开关关时不取）；`mail === true` 且消息提到邮件 / 邮箱等词时走 Operator 分支并带工具；把 `mail` 传给系统提示；本轮调用过读信工具时，`AiMessage` 存省略原文后的文本、且不调用项目洞察抽取；流给浏览器的内容与工具事件不变。扩 `mail-untrusted-guard.test.ts`（路由判定纯函数三个场景 + 消息接口源码断言）。verify：`npx tsx src/lib/agent-core/__tests__/mail-untrusted-guard.test.ts` 与 `npx tsx src/lib/assistant/__tests__/intent-router.test.ts` 通过；`npm run typecheck` 通过

## 6. 读信权限状态

- [ ] 6.1 `GET /api/sales/email-status` 的响应改由纯函数生成（开关关时逐字段不变；开时 `gmail.hasReadScope` 与顶层 `mailRead: { enabled: true }`）；`src/app/(main)/settings/email/page.tsx` 在 `mailRead.enabled` 时显示「读信权限」三种状态与「重新授权」。扩 `mail-read-pure.test.ts`（状态响应两种开关 × 三种授权、页面源码断言）。verify：`npx tsx src/lib/mail-read/__tests__/mail-read-pure.test.ts` 通过；本地起应用、开开关，截「读信权限未开启 + 重新授权」与「只绑 SMTP」两张图存 `docs/acceptance/mail-1/`

## 7. 验证与报告

- [ ] 7.1 全量验证。verify：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate mail-read-tools --strict` 全部通过；`git diff --stat main -- vercel.json prisma/` 为空；`git grep -n "mailboxEmail" -- src/lib/mail-read src/lib/agent-core/tools/mail.ts` 无结果
- [ ] 7.2 写 `docs/QINGYAN_MAIL-1_REPORT.md`（核对结果、两处拍板的最终取值、与任务书对不上的地方、测试通过数与基线对比、`snippet` 的实测结论、未做的 staging 验收项与运维前置）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 MAIL-1 状态列。verify：报告文件存在且各节齐全；TASKFLOW 的 MAIL-1 行状态为 `[G]`

## Workflow follow-up

- 开 PR（一个 change = 一个 PR），PR 描述写明两处拍板的取值；合并时 `MAIL_READ_ENABLED` 不设。
- 合并后在 staging 开 `MAIL_READ_ENABLED`，用一个测试邮箱跑任务书「验收」里 Lynn、缺权限成员、老板三组，再决定生产开启。
- PR 合并后 `/opsx:archive mail-read-tools --yes`（独立小 PR），同步把 TASKFLOW 的 MAIL-1 改成 `[x]（#PR 号）`，并确认 `openspec list --specs` 列出 `mail/assistant-read`。
