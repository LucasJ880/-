# SDD-0 完成报告：接入 OpenSpec + 第一个 change `register-muse-rfq-tests`

任务书：`docs/QINGYAN_SDD-0_OPENSPEC_TASKBRIEF.md`
分支：`claude/affectionate-ptolemy-81vzuy`（基于 main `f111f77`，即 #240 之后）
OpenSpec change：`openspec/changes/register-muse-rfq-tests/`（proposal / specs 增量 / design / tasks 四件套，`openspec validate --strict` 通过）

---

## 1. 做了什么

### A. OpenSpec 接线

| 文件 | 内容 |
|---|---|
| `.claude/commands/opsx/*.md`（12） | `/opsx:propose / explore / apply / update / sync / archive / new / continue / ff / bulk-archive / verify / onboard` 斜杠命令，由 `openspec init --tools claude --profile custom` 生成 |
| `.claude/skills/openspec-*/SKILL.md`（12） | 对应技能正文（同上生成） |
| `openspec/config.yaml` | `schema: spec-driven`；`context:` 八条硬纪律 + 工作约定；`rules:` proposal / specs / design / tasks 四组硬检查项；`operations:` apply / archive 指引 |
| `openspec/specs/.gitkeep`、`openspec/changes/archive/.gitkeep` | 空目录占位 |
| `CLAUDE.md` | 会话开头必读顺序（config.yaml → `openspec list` → TASKFLOW → 任务书/报告 → `openspec list --specs`）、项目事实表、分工表、一个 change 的生命周期 |
| `docs/QINGYAN_SDD-0_OPENSPEC_TASKBRIEF.md` | 本任务书原文 |

本机 OpenSpec 全局配置：`telemetry.enabled=false`、`profile=custom`、`workflows` = 上述 12 个。`openspec update --force` 输出 `Updated: Claude Code (v1.15.0)`，24 个文件 md5 全部不变；`openspec doctor` → `OpenSpec root: ok`；`openspec list --json` 的 `root.path` = 仓库根。`.claude/launch.json` 未动。

**与任务书的差异（请审）**：`qingyan-openspec-kit.zip` 不在仓库也不在执行环境里。任务书 §3 文件清单写明命令与技能是 `openspec init` 生成的，所以用同版本 CLI（1.15.0）、同 profile 重新生成；`config.yaml` 的 context / rules 与 `CLAUDE.md` 按任务书 §0、§2.2 描述的来源（TASKFLOW 表头纪律行、T5 preflight §2、Decision A 2026-10-23 = PR #238 邮箱拆分、P1-8 任务书 §2.2/§5）重写。如果 kit 里的版本与这里不同，以 PR 评审意见为准改。

### B. 状态真相修正

| 文件 | 改动 |
|---|---|
| `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` | P1-7（#239）、P1-8（#236）→ `[x]`；**另外** P1-4（#234）、P1-5 / P1-6（#235）同样已合并且 REPORT 在，但仍是 `[ ]`，一并改成 `[x]`——任务书只点名 P1-7 / P1-8，这三行是对照 `git log --merges` 时发现的同类漂移，只改状态列。P0-9 的"（注册待做）"已删 |
| `README.md` | 技术栈表 运行时 `Node.js 20` → `Node.js 24（以 .nvmrc 为准）` |

### C. 第一个 change：`register-muse-rfq-tests`

| 文件 | 内容 |
|---|---|
| `scripts/test-all.sh` | 第一组末尾（Tender T3 之后、TypeScript 编译组之前）追加 13 条 `run_test`（中文名）+ 1 条 `测试注册校验（SDD-0）`；既有行、分组、汇总逻辑未动 |
| `scripts/check-test-registry.sh` | 新增。枚举 `src/lib/**/__tests__/*.test.ts`，与 `scripts/test-all.sh` + 它直接调用的 `scripts/*.sh`（目前只有 `test-runtime-architecture.sh`）比对；未注册且不在基线 → 列出、退出 1；基线条目已注册或文件不存在 → "基线过期"、退出 1；输入文件缺失 → 退出 2；纯 bash/find/grep，不读 env、不碰 DB |
| `ci/test-registry-baseline.txt` | 新增。冻结 SDD-0 之前已存在且未注册的 **76** 个历史欠账文件（与 `ci/eslint-error-baseline.json` 同目录、同"只拦新增"思路）；只允许删行 |
| `openspec/changes/register-muse-rfq-tests/` | proposal.md（含 TASKFLOW ID、Out of scope、受影响意图=无）、`specs/qa/test-registry/spec.md`（4 条 Requirement / 8 个 Scenario，全 ADDED）、design.md（D1–D5、八条硬纪律逐条关系、风险、验证方式）、tasks.md（4 条，全部 `[x]`） |

**注册的 13 个文件与本地通过数**（main `f111f77`，Node 22.22 / tsx）：

| 测试 | 文件 | 通过 |
|---|---|---|
| Muse 桥接 纯逻辑 | `muse-bridge/__tests__/muse-bridge-pure.test.ts` | 43 |
| Muse 桥接 建议式回复契约 | `muse-bridge/__tests__/advisory.test.ts` | 70 |
| Muse 桥接 next_step 确定性查表 | `muse-bridge/__tests__/next-step.test.ts` | 59 |
| Muse 桥接 个人偏好记忆 | `muse-bridge/__tests__/prefs.test.ts` | 26 |
| 招标询价 RFQ 结构化生成器 | `tender-rfq/__tests__/build.test.ts` | 21 |
| 招标询价 轮次锁/发件人解析 | `tender-rfq/__tests__/round-pure.test.ts` | 31 |
| 招标询价 入站解析 | `tender-rfq/__tests__/inbound-parse.test.ts` | 38 |
| 招标询价 入站写入规则 | `tender-rfq/__tests__/inbound-apply.test.ts` | 49 |
| 招标询价 落地价归一化 | `tender-rfq/__tests__/landed-cost.test.ts` | 70 |
| 招标询价 比价矩阵+脱敏投影 | `tender-rfq/__tests__/compare.test.ts` | 47 |
| 招标询价 [auto] 备注回读 | `tender-rfq/__tests__/notes-parse.test.ts` | 17 |
| 招标询价 催单/追问决策与模板 | `tender-rfq/__tests__/chase-pure.test.ts` | 47 |
| 招标询价 催单执行器 | `tender-rfq/__tests__/chase-execute.test.ts` | 23 |

合计 541 条断言，此前一条都不在 `npm test` 里。

**与任务书的差异（请审）**：任务书 §2.3 说 C 只改 `test-all.sh` 并新增 `check-test-registry.sh`。实际盘点发现 `src/lib/**/__tests__/*.test.ts` 共 459 个，未注册的有 89 个（13 个是本次的，76 个是更早的欠账），而 §5 禁止"顺手"补其它测试。因此多了一个文件 `ci/test-registry-baseline.txt` 作冻结基线，让"任何测试必须注册"的规则对新增/改名文件立即生效、对历史欠账只减不增（design D1 写了被否决的两个备选：全部注册 / 把范围缩到两个目录）。

---

## 2. 怎么验

```bash
# 校验脚本（spec 的 8 个 Scenario 全部实跑过，见 §3）
bash scripts/check-test-registry.sh          # OK 测试注册校验通过：已注册 383 个；历史欠账基线剩余 76 条；rc=0
mv src/lib/muse-bridge/__tests__/advisory.test.ts src/lib/muse-bridge/__tests__/advisory-renamed.test.ts
bash scripts/check-test-registry.sh          # 列出 advisory-renamed.test.ts；rc=1（验收用例 4）
# 恢复后 rc=0

# 全量
npm test                                     # 测试结果: 385/399 通过, 14 失败——14 个新项（13 测试 + 注册校验）全部 PASS；
                                             # 14 个失败全部是环境性/既有问题，见 §3 用例 4 与 §5
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit   # 退出 0（test-all 内的 tsc 项在默认 2GB 堆下 OOM）

# OpenSpec
openspec validate register-muse-rfq-tests --strict   # Change 'register-muse-rfq-tests' is valid
openspec update                                      # All 1 tool(s) up to date (v1.15.0)；git diff --stat .claude openspec 为空
openspec doctor                                      # OpenSpec root: ok
```

---

## 3. 验收用例对照（任务书 §4）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 新会话问"青砚现在有哪些硬纪律"能答出 ≥3 条 | `CLAUDE.md` §1 第一条指向 `openspec/config.yaml` 的 `context:`（八条硬纪律）；`openspec instructions proposal --json` 实测返回 `context` 1508 字节 + 5 条 `rules.proposal`，链路通。真正的"新会话盲问"留给审核方做 |
| 2 | proposal 含 Out of scope 且写了 TASKFLOW ID | ✅ proposal.md 开头 `TASKFLOW：P0-9 / SDD-0`，末节 `Out of scope` |
| 3 | `openspec update` 输出 v1.15.0 且 `.claude` / `openspec` 无 diff | ✅ `--force` 重生成后 24 个文件 md5 不变 |
| 4 | `npm test` 新增 13 个 PASS；改名一个文件后校验退出 1 | ✅ 13 个新项 + "测试注册校验（SDD-0）"在 `npm test` 内全部 PASS；校验脚本改名 / 删注册行 / 基线过期 / 缺基线（rc=2）/ 无 env 六种情形全部按 spec 退出。整体 385/399：14 个失败全部与本 change 无关——10 项 `MISSING_DATABASE_URL`（Agent Trace / Phase3A-2…5 / Governance Hygiene）、`T4 授标情报真实 Postgres 矩阵` 需要 DATABASE_URL、`Gmail Draft OAuth Compose Scope` 与 `Quote Operations 客户报价 PDF 分页布局` 在干净的 origin/main 工作树上同样失败（已实跑复现）、`TypeScript 类型检查` 在默认 2GB 堆下 OOM，单独以 6GB 堆重跑退出 0 |
| 5 | archive 后 `openspec list --specs` 列出 `qa/test-registry` | ⏳ 等 PR 合并后 `/opsx:archive register-muse-rfq-tests --yes`（独立小 PR）再验 |
| 6 | TASKFLOW P1-7 / P1-8 与 `git log --merges` 一致；P0-9 不带"注册待做" | ✅（P1-4/5/6 一并修正，见 §1-B） |
| 7 | `.claude/launch.json` 未变 | ✅ `git diff` 无该文件 |

---

## 4. 判断点（请审）

1. **P1-4 / P1-5 / P1-6 也改成了 `[x]`**：证据与 P1-7 / P1-8 同等（合并 PR + REPORT）。不同意就只回退这三行。
2. **基线文件 `ci/test-registry-baseline.txt`（76 条）**：是任务书之外的文件。替代方案是把规则缩到两个目录，但那样下一个模块照样漂移。基线条目"已注册或已删除即失败"是故意的——逼着注册时同步删基线。
3. **"已注册"向下只看一层间接运行器**：目前只有 `test-runtime-architecture.sh` 一个；出现脚本调脚本调脚本时会误报，到时直接写进 `test-all.sh` 或扩一层。
4. **`openspec/config.yaml` 的 context 第 8 条与工作约定**是本次新加的纪律与约定（"一个 change = 一个 PR"、"archive 同步 TASKFLOW"、"specs 不手写"），Evan 不同意直接删。
5. **Node 版本**：执行环境只有 Node 22.22（≥ 20.19，满足 OpenSpec 要求），不是 `.nvmrc` 的 24；`npm ci` 对 `engines >=24 <25` 只告警。所有测试数在 Node 22 下取得。

---

## 5. 已知限制 / 发现

- **CI 不跑 `test-all.sh`**：`.github/workflows/ci.yml` 跑的是 `npm run test:ci`（`scripts/test-ci-unit.sh`，一个手工子集），所以这 13 个测试仍然不在 CI 门禁里，`check-test-registry.sh` 也不在。把校验脚本加进 `test-ci-unit.sh` 是一行改动，但任务书 §5 禁止在本次顺手改，建议作为下一个 change（`ci-run-test-registry-check`）。
- **历史欠账 76 个**，按目录：supplier-intel 12、trade 10、sales 9、marketing 7、reminders 4、operations 4、blinds 4、bid-workflow 4、env 3、digital-employees 3，其余 16 个散落在 visualizer / revenue-spine / projects / knowledge 等 12 个目录。建议按模块清欠，每次一个小 change，同时从基线删行。
- **`test-all.sh` 的 tsc 项没带 `NODE_OPTIONS`**（`npm run build` 用的是 `--max-old-space-size=6144`），在 2GB 默认堆的机器上会 OOM 误报。既有问题，任务书 §5 禁止在本次重构 `test-all.sh`，建议下一个 change 顺手对齐。
- `/opsx:archive` 要等 PR 合并；archive 时会把 `specs/qa/test-registry/spec.md` 合成 `openspec/specs/qa/test-registry/spec.md`，change 目录移到 `openspec/changes/archive/<日期>-register-muse-rfq-tests/`。

---

## 6. `/opsx:verify register-muse-rfq-tests` 结果（2026-10-25）

| 维度 | 结果 |
|---|---|
| 完整性 · 任务 | 4/4 `[x]`（`openspec instructions apply --json` → `state: all_done`，`progress {total:4, complete:4, remaining:0}`） |
| 完整性 · 规格覆盖 | 4 条 ADDED Requirement 均有对应实现：R1 → `test-all.sh` 13 行 + `check-test-registry.sh`；R2 → `test-all.sh` 第 457 行；R3 → 脚本"基线过期"分支 + `ci/test-registry-baseline.txt`；R4 → 脚本只用 bash/find/grep、不读 env |
| 正确性 · Scenario | 8/8 实跑：未注册（改名 / 删注册行）→ rc=1 并列出路径；全部注册 → OK 行 rc=0；13 项进入 `npm test` 且 PASS；`npm test` 含"测试注册校验（SDD-0）"项；基线条目已注册 → rc=1；基线条目文件不存在 → rc=1；`env -i` 下 rc=0；缺基线文件 → rc=2 |
| 一致性 · 设计 | D1（冻结基线放 `ci/`）、D2（间接运行器一层、`grep -F`）、D3（范围含 `.isolated.test.ts`）、D4（纯 shell，退出码 0/1/2）、D5（第一组末尾、中文名、校验为最后一条）全部按 design 落地 |
| 一致性 · 代码风格 | 脚本头部注释与用法块沿用 `test-all.sh` 的中文 banner 风格；可执行位与 `test-all.sh` 一致；基线放置与 `ci/eslint-error-baseline.json` 同目录 |

**CRITICAL**：无。

**WARNING**（2）：
1. R2 Scenario 的后半句"该项失败时 `npm test` 以非零退出码结束"没有单独实跑（要跑一遍全量），由 `test-all.sh` 既有逻辑推得：`run_test` 失败 → `FAIL+1` → 末尾 `exit 1`（第 477–482 行）。
2. 本执行环境没有 Postgres，`npm test` 整体 385/399；14 个失败全部与本 change 无关（§3 用例 4），但"结尾 ✅"这一验收在本环境不可达，需在有隔离库的机器上复跑一次确认。

**SUGGESTION**（2）：
1. 下一个 change 把 `bash scripts/check-test-registry.sh` 加进 `scripts/test-ci-unit.sh`，让注册漂移进 CI 门禁（本任务书禁止顺手改 CI 子集）。
2. `test-all.sh` 的 tsc 项加 `NODE_OPTIONS=--max-old-space-size=6144` 与 `npm run build` 对齐，避免小内存机器 OOM 误报。

结论：No critical issues. 2 warning(s) to consider. Ready for archive（等 PR 合并后执行）。
