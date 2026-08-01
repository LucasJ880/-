# Wave 1.5 — 稳定版本封版计划

**日期：** 2026-08-01  
**阶段：** Wave1.5 Production Acceptance（非 Wave2）  
**纪律：** 不创建 Tag、不修改 GitHub 设置，直至产品负责人明确批准  

---

## 1. 当前正式基准

| 项 | 值 |
|---|---|
| 正式稳定基准 | `main@bc132fd8e9306e6f9905facf17f6ab4c8a280e8b` |
| 说明 | Merge PR #45（Wave0/1 完成报告）后的 tip |
| 远程 `origin/main` | 已确认 = `bc132fd…` |
| 本机检出（wave15 分支） | 自 `origin/main` 创建，指向同一 SHA |
| 工作区 | 封版检查时要求 clean（本 PR 仅文档/只读脚本） |

**不得**使用 `feature/agent-runtime-2-phase1` 或任何实验树作为发布基准。

---

## 2. 封版检查结果（2026-08-01）

| 检查项 | 结果 |
|---|---|
| 远程 main = `bc132fd` | **PASS** |
| 未合并的稳定化 PR（#39–#45） | **无**（均已合入） |
| 其他 open PR | #24 `feature/workbench-v2`（非 Draft）、#18 tenant docs（Draft）— **不属于** Wave0/1 稳定化范围，封版前应避免误合入 main |
| Branch Protection（API） | **`main` 当前未保护**（`GET …/branches/main/protection` → 404 *Branch not protected*；`protected: false`） |
| 直接 push / force push 风险 | **高** — 无 required reviews / 无 status checks / 无限制 force push（API 可确认范围内） |
| 是否适合创建 Release Tag | **技术上可打 Tag**（tip 已含 Wave0/1）；**流程上须先加固 Branch Protection 或接受风险后由负责人批准** |

---

## 3. 建议 Release Tag（待批准）

**建议名称：** `qingyan-stable-wave1-2026-08-01`  
**建议指向：** `bc132fd8e9306e6f9905facf17f6ab4c8a280e8b`  
**Annotated tag 建议消息：**

```text
Qingyan stable Wave1 freeze — 2026-08-01

Includes Wave0 baseline and Wave1 P0 stabilizations (#39,#41,#42,#43,#40,#44,#45).
Does not include Wave2 Approval Consolidation.
```

### 拟执行命令（**不要擅自执行**；等待产品负责人批准）

```bash
git fetch origin
git rev-parse origin/main
# 必须输出：bc132fd8e9306e6f9905facf17f6ab4c8a280e8b

git tag -a qingyan-stable-wave1-2026-08-01 bc132fd8e9306e6f9905facf17f6ab4c8a280e8b -m "$(cat <<'EOF'
Qingyan stable Wave1 freeze — 2026-08-01

Includes Wave0 baseline and Wave1 P0 stabilizations (#39,#41,#42,#43,#40,#44,#45).
Does not include Wave2 Approval Consolidation.
EOF
)"

git push origin qingyan-stable-wave1-2026-08-01
```

**本轮不创建 Tag。**

---

## 4. Branch Protection 建议（待批准；本轮不修改）

建议对 `main` 启用（GitHub Settings → Branches，或 API）：

1. Require a pull request before merging  
2. Require approvals ≥ 1（产品/技术双人更佳）  
3. Require status checks to pass：CI workflow `validate-lint-typecheck-test-build`（或等价 job 名）  
4. Require branches to be up to date before merging  
5. Restrict who can push to matching branches（禁止全员 direct push）  
6. Do not allow force pushes  
7. Do not allow deletions  

### 拟执行方向（批准后由负责人或授权账号操作）

- UI：Repository → Settings → Branches → Add rule → Branch name pattern `main`  
- 或 `gh api` / GitHub API `PUT /repos/{owner}/{repo}/branches/main/protection`  

**本轮不修改 Branch Protection。**

---

## 5. 旧实验分支处置方式

| 对象 | 处置 |
|---|---|
| `feature/agent-runtime-2-phase1` @ `80c76e4` | **保留作历史指针**；禁止 merge；禁止作开发基准（见 `docs/QINGYAN_W1_PR5_AGENT_RUNTIME_BRANCH_DRIFT.md`） |
| 历史本地 dirty / untracked 实验树 | **远程不可见**；不得整包移植；若恢复能力须从最新 main 重做 |
| `stabilization/*` 已合并分支 | 可保留；勿再向其提交新功能 |
| Open 非稳定化 PR（#24/#18） | 与 Wave1 封版解耦；合入须单独产品批准，避免污染稳定 tip |

---

## 6. 回滚基准

| 场景 | 回滚到 |
|---|---|
| 稳定版发布后严重回归 | Tag `qingyan-stable-wave1-2026-08-01`（批准创建后）或 commit `bc132fd` |
| Preview / 部署回滚 | Vercel 指向上述 commit / Tag |
| 数据/Schema | **本波无 migration**；禁止用实验 migration 「回滚修复」 |

回滚**不**等于批准 Wave2 或恢复实验树。

---

## 7. 发布前检查清单

- [ ] `origin/main` 仍为 `bc132fd`（或负责人明确推进的新 tip）  
- [ ] 工作区 clean；无未审查的稳定化外变更误合入  
- [ ] CI 在 tip 上绿：prisma validate / typecheck / test:ci / lint:baseline / build  
- [ ] build 日志无 migrate / db push  
- [ ] 生产验收矩阵（`QINGYAN_WAVE15_PRODUCTION_ACCEPTANCE.md`）关键项完成或 BLOCKED 已接受  
- [ ] CI：`wave15-smoke-readonly.ts --self-check-only` PASS  
- [ ] 显式网络 smoke（若执行）：`--allow-network --base-url <localhost|https://git-*.vercel.app>` 必须 PASS；连接失败计 FAIL 而非 skip  

- [ ] Branch Protection 已按建议启用 **或** 负责人书面接受风险  
- [ ] Tag 创建已获批准并执行  
- [ ] 明确 **Wave2 仍未批准**  

---

## 8. 停止条件

出现以下情况立即停止封版并汇报：

- 需要 Schema / migration / 生产数据修复  
- 需要权限模型或审批模型变更才能上线  
- 发现可匿名执行的写操作公开路由  
- 需要轮换生产 Secret 才能验收  

---

## 9. 本阶段声明

Wave1.5 只做封版准备与验收文档/只读验证。  
**不构成 Wave2 批准。**  
未经产品负责人明确指令：不处理 P1、不进入 Wave2 编码、不恢复实验 Agent Runtime、不执行生产迁移、不轮换 Secret。  
