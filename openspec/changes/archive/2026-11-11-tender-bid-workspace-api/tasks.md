# Tasks

每条带验证方式；真实输出写进报告。前置：TI-1、TI-2、TI-3a、TI-3b 已 apply。

## 1. 契约与读取结果（纯函数）

- [x] 1.1 `flags.ts` 与 `contract.ts`：开关与组织白名单；已存内容与保存请求、成本核算请求的校验（类型、长度、行数上限、剥除未知字段）；新建 `workspace-contract.test.ts`（开关三种情形、保存后的形状、字段类型错误、超过 300 行、夹带成本字段被剥除、本目录与两个路由无发信 / 审批 / 模型 / 外部网络引用的源码断言）并登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-bid-workspace/__tests__/workspace-contract.test.ts` 全部通过
- [x] 1.2 `workspace-view.ts`：由已存内容算出价格表校验、尺寸对照、认证闸、领取方汇总、可投标判定、阶段决定与三张清单；由成本输入加已存行项算出核算表；新建 `workspace-view.test.ts`（渥太华读取结果、读取结果无金额字段、材料推导、成本输入引用不存在的行号、核算表合计等于逐行之和）并登记；verify：该测试全部通过

## 2. 存取与接口

- [x] 2.1 `store.ts`：加锁读改写、只替换自己的键、分块合并、没有情报室时建行、写审计；verify：由 2.3 的隔离库测试覆盖
- [x] 2.2 两个路由文件：`GET` / `PUT …/bid-workspace` 与 `POST …/bid-workspace/cost-sheet`；开关、项目访问、财务查看权、错误码与中文说明；`.env.example` 补两个变量的说明；verify：`npm run typecheck` 通过，由 2.3 覆盖行为
- [x] 2.3 新建 `bid-workspace-db.isolated.test.ts`（真实路由 + 隔离库）：开关关闭 404 且零写入、组织不在白名单、其它组织用户被拒、只读成员不能保存、伪造组织与用户被忽略、保存后读回、类型错误 400 且数据不变、其它功能的内容原样保留、分块保存、并发保存、审计操作者、渥太华读取结果、负责人算出核算表、无财务权限 403、不落库、没有价格表 409；登记进两个脚本；verify：隔离库下该测试全部通过，输出写进报告

## 3. 收尾

- [x] 3.1 门禁：两个纯逻辑测试、隔离库测试、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-bid-workspace-api --strict`；verify：全部通过，真实输出写进报告
- [x] 3.2 写 `docs/QINGYAN_TI-4a_REPORT.md`（交付清单、验收项 A17 / A20 / A22、成本数据存储的两个候选与利弊、已知限制、测试输出、未做事项）+ 在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase F 新增 TI-4a 行并更新状态列；verify：报告存在，`grep -n 'TI-4a' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive tender-bid-workspace-api --yes`（独立小 PR）。
- 开关在生产保持关闭；打开属于部署决定，由 Lucas / Evan 定。
