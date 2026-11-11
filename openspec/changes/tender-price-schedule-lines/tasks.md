# Tasks

每条带验证方式；真实输出写进报告。

## 1. 契约与夹具

- [ ] 1.1 新建 `src/lib/tender-price-schedule/__tests__/fixtures/ottawa-18026.ts`：18 个行项、截标时间、补遗、文件领取方条数，取自 Skill 包的 `ottawa-bedbug-case.json`；竞争对手与出口商名称换成代号；文件头注明「历史回归样例，不是报价，不是合规证明」；verify：`grep -c 'line_no\|lineNo' <该文件>` 为 18 行项，且 `grep -rn 'Amcan\|Huierjia\|Jianjin' src/` 无命中
- [ ] 1.2 `contract.ts`：行项类型、单位目录、结构校验、按行号集合汇总；新建 `schedule-contract.test.ts`（渥太华通过、行号重复 / 不连续、未知单位、五组合计 6,119 / 2,903 / 436 / 54 / 1,140、混合单位不相加）并登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-price-schedule/__tests__/schedule-contract.test.ts` 全部通过

## 2. 换算、尺寸、截标、导出

- [ ] 2.1 `unit-conversion.ts`：按件报价换算到招标单位、已按招标单位不重复换算、缺包装数拒绝、单价舍入到分后算行合计与总计（定点）；新建 `unit-conversion.test.ts` 并登记；verify：该测试全部通过，含规格里的 61,094.56 对账用例
- [ ] 2.2 `dimension-match.ts`：解析定值 / 区间 / 最小值，按位置比较，三种结果；新建 `dimension-match.test.ts`（36×39 对 36×38 不符、区间内相符、最小尺寸两向、无法解析、维数不同）并登记；verify：该测试全部通过
- [ ] 2.3 `closing-time.ts`：时区校验与开放 / 已提交 / 已过期推导；`official-export.ts`：原样导出行数组与 CSV、缺价拒绝、字段白名单；新建 `closing-and-export.test.ts`（含「本目录无数据库 / 网络 / 模型调用引用」的源码断言）并登记；verify：该测试全部通过

## 3. 收尾

- [ ] 3.1 门禁：四个新测试、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-price-schedule-lines --strict`；verify：全部通过，真实输出写进报告
- [ ] 3.2 写 `docs/QINGYAN_TI-1_REPORT.md`（交付清单、验收项 A1 / A2 / A8 / A9 / A10 / A16 逐项对应的测试、测试输出、未做事项）+ 在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase F 新增 TI-1 行并更新状态列；verify：报告存在，`grep -n 'TI-1' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive tender-price-schedule-lines --yes`（独立小 PR）。
