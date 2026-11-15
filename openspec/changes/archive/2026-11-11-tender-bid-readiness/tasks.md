# Tasks

每条带验证方式；真实输出写进报告。前置：TI-1、TI-2、TI-3a 已 apply。

## 1. 可投标判定

- [x] 1.1 `evidence-status.ts`：三轴 + 时效 + 矛盾 → 五个显示状态；同主题同字段的矛盾检测；新建 `evidence-status.test.ts`（人工确认的事实、过期、模型抽取只是指示性、推断、两条有效声明取值不同、被取代的不算矛盾、未知与矛盾不支撑结论）并登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-bid-readiness/__tests__/evidence-status.test.ts` 全部通过
- [x] 1.2 `certification-gate.ts` 与 `staleness.ts`：六个条件的认证闸与逐条原因；按「行 + 补遗版本」的失效判断与复核清单；新建 `certification-and-staleness.test.ts`（渥太华第 13–15 行待定、只有部件认证、只是声称、只留预算、全部满足、型号不一致、已过期、第 1 号补遗影响第 13–15 行、已基于最新补遗）并登记；verify：该测试全部通过
- [x] 1.3 `readiness.ts`：汇总截标窗口、价格表结构、逐行成本、关税依据、尺寸对照、认证闸、补遗失效为阻断项与提示；新建 `readiness.test.ts`（渥太华回归、尺寸相符但认证未过、没有阻断项、指示性价格只是提示、输出无批准字段、可投标判定四个文件无数据库 / 网络 / 模型 / 发信 / 审批引用的源码断言）并登记；verify：该测试全部通过

## 2. 阶段策略

- [x] 2.1 `stage-policy.ts`：十三个阶段的类别表、给定材料与来源状态的决定、三张清单、组织覆盖的边界；新建 `stage-policy.test.ts`（十三个阶段各一类、材料齐备时只读阶段全部执行、缺材料不阻塞、贸易数据未接通、人工录入线索、要批准的始终停下、渥太华缺省情形的三张清单、关闭阶段、外联不能改自动、未知阶段名、无运行时 / 定时任务引用的源码断言）并登记；verify：该测试全部通过

## 3. 收尾

- [x] 3.1 门禁：四个新测试、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-bid-readiness --strict`；verify：全部通过，真实输出写进报告
- [x] 3.2 写 `docs/QINGYAN_TI-3b_REPORT.md`（交付清单、验收项 A7 / A16 / A21 逐项对应的测试、阶段策略表全表、测试输出、未做事项）+ 在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase F 新增 TI-3b 行并更新状态列；verify：报告存在，`grep -n 'TI-3b' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive tender-bid-readiness --yes`（独立小 PR）。
