# 观察期包4 — 单文件页数上限 80 → 400 实施报告

日期：2026-08-17 · 分支 `feature/tender-obs-p4-page-limit-400` · base = main `18b1b07d`
（冻结基线 `965258c0` 之后的 drift 已审计：#111 财务 / #120 Autopilot，与本包文件面零交集）

## 1. 口径（2026-08-17 用户拍板）

| 决策点 | 结论 |
|---|---|
| 解析层单文件上限 | `MAX_PDF_PAGES` 80 → **400**（与整包上限对齐） |
| legacy（包分析）管线 | **保持 80**（新常量 `PACKAGE_ANALYSIS_MAX_PDF_PAGES`），仅 Workforce 吃大文件 |
| workforce 整包门 | **新增 400 页 fail-closed 门**（t2，与 auto 路径同口径） |

保持 80 的依据（都是已记录的生产事实）：legacy EXTRACT_FACTS 单步超 Vercel 300s
被硬杀且无中途 checkpoint（「一直分析中」根因）；legacy 读 200k 字符截断的整文
`contentText`，400 页密排文本必然静默截断。Workforce t3 按页级窗口读、可续跑
（T5-P1.1），二者都不存在，这是 400 页现在才可行的原因。

## 2. 改动清单（SCHEMA_CHANGE = NONE）

- `src/lib/tender-auto-analysis/page-parse.ts` — `MAX_PDF_PAGES=400`；新增
  `PACKAGE_ANALYSIS_MAX_PDF_PAGES=80`（含语义注释：解析护栏 ≠ 分析口径）
- `src/lib/tender-auto-analysis/package.ts` — `getTenderPackageDocuments`
  选择层跳过 `pageCount > 80` 的文件（force 手动纳入可越过，worker 兜底拦）
- `src/lib/tender-auto-analysis/worker.ts` — `stepEnsurePages` 新增
  `PAGE_LIMIT_EXCEEDED` 显式守卫（覆盖「入队时页数未知、解析后才知道超限」
  与 force 两种路径；报错带文件名+页数+上限；重试的新 run 在选择层自然排除，
  与旧行为「首跑失败、重试恢复」对齐，零回归）
- `src/lib/tender-auto-analysis/package-coverage.ts` — 新排除归因
  `over_page_limit`，逐文件文案含**真实页数**（「216 页超出包分析单文件 80 页
  上限（可由 AI 分析纳入）」）——落实包4「用户不用问就知道为何被排除」；
  `parse_failed` 优先级高于页数归因（真解析失败不被掩盖）
- `src/lib/tender-workforce/tools.ts` — t2 `handleParseDocuments` 解析后新增
  整包 `PACKAGE_TOO_LARGE` fail-closed 门（`> MAX_TENDER_PACKAGE_PAGES=400`
  显式报错，绝不静默截断/丢文档）
- 测试：钉值探针更新（ready-gate / package-fingerprint / review-hardening——
  「上限不过大」的成本守卫改由 `PACKAGE_ANALYSIS_MAX_PDF_PAGES <= 120` 承接）；
  新增 `__tests__/obs-p4-page-limit.test.ts`（13 探针，含 2 条静默截断反例守卫）；
  新增 `scripts/obs-p4-real-bigfile-e2e.ts`（真实大文件 E2E harness，支持
  `--seed-file` 全本地 blob 模式）；均已注册 test-all.sh / test-ci-unit.sh

## 3. 测试证据

- 纯平面：obs-p4 13/13、ready-gate 43/43、review-hardening 18/18、
  package-fingerprint 28/28、page-parse 14/14、package-coverage 17/17
- `tsc --noEmit` 全量零错；eslint 变更文件零告警；CI 单测子集 PASS
- **真实大文件 E2E 6/6**（隔离 Neon 生产快照分支 + 真实文件，零模型调用）：
  `26-58058_Annex Ai_Specifications.pdf`（真实招标附件，8.5MB/158 页）走产品
  同一条上传→落行→解析链：2794ms 解析、158 页行=pageCount（零截断）、
  包分析选择层排除、coverage 归因 `over_page_limit` 且文案含真实页数。
  ——生产 T-1085 Doc4（216 页）blob 属私有 store，本地缺
  `BLOB_PRIVATE_READ_WRITE_TOKEN` 不可读（既有已知缺口），故用本地真实
  招标文件经 `PRODUCT_CONTENT_LOCAL_STORE=1` 全本地链路替代；文件为真实
  业务文档，非伪造数据。

## 4. 成本外推（提限验收要求的对比数据）

生产首单基线（T-1085，163 页）：157 grounding + 2 analyst ≈ 159 次调用，
~1.9M 入 / ~1.1M 出字符，纯工作 ~20–25min。按页线性外推：

| 包规模 | 预计调用 | 预计字符量 | 预计纯工作时间 |
|---|---|---|---|
| 163 页（基线） | ~159 | 1.9M/1.1M | 20–25min |
| 400 页（新上限） | ~390 | ~4.7M/~2.7M | ~50–60min |

400 页包预计 t3 让出 ~15–20 次 → 总 invocation ~20，仍在包1 自触发链
depth 上限 25 之内（超限也只是退回 cron 节拍，不失败）。真实 400 页级
全模型跑数留观察期首个真实大包时在包0 监控中采集。

## 5. 遗留与边界

- 整包上限 400 不变：一个 400 页文件 + 其它文档会触发整包门（auto 路径
  报「请人工选择文件」；t2 显式 PACKAGE_TOO_LARGE）。是否提整包上限=另一个
  成本决策，等真实需求再议。
- coverage 的 `parse_failed` 逐文件文案仍为通用「文件解析失败」（未带
  parseError 原文）；本包只承诺页数类排除显式化。
- 历史 `parseStatus=failed` 的超限文档（如生产 Doc4）需一次重新解析才能
  享受新上限（UI 重新解析入口 / 下次 reanalyze 时 ENSURE_PAGES 自动重解析；
  兼容性：旧失败态在 coverage 中仍正确归因 parse_failed）。

## 6. Gate

```
OBS_P4_SCHEMA_CHANGE            = NONE
OBS_P4_PARSE_LIMIT              = 400
OBS_P4_LEGACY_ANALYSIS_LIMIT    = 80（不变，选择层+worker 双层强制）
OBS_P4_T2_PACKAGE_GATE          = 400 fail-closed（显式报错，零静默截断）
OBS_P4_EXCLUSION_REASON_EXPLICIT= PASS（真实页数入文案，over_page_limit 归因）
OBS_P4_PURE_SUITES              = 133/133（六套件合计）
OBS_P4_REAL_BIGFILE_E2E         = PASS 6/6（158 页真实招标附件，隔离库全链路）
OBS_P4_SILENT_TRUNCATION        = 0（反例守卫在 suite 内长期值守）
OBS_P4_STATUS                   = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
