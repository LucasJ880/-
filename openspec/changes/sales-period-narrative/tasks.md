# Tasks — sales-period-narrative（KPI-2）

## 1. 例外与纯函数核心

- [ ] 1.1 改规则并写纯函数核心：
  - `openspec/config.yaml` 第 7 条末尾追加 design D1 的例外句；
  - 新建 `src/lib/sales/period/narrative-pure.ts`：
    - `isPeriodNarrativeEnabled(env)`；
    - 输入投影（org / own，含 `thresholds` 与 `allowedActions`）；
    - 固定系统提示词；
    - 解析（围栏、结构、条数、长度）；
    - 数字允许集合与比对（取整、千分位、货币、正负号、百分比、万、日期、中文数字拒绝）；
    - 引用与词表校验；
    - 汇总为 `{ narrative, fallbackReason }`。

  写 `src/lib/sales/__tests__/period-narrative-pure.test.ts` 覆盖上述每条规则与 spec 中的纯函数场景，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：该测试 `npx tsx …` 退出 0；`bash scripts/check-test-registry.sh` 通过；`openspec validate sales-period-narrative --strict` 通过。

## 2. 服务与接口

- [ ] 2.1 新建服务与接口，并给期间汇总加开关回显：
  - `src/lib/sales/period/narrative.ts` `generatePeriodNarrative(params, deps?)`：
    - 取数复用 `buildSalesPeriodResponse`；
    - 一次 `createCompletionDetailed`（可注入）；
    - 异常映射 `model_error` / `budget_exceeded`；
    - `logAudit`（只记 outcome / model / scope / 期间 / 耗时）。
  - `src/app/api/sales/period-summary/narrative/route.ts` `POST`：开关 404 → 授权 403 → 期间 400 → 限次 429 → 生成。
  - `src/lib/sales/period/load.ts` 响应加 `narrativeEnabled`；`.env.example` 加开关说明。

  verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0；`npx eslint` 对新文件无输出；`period-db.isolated.test.ts` 与 Muse `sales-db.isolated.test.ts` 在隔离库全过。

## 3. 面板

- [ ] 3.1 `src/components/sales-command-center/sales-period-panel.tsx`：
  - `narrativeEnabled` 为真时显示"生成解读"按钮，点击才请求；
  - 三段展示与"AI 解读 · 数字已与看板核对"标注；
  - 回落与 429 提示；
  - 换期间清空结果。

  verify：`npm run build` 通过；浏览器检查（开关关无按钮；开关开 + 本机假 OpenAI 服务时三段显示；假服务返回编造数字时显示回落提示）记录写入报告。

## 4. 端到端

- [ ] 4.1 写 `src/lib/sales/__tests__/period-narrative-db.isolated.test.ts`（注入假模型调用），覆盖：
  - 开关关 404 且零调用；`GET narrativeEnabled` 两种取值；
  - 403 / 400 零调用；
  - 合法输出 200；
  - 编造数字 `invalid_numbers`、越词表 `invalid_reference`；
  - 模型抛错 `model_error`、费用超限 `budget_exceeded`；
  - 本人范围提示词不含他人姓名；
  - 审计 outcome 正确且不含正文与金额；
  - 第 7 次请求 429。

  同一 task 注册进 `scripts/test-all.sh`。verify：隔离库下全过；无 `DATABASE_URL` 时跳过并退出 0。

## 5. 收口

- [ ] 5.1 全量门禁全部通过：
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`
  - `npm run lint:baseline`
  - `npm run test:ci`
  - `bash scripts/check-test-registry.sh`
  - `OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 validate sales-period-narrative --strict`
  - 隔离库全量 `npm test` 的失败项逐一与 main 对比
  - PR 上 CI `validate-lint-typecheck-test-build` 为绿

  verify：上述命令退出码与输出贴进报告；registry 比当前 main 增加 2；CI 绿。

- [ ] 5.2 写 `docs/QINGYAN_KPI-2_REPORT.md`：
  - 做了什么、怎么验、对设计稿 §3.5 的偏离（模型调用走 `getClient` 而非设计稿写的 ProviderRouter 路径、输出改为约定 JSON、开关回显、限次与审计）；
  - 已知限制：真实模型输出质量与回落率需上线验收、中文数字一律拒绝的误杀；
  - 上线步骤：设置环境变量、人工验收 10 次并记录通过 / 回落分布。

  更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 KPI-2 状态列为 `[G]`，并更新 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_HANDOFF.md`。verify：三个文件在 PR diff 中；TASKFLOW KPI-2 行含 `[G]`。

## Workflow follow-up

- PR 合并后 `/opsx:archive sales-period-narrative --yes`（独立小 PR），TASKFLOW KPI-2 → `[x]`，确认 `openspec list --specs` 出现 `sales/period-narrative`。
- 上线：Vercel 设置 `SALES_PERIOD_NARRATIVE_ENABLED=true`，老板在首页点"生成解读"人工验收。
