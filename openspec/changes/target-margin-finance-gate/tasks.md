# Tasks：目标毛利只给有财务查看权的人（FIX-25）

开工前先跑一遍将要触碰模块的已注册测试记下基线（main `2a0eb964` 本机：`finance-view.test.ts` 47 过、`compare-cost-source.test.tsx` 83 过、`pricing-helper.test.ts` 13 过；隔离库三个按当时实际记）。

## 1. 纯函数

- [ ] 1.1 改 `src/lib/tender-pricing/finance-view.ts`：没有财务查看权时读取视图与保存返回的 `inputs.targetMarginPct` 与 `ourCostCad` 一起置 `null`（情景按两者都为 `null` 算）；「这次保存碰了受限的键」加上 `inputs.targetMarginPct`（键在即算，含 `null`）；房间 JSON 裁剪去掉整个 `pricingInputs`（备忘照旧去掉；两者都没有时返回同一个对象，不改入参）；403 那句改为「没有保存：需要财务查看权才能修改我方成本和目标毛利。请刷新页面，重新填写后再保存。」，新增「需要财务查看权才能看目标毛利。」，删掉「目标毛利只用于按成本算的底价情景；你这里改了，情景表不会变。」；`COST_ACCESS_HINT_ZH` 等四句不改，文件仍只 import `./calc` 与类型，去备忘的代码仍只在本文件。新增 `src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts`，同一 task 登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts` 通过，且在 `origin/main` 版本的 `finance-view.ts` 上失败；`bash scripts/check-test-registry.sh` 通过）
- [ ] 1.2 更新 `src/lib/tender-pricing/__tests__/finance-view.test.ts` 里随行为改变的断言，只这几条：「固定文字」里 403 那句与删掉的那句；「成本为 null、costHidden…」里 `targetMarginPct === 15` 改为 `=== null`；「只带对手价 / 目标毛利 / 模型：没碰」改为只带对手价或模型没碰、带目标毛利（数字与 `null`）算碰了；「房间 JSON」两条改为去掉整个 `pricingInputs`；卡片接线里「目标毛利下面那句」与成本加成提示两条（verify：`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts` 通过；`git diff origin/main -- src/lib/tender-pricing/__tests__/finance-view.test.ts` 只动这几条）

## 2. 卡片

- [ ] 2.1 改 `src/components/tender/pricing-helper-card.tsx`：`costHidden` 时目标毛利格换成标签 +「需要财务查看权才能看目标毛利。」（`data-testid="pricing-margin-hidden"`），不渲染成本加成提示，去掉那句说明，保存请求不带 `targetMarginPct`；有财务查看权时渲染与请求和改动前相同；顶部与类型注释写明 `costHidden` 同时管目标毛利。`src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx` 里成本加成提示那条接线字符串按新接线更新，行为断言不改（verify：`target-margin-finance-view.test.ts` 的卡片源码断言通过；`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx` 通过）

## 3. 隔离库

- [ ] 3.1 新增 `src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`，同一 task 登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`：复现数据（成本 87,654.32、目标毛利 23.7、镜像我方报价与 `ourBidPrice` 114,881.15；夹具评分模型与对手价选成算出的分数与价格里不含这两个数，测试先断言这一点）；只读成员、项目编辑者、没有财务键的 `org_admin`、分配范围持 `project.finance.read` 的投标同事读调查室、项目列表、报价表助手、项目详情（四个响应都没有目标毛利、`summaryJson` 没有 `pricingInputs`、去掉时间戳后搜不到 `23.7` 与 `87654.32`）；负责人、组织范围 `project.finance.read`、平台超级管理员读报价表助手（`targetMarginPct = 23.7`、三人逐字节相同）；编辑者五次保存与 409 → 403 → 400；被拒时库不变。同时更新 `pricing-helper-finance-db.isolated.test.ts` 里随行为改变的断言：读取的 `targetMarginPct`、编辑者带目标毛利保存（原来 200 / 400 的两次改为 403）、两个房间 JSON 接口的 `ourPriceCad`；并在它的「响应里搜不到成本数字」里加上目标毛利（verify：`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts` 与 `NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts` 在隔离库通过；新测试在 `origin/main` 版本的源文件上的失败条数记进报告，跑完 `git status` 核对已还原）

## 4. 门禁与报告

- [ ] 4.1 既有不改期望（verify：`npx tsx src/lib/tender-pricing/__tests__/pricing-helper.test.ts`、`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-save-db.isolated.test.ts`、`…/pricing-helper-lock-db.isolated.test.ts`、`…/compare-cost-source-db.isolated.test.ts`、`NODE_ENV=test npx tsx src/lib/tender-room/__tests__/room-summary-merge-db.isolated.test.ts` 原样通过）
- [ ] 4.2 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`npx openspec validate target-margin-finance-gate --strict`；`git diff origin/main -- prisma/ vercel.json` 为空；`grep -rln "bidStrategyMemo" src --include=*.ts --include=*.tsx | grep -v __tests__` 与改动前相同）
- [ ] 4.3 写 `docs/QINGYAN_FIX-25_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含出口清单与每条的去向、多维审查、门禁数字、改动前对照数字、GATE 结论、与 CHAIN-2e / CHAIN-2d 的合并顺序、「没有开关，合并即生效」；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 FIX-25 行状态列为 `[~]`——CHAIN-2d 已合并时改它带进来的那一行，没合并时在 CHAIN-2b 行之后新增同样一行）
