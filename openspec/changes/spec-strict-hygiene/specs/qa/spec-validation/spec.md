# Spec Delta

## Purpose

约束 `openspec/specs/**` 这批已归档主规格的写法：在项目锁定的 OpenSpec CLI（`@fission-ai/openspec@1.15.0`）严格校验下全部通过，Purpose 不过短、要求描述不超长，使"规格即系统现状"可以被一条命令机械地检查。

## ADDED Requirements

### Requirement: 主规格严格校验通过
`openspec/specs/**` 下的全部主规格 SHALL 在 `openspec validate --specs --strict`（CLI 版本 `@fission-ai/openspec@1.15.0`）下通过，命令 SHALL 以退出码 0 结束；任何 change 归档进 `openspec/specs/**` 后 SHALL NOT 让该命令出现失败项。

#### Scenario: 全量严格校验
- **WHEN** 在 main 上运行 `OPENSPEC_TELEMETRY=0 openspec validate --specs --strict`
- **THEN** 输出的每一项都是 `✓`，汇总行的失败数为 0，退出码为 0

#### Scenario: 曾经失败的四个规格
- **WHEN** 对 `accounting/workspace`、`authorization/position-catalog`、`inventory/fabric-stock-access`、`sunny/process-order-autogen` 逐个运行 `OPENSPEC_TELEMETRY=0 openspec validate <spec-id> --type spec --strict`
- **THEN** 四条命令都报告该规格有效，均不再出现 `Purpose section is too brief` 或 `Requirement text is very long` 警告，退出码均为 0
