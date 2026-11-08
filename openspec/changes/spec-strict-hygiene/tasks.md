# Tasks

> 本 change 是纯规格 change：增量（`specs/**`）已在 propose 阶段写好，apply 只做核对与预演，不改 `src/`，也不写 `openspec/specs/**`。
> 两个 Purpose 的直接修订（design D3，维护者同意的一次性例外）不是本 change 的 task，在本分支上单独一个 commit 完成。
> 下面命令里的 `openspec` 都指 `@fission-ai/openspec@1.15.0`，运行前 `export OPENSPEC_TELEMETRY=0`。

## 1. 增量逐字核对

- [ ] 1.1 核对 `specs/authorization/position-catalog/spec.md`：两条 ADDED 的描述按顺序拼接与 main 上「新增权限键登记」原描述逐字相等；原要求的 2 个场景块在 ADDED 里各出现一次且逐字相等。verify：`diff <(git show origin/main:openspec/specs/authorization/position-catalog/spec.md | sed -n 74p) <(awk '/^### Requirement: 岗位体系权限键登记/{getline;printf "%s",$0} /^### Requirement: 岗位管理键只允许人类主体/{getline;print}' openspec/changes/spec-strict-hygiene/specs/authorization/position-catalog/spec.md)` 无输出；`diff <(git show origin/main:openspec/specs/authorization/position-catalog/spec.md | sed -n 76,82p | grep -v '^$' | sort) <(sed -n '/^## ADDED/,$p' openspec/changes/spec-strict-hygiene/specs/authorization/position-catalog/spec.md | grep -E '^#### |^- \*\*' | sort)` 无输出。
- [ ] 1.2 核对 `specs/sunny/process-order-autogen/spec.md`：两条 ADDED 的描述按顺序拼接与 main 上「斑马帘布纱比对照表」原描述逐字相等；原要求的 6 个场景块在 ADDED 里各出现一次且逐字相等。verify：`diff <(git show origin/main:openspec/specs/sunny/process-order-autogen/spec.md | sed -n 49p) <(awk '/^### Requirement: 斑马帘布纱比对照表维护/{getline;printf "%s",$0} /^### Requirement: 斑马帘布纱比查表/{getline;print}' openspec/changes/spec-strict-hygiene/specs/sunny/process-order-autogen/spec.md)` 无输出；`diff <(git show origin/main:openspec/specs/sunny/process-order-autogen/spec.md | sed -n 51,73p | grep -v '^$' | sort) <(sed -n '/^## ADDED/,$p' openspec/changes/spec-strict-hygiene/specs/sunny/process-order-autogen/spec.md | grep -E '^#### |^- \*\*' | sort)` 无输出。

## 2. 校验与归档预演

- [ ] 2.1 校验增量并在仓库副本里预演归档。verify：`openspec validate spec-strict-hygiene --strict` 输出 `Change 'spec-strict-hygiene' is valid`；把 `openspec/` 复制到一个空的临时目录，在那里跑 `openspec archive spec-strict-hygiene --yes`（输出 `Totals: + 5, ~ 0, - 2, → 0`）再跑 `openspec validate --specs --strict`，在两个 Purpose 的直接修订 commit 已在本分支上的前提下输出 `Totals: 81 passed, 0 failed (81 items)`；回到仓库后 `git status --short openspec/specs openspec/changes/archive` 无输出（预演不落到仓库）。
- [ ] 2.2 回归确认本 change 不影响代码与测试。verify：`git diff --stat origin/main -- src scripts ci prisma .github` 无输出；`bash scripts/check-test-registry.sh` 退出 0；`npm test` 的通过 / 失败清单与改前基线（同一环境下在 origin/main 上跑一次）一致，差异逐条记入 PR 描述；`NODE_OPTIONS=--max-old-space-size=7168 npm run typecheck` 退出 0。

## Workflow follow-up

- PR 合并到 main 后再 `/opsx:archive spec-strict-hygiene --yes`（独立小 PR）；该 PR 里确认 `openspec list --specs` 列出 `qa/spec-validation`，且 `OPENSPEC_TELEMETRY=0 openspec validate --specs --strict` 全部 ✓、退出码 0。
- TASKFLOW：无（基础设施），归档时不改 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 状态列。
