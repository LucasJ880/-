# Tasks：报价表助手的我方成本只给有财务查看权的人（CHAIN-2b）

## 1. 纯函数

- [ ] 1.1 新增 `src/lib/tender-pricing/finance-view.ts`：读取视图裁剪（`ourCostCad → null`、`costHidden`、去掉 `compareCost`、换假设说明那一句）、保存返回裁剪、「这次保存是否碰了成本」判定、两句固定文字（verify：`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts` 通过；有权限时输入与输出 `JSON.stringify` 相同）

## 2. 接口

- [ ] 2.1 `GET`：取财务查看权（项目组织 + 负责人；无组织按不持键；抛错按无权），无权时不取比价建议、情景按无成本算、调用裁剪（verify：隔离库用例「只读成员读取」「有财务查看权的人读取」「没有财务查看权」）
- [ ] 2.2 `POST save`：锁外判定；无权且碰了成本 → 403 不写库；否则照常保存并裁剪返回（verify：隔离库用例「没有财务查看权的编辑者保存」「响应里搜不到成本数字」）

## 3. 卡片

- [ ] 3.1 `pricing-helper-card.tsx`：`costHidden` 时成本输入框换成说明、保存不带 `ourCostCad`、情景表不显示毛利一栏、不显示成本加成提示（verify：`finance-view.test.ts` 里的渲染断言）

## 4. 测试与门禁

- [ ] 4.1 新增 `src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`（五种身份 × 开关开关、保存 403 与库不变、响应搜不到数字），两个新测试登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`NODE_ENV=test npx tsx …finance-db.isolated.test.ts` 通过；`bash scripts/check-test-registry.sh` 通过）
- [ ] 4.2 既有不改期望（verify：`pricing-helper.test.ts`、`pricing-helper-save-db.isolated.test.ts`、`pricing-helper-lock-db.isolated.test.ts`、`compare-cost-source.test.tsx`、`compare-cost-source-db.isolated.test.ts` 原样通过）
- [ ] 4.3 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate pricing-helper-finance-gate --strict`；`git diff origin/main -- prisma/ vercel.json` 为空）
- [ ] 4.4 写 `docs/QINGYAN_CHAIN-2b_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果、投标策略备忘那条未收口的路径；TASKFLOW 新增 CHAIN-2b 一行为 `[~]`）
