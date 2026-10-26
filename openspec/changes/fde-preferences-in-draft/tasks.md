# Tasks

## 1. 金样本与偏好解析（先锁定现状）

- [x] 1.1 先锁定现状，再写偏好段与解析：
  - 先提交：新建 `src/lib/revenue-spine/__tests__/fixtures/draft-golden-cases.ts`，用**未改动的代码**生成 `draft-golden-pre-b3.json`，单独提交；
  - 再实现 `policy.ts` 的 `fde` 段（类型、默认值、合并）与新建 `src/lib/revenue-spine/draft-preferences.ts`（`resolveDraftPreferences`、禁用词匹配、违规审计 `recordIgnoredDraftPreferencesSafe`，依赖可注入）；
  - 新建 `src/lib/revenue-spine/__tests__/draft-preferences.test.ts`，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：测试退出 0，覆盖 spec「草稿偏好默认关闭，关闭时草稿不变」中合并相关 scenario、「偏好值经守卫校验，违规项逐条忽略」全部 scenario、「违规偏好留审计且不重复」前两个 scenario；`scoring-draft.test.ts`、`autonomy.test.ts` 仍全过。

## 2. 追问与草稿模板接入

- [x] 2.1 追问与草稿模板接入：
  - `rfq/missing-info.ts` `buildClarifyingQuestions` 加可选偏好参数；
  - `reply-draft.ts`：可选 `preferences` 输入（问候 / 结束语 / 敬语 / 禁用词保护行），以及 `polishReplyDraftWithLlm` 的两条回退判定与追加提示；
  - `draft-preferences.test.ts` 补模板、排序、禁用词、润色回退（注入 `complete`）与金样本三种比对。
  - verify：测试退出 0，覆盖 spec「偏好只影响问候、结束语、敬语、追问与禁用词」「必问与免问字段按偏好排序」「禁用词替换不改事实与参考值」「守卫与润色顺序不变」全部 scenario，金样本比对通过；`scoring-draft.test.ts`、`tricky-inquiries.test.ts`、`no-reply-followup.test.ts`、`draft-feedback.test.ts` 仍全过；`npm run typecheck` 退出 0。

## 3. FDE 接入

- [x] 3.1 `fde/inbound-sales.ts` 接入：
  - 解析一次偏好，用于追问、草稿与审核用中文版；
  - 违规时调用审计；
  - "回复草稿已生成"事件追加偏好键名。
  - `draft-preferences.test.ts` 补接入点静态断言：开关关闭时不传偏好；审计在 try/catch 内；润色仍在守卫之前。
  - verify：测试退出 0，覆盖 spec「违规偏好留审计且不重复」第三个 scenario；FDE 相关既有测试仍全过。

## 4. 门禁与交付

- [ ] 4.1 跑全部门禁并做独立交叉审查：
  - 门禁：`npm test` 与基线比较新增失败为 0；`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline` 通过；`bash scripts/check-test-registry.sh` 无新增未注册；`openspec validate fde-preferences-in-draft --strict` 通过；`git diff --stat` 无 `prisma/`、`vercel.json`。
  - 交叉审查：独立审查代理审查实现，处理其阻塞与应修项。
  - verify：上述命令输出与审查结论写进报告。
- [ ] 4.2 写 `docs/QINGYAN_ORG_COCKPIT_B-3_REPORT.md`，把 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` B-3 状态列改为 `[G]`，同步 `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`。
  - verify：三个文件已提交，报告包含门禁结果、开启方式与 GATE 待确认项。

## Workflow follow-up

- 归档：B-3 不修改 B-1 / B-2 的能力，可独立归档；建议仍按 B-1 → B-2 → B-3 顺序归档，各自独立小 PR 并同步状态列。
- staging：用 `PUT /api/revenue/policy` 为测试组织开启偏好（英文问候 `Hi {name},`、免问 `targetPrice`、禁用词一条、再配一条含数字的结束语），确认：下一封 FDE 草稿体现偏好；含数字的结束语被忽略并产生一条审计；关闭开关后草稿回到默认。
