# Tasks：供应商分组（RFQ-AUTO-5）

实施时这份清单曾拆成 21 条且没有写 verify，不合项目对 tasks 的规定（不超过 8 条、每条自带 verify）；PR 开出后按规定并成下面 8 条，内容没有增减，都已完成。

## 1. 分组本身

- [x] 1.1 功能开关 `supplier-groups-flags.ts`（默认关、组织白名单）与纯函数 `supplier-groups.ts`（上限、校验、读库里那份、规整与比对、抽屉预选与说明、四种修改、保存结果的处理）；verify：`npx tsx src/lib/tender-rfq/__tests__/supplier-groups.test.ts` 全部通过（103 项）
- [x] 1.2 读写服务 `supplier-groups-service.ts`（本人最近一条记录即状态；保存在短事务里取本人的锁、比版本、明确给记录时间；新加入的供应商须属于本组织）与接口 `PUT /api/projects/[id]/tender-rfq/supplier-groups`（项目写权限；400 / 404 / 409）；verify：`supplier-groups-db.isolated.test.ts` 中保存、权限、版本冲突、同时保存、时钟不一致各用例通过

## 2. 接到询价入口与自动起草

- [x] 2.1 `web-entry.ts`：功能开启时响应带 `supplierGroups`，分组里的供应商并进可选列表；功能关闭时不带该字段；verify：`supplier-groups-db.isolated.test.ts` 中入口各用例通过，`npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts` 151 项不改断言即通过
- [x] 2.2 `auto-draft-pure.ts` / `auto-draft-service.ts`：有分组时名单只取对上的那一组；两个新原因 `SUPPLIER_GROUP_UNDETERMINED`、`SUPPLIER_GROUP_EMPTY`；结果、卡摘要、审计写明分组与关键词（`service.ts` 的建轮次入参多一个可选项，只写进卡摘要那一句）；verify：`npx tsx src/lib/tender-rfq/__tests__/auto-draft-pure.test.ts` 63 项通过，`supplier-groups-db.isolated.test.ts` 中自动起草各用例通过，`auto-draft-db.isolated.test.ts` 68 项不改断言即通过

## 3. 界面

- [x] 3.1 抽屉里的分组标签行与管理区 `rfq-supplier-groups.tsx`（点分组换勾选；存为新分组、用当前勾选覆盖、改名字与关键词、删除先确认；失败不丢勾选），抽屉的预选改为调用纯函数；verify：`docs/acceptance/rfq-auto-5/` 四张截图（`drawer-manage.png`、`drawer-matched.png`、`drawer-undetermined.png`、`panel-result-group.png`）

## 4. 测试注册、审查与收尾

- [x] 4.1 两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK（已注册 593 个）
- [x] 4.2 开 PR 前请一个不带结论的独立审查并修复其发现；全部门禁；verify：报告 §5 逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate rfq-supplier-groups --strict` valid
- [x] 4.3 写 `docs/QINGYAN_RFQ-AUTO-5_REPORT.md` + 更新 TASKFLOW 状态列（交接文档里 RFQ-AUTO-5 的一行在 #430 里，归档本 change 时一并更新）；verify：TASKFLOW 里有 RFQ-AUTO-5 一行，状态 `[G]`
