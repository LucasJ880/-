# Spec Delta

## Purpose

测试文件注册纪律：`src/lib` 下每一个测试文件都必须被全量测试入口 `npm test` 真正执行，注册状态由脚本校验，历史欠账以冻结基线记录且只减不增，防止"测试写了却从没跑过"的漂移再次发生。

## ADDED Requirements

### Requirement: 测试文件必须注册进全量测试入口
`src/lib/**/__tests__/*.test.ts` 下的每一个文件 SHALL 在 `scripts/test-all.sh`（或它直接调用的 `scripts/*.sh`）中按仓库相对路径被引用，从而被 `npm test` 执行。唯一例外是 `ci/test-registry-baseline.txt` 中冻结的历史欠账条目。

#### Scenario: 新增或改名的测试文件未注册
- **WHEN** 存在一个 `src/lib/**/__tests__/*.test.ts` 文件，既未在 `scripts/test-all.sh` 及其直接调用的 `scripts/*.sh` 中被引用，也不在 `ci/test-registry-baseline.txt` 中
- **THEN** `bash scripts/check-test-registry.sh` 逐行输出该文件的仓库相对路径，并以退出码 1 结束

#### Scenario: 全部已注册或在基线中
- **WHEN** 每一个 `src/lib/**/__tests__/*.test.ts` 文件都已被引用，或列于基线
- **THEN** `bash scripts/check-test-registry.sh` 输出 OK 行（含已注册文件数与基线剩余条数），并以退出码 0 结束

#### Scenario: 13 个 muse-bridge / tender-rfq 测试进入 npm test
- **WHEN** 运行 `npm test`
- **THEN** 输出中出现 `src/lib/muse-bridge/__tests__/{muse-bridge-pure,advisory,next-step,prefs}.test.ts` 与 `src/lib/tender-rfq/__tests__/{build,round-pure,inbound-parse,inbound-apply,landed-cost,compare,notes-parse,chase-pure,chase-execute}.test.ts` 对应的 13 个 `▶` 项，名称为中文，且全部通过

### Requirement: 注册校验是全量测试的一部分
`scripts/check-test-registry.sh` SHALL 本身在 `scripts/test-all.sh` 中注册为一条 `run_test`，使任何注册漂移直接导致 `npm test` 整体失败。

#### Scenario: npm test 包含注册校验
- **WHEN** 运行 `npm test`
- **THEN** 输出中出现"测试注册校验"项；当存在未注册文件或过期基线条目时该项失败，`npm test` 以非零退出码结束

### Requirement: 历史欠账基线只减不增
`ci/test-registry-baseline.txt` SHALL 只记录本 change 之前已存在且未注册的测试文件，每行一个仓库相对路径。基线条目一旦被注册或文件不再存在，校验脚本 SHALL 将其报告为"基线过期"并以退出码 1 结束，直到该条目从基线移除。

#### Scenario: 基线条目已被注册
- **WHEN** 基线中的某个路径已在 `scripts/test-all.sh`（或其直接调用的 `scripts/*.sh`）中被引用
- **THEN** 校验脚本输出该路径并标记为基线过期，以退出码 1 结束

#### Scenario: 基线条目对应文件已不存在
- **WHEN** 基线中的某个路径在工作树中不存在
- **THEN** 校验脚本输出该路径并标记为基线过期，以退出码 1 结束

### Requirement: 校验不依赖运行时环境
`scripts/check-test-registry.sh` SHALL 只读取工作树文件，SHALL NOT 连接数据库、访问网络或读取任何环境变量；在仅有 bash、find、grep 的环境中 SHALL 能完成校验。

#### Scenario: 无数据库、无环境变量
- **WHEN** 在未设置 `DATABASE_URL` 等任何环境变量、无网络的 shell 中运行 `bash scripts/check-test-registry.sh`
- **THEN** 脚本按注册状态给出退出码 0 或 1，不因环境缺失而报错

#### Scenario: 输入文件缺失
- **WHEN** `scripts/test-all.sh` 或 `ci/test-registry-baseline.txt` 不存在
- **THEN** 脚本输出缺失的文件路径并以退出码 2 结束
