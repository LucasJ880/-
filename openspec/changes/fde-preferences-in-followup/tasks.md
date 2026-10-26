# Tasks

## 1. 金样本与共用函数

- [x] 1.1 先锁定现状，再抽共用函数：
  - 先提交 `src/lib/revenue-spine/__tests__/fixtures/followup-golden-cases.ts` 与用**未改动代码**生成的 `followup-golden-pre-c2.json`（单独提交）；
  - 在 `reply-draft.ts` 抽出 `applyBannedPhrasesSafely`，`buildReplyDraft` 改为调用它。
  - verify：`draft-preferences.test.ts` 45 条全过（含首封金样本）；`scoring-draft.test.ts`、`tricky-inquiries.test.ts` 全过。

## 2. 跟进模板与起草接入

- [x] 2.1 跟进模板与起草接入：
  - `fde/no-reply-followup.ts`：`NoReplyFollowUpInput.preferences`；问候 / 结束语 / 敬语 / 禁用词（共用函数）；
  - `draftNoReplyFollowUps`：组织级解析偏好、违规审计、追问与草稿（含中文对照）传入偏好、`bannedPhrasesSkipped` 审计。
  - 新建 `src/lib/revenue-spine/__tests__/followup-preferences.test.ts`，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：测试退出 0，覆盖 spec 全部 scenario，跟进金样本三种情况比对通过；`no-reply-followup.test.ts` 全过；`draft-preferences.test.ts` 45 条全过（其"不碰的模块"断言改为跟进只经 `resolveDraftPreferences` 读偏好）；`npm run typecheck` 退出 0。

## 3. 门禁与交付

- [ ] 3.1 跑全部门禁并做独立交叉审查：
  - 门禁：`npm test` 与基线比较新增失败为 0；`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline` 通过；`bash scripts/check-test-registry.sh` 无新增未注册；`openspec validate fde-preferences-in-followup --strict` 通过；`git diff --stat` 无 `prisma/`、`vercel.json`。
  - 交叉审查：独立审查代理审查实现，处理其阻塞与应修项。
  - verify：上述命令输出与审查结论写进报告。
- [ ] 3.2 写 `docs/QINGYAN_ORG_COCKPIT_C-2_REPORT.md`，同步 `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`。
  - verify：两个文件已提交，报告包含门禁结果与 GATE 待确认项。

## Workflow follow-up

- 归档：本 change 新增独立能力，不修改 B-3 的规格；建议在 B-3 归档后归档，独立小 PR。
- staging：为测试组织开启偏好后，等一轮无回复跟进，确认跟进草稿的问候 / 敬语 / 免问与首封一致。
