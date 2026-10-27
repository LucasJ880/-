# Tasks

## 1. 金标准

- [ ] 1.1 写 `scripts/sunny-process-oracle/`（`oracle.py` UNO 重算器 + 四类用例生成器 + README），对 5 份原件生成 `src/lib/sunny-process/__tests__/fixtures/{blinds,domestic,drapes-6cm,drapes-7cm,vinyl}.json`，并产出 Blinds 全窗位原件缺陷清单。verify：`python3 scripts/sunny-process-oracle/oracle.py --all --src <原件目录>` 退出 0，夹具文件存在且每个含原件 SHA-256。

## 2. 引擎

- [ ] 2.1 修正 Blinds 引擎（拉绳分档阈值、任意布纱比裁剪位、裁剪数量、切割类别），写 `blinds-oracle.test.ts` 并注册。verify：`npx tsx src/lib/sunny-process/__tests__/blinds-oracle.test.ts` 退出 0。
- [ ] 2.2 新增国内下单与窗帘（6cm/7cm）引擎，写 `domestic-oracle.test.ts`、`drapes-oracle.test.ts` 并注册。verify：两个测试退出 0。
- [ ] 2.3 新增 Vinyl 引擎（单窗工艺、下料总表合并排序、标签），写 `vinyl-oracle.test.ts` 并注册。verify：测试退出 0，夹具全部用例逐项一致。

## 3. 生成与门禁

- [ ] 3.1 新增报价映射 + 待核对 + 自动生成服务（AuditLog 版本化 spec、幂等、通知），接入 mark-signed 与公开 sign 两路由；写 `quote-mapping.test.ts`、`autogen.test.ts`（注入式 db 假体）并注册。verify：两个测试退出 0；`grep -n "generateProcessOrderForSignedQuote" src/app/api/sales/quotes -r` 命中两处。
- [ ] 3.2 新增 `PUT/GET /api/blinds-orders/[id]/spec`，transition 加 draft→confirmed 阻断门禁，export 补可见性校验并输出全部产品线工作表。verify：`autogen.test.ts` 中门禁与 spec 版本用例通过；导出用例生成的 xlsx 用 ExcelJS 读回含预期工作表名。

## 4. 界面与收尾

- [ ] 4.1 工艺单详情页显示来源报价、待核对、国内下单 / 窗帘 / Vinyl 三段可编辑参数与计算结果；报价页"生成订单"成功提示带工艺单链接。verify：`npm run typecheck` 0 错；本地 `next build` 通过。
- [ ] 4.2 写 `docs/QINGYAN_SUNNY_PROCESS_ORDER_REPORT.md`（对照检验结果、原件缺陷与偏离登记、待拍板项）与 `docs/QINGYAN_SUNNY_PROCESS_ORDER_HANDOFF.md`（续做指引）。verify：`bash scripts/check-test-registry.sh` 退出 0；`npm test` 新增项全部 PASS；`openspec validate sunny-process-order-autogen --strict` 通过。

## Workflow follow-up

- PR 合并到 main 后 `/opsx:archive sunny-process-order-autogen --yes`（独立小 PR）；确认 `openspec list --specs` 列出 `sunny/process-order-engines` 与 `sunny/process-order-autogen`。
