# Design

## Context

- `scripts/test-all.sh` 是 `npm test` 的入口：一个 `run_test "<中文名>" "<命令>"` 列表，分四组（纯逻辑 / tsc / AI 分类 / `--api`），末尾汇总 PASS/FAIL。第一组最后一条目前是 Tender T3 企业记忆 DB 集成（第 439 行），紧接着是 TypeScript 编译组。
- 第一组里有一条是间接运行器：`run_test "Runtime Architecture Guards…" "bash scripts/test-runtime-architecture.sh"`，该脚本内部 `npx tsx` 了 7 个 `src/lib/**/__tests__/*.test.ts`。所以"被注册"不能只看 `test-all.sh` 本身。
- 工作树里共 459 个 `src/lib/**/__tests__/*.test.ts`，其中 89 个未被 `test-all.sh`（含间接运行器）引用；13 个是本 change 要补的 muse-bridge / tender-rfq，其余 76 个是历史欠账，任务书 §5 禁止在本 change 里"顺手"补注册。
- 仓库已有同类"历史债务门禁"先例：`scripts/check-eslint-baseline.mjs` + `ci/eslint-error-baseline.json`（基线放 `ci/`，CI 只拦新增）。
- CI（`.github/workflows/ci.yml`）跑的是 `npm run test:ci` = `scripts/test-ci-unit.sh`，不是 `test-all.sh`；本 change 不动它（见 proposal Out of scope）。
- 13 个文件在当前 main 上本地逐个运行全部通过（43/70/59/26/21/31/38/49/70/47/17/47/23，共 541 条断言，单个 < 1.5 秒），都不依赖数据库。

## Goals / Non-Goals

**Goals:**
- `npm test` 从此真正执行这 13 个文件。
- 以后任何新增 / 改名的 `src/lib/**/__tests__/*.test.ts` 漏注册，`npm test` 立即红。
- 历史欠账可见、只减不增，不靠人记。

**Non-Goals:**
- 不改 `src/lib/muse-bridge/**`、`src/lib/tender-rfq/**` 任何源文件或测试文件内容。
- 不注册基线中的 76 个文件；不改 `scripts/test-ci-unit.sh`；不改 `scripts/test-runtime-architecture.sh`。
- 不重构 `scripts/test-all.sh` 的 `run_test` 函数、分组、汇总逻辑；不把列表改成 glob 自动发现。
- 不覆盖 `src/app/**`、`src/components/**`、`scripts/*.test.ts`。

## Decisions

### D1 历史欠账用冻结基线，而不是全部注册或缩小范围
- **选择**：新增 `ci/test-registry-baseline.txt`（每行一个仓库相对路径，76 条），校验脚本把"未注册且不在基线"视为失败；基线条目一旦已注册或文件消失也视为失败（强制从基线删掉）。
- **否决 A：把 89 个全部注册** —— 任务书 §5 明文禁止；而且其中含 `.isolated.test.ts`、需要真实 Postgres 的 DB 矩阵，盲目注册会让 `npm test` 在无库环境里红。
- **否决 B：把规则缩到 `src/lib/muse-bridge` + `src/lib/tender-rfq` 两个目录** —— 规则对 `src/lib/**` 不成立，下一个模块照样漂移，与 SDD-0 "让当前需求有唯一事实源"的动机相悖。
- **否决 C：把基线写死在脚本里** —— 76 行路径塞进 shell 不可读；仓库先例是基线独立放 `ci/`。

### D2 "已注册"的判定 = 路径字符串出现在 `test-all.sh` 或它直接调用的 `scripts/*.sh` 中
- **选择**：把 `scripts/test-all.sh` 与其中出现的每个 `scripts/<name>.sh` 文本拼成一份"注册表"，对每个测试路径做 `grep -F` 整串匹配。只向下看一层。
- **否决 A：只看 `test-all.sh` 本身** —— 会把 `test-runtime-architecture.sh` 跑的 7 个文件误报为未注册。
- **否决 B：解析 `run_test` 第二个参数并执行语义分析** —— 脆、慢；注册表的本质就是"这个路径有没有写进去"。
- 风险：`grep -F` 是子串匹配。路径均以 `src/lib/` 开头且以 `.test.ts` 结尾，在 `run_test` 命令里只会以完整 token 出现，不存在"长路径包含短路径"的情况；接受。

### D3 范围 = `src/lib/**/__tests__/*.test.ts`，包含 `.isolated.test.ts`
- 与任务书一致。`*.isolated.test.ts` 也匹配 `*.test.ts`，而第一组里本来就注册了若干 isolated 测试（它们在无库时自行跳过），所以不另设例外。
- **否决：扩到 `src/app/**`、`src/components/**`** —— 任务书没要求，另一批欠账，另开 change。

### D4 脚本用 bash + find + grep，零依赖
- **选择**：纯 shell，退出码 0 = 通过，1 = 有未注册 / 基线过期，2 = 输入文件缺失。不读任何环境变量、不碰 DB。
- **否决：Node 脚本（像 `check-eslint-baseline.mjs`）** —— 这里不需要 JSON 指纹与 ESLint 进程，shell 更短且不受 `npx` 启动开销影响。

### D5 新条目放在第一组末尾，中文命名，自身注册为"测试注册校验（SDD-0）"
- 13 条 `run_test` 追加在 Tender T3 之后、TypeScript 编译组之前，前面加一行注释说明来源（SDD-0 / P0-9）。校验脚本紧随其后，作为第一组最后一条。
- 名字沿用现有风格：`Muse 桥接 …` / `招标询价 …` 前缀 + 功能名，与各 REPORT 里的称呼一致。
- **否决：放在第一组开头** —— 现有列表按功能线成段排列，插到中间或开头会打断既有段落。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 不涉及（不碰 Prisma / 数据） |
| 2 | 出站先审批 | 不涉及（无任何出站） |
| 3 | 禁止第三套队列 | 不涉及 |
| 4 | 脱敏 | 不涉及（脚本只输出文件路径；测试本身的脱敏断言由被注册的 `muse-bridge-pure` / `advisory` 测试覆盖，本 change 让它们真正在 `npm test` 里跑） |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及（`chase-execute` / `round-pure` 的 mailboxEmail 断言随注册进入 `npm test`） |
| 7 | 确定性优先 | 不涉及 |
| 8 | 测试注册 | **本 change 建立这条纪律**：规则 + 校验脚本 + 基线 |

## Risks / Trade-offs

- [基线被遗忘，76 条永远不减] → 基线过期即失败，强迫维护者在注册时同步删条目；SDD-0 报告里列出剩余数，后续 change 按模块清欠。
- [`npm test` 变长约 15 秒] → 13 个纯逻辑测试均 < 1.5 秒；接受。
- [有人把新测试加进基线而不是注册] → 基线只允许删不允许加是纪律（写进 spec 与 `config.yaml` context 第 8 条）；code review 看 `ci/test-registry-baseline.txt` 的 diff 只能是删行。
- [间接运行器嵌套两层（脚本调脚本调脚本）] → 当前只有一层；出现两层时校验会误报，届时把该脚本直接写进 `test-all.sh` 或扩展一层扫描。

## 验证方式

- `bash -n scripts/test-all.sh`、`bash -n scripts/check-test-registry.sh` 语法通过。
- `bash scripts/check-test-registry.sh` → 退出 0，输出 OK 行；临时 `git mv` 一个已注册测试文件再运行 → 退出 1 并列出新路径；恢复后退出 0。
- 临时从 `test-all.sh` 删一行已注册条目 → 校验列出该文件退出 1；恢复。
- `npm test`：输出含 13 个新 `▶` 项与"测试注册校验（SDD-0）"项，全部 PASS，结尾 ✅。
- `openspec validate register-muse-rfq-tests` 通过。

## Migration Plan

无部署动作。合并即生效；回滚 = revert 该 PR。
