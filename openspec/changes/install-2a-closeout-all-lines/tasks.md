# Tasks

## 1. 收口单元（纯函数）

- [ ] 1.1 `src/lib/install/closeout.ts`：新增收口单元类型与构建函数（Blinds 行 + 工艺参数四段，D3 顺序与编号、D4 布纱各一）、单元 id 编解码（`spec-<段>-<下标>` ↔ 审计目标 `<orderId>:<段>:<下标>`，D1）、按单元聚合（两类记录、位置快照比对 D2、零单元 `allCompleted=false`）与未收口清单；保留 `aggregateCloseout` 对既有调用方的签名或同步替换全部调用方。新建 `src/lib/install/__tests__/closeout-units.test.ts` 覆盖 spec「收口单元」「工艺参数单元的位置比对」全部场景，同 task 注册 `scripts/test-all.sh`。verify：`npx tsx src/lib/install/__tests__/closeout-units.test.ts` 与 `npx tsx src/lib/install/__tests__/closeout.test.ts` 均 0 失败。

## 2. 服务与接口

- [ ] 2.1 `src/lib/install/service.ts`：批量读取最新工艺参数与两类收口记录（D6）、按单元序列化详情（单元 id / 序号 / 位置 / 尺寸 / 品类标签 / 色号 / 段 / 位置已变标记）；`GET /api/install/tasks` 与 `GET /api/install/tasks/{id}` 改用单元计数与单元列表。verify：`npm run typecheck`（`NODE_OPTIONS=--max-old-space-size=8192`）0 error；`grep -rnE "grandTotal|price|msrp|costPrice" src/app/api/install src/lib/install` 为空。
- [ ] 2.2 上传路由接受工艺参数单元 id（不存在 404）、写 `blinds_order_unit` 目标与位置快照、改用会抛错的审计写入并在失败时返回 500"请重拍"（D5）；完成收口路由对零单元返回 409 `NO_UNITS`、`WINDOWS_MISSING` 清单按单元序号与位置。verify：typecheck；隔离库用例（task 4.1）。

## 3. 页面

- [ ] 3.1 `src/components/install/install-types.ts` / `install-task-detail.tsx`：单元卡片显示品类标签与段、工艺参数单元的尺寸 / 色号字段、位置已变提示；`total === 0` 时显示"工艺单没有可收口的行，请联系出单补齐"且不显示"还差 0 扇"；`NO_UNITS` / 500 错误原样提示。`src/app/(main)/blinds-orders/[id]/page.tsx` 收口标签显示单元品类标签。verify：`npx eslint src/components/install "src/app/(main)/blinds-orders/[id]/page.tsx"` 0 error；本地 Playwright 截图：只有 Vinyl 的任务页 3 个单元、拍完后"完成收口"可点，零单元任务页显示说明。

## 4. 测试与收尾

- [ ] 4.1 新建 `src/lib/install/__tests__/closeout-db.isolated.test.ts`（真实路由 + 隔离库 + 本地 Blob 盘）：只有 Vinyl 的单上传 → 列表 / 详情计数一致 → 完成收口 200、工艺单 installed；混合单计数；零单元 409 `NO_UNITS`；`spec-vinyl-5` 404；位置改后计为未收口；审计写入失败 500 且单元仍未收口；他人任务 403；注册 `scripts/test-all.sh`。verify：本地 Postgres 16 隔离库跑通 0 失败；`bash scripts/check-test-registry.sh` 通过。
- [ ] 4.2 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate install-2a-closeout-all-lines --strict` 通过；写 `docs/QINGYAN_INSTALL-2a_REPORT.md`（含不可清理清单追加 `blinds_order_unit`）+ `docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2a 改 `[G]` + 更新 `docs/QINGYAN_INSTALL-2_HANDOFF.md`。verify：四条命令退出 0；`grep -c "INSTALL-2a .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后 `/opsx:archive install-2a-closeout-all-lines --yes`（独立小 PR），TASKFLOW INSTALL-2a 改 `[x]`；确认 `openspec show installation/window-closeout --type spec` 含「收口单元」。
- 之后 `/opsx:propose install-2b-balance-warranty`（方案 §9 第二行）。
