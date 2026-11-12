# Tasks：项目页上能记「已提交」并留回执（FLOW-H4a）

## 1. 判断与写入

- [x] 1.1 `src/lib/tender-submission/`：输入校验与三种情形的判定（纯函数）、开关；verify：`npx tsx src/lib/tender-submission/__tests__/submission-record.test.ts` 全部通过
- [x] 1.2 `src/lib/tender/stage-transition.ts` 加三个可选参数、把重复写入的保护做进写的那一句；`src/lib/tender-submission/service.ts`：第一次记录走阶段推进，更正与补记自己写日期，记录追加进审计；verify：`npx tsx src/lib/tender-submission/__tests__/submission-record-db.isolated.test.ts` 全部通过（本地隔离库），其中含「不传新参数时阶段推进写入的内容与原来相同」
- [x] 1.3 接口 `GET` / `POST /api/projects/[id]/submission-record`；verify：同上隔离库测试里的权限、隔离、开关、非招投标项目各场景通过

## 2. 页面

- [x] 2.1 「提交」页签的「提交记录」一块（显示、记录、更正、确认）；「下一步」卡片在截标已过时指到它；verify：真实浏览器截图 `docs/acceptance/flow-h4a/*.png`；`web-next-step.test.ts` 与 `submission-record.test.ts` 的相关断言通过

## 3. 测试注册与验收

- [x] 3.1 两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 3.2 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate tender-submission-record --strict` valid
- [x] 3.3 写 `docs/QINGYAN_FLOW-H4a_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FLOW-H4a 一行，状态 `[G]`
