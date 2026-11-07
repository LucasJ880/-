# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_W-1_REPORT.md`。

## 1. 纯函数

- [x] 1.1 先写 `src/lib/tender-rfq/__tests__/web-entry-pure.test.ts`（入口状态：七种不可发原因的优先级、可发态说明文字、只缺读信权限的提醒；七个 `prepareRfqRound` 错误码 → 中文说明 + 出路；轮次状态行；耗时标签 < 1 分钟 / 分秒 / ≥ 1 小时；预览白名单不含敏感字段），再写 `src/lib/tender-rfq/web-entry-pure.ts`；注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：该测试全过，`bash scripts/check-test-registry.sh` 通过

## 2. 服务层

- [x] 2.1 `service.ts`：`PrepareRfqInput.source` 必填并写入审批卡 `source.toolName`；轮次标题用默认值；抽出 `loadRfqRoundLockState` / `loadRfqRequirementInputs` 两个加载器供 prepare 与 entry 共用；`muse-bridge/router.ts handleRfq` 传 `source: "muse"`；新增 `web-entry.ts loadRfqWebEntry`（只读，组装 entry 响应）；verify：`npm run typecheck` 通过，`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` 与 tender-rfq 全部已注册测试仍全过

## 3. API

- [x] 3.1 新增 `GET /api/projects/[id]/tender-rfq/entry`（项目读权限）与 `POST /api/projects/[id]/tender-rfq/rounds`（项目写权限 + zod），审批能力经 `getCapabilityApproval` 取；verify：`npm run typecheck` 通过；路由文件里没有直接创建 PendingAction 或调用发信函数（`grep -n "sendGmail\|createDraft\|pendingAction.create" src/app/api/projects/\[id\]/tender-rfq -r` 为空）

## 4. 界面

- [x] 4.1 `rfq-web-entry-drawer.tsx`（三块表单 → 结果页）、`rfq-approval-panel.tsx`（批准并发送 / 驳回 / 无权提示）、`rfq-round-status-line.tsx`（状态行 + 自动进表说明 + 耗时）；`project-inquiry-section.tsx` 主按钮「问供应商要价」+ 实时说明、「手工建一轮」降级、待批轮次显示审批面板；`inquiry-detail.tsx` 待批轮次隐藏「标记发送」「开始询价」；verify：`npm run typecheck` 与 `npm run lint:baseline` 通过

## 5. 下线旧直发

- [x] 5.1 `email/send`、`email/generate` 返回 410；删除 `email-draft-dialog.tsx` 与 `batch-followup-dialog.tsx`，`inquiry-detail.tsx` 去掉「生成邮件」，`dashboard-ai-suggestions.tsx` 的「批量催促供应商」改为跳到 `/projects/{id}?tab=bid`；verify：`grep -rn "EmailDraftDialog\|BatchFollowupDialog\|/email/send" src` 只剩路由文件自身，typecheck 通过

## 6. 门禁

- [x] 6.1 `bash scripts/check-test-registry.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate rfq-web-entry --strict`、tender-rfq + muse-bridge 已注册测试；另起独立审查（只给任务书与 diff）并处理结论；verify：全部通过，真实输出写进报告

## 7. 收尾

- [x] 7.1 写 `docs/QINGYAN_W-1_REPORT.md` + TASKFLOW 新增 Phase W 表（W-1 状态 `[G]`，W-2 / W-3 `[ ]`）与 GATE-1 Web 版验收行；verify：报告存在，`grep -n 'W-1' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive rfq-web-entry --yes`（独立小 PR）。
