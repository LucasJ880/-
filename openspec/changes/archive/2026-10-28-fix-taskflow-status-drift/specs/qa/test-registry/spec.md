# Spec Delta

## ADDED Requirements

### Requirement: 注册校验在 CI 子集中执行
`scripts/test-ci-unit.sh`（`npm run test:ci`，即 CI 实际运行的测试入口）SHALL 执行 `bash scripts/check-test-registry.sh`；该校验退出码非 0 时，`npm run test:ci` SHALL 以非零退出码结束。只把测试文件加进 CI 子集、却没有注册进 `scripts/test-all.sh` 的提交，SHALL NOT 通过 CI。

#### Scenario: CI 子集包含注册校验
- **WHEN** 在全部测试文件都已注册或列于基线的工作树上运行 `npm run test:ci`
- **THEN** 输出中出现 `bash scripts/check-test-registry.sh` 的 OK 行，且 `npm run test:ci` 以退出码 0 结束

#### Scenario: 只进了 CI 子集、没进全量入口的测试文件
- **WHEN** 某个 `src/lib/**/__tests__/*.test.ts` 只在 `scripts/test-ci-unit.sh` 中被引用，既未在 `scripts/test-all.sh` 中引用，也不在 `ci/test-registry-baseline.txt` 中，然后运行 `npm run test:ci`
- **THEN** 输出列出该文件的仓库相对路径，`npm run test:ci` 以非零退出码结束

#### Scenario: 两个 trade 通道入站标识测试进入 npm test
- **WHEN** 运行 `bash scripts/check-test-registry.sh`
- **THEN** 输出不再列出 `src/lib/trade/__tests__/inbound-org.test.ts` 与 `src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts`，并以退出码 0 结束
