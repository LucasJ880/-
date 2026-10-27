# Tasks

## 1. 注册 13 个测试

- [x] 1.1 在 `scripts/test-all.sh` 第一组末尾（Tender T3 之后、TypeScript 编译组之前）追加 13 条 `run_test`（中文名，前加一行 SDD-0 / P0-9 来源注释），不改任何既有行。verify：`bash -n scripts/test-all.sh` 通过；`grep -c "src/lib/muse-bridge/__tests__\|src/lib/tender-rfq/__tests__" scripts/test-all.sh` 输出 13；13 个文件逐个 `npx tsx` 退出 0。

## 2. 注册校验

- [x] 2.1 新建 `scripts/check-test-registry.sh`（bash + find + grep，退出码 0/1/2，见 design D2/D4）与 `ci/test-registry-baseline.txt`（冻结当前 76 条历史欠账，每行一个路径）。verify：`bash scripts/check-test-registry.sh` 退出 0 并打印 OK 行；临时把一个已注册测试文件改名后运行退出 1 且列出新路径；临时从 `test-all.sh` 删一行已注册条目后运行退出 1；两处恢复后再退出 0。
- [x] 2.2 把 `scripts/check-test-registry.sh` 注册进 `scripts/test-all.sh` 第一组最后一条（"测试注册校验（SDD-0）"），然后跑 `npm test`。verify：输出含 13 个新 `▶` 项与"测试注册校验（SDD-0）"项，全部 PASS，结尾为 ✅ 全部通过。
  - 实测（2026-10-25，无 Postgres 的执行环境）：14 个新项全部 PASS；整体 385/399，14 个失败均为环境性既有问题（10 项 MISSING_DATABASE_URL、T4 需 DATABASE_URL、Gmail/PDF 两项在干净 origin/main 上同样失败、tsc 默认 2GB 堆 OOM 而 6GB 堆重跑退出 0），详见 docs/QINGYAN_SDD-0_REPORT.md §3 用例 4。

## 3. 收尾

- [x] 3.1 写 `docs/QINGYAN_SDD-0_REPORT.md`（做了什么 / 怎么验 / 判断点 / 已知限制，含基线剩余条数与 OpenSpec 接线验收结果）；把 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` P0-9 状态列的"（注册待做）"删掉。verify：报告文件存在；`grep -c "注册待做" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 输出 0；`openspec validate register-muse-rfq-tests` 通过。

## Workflow follow-up

- PR 合并到 main 后再 `/opsx:archive register-muse-rfq-tests --yes`（独立小 PR）；确认 `openspec/specs/qa/test-registry/spec.md` 与 `openspec/changes/archive/<日期>-register-muse-rfq-tests/` 出现，`openspec list --specs` 列出 `qa/test-registry`。
