# Phase B：Account Playbook — 完成报告

**日期：** 2026-07-29  
**仓库：** `青砚-visualizer-templates`  
**范围：** Account / Group Playbook 数据模型、生命周期、继承解析、AI 草稿、管理页、权限与测试  
**未执行：** 生产 migration / `prisma db push` / PublishJob 状态机改造 / Phase C–E

---

## 1. 结论

```text
PASS
```

Phase B 按 Phase A 现有架构增量落地，未重写运营发布模块。已批准版本不可覆盖；无 Playbook 账号可继续依赖 `personaNotes` / BrandProfile 兼容运行。

---

## 2. 新增与修改文件

### Prisma / Migration
- `prisma/schema.prisma` — `MatrixAccountGroup`、`MatrixGroupPlaybook`、`MatrixAccountPlaybook`；`MatrixAccount.groupId`
- `prisma/migrations/20260729120000_matrix_account_playbook/migration.sql`

### Lib
- `src/lib/operations/playbook/types.ts`
- `src/lib/operations/playbook/permissions.ts`
- `src/lib/operations/playbook/validate.ts`
- `src/lib/operations/playbook/groups.ts`
- `src/lib/operations/playbook/merge.ts`
- `src/lib/operations/playbook/resolve-context.ts`
- `src/lib/operations/playbook/service.ts`
- `src/lib/operations/playbook/group-service.ts`
- `src/lib/operations/playbook/ai-draft.ts`
- `src/lib/operations/playbook/index.ts`
- `src/lib/operations/__tests__/playbook.test.ts`

### API（账号）
- `GET/POST /api/operations/matrix-accounts/[id]/playbooks`
- `GET/PATCH /api/operations/matrix-accounts/[id]/playbooks/[playbookId]`
- `POST .../submit` · `.../approve` · `.../reject`
- `POST .../playbooks/ai-draft`
- `GET .../effective-context`
- `GET /api/operations/matrix-accounts` — 增加 `playbookSummary`；创建账号时链接稳定组

### API（账号组）
- `GET/POST /api/operations/matrix-groups/[groupId]/playbooks`
- `GET/PATCH .../[playbookId]`
- `POST .../submit` · `.../approve` · `.../reject`

### UI
- `/operations/matrix/[accountId]/playbook` — 编辑 / 版本历史 / 提交审批 / AI 草稿 / 生效上下文预览
- `/operations/matrix` — Playbook 状态入口列

### 校验脚本
- `scripts/verify-migration-history.ts` — active 含第 4 条 migration
- `scripts/check-release-safety.test.ts` — 同步 active 列表
- `scripts/test-all.sh` — 接入 Playbook 单测

---

## 3. Prisma 模型与 Migration

| 模型 | 作用 |
|---|---|
| `MatrixAccountGroup` | 稳定组实体：`groupKey`（不可因改名变化）+ `displayName` |
| `MatrixAccount.groupId` | 可空外键；旧 `groupName` 保留兼容 |
| `MatrixGroupPlaybook` | 组级策略版本；`isEffective` 唯一生效 |
| `MatrixAccountPlaybook` | 账号级版本；同上 |

**生命周期状态（单一主状态）：**  
`draft` → `submitted` → `approved` | `rejected`；旧生效版在新批准时 → `archived`

**独立校验字段：** `completenessScore` / `validationResult` / `validationIssues`  
（不与审批 `status` 混用）

**版本审计字段：** `version` / `basedOnVersion` / `createdById` / `submittedById` / `submittedAt` / `approvedById` / `approvedAt` / `rejectedReason` / `changeSummary`

**Migration 安全：** 仅新增表/列与索引；`groupId` 可空；未删运营数据；未改历史 migration；未对生产执行 deploy。

Checksum（sha256）：`a5c3ad3450048c938ee37447fb75cbf16d7d5b02c558209a178eba30fcd2e0d0`

---

## 4. API 与权限矩阵

| 操作 | Boss/Admin | Operations | Sales | AI |
|---|---|---|---|---|
| 读 Playbook / effective-context | ✓ | ✓ | ✓（只读） | — |
| 创建/编辑草稿 | ✓ | ✓ | ✗ | 仅经服务端写草稿 |
| AI 生成草稿 | ✓ | ✓ | ✗ | 只产出 draft |
| 提交审批 | ✓ | ✓ | ✗ | ✗ |
| 批准 / 驳回 | ✓ | ✗（含不可自批） | ✗ | ✗ |
| 归档（批准时旧版） | ✓（系统事务） | ✗ | ✗ | ✗ |

所有写接口经 `withAuth` + `resolveRequestOrgIdForUser` + 角色断言；组织隔离以 `orgId` + 账号/组归属校验。

---

## 5. 页面入口与操作流程

1. 运营中心 → **矩阵账号** → 每行 Playbook 徽章  
2. 进入 `/operations/matrix/[accountId]/playbook`  
3. 新建草稿 / AI 生成 → 编辑 JSON/文本字段 → 保存（仅 draft/rejected）  
4. 完整度 `pass|warn` 后 **提交审批**  
5. Boss/Admin **批准**（旧生效版 archived）或 **驳回**（填原因）  
6. 「生效上下文」调用 `resolveEffectiveAccountContext`（`preview=1` 可含草稿预览，不视为已批准）

组策略：API 已就绪；账号页通过 resolve 继承组批准版。组级独立管理 UI 可在后续补全（见技术债）。

---

## 6. 继承与覆盖规则

`resolveEffectiveAccountContext()` 返回：

```ts
{ effectiveContext, sourceTrace, warnings, hasApprovedPlaybook, usingDraftPreview, ... }
```

**层序（低 → 高）：**  
MarketingBrandProfile → BrandProfile → personaNotes（兼容）→ 组 approved Playbook → 账号 approved（或 preview 下 draft）→ Campaign → taskInput

**合并模式（`sourceTrace.mergeMode`）：**
- 数组类（支柱/受众/禁题等）：默认 `replace`
- KPI / visual / postingRules：`merge-by-key`
- 可用 `overridesJson` 声明 `replace | append | merge-by-key | disabled`
- 禁止不可解释的浅合并

**兼容降级（无 approved Playbook）：**  
approved →（仅 preview）draft → personaNotes → groupName/groupId → BrandProfile  
未批准不得被自动发布链路当作批准策略（`hasApprovedPlaybook=false` + warnings）。不迁移/不覆盖既有 `personaNotes`。

---

## 7. AI 草稿流程

1. `POST .../playbooks/ai-draft`（需编辑草稿权限）  
2. 结构化 JSON + 服务端 Schema/完整度校验  
3. `aiDraftMetaJson` 记录：model、promptVersion、sources、missingInformation、riskFlags、fact/inference/suggestion notes  
4. **只创建 draft**；不自动提交；不自动批准；禁止改写已批准版本  
5. Prompt 禁止编造业绩/客户数据/账号表现

---

## 8. 测试与 Build 结果

| 检查 | 结果 |
|---|---|
| `npx prisma validate` | PASS |
| `npx prisma generate` | PASS |
| `npx tsx src/lib/operations/__tests__/playbook.test.ts` | 24/24 |
| `npx tsx scripts/verify-migration-history.ts` | 25/25 |
| `npx tsx scripts/check-release-safety.test.ts` | 24/24 |
| `npx tsc --noEmit` | PASS |
| `npm run build` | PASS |

**未执行：** 生产 `migrate deploy`。

---

## 9. 未解决的技术债

1. **组 Playbook 管理 UI** 仅有 API，尚无独立页面（继承已在 resolve 生效）。  
2. **旧账号 `groupId` 回填**：创建 Playbook / 新建账号时 ensure；存量可批量回填脚本（未跑生产）。  
3. **`groupName` 仍为显示兼容字段**；长期应以 `groupId`/`groupKey` 为准。  
4. **自动发布链路尚未消费 Playbook**（属 Phase C：配文/派发接入 `hasApprovedPlaybook`）。  
5. **PublishJob 状态缺口**（`queued` 滞留、`pending_human_approval` 等）明确留给 Phase C/D。  
6. **组策略 CRUD 无前端按钮**；需运营用 API 或后续 UI。

---

## 10. Phase C 前需确认事项

1. 是否批准在**隔离/生产**执行 `20260729120000_matrix_account_playbook` migration？  
2. 自动发布是否**强制要求**账号 approved Playbook，还是继续兼容 personaNotes？  
3. 组策略是否需要优先做管理 UI，还是先接账号级即可？  
4. Phase C 是否同时修 PublishJob 状态机与 Postiz `queued` 回写？  
5. AI 草稿是否接入 PendingAction 队列，还是保持当前直接写 draft？

---

**Phase B 到此暂停。不自动进入 Phase C。**
