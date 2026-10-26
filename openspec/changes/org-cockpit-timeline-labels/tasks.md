# Tasks

## 1. 标签与来源（纯函数）

- [ ] 1.1 新建 `src/lib/cockpit/audit-labels.ts`：动作标签表、目标类型标签表、摘要（含回退）、来源判定、商机阶段变更白名单解析（只接受枚举值）与摘要。
  - 新建 `src/lib/cockpit/__tests__/audit-labels.test.ts`，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：测试退出 0，覆盖 spec「审计条目的中文摘要」「商机阶段变更显示前后阶段」「条目来源」「审计只读白名单字段」全部 scenario。

## 2. 接入时间线、读模型与界面

- [ ] 2.1 接入：
  - `timeline.ts`：`TimelineEntry.source`；`auditEntry` 用新摘要与来源（AI 运行事件 `ai`、自动化运行 `system`）；
  - `posts-read-model.ts`：本页商机阶段变更审计的白名单字段额外查询（限定组织与本页 id，没有则不查）；
  - `presentation.ts` 来源感知的操作者标签，`org-cockpit-view.tsx` 操作者列改用它。
  - 既有 `timeline.test.ts`、`posts-read-model.test.ts`、`presentation.test.ts` 补断言。
  - verify：上述三个测试与 `audit-labels.test.ts` 退出 0，覆盖 spec「统一信封」「时间线显示来源」scenario；`npm run typecheck` 退出 0。

## 3. 门禁与交付

- [ ] 3.1 跑全部门禁并做独立交叉审查：
  - 门禁：`npm test` 与基线比较新增失败为 0；`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline` 通过；`bash scripts/check-test-registry.sh` 无新增未注册；`openspec validate org-cockpit-timeline-labels --strict` 通过；`git diff --stat` 无 `prisma/`、`vercel.json`。
  - 交叉审查：独立审查代理审查实现，处理其阻塞与应修项。
  - verify：上述命令输出与审查结论写进报告。
- [ ] 3.2 写 `docs/QINGYAN_ORG_COCKPIT_A-2b_REPORT.md`，同步 `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`。
  - verify：两个文件已提交，报告包含门禁结果、staging 验证步骤与 GATE 待确认项。

## Workflow follow-up

- 归档：新增能力 `cockpit/company-log-labels`，并修改 A-2 的 `cockpit/company-log`；A-2 归档后再归档本 change，独立小 PR。
- staging：见 design「验证方式」最后一行。
