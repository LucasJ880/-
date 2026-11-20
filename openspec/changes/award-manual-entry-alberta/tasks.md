# Tasks：Alberta 授标的人工录入（CHAIN-1b）

## 1. 纯函数

- [ ] 1.1 新增 `src/lib/tender-intel/award-manual-entry.ts`：表单校验与规整（链接只做字符串解析）、来源键、结果说法与固定文字（verify：`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts` 每条校验与那句话、来源键确定、源码没有网络调用）

## 2. 接口

- [ ] 2.1 新增 `src/app/api/organizations/[orgId]/tender-awards/manual/route.ts`：`requireOrgRole(…, "org_member")`（超级管理员 + 组织不存在 404）→ 开关 409 → 校验 400 → 事务里写入服务（撤回过的换后继键）+ 审计；P2002 重读按已经录过返回（verify：隔离库用例「谁能录入」「开关关闭」「新录入与复核」「挂到既有与疑似重复」「重录、并发、撤回后重录」「审计」）
- [ ] 2.2 `src/app/api/org/tender-awards/route.ts`：返回 `canEnterManual`、每条记录的人工录入 APC 链接（只认 `manual:apc:` 来源、再校验主机）、采购方候选（verify：隔离库用例「列表显示」）

## 3. 页面

- [ ] 3.1 `src/app/(main)/projects/intelligence/awards/page.tsx`：表单（字段、说明、采购方候选与提示、范围提示、提交中禁用、结果一句、错误一句）、列表里的 `人工录入 · APC 公告` 链接、统计条「待确认（AI 提取 / 人工录入）」（verify：`award-manual-entry.test.ts` 源码断言逐字）

## 4. 测试与门禁

- [ ] 4.1 新增 `src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`（含零外部请求计数），两个新测试登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`NODE_ENV=test npx tsx …award-manual-entry-db.isolated.test.ts` 通过；`bash scripts/check-test-registry.sh` 通过）
- [ ] 4.2 既有不改期望（verify：`awards.test.ts`、`awards-db.test.ts`、`award-dedupe-db.isolated.test.ts`、`award-review-db.isolated.test.ts`、`sourcing-suggestions-db.isolated.test.ts`、`import-leads-db.isolated.test.ts` 原样通过）
- [ ] 4.3 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate award-manual-entry-alberta --strict`；`git diff origin/main -- prisma/ vercel.json` 为空）
- [ ] 4.4 写 `docs/QINGYAN_CHAIN-1b_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果；TASKFLOW 新增 CHAIN-1b 一行为 `[~]`）
