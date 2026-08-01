# 青砚 ESLint 历史债务基线

**用途：** Wave 0 CI 门禁 — 保留完整 lint 日志与既有债务，阻止新增 error。  
**基线文件：** `ci/eslint-error-baseline.json`  
**检查脚本：** `scripts/check-eslint-baseline.mjs`

---

## 1. 基线来源（可复核）

| 项 | 值 |
|---|---|
| 基准 Commit | `2255f8da919c883bc9e2f210209782c40ee5eaae`（`main@2255f8d`） |
| 生成时工作树 | `stabilization/qingyan-wave0`（相对该 commit **无 `src/` 差异**） |
| 生成命令 | `npm run lint:baseline:generate` → `node scripts/check-eslint-baseline.mjs --generate` |
| 基线 error 数量 | **53** |
| 基线 warning 数量 | **111**（记录在基线元数据；warning 不阻断） |
| 唯一 fingerprint 数 | **24** |

生成脚本在 `--generate` 时若检测到相对 `sourceCommit` 仍有 `src/` 差异会拒绝写入，避免从实验分支污染基线。

---

## 2. Fingerprint 规则

```
fingerprint = repoRelativePath + "\0" + ruleId + "\0" + normalize(message)

normalize(message) = trim + 折叠连续空白
```

| 包含 | 不包含 |
|---|---|
| 仓库相对路径 | 行号 |
| ESLint `ruleId` | 列号 |
| 稳定化后的 message 文本 | 绝对磁盘路径 |

同一 fingerprint 记录 `count`（出现次数）。  
**不得**用「总 errors ≤ 53」作为通过条件。

---

## 3. 门禁行为

| 情况 | 结果 |
|---|---|
| 当前 error fingerprint ⊆ 基线，且 count ≤ 基线 | PASS |
| 旧债被修复（count 下降 / fingerprint 消失） | PASS（允许） |
| 既有 warning | 不阻断；完整日志仍输出 |
| 新 fingerprint | **FAIL** |
| 既有 fingerprint 的 count 上升 | **FAIL** |
| PR 相对 sourceCommit 改动文件上出现新增/增多 error | **FAIL** |
| 基线文件相对 `origin/main` 扩大 fingerprint/count，且无批准 | **FAIL** |
| ESLint 无法启动 / 配置失败 / JSON 无效 | **FAIL**（exit 2） |

批准扩大基线时需同时：

1. 产品/工程书面批准  
2. 更新本文档中的数量与原因  
3. CI/本地设置 `ALLOW_ESLINT_BASELINE_UPDATE=true` 后合并基线变更  

**禁止**在无批准时扩大基线以「消掉」新错误。

---

## 4. CI 步骤

1. `Lint (full log)` — `npm run lint`（完整输出；`continue-on-error` 仅用于收齐后续步骤）  
2. `ESLint baseline gate` — `npm run lint:baseline`（**阻断**）  
3. typecheck / test:ci / build  

最终 job 成败以 baseline gate 为准，**不是** raw lint exit code，也**不是**无条件放行。

---

## 5. 本地命令

```bash
npm run lint                 # 完整扫描 + 日志
npm run lint:baseline        # 基线门禁
npm run lint:baseline:generate   # 仅维护用；需 src 相对 2255f8d 无差异
```

---

## 6. 更新基线所需批准

扩大 `ci/eslint-error-baseline.json`（新增 fingerprint 或提高 count）必须：

- Acting CTO / 产品负责人明确批准  
- 说明为何不修复代码而抬高基线  
- 提交信息或 PR 描述写明批准人  
- 使用 `ALLOW_ESLINT_BASELINE_UPDATE=true` 通过扩大检查  

缩小基线（修复旧债后重新 generate）鼓励，但仍应走 PR 复核。
