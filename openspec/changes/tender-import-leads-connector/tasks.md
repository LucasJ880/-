# Tasks：中标者 → 进口线索 → 供货商候选（CHAIN-3）

开工前跑一遍要触碰模块的已注册测试并记下基线（`tender-competition/__tests__/*`、`supplier-intel/__tests__/discovery-priority`、`submission-parser`、`tender-rfq/__tests__/web-entry-pure`），写进报告。

## 1. 纯函数

- [x] 1.1 新增 `src/lib/tender-import-leads/flags.ts`、`parse.ts`（表头别名、逗号 / 制表符、逐行校验与文案、同批去重键）、`provider.ts`（`ImportLeadProvider` + 人工粘贴实现）、`match-pure.ts`（中标者三档 + 别名裁决）、`aggregate-pure.ts`（按出口商汇总、12 个月、关键词、排序）；新增 `src/lib/tender-import-leads/__tests__/import-leads.test.ts` 并注册（test-all + test-ci-unit）；verify：该测试通过，`tender-competition/__tests__/amount-measures.test.ts` 不改期望通过

## 2. 落库与服务

- [x] 2.1 `src/lib/supplier-intel/constants.ts` `SIGNAL_PLATFORMS` 加 `TRADE_DATA`，`workspace-labels.ts` 加平台名；verify：`supplier-intel/__tests__/discovery-priority.test.ts`、`submission-parser.test.ts` 不改期望通过
- [x] 2.2 `src/lib/tender-intel/sourcing-suggestions.ts` 导出「本采购方他人授标」（寻源建议改用，行为不变）；新增 `src/lib/tender-import-leads/service.ts`：读视图（中标者、裁决、信号读时分类、汇总、来源说明）、导入（锁 → 解析 → 匹配 → 去重 → 写信号 → 审计）、裁决（锁 → 409 → 审计）、加入供应商库（锁 → 同名关联 / 新建 → 逐条既有关联流程 → 审计）；其它页面显示（来源名称表、找厂优先级跳过）；verify：`npm run typecheck` 通过，`sourcing-suggestions.test.ts` 与隔离库 `sourcing-suggestions-db` 不改期望通过

## 3. 接口与界面

- [x] 3.1 新增 `src/app/api/projects/[id]/tender-intel/import-leads/route.ts`（GET / POST）、`.../import-leads/aliases/route.ts`、`.../import-leads/suppliers/route.ts`（读：项目读 + 组织有效成员；写：项目写 + 组织有效成员；开关关 404；判定顺序 401 → 404 → 开关 404 → 403）；verify：`npm run typecheck` 通过，`import-leads.test.ts` 的路由源码断言（判定顺序、组织有效成员、无网络调用）通过
- [x] 3.2 新增 `src/components/tender-intel/import-leads-panel.tsx`（槽内摘要 + 完整面板），接进 `src/components/tender-intel/org-award-intel-slots.tsx` 的供应链槽（接口 404 时保留原占位句）；verify：`npm run typecheck` 与 `npm run lint:baseline` 通过，`import-leads.test.ts` 的界面源码断言通过

## 4. 端到端与收尾

- [x] 4.1 新增隔离库 `src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts` 并注册（test-all + test-ci-unit）；verify：本机隔离库全部通过、外部请求 0
- [x] 4.2 多维审查：并行派子 agent（正确性与回归、安全 / 隐私与硬纪律、规格—代码—测试一致性、使用流畅与文案）各审一遍 diff，逐条核实后修，超出范围的另开任务；verify：报告「多维审查」一节逐条写明处理
- [ ] 4.3 写 `docs/QINGYAN_CHAIN-3_REPORT.md` + 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` CHAIN-3 状态列，跑全量门禁（`npm test` 与 main 对照失败名单、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-import-leads-connector --strict`、`git diff origin/main -- prisma/ vercel.json` 为空）；verify：两个文件在 PR diff 里，门禁输出写进报告

## Workflow follow-up

- `/opsx:verify` → PR（正文含「多维审查」）→ 合并 → `/opsx:archive tender-import-leads-connector --yes`（独立小 PR，至少一个子 agent 核对）。
- 生产：对 Sunny 打开 `TENDER_IMPORT_LEADS_ENABLED`（需要 Vercel 权限；还要 `T4_AWARD_INTELLIGENCE_SCHEMA_READY` 已开，才有历史中标者可比对）。
