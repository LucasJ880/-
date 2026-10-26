# CLAUDE.md — 青砚会话入口

每次会话从零开始。开工前按这个顺序读，不要凭记忆。

## 1. 会话开头必读（按顺序）

1. `openspec/config.yaml` 的 `context:` —— 项目硬纪律的**唯一事实源**（零 schema / 出站先审批 / 禁止第三套队列 / 脱敏 / 不爬登录页 / 邮箱分离 / 确定性优先 / 测试注册）。它会被注入每一次 `/opsx:*`，但你也要自己读一遍。
2. `openspec list` —— 看有没有进行中的 change。接着别人的活用 `/opsx:continue <change>`，不要重开。
3. `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` —— 当前阶段表与状态列（`[ ]` / `[~]` / `[x]` / `[G]`）。状态列以 `git log --oneline --merges` 为准，发现漂移先修状态再干活。
4. 本次任务对应的 `docs/QINGYAN_*_TASKBRIEF.md` 与上一步的 `docs/QINGYAN_*_REPORT.md`。
5. `openspec list --specs` —— 已归档的规格就是"系统现在应该是什么样"；规格只从 change 归档进来，不手写。

## 2. 项目事实

| 项 | 值 |
|---|---|
| 技术栈 | Next.js 16 (App Router) / TypeScript / Tailwind 4 / Prisma 6 + PostgreSQL |
| Node | 24（`.nvmrc`；`package.json` engines `>=24 <25`） |
| 测试 | 单文件 `npx tsx <file>`；全量 `npm test` = `scripts/test-all.sh`；CI 子集 `npm run test:ci` = `scripts/test-ci-unit.sh` |
| 测试注册 | 任何 `src/lib/**/__tests__/*.test.ts` 必须在 `scripts/test-all.sh` 注册；`scripts/check-test-registry.sh` 校验，历史欠账在 `ci/test-registry-baseline.txt`（只减不增） |
| 类型 / lint | `npm run typecheck`；`npm run lint:baseline`（ESLint 历史债务门禁，基线 `ci/eslint-error-baseline.json`） |
| OpenSpec | `@fission-ai/openspec@1.15.0`，profile `custom`，12 个 `/opsx:*` 命令；`openspec update` 应无 diff |
| 主线文档 | `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`（阶段 / GATE / 度量 / 已决定） |
| 不动的 | `.claude/launch.json`；`docs/` 下任何文件不删；`openspec/specs/**` 不手写 |

## 3. 分工

| 角色 | 做什么 |
|---|---|
| Claude（chat） | 写 proposal 粒度的任务书（Why / What / 受影响意图 / Out of scope / 验收）；审 `/opsx:propose` 产出的四件套；GATE 审核 |
| Claude Code | `/opsx:propose <change>` → 四件套回传审核 → `/opsx:apply` → `npm test` → `/opsx:verify <change>` → 开 PR；PR 合并后 `/opsx:archive <change> --yes`（独立小 PR） |
| Evan | 拍板合并；对 `openspec/config.yaml` 里的约定有异议直接改 |

GATE 审核项固定多一条：`openspec validate <change>` 通过，且 specs 增量覆盖了本次改动的全部对外行为。

## 4. 一个 change 的生命周期

```
/opsx:propose <name>   # 只产出 proposal / specs 增量 / design / tasks，不碰代码
   ↓ 回传 Claude 审
/opsx:apply <name>     # 按 tasks 实施，逐条打勾
npm test               # 全量；新测试必须已注册
/opsx:verify <name>    # 完整性 / 正确性 / 一致性报告
开 PR（一个 change = 一个 PR）
   ↓ 合并
/opsx:archive <name> --yes   # specs 增量合入 openspec/specs/**；同步 TASKFLOW 状态列；独立小 PR
```
