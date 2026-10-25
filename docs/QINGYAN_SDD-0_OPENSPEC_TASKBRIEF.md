# SDD-0 任务书：接入 OpenSpec，让"当前需求"有唯一事实源

| 项 | 值 |
|---|---|
| 编号 | SDD-0（基础设施；不占 TASKFLOW 阶段表编号） |
| 动机 | 做到后面人和 AI 都忘了前面的需求。证据就在本仓库：① `scripts/test-all.sh` 里一条 muse-bridge / tender-rfq 测试都没注册（P0-9 写着"注册待做"，之后 P1-1…P1-8 共 13 个测试文件全漏了）；② `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 第 59–60 行 P1-7 / P1-8 仍是 `[ ]`，但 PR #239 已合并、两份 REPORT 都在；③ 根目录没有 `CLAUDE.md`，Claude Code 每次会话从零开始；④ `docs/` 已有 222 份文件，没有一份是"系统现在应该是什么样" |
| 依赖 | 无（不碰业务代码） |
| 执行者 | Claude Code |
| 审核 | Claude（chat） |
| 配套 | `qingyan-openspec-kit.zip`（已按本仓库生成好的 `.claude/` 技能、`openspec/` 配置、`CLAUDE.md`） |

## 0. 先读

- `openspec/config.yaml`（kit 内）— `context:` 是项目硬纪律，会被注入每一次 `/opsx:*`；看一遍，有不对的地方在 PR 里改，不要留到聊天里
- `CLAUDE.md`（kit 内）— 会话开头读什么、按什么顺序
- `.claude/skills/openspec-propose/SKILL.md` 与 `openspec-archive-change/SKILL.md` — 了解 change 目录结构（proposal / specs 增量 / design / tasks）和 archive 时 specs 如何合并
- OpenSpec 官方对既有项目的建议：不要回填全部规格，specs 从真实变更里长出来；所以本任务只做"接线"+ 一个很小的真实变更

## 1. 做四件事

### A. 装 CLI，落文件

1. `node -v` 必须 ≥ 20.19（`.nvmrc` 是 24，`nvm use` 即可）；`npm i -g @fission-ai/openspec@1.15.0`（锁 1.15.0，与 kit 生成版本一致）。
2. 在仓库根目录解压 `qingyan-openspec-kit.zip`（会得到 `.claude/commands/opsx/*.md` ×12、`.claude/skills/openspec-*/SKILL.md` ×12、`openspec/{config.yaml,specs/,changes/archive/}`、`CLAUDE.md`、本任务书）。现有 `.claude/launch.json` 不受影响。
3. 关掉匿名统计：`openspec config set telemetry.enabled false`。
4. 让本机 profile 与 kit 一致（否则下次 `openspec update` 会把 6 个扩展命令删掉）：

```bash
openspec config set profile custom
openspec config set workflows '["propose","explore","apply","update","sync","archive","new","continue","ff","bulk-archive","verify","onboard"]'
openspec update        # 应输出 "Updated: Claude Code (v1.15.0)"，文件无 diff
```

5. `openspec doctor` 应显示 `OpenSpec root: ok`；`openspec list --json` 的 `root` 非 null。

### B. 修正两处已漂移的"状态真相"

- `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：对照 `git log --oneline --merges -30` 与 `docs/QINGYAN_TENDER_P1-7_REPORT.md`、`P1-8_REPORT.md`，把 P1-7 / P1-8 状态列改成实际值（预期 `[x]`），P0-9 的"（注册待做）"在 C 完成后删掉。只改状态列，不改任务描述。
- `README.md` 技术栈表 Node 行：`20` → 以 `.nvmrc` 为准（24）。

### C. 第一个真实 change：补注册漏掉的测试

用它跑通整个闭环，同时把 P0-9 的欠账还上。

```bash
/opsx:propose register-muse-rfq-tests
```

proposal 要点（给 Claude Code 的输入，不是让它照抄）：

- Why：`npm test` 当前不覆盖 muse-bridge / tender-rfq 任何一条断言，CI 绿≠这两个模块没坏。
- What：把下列 13 个文件注册进 `scripts/test-all.sh` 的 `run_test` 列表（名字用中文，与现有风格一致）：
  `src/lib/muse-bridge/__tests__/{muse-bridge-pure,advisory,next-step,prefs}.test.ts`
  `src/lib/tender-rfq/__tests__/{build,round-pure,inbound-parse,inbound-apply,landed-cost,compare,notes-parse,chase-pure,chase-execute}.test.ts`
- specs 增量：新建 capability `qa/test-registry`，一条 Requirement："SHALL 任何 `src/lib/**/__tests__/*.test.ts` 都必须在 `scripts/test-all.sh` 注册"，Scenario 用 WHEN/THEN；再加一条校验脚本 `scripts/check-test-registry.sh`（列出未注册的测试文件，非空则退出 1），并把它自己也注册进 test-all。
- tasks：≤ 4 条，每条带 verify；最后一条固定是"写 `docs/QINGYAN_SDD-0_REPORT.md` + 更新 TASKFLOW P0-9 备注"。
- 走完 `/opsx:apply` → 跑 `npm test`（13 个新项全部 PASS）→ `/opsx:verify register-muse-rfq-tests` → 开 PR。
- PR 合并后再 `/opsx:archive register-muse-rfq-tests --yes`，确认 `openspec/specs/qa/test-registry/spec.md` 出现、`openspec/changes/archive/2026-xx-xx-register-muse-rfq-tests/` 出现（archive 是第二个小 PR）。

### D. 从下一个任务起改工作方式

- Claude（chat）的任务书改为 proposal 粒度（Why / What / 受影响意图 / Out of scope / 验收），由 Claude Code 跑 `/opsx:propose` 生成四件套后先回传给 Claude 审，再 `/opsx:apply`。
- 换会话续做用 `/opsx:continue <name>`；不要凭记忆重写。
- 每个 GATE 审核项多一条："`openspec validate <change>` 通过，且 specs 增量覆盖了本次改动的全部对外行为"。

## 2. 细节

### 2.1 为什么不回填全部规格

OpenSpec 官方《Existing Projects》明确：只为即将改动的部分写规格，未触碰代码的规格会很快过期。青砚招投标线正在高频改动，Phase 2 开始时自然会把 `tender-intel` / `muse-bridge` 的规格长出来。如果 GATE-1 联调前确实需要一份"Muse 桥接当前行为"的基线，再单独开一个 change（`baseline-muse-bridge-v1`，specs 全部为 ADDED，tasks 只有核对项），不要混进本任务。

### 2.2 `openspec/config.yaml` 里哪些是我加的、可以改

- `context:` 的"硬纪律"来自 TASKFLOW 表头纪律行、T5 preflight §2、Decision A（2026-10-23）与 P1-8 任务书 §2.2；"一个 change = 一个 PR"和"archive 时同步更新 TASKFLOW 状态"是本任务书提议的约定，Evan 不同意就删。
- `rules:` 四组是对 proposal / specs / design / tasks 的硬性检查项，会注入到对应生成步骤；觉得啰嗦可以减，不要加"请尽量"这类软话。

### 2.3 不改的

- 不动任何 `src/` 业务代码（C 只改 `scripts/test-all.sh` 与新增 `scripts/check-test-registry.sh`）。
- 不删 `docs/` 任何文件。
- 不装 Beads / claude-mem；那是第二步，等 OpenSpec 跑顺两个 change 再说。

## 3. 文件清单

| 文件 | 内容 | 来源 |
|---|---|---|
| `.claude/commands/opsx/*.md`（12） | `/opsx:*` 斜杠命令 | kit（`openspec init` 生成） |
| `.claude/skills/openspec-*/SKILL.md`（12） | 对应技能正文 | kit（同上） |
| `openspec/config.yaml` | schema + 项目 context + rules + operations | kit（已按青砚定制） |
| `openspec/specs/.gitkeep`、`openspec/changes/archive/.gitkeep` | 空目录占位 | kit |
| `CLAUDE.md` | 会话开头必读顺序 + 项目事实 + 分工 | kit（新建） |
| `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` | 状态列修正 | B |
| `README.md` | Node 版本行 | B |
| `scripts/test-all.sh`、`scripts/check-test-registry.sh` | 注册 13 个测试 + 注册校验 | C（通过 change 实现） |
| `openspec/changes/register-muse-rfq-tests/` → 合并后 `openspec/changes/archive/…`、`openspec/specs/qa/test-registry/spec.md` | 第一个 change 及其归档 | C |
| `docs/QINGYAN_SDD-0_REPORT.md` | 完成报告 | C |

## 4. 验收用例

1. 新开一个 Claude Code 会话，不给任何上下文，问"青砚现在有哪些硬纪律"→ 能答出零 schema / 出站先审批 / 脱敏三条以上（说明 `CLAUDE.md` → `config.yaml` 这条链通了）。
2. `/opsx:propose` 生成的 proposal 含"Out of scope"一节且写了 TASKFLOW ID（`rules.proposal` 生效）。
3. `openspec update` 输出 v1.15.0 且 `git diff --stat .claude openspec` 为空（profile 与 kit 一致）。
4. `npm test` 新增 13 个 PASS 项；故意把其中一个文件改名后 `scripts/check-test-registry.sh` 退出码 1。
5. archive 后 `openspec list --specs` 列出 `qa/test-registry`；`openspec show qa/test-registry` 能看到 Requirement 与 Scenario。
6. TASKFLOW 的 P1-7 / P1-8 状态与 `git log --merges` 一致；P0-9 不再带"注册待做"。
7. `.claude/launch.json` 内容未变。

## 5. 禁止事项

- 禁止用 `/opsx:*` 之外的方式手写 `openspec/specs/**`（规格只能从 change 归档进来，否则又回到"文档散落"）。
- 禁止在本任务里"顺手"补其它测试或重构 `test-all.sh` 结构。
- 禁止把 `openspec/` 或 `.claude/` 加进 `.gitignore`——它们必须入库，这是整个方案成立的前提。
- 禁止在没有合并 PR 的情况下 archive。
