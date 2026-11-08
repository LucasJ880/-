# Proposal: spec-strict-hygiene

**TASKFLOW：** 无（基础设施）。本 change 只整理已归档规格的写法，不交付新的 TASKFLOW 任务。
**受影响的 Muse 意图：** 无。本 change 不改 `src/`，不触碰 muse-bridge。

## Why

`openspec validate --specs --strict` 在 main（1c9ea12）上 77/81 通过，4 个主规格失败：两条要求描述超过 500 字（`authorization/position-catalog`「新增权限键登记」510 字、`sunny/process-order-autogen`「斑马帘布纱比对照表」535 字），两个 Purpose 不足 50 字（`accounting/workspace`、`inventory/fabric-stock-access`），非严格模式下全部通过。

## What Changes

- 拆分 `authorization/position-catalog` 的「新增权限键登记」：REMOVED 原要求；ADDED「岗位体系权限键登记」（原文第一句：15 个键的清单与中文标签 / 风险等级 / 数据范围，带场景「权限键可识别」）与「岗位管理键只允许人类主体」（原文第二句，带场景「岗位管理键不开放给数字员工」）。
- 拆分 `sunny/process-order-autogen` 的「斑马帘布纱比对照表」：REMOVED 原要求；ADDED「斑马帘布纱比对照表维护」（原文第一句：存储位置、种子、读写入口、保存权限与 AuditLog，带场景「组织隔离」「出单岗位可以保存」「无出单权限的普通成员只读」「只持其他品类出单键」）与「斑马帘布纱比查表」（原文第二句：按 SKU 查表的命中规则与默认 3:2，带场景「系列名命中」「未命中」）。
- 新增能力 `qa/spec-validation`：一条要求写明主规格在 `openspec validate --specs --strict` 下全部通过。
- 拆分时要求原文逐字保留、只按句号切开；场景逐字搬运、一条不增、一条不删；不改变任何要求的含义。

## Capabilities

### New Capabilities
- `qa/spec-validation`：已归档主规格的写法纪律——`openspec/specs/**` 在 OpenSpec 严格校验下全部通过。

### Modified Capabilities
- `authorization/position-catalog`：「新增权限键登记」拆成两条（REMOVED + 2 × ADDED），行为不变。
- `sunny/process-order-autogen`：「斑马帘布纱比对照表」拆成两条（REMOVED + 2 × ADDED），行为不变。

## Impact

- `openspec/changes/spec-strict-hygiene/**`：本 change 的四件套与 3 个增量规格。
- 归档后（独立小 PR）：`openspec/specs/authorization/position-catalog/spec.md`、`openspec/specs/sunny/process-order-autogen/spec.md` 各少 1 条、多 2 条要求，新要求排在各自规格末尾；新增 `openspec/specs/qa/spec-validation/spec.md`。
- 原要求名「新增权限键登记」「斑马帘布纱比对照表」只在这两个主规格里作为要求名出现；`src/` 与 `docs/` 里同名字符串是页面标题 / 注释 / 报告小节名，不是对要求的引用，不受影响。
- 不改 `src/`、`scripts/`、`ci/`、Prisma schema；`npm test` 的已注册测试不受影响。

## Out of scope

- 不改任何 `src/` 代码、测试文件与 `scripts/test-all.sh`。
- 不在 CI（`scripts/test-ci-unit.sh` / `.github/workflows/ci.yml`）里加 `openspec validate --specs --strict`；是否加由后续 change 决定。
- 不改两个过短的 Purpose：OpenSpec 归档会忽略增量里的 Purpose，`accounting/workspace` 与 `inventory/fabric-stock-access` 的 Purpose 经维护者同意，作为一次性例外在本 PR 里单独一个 commit 直接改主规格 Purpose 段，不在本 change 的 tasks 与增量里。
- 不拆、不改任何未超长的要求；不调整既有要求的顺序。
- 不改 `openspec/changes/archive/**` 里的历史 change。
- 不在本 change 内 archive；archive 等 PR 合并后另开小 PR。
