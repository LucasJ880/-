# Tasks

## 1. 规则化抽取（纯函数）

- [x] 1.1 新建 `src/lib/revenue-spine/fact-extract.ts`，包含：
  - 截引用；
  - 价格句过滤；
  - 六个字段的抽取规则与规范键；
  - 买家域名 / 联系方式排除。
  - 同时在 `src/lib/revenue-spine/fde/draft-diff.ts` 导出新增行。
  - 新建 `src/lib/revenue-spine/__tests__/fact-extract.test.ts`（≥ 20 例表驱动），同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：测试退出 0，覆盖 spec「规则化抽取商务事实」「价格条款永不抽取」全部 scenario；`draft-diff.test.ts` 仍全过。

## 2. 起卡、审批类型与执行器

- [ ] 2.1 新建 `src/lib/revenue-spine/fact-proposals.ts`，包含：
  - 起卡判定纯函数与依赖可注入的起卡器；
  - 卡片内容与脱敏；
  - 执行器合并函数与角色判定。
  - 接入 `pending-actions/types.ts`（新类型与载荷）、`executor.ts`（认领前角色门 + 执行分支）、`wechat-confirm-policy.ts`（`web_only_review`）、`cockpit/posts.ts`（岗位认领）。
  - 新建 `src/lib/revenue-spine/__tests__/fact-proposals.test.ts` 并注册。
  - verify：测试退出 0，覆盖 spec「起卡规则与限流」「审批卡内容」「只有企业负责人或管理员能批准」「批准后写入并被草稿引用」全部 scenario；A-1 / A-2 岗位测试与微信确认测试仍全过；`npm run typecheck` 退出 0。

## 3. 人工回复作废的反馈事件与接入

- [ ] 3.1 B-1 记录器与接入：
  - `fde/draft-feedback.ts`：人工回复终态、读外发正文、userId、补漏条件、记录后触发起卡；
  - `trade/outbound-sync.ts`：作废成功后尽力而为地记录。
  - `draft-feedback.test.ts` 补对应断言（含外发同步接入点的静态断言）。
  - verify：`draft-feedback.test.ts` 退出 0，覆盖修改后 spec「终态自动产生反馈事件」「同一审批同一终态只产一条事件」「接入点覆盖全部审批入口并有补漏」全部 scenario；既有 trade outbound 相关测试仍全过。

## 4. 门禁与交付

- [ ] 4.1 跑全部门禁并做独立交叉审查：
  - 门禁：`npm test` 与基线比较新增失败为 0；`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline` 通过；`bash scripts/check-test-registry.sh` 无新增未注册；`openspec validate fde-fact-proposals --strict` 通过；`git diff --stat` 无 `prisma/`、`vercel.json`。
  - 交叉审查：独立审查代理审查实现，处理其阻塞与应修项。
  - verify：上述命令输出与审查结论写进报告。
- [ ] 4.2 写 `docs/QINGYAN_ORG_COCKPIT_B-2_REPORT.md`，并把 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` B-2 状态列改为 `[G]`，同步 `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`。
  - verify：三个文件已提交，报告包含门禁结果与 GATE 待确认项。

## Workflow follow-up

- 归档顺序：先 `/opsx:archive fde-feedback-loop --yes`，再 `/opsx:archive fde-fact-proposals --yes`（本 change 修改 B-1 新增的能力）。各自独立小 PR，并同步状态列。
- staging：在外贸收件箱人工回复一封带 MOQ 的询盘（该询盘有待审批 FDE 草稿），确认产生改稿事件与 `moq` 审批卡；boss 批准后下一封同类询盘的草稿引用该 MOQ。
