# Tasks

每条带验证方式；真实输出写进报告。**本文件在四件套获 Lucas 批准后才开始执行。**

## 1. 纯逻辑

- [x] 1.1 `followup-flags.ts`（开关与组织白名单）；`types.ts` 的发询价载荷加可选 `followUpPolicy`；`chase-pure.ts` 加 `CHASE_TEMPLATE_VERSION` 与模板指纹函数；verify：`npx tsx src/lib/tender-rfq/__tests__/chase-pure.test.ts` 全部通过（含新增断言）
- [x] 1.2 新建 `followup-coverage.ts`（`buildFollowUpPolicy`、`decideFollowUpCoverage`，十二个条件各一个原因码）与 `followup-coverage.test.ts`（全部满足、逐条不满足、授权受载荷哈希保护、上限校验、回信夹带指令不改变追问内容），登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-rfq/__tests__/followup-coverage.test.ts` 全部通过

## 2. 发送与执行

- [x] 2.1 `service.ts`：网页发起且勾选时把授权写进载荷，卡片摘要加一行范围说明；Muse 路径不变；verify：`round-pure.test.ts` 与 `web-entry-pure.test.ts` 全部通过（含新增断言）
- [x] 2.2 `chase-service.ts`：扫描只看进行中的轮次；对覆盖得住的邮件建记录后以批准人身份执行并写审计，覆盖不住的照旧待批并记原因；verify：`tracking-notify.test.ts`、`tracking-notify-wiring.test.ts` 全部通过（含新增断言）
- [x] 2.3 `chase-execute.ts`：轮次已取消或已完成不发；催单过了回复截止不发；verify：`npx tsx src/lib/tender-rfq/__tests__/chase-execute.test.ts` 全部通过（含新增断言）
- [x] 2.4 新建 `followup-auto-db.isolated.test.ts`（本地隔离库 + 假邮件发送：自动催单留下的记录与审计、并发两次扫描只发一封、发送失败不重发、停止后退回待批、取消后不建卡、只读成员不能停止、开关关闭零变化）并登记；verify：本地隔离库运行全部通过，无库时自跳过

## 3. 接口与界面

- [x] 3.1 建轮次接口接受 `autoFollowUp`；新增停止接口；入口返回的轮次状态带自动跟进信息；verify：`web-entry-pure.test.ts` 全部通过；`npm run typecheck` 通过
- [x] 3.2 询价入口组件：勾选框、卡上的授权说明与模板预览、轮次状态与停止按钮；verify：`npm run typecheck` 通过；真实应用截图 `approval-card.png`、`round-status.png` 存 `docs/acceptance/rfq-auto-1/`

## 4. 纪律文字与收尾

- [x] 4.1 `openspec/config.yaml` 硬纪律第 2 条补一句（文字见 design D8），`.env.example` 写明两个变量；verify：`openspec validate rfq-round-followup-preapproval --strict` 通过；PR 正文单列这一处改动请 Owner 确认
- [x] 4.2 门禁：以 CI 的环境变量跑整份 `bash scripts/test-ci-unit.sh`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/test-runtime-architecture.sh`、`bash scripts/check-test-registry.sh`；重跑读到 `tender-rfq` 的全部既有测试；verify：全部通过，真实输出写进报告
- [x] 4.3 写 `docs/QINGYAN_RFQ-AUTO-1_REPORT.md`（含现状底稿的 `文件:行`、A18 / A19 的对应测试）+ TASKFLOW Phase F 新增 RFQ-AUTO-1 行；verify：报告存在，`grep -n 'RFQ-AUTO-1' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR，直接指向 main，不叠层；不自动合并；合并后 `/opsx:archive rfq-round-followup-preapproval --yes`（独立小 PR）。
- 下一个 change：RFQ-AUTO-2 `rfq-round-auto-draft`（要求确认后自动选供应商、自动起草一轮，仍只给一张卡）。

## 7. 独立审查后的修复

- [x] 7.1 覆盖判定加四条（供应商名称、发件人、原邮件主题、回复截止与批准的卡一致）；verify：`followup-coverage.test.ts` 与 `followup-auto-db.isolated.test.ts` 全部通过
- [x] 7.2 带授权的发询价卡不能在 Muse 批、标题标明「含自动跟进授权」；verify：`muse-bridge-pure.test.ts` 全部通过
- [x] 7.3 扫描只排除已取消 / 已完成的轮次；verify：`followup-auto-db.isolated.test.ts`「草稿状态的轮次」
- [x] 7.4 代为执行前核对库里审批记录的内容；执行抛错时按实际状态留审计；已自动发出的封数按卡去重；verify：`followup-coverage.test.ts`、`followup-auto-db.isolated.test.ts`
- [x] 7.5 抽屉里关于回复截止的说明改正；规格、design、报告同步
