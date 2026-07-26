# Visualizer AI 安装模板 — Production 部署审查

**阶段：** Phase 3 完成 — **`PRODUCTION_DEPLOYMENT_PASS`**  
**日期：** 2026-07-26  
**PR：** [#21](https://github.com/LucasJ880/-/pull/21)（**MERGED**）  
**Merge SHA：** `69c84c4879a24fa74137870b047f72868ffb0c59`  
**工作树：** `/Users/user/Desktop/青砚-visualizer-templates`  

**已执行：** 合并；Production 模板 env；Production 冒烟；Preview DB override 移除；Neon e2e branch 删除。  
**未执行（按批准）：** `migrate deploy` / `resolve` / `db push` / `migrate reset`（本功能 SQL 已存在且 status up to date）。

---

## 1. PR Code Review 结论

**CODE_REVIEW_STATUS：`NO_CODE_REVIEW_BLOCKER`**

相对 `origin/main`：28 files，+2596 / −133。核心能力与验收规则对齐，未见阻断合并的代码缺陷。

### 1.1 Prisma migration

文件：`prisma/migrations/20260725120000_visualizer_catalog_template/migration.sql`  
SHA256：`03e3afaa9e1e64b2d88415939b17d279d14d1e48f66d651b9d6c998183e2144b`

仅包含：

- `VisualizerCatalogAsset.verificationStatus`（`TEXT NOT NULL DEFAULT 'draft'`）+ 索引
- 表 `VisualizerCatalogTemplateJob` + 索引 + 对 `VisualizerCatalogProduct` 的 FK（`ON DELETE CASCADE`）

未发现无关表改动或破坏性 DROP。

### 1.2 catalog-readiness

优先级实现正确：

| 条件 | 状态 |
|---|---|
| `installed` + `real` | `real_install_ready` |
| 否则 `style_reference` + `ai_generated` | `ai_template_ready` |
| 否则 texture/detail/swatch | `source_ready` |
| 否则 | `incomplete` |

`deriveVerificationStatus` 强制 AI 模板为 `ai_reference`；`sanitizeCatalogAssets` 禁止 `ai_generated` 伪装为 `installed`。

### 1.3 generate-template API / catalog-template

| 检查 | 结论 |
|---|---|
| 组织隔离 | `product.orgId !== orgId` → 403 `FORBIDDEN` |
| 平台产品 | `orgId === null` → 403 `PLATFORM_IMMUTABLE` |
| 归档 | `archived` → 400 `ARCHIVED` |
| JOB_IN_PROGRESS | 同 product+templateType 且 `queued/running` → 409 |
| 失败不伪成功 | catch 将 Job 标 `failed`，不创建资产 |
| AI 资产字段 | 始终 `style_reference` / `ai_generated` / `ai_reference` |
| 底图读取 | `fetchBuffer` → Blob SDK / pathname；上传返回 `/api/files` proxy |
| 私有 Blob | `/api/files` 仅对 `visualizer/templates/...` 登录可读；catalog 仍按 org |

### 1.4 catalog-reference / HD render

渲染排序：真实安装 > texture > detail > swatch > AI 模板；同 role 结合 `isPrimary` / `sortOrder`。  
AI-only 时 `referenceQuality=ai_only` 且返回中文 warning；`render-hd` 透出该字段。

### 1.5 UI

- AI 标签为「AI 生成参考」，不显示为真实安装案例
- 免责声明可见
- 「更多」按钮：`opacity-100` + `sm:opacity-0 sm:group-hover:opacity-100`（移动可点，桌面仍 hover）
- 旧产品 / 无资产路径有测试覆盖

### 1.6 发现列表

| 严重程度 | 发现 | 说明 |
|---|---|---|
| **BLOCKER** | 无 | — |
| HIGH | 无 | — |
| MEDIUM | Production 在 PR 合并前已应用本 migration | checksum 一致且 schema 对象已存在；属流程偏差，非内容错误。Phase 3 应验证 `migrate status` 为 up to date，**不应**再 resolve/reset |
| MEDIUM | Production `_prisma_migrations` 含 main 仓库缺失的 migration 记录 | 见 §2；与本功能 SQL 无冲突，但整体 baseline 需人工知晓 |
| LOW | `JOB_IN_PROGRESS` 为 check-then-create，极端并发下可能双开 Job | MVP 可接受；UI 有 `generating` 防连点 |
| LOW | `resolveTemplateRoomUrl` 允许 env 中出现 `*.blob.vercel-storage.com` | 仅服务端配置；前端资产仍走 proxy |
| INFORMATIONAL | Production 尚未配置 `VISUALIZER_TEMPLATE_*` | 预期，属 Phase 2 |
| INFORMATIONAL | Preview 仍挂分支级隔离 `DATABASE_URL`/`DIRECT_URL` | 冒烟通过后再清理（Phase 3） |

**明确声明：`NO_CODE_REVIEW_BLOCKER`**

---

## 2. Migration baseline 只读审查

**MIGRATION_BASELINE_STATUS：`BASELINE_NEEDS_MANUAL_REVIEW`**

### 2.1 目标库（脱敏）

| 项 | 值 |
|---|---|
| 来源 | Vercel Production env pull（只读查询后已删除本地明文文件） |
| `DATABASE_URL` host | `ep-super-field-antfibsl-pooler…`（Production / 非 e2e） |
| `DIRECT_URL` host | `ep-super-field-antfibsl…` |
| 隔离 e2e host（对照） | `ep-curly-moon-an3uwdeg…`（`visualizer-ai-template-e2e`） |

### 2.2 本 PR migration

| 检查项 | 结果 |
|---|---|
| 文件名 | `20260725120000_visualizer_catalog_template` |
| 仓库文件 checksum (sha256) | `03e3afaa…e2144b` |
| Production `_prisma_migrations` | **已记录** |
| DB checksum | `03e3afaa…e2144b`（**与文件一致**） |
| finished | YES |
| rolled_back | NO |
| `verificationStatus` 列 | **已存在** |
| `VisualizerCatalogTemplateJob` 表 | **已存在** |
| 同名不同内容 | **否** |

### 2.3 main / branch / DB 集合

| 集合 | 数量 |
|---|---|
| `origin/main` migrations | 70 |
| PR branch migrations | 71（+本 PR 1 个） |
| Production `_prisma_migrations` | 82 |

| 方向 | 结论 |
|---|---|
| main 有、DB 无 | **无** |
| branch 有、DB 无（pending 于本功能） | **无**（本 PR migration 已在 DB） |
| DB 有、main 无 | **11**（含本 PR 1 个 + 历史 10 个） |

DB 有而当前 `main` 文件夹没有的历史项（节选分类）：

- 早期：`20260319…init_postgresql` 等（本地 git history 可追溯）
- 近端其他功能：`20260724160000_project_fact_memory_phase2` … `20260725030000_phase4a2_pricing_line_reviewer_note`（本 clone **无** migration 文件历史）
- 本 PR：`20260725120000_visualizer_catalog_template`（合并后将进入 main）

### 2.4 `prisma migrate status`（Production，只读）

在 PR 工作树对 Production 执行：

```
71 migrations found in prisma/migrations
Database schema is up to date!
```

另：存在历史行 `20260416120000_baseline_before_launch`（`finished=false`, `rolled_back=true`, steps=0）。Prisma 仍报告 schema up to date；**不要**对本行做自动 `migrate resolve`。

### 2.5 为何隔离 Neon branch 显示本 migration「已在 parent 存在」

Neon branch `visualizer-ai-template-e2e` 从 Production parent 做 copy-on-write。  
因 **Production 在创建该临时 branch 前已写入** `_prisma_migrations` 中本 migration（checksum 一致），子 branch 继承了该记录与 schema。  
这解释了 e2e 上「migrate 已存在 / schema up to date」，**并非**子 branch 回写 parent。

### 2.6 Baseline 分类说明

- **不是 `BASELINE_SAFE`：** Production 在合并前已应用本 migration；且 DB 含 main 缺失的其他 migration 记录。
- **不是 `BASELINE_UNSAFE`：** 本 PR SQL checksum 一致、对象已存在、`migrate status` = up to date、无「main 有而 DB 缺」的 pending。
- **采用 `BASELINE_NEEDS_MANUAL_REVIEW`：** 需人工确认「合并前已应用」可接受，并知晓与其他功能相关的 migration 目录漂移（不在本 Phase 自动修复）。

---

## 3. 安全门禁（本轮重跑）

### 3.1 执行的命令

```bash
npx prisma generate
npx next build
npx tsx src/lib/visualizer/__tests__/catalog-assets.test.ts
npx tsx src/lib/visualizer/__tests__/catalog-readiness.test.ts
npx tsx src/lib/visualizer/__tests__/catalog-template.test.ts
npx tsx src/lib/visualizer/__tests__/catalog-template-gate.test.ts
# 只读 baseline：
npx prisma migrate status   # DATABASE_URL=Production（未 deploy）
# 只读 SQL：查询 _prisma_migrations / information_schema
```

### 3.2 结果

| 项 | 结果 |
|---|---|
| `prisma generate` | PASS |
| `next build` | PASS |
| Visualizer 单测 | **61/61 PASS**（8+19+15+19） |
| 本 PR 新增失败 | **无** |
| 真实 E2E（本 Phase 未重跑） | 沿用既有记录 36/36；本阶段以代码审查 + 单测 + build 为准 |

未修复仓库既有、与本功能无关的 lint / 全量测试问题。

---

## 4. 是否建议合并 / 是否建议 Production migration

### 4.1 合并

**MERGE_RECOMMENDATION：`YES_WITH_ACK`**

建议在确认以下认知后合并代码：

1. 无 code review blocker  
2. CI/Vercel Preview 已 SUCCESS；PR `MERGEABLE`  
3. Production schema **已含**本功能 migration（合并不会带来新的 pending SQL）  
4. 合并后仍须配置 Production 模板环境变量，否则生成 API 返回 503 `TEMPLATE_ROOM_NOT_CONFIGURED`

### 4.2 Production migration

**PRODUCTION_MIGRATION_RECOMMENDATION：`VERIFY_ONLY_NO_NEW_SQL_EXPECTED`**

- **不需要**为「补齐本 PR schema」而期待新的 DDL；对象已在 Production。  
- Phase 3 批准后应再次 `migrate status`；预期 `Database schema is up to date`。  
- 若 status 异常：**停止**，禁止 `resolve` / `reset` / `db push`。  
- `migrate deploy` 若执行，预期对本 migration 为 **no-op**；仍须在批准后、且目标确认为 Production 时才可执行。

---

## 5. 合并后的建议部署顺序（待批准后执行）

> 以下为计划，**Phase 1 不执行**。

1. **Phase 2（需批准）**  
   - 合并 PR #21（按仓库规则 squash 或 merge commit）  
   - **仅**向 Production 写入：  
     - `VISUALIZER_TEMPLATE_STANDARD_ROOM_URL=/api/files/visualizer/templates/standard-floor-to-ceiling.jpg`  
     - `VISUALIZER_TEMPLATE_LIVING_ROOM_URL=/api/files/visualizer/templates/modern-living-room.jpg`  
   - **禁止**改 Production `DATABASE_URL` / `DIRECT_URL` / Blob / 模型密钥  
   - 触发或等待 Production 重新部署  
   - **暂停**（不 migrate）

2. **Phase 3（需另行批准）**  
   - 再次确认 DB host = Production（非 `curly-moon` / e2e）  
   - `npx prisma migrate status` → 安全则 `migrate deploy` → 再 `status`  
   - Production 冒烟（测试产品 `PROD SMOKE - Visualizer AI Template`）  
   - 冒烟 PASS 后：移除 Preview 分支隔离 DB 覆盖；确认无依赖后删除 Neon `visualizer-ai-template-e2e`  
   - **保留**私有 Blob 两张底图与 Job 审计

---

## 6. 风险与回滚

| 风险 | 缓解 / 回滚 |
|---|---|
| Production 模板 env 未配 | 功能代码上线后生成入口 503；配置 proxy URL 即可，无 DB 回滚 |
| 模型/Blob 故障 | Job `failed`；不写伪成功资产；可重试 |
| 误把 Preview 隔离 DB 配到 Production | Phase 2 明确禁止；配置前核对 host |
| 误对 e2e 或错误库 migrate | Phase 3 部署前强制 host 核对 |
| 迁移已提前应用导致流程困惑 | 以 checksum + `migrate status` 为准；勿 resolve |
| UI/逻辑回滚 | revert merge commit；DB 列/表可保留（向后兼容默认值） |
| AI 图被误认为真实安装 | 代码强制降级 + 标签/免责声明；HD `ai_only` warning |

---

## 7. Production 环境变量（Phase 2 后）

| 变量 | Production |
|---|---|
| `VISUALIZER_TEMPLATE_STANDARD_ROOM_URL` | **CONFIGURED**（`/api/files/visualizer/templates/standard-floor-to-ceiling.jpg`） |
| `VISUALIZER_TEMPLATE_LIVING_ROOM_URL` | **CONFIGURED**（`/api/files/visualizer/templates/modern-living-room.jpg`） |
| `DATABASE_URL` / `DIRECT_URL` | **未修改**（仍为既有 Production / shared 配置；未写入 e2e） |
| `BLOB_PRIVATE_READ_WRITE_TOKEN` | **未修改** |

Preview 分支级 DB 隔离：

- `DATABASE_URL` / `DIRECT_URL`（`feature/visualizer-ai-install-templates`）→ **已移除**  
- `VISUALIZER_TEMPLATE_*` Preview 分支覆盖 → 仍可保留（非 DB；不影响 Production）  

Neon 临时 branch **`visualizer-ai-template-e2e`：已删除**（`br-autumn-morning-anjqq420`，非 primary）。

技术债（不在本 PR 修复）：Production `_prisma_migrations` 含若干 main 目录缺失的历史记录；见 Phase 1 §2。

---

## 8. Phase 1 状态摘要（历史）

| Key | Value |
|---|---|
| `PHASE_1_STATUS` | **COMPLETE** |
| `CODE_REVIEW_STATUS` | **NO_CODE_REVIEW_BLOCKER** |
| `MIGRATION_BASELINE_STATUS` | **BASELINE_NEEDS_MANUAL_REVIEW** |
| `MERGE_RECOMMENDATION` | **YES_WITH_ACK**（已执行） |
| `PRODUCTION_MIGRATION_RECOMMENDATION` | **VERIFY_ONLY_NO_NEW_SQL_EXPECTED** |
| `DATABASE_MIGRATION_STATUS` | **NOT_RUN** |
| `PR_STATE` | 当时 Ready；现已 MERGED |

---

## 9. Phase 2 执行记录

### 9.1 合并前检查

| 检查 | 结果 |
|---|---|
| PR HEAD | `d542416`（含 Phase 1 报告 commit；相对此前验证 HEAD `fc5ca1a` 仅文档） |
| 工作树 | 提交报告后干净 |
| mergeable / 冲突 | `MERGEABLE` / `CLEAN`（docs push 后短暂 UNKNOWN，合并成功） |
| Review blocker / HIGH | 无 review comments |
| CI | Vercel Preview 历史 SUCCESS；docs commit 触发的 Preview 仍 PENDING 时已按批准合并（与既有 main 合并惯例一致；无失败 check） |

### 9.2 合并

| Key | Value |
|---|---|
| `MERGE_STATUS` | **MERGED** |
| `MERGE_STRATEGY` | **merge commit**（`gh pr merge --merge`；与近期 `#19/#20` 风格一致） |
| `MERGE_SHA` | `69c84c4879a24fa74137870b047f72868ffb0c59` |
| `MAIN_SHA` | `69c84c4879a24fa74137870b047f72868ffb0c59` |
| 合并时间 | `2026-07-26T21:38:31Z` |
| PR URL | https://github.com/LucasJ880/-/pull/21 |

### 9.3 Production 模板 env

| Key | Value |
|---|---|
| `PRODUCTION_TEMPLATE_ENV_STATUS` | **CONFIGURED** |
| 配置项 | 仅上述两个 `VISUALIZER_TEMPLATE_*` |
| 禁止项 | 未改 `DATABASE_URL` / `DIRECT_URL`；未复制 Preview 隔离 Neon |

### 9.4 Production 部署

| Key | Value |
|---|---|
| `PRODUCTION_DEPLOYMENT_STATUS` | **READY** |
| 合并触发部署 | `dpl_HX8HhDvieF34KpgsndDgRVxW4owD` → Ready（`1fjstwfyh-ndmo7ls2q-…`） |
| Env 保障重新部署 | `dpl_2SLqfFrnZRSw11s2HkbzwzR7QCB6` → Ready（`1fjstwfyh-6vap6u619-…`） |
| Inspect | https://vercel.com/lucas-9039s-projects/-/2SLqfFrnZRSw11s2HkbzwzR7QCB6 |
| 生产别名 | `qingyan.ca` / `www.qingyan.ca` 等已指向该部署 |
| 说明 | 因 env 在合并部署创建后数秒内写入，额外 `vercel redeploy` 一次以确保两变量进入当前 Production 运行实例 |

### 9.5 数据库

| Key | Value |
|---|---|
| `DATABASE_MIGRATION_STATUS` | **NOT_RUN** |
| 预期 | 本功能 SQL 已在 Production；Phase 3 仅核对 `migrate status` |

### 9.6 Phase 2 摘要

| Key | Value |
|---|---|
| `PHASE_2_STATUS` | **COMPLETE** |
| `MERGE_STATUS` | **MERGED** |
| `MERGE_STRATEGY` | **merge commit** |
| `MERGE_SHA` | `69c84c4879a24fa74137870b047f72868ffb0c59` |
| `MAIN_SHA` | `69c84c4879a24fa74137870b047f72868ffb0c59` |
| `PRODUCTION_TEMPLATE_ENV_STATUS` | **CONFIGURED** |
| `PRODUCTION_DEPLOYMENT_STATUS` | **READY** |
| `DATABASE_MIGRATION_STATUS` | **NOT_RUN** |
| `PRODUCTION_SMOKE` | 见 §10（Phase 3） |
| Neon e2e / Preview DB override | 见 §10（已清理） |

---

## 10. Phase 3 执行记录

### 10.1 Production 目标确认

| 项 | 值 |
|---|---|
| Alias | `https://qingyan.ca` |
| Deployment | `dpl_2SLqfFrnZRSw11s2HkbzwzR7QCB6` Ready |
| Neon | `ep-super-field-antfibsl…`（Production；**非** `curly-moon` / e2e） |
| Preview DB override 影响 Production | **否**（分支级覆盖仅作用于 Preview） |

### 10.2 Migration（只读）

| Key | Value |
|---|---|
| `npx prisma migrate status` | **Database schema is up to date** |
| `MIGRATION_STATUS` | **UP_TO_DATE** |
| `MIGRATION_DEPLOY_STATUS` | **SKIPPED_ALREADY_APPLIED** |
| `NEW_SQL_EXECUTED` | **NO** |
| `verificationStatus` 列 | 存在 |
| `VisualizerCatalogTemplateJob` | 存在 |
| 本 PR migration checksum | 与仓库一致（`03e3afaa…e2144b`） |

### 10.3 底图读取

| 检查 | 结果 |
|---|---|
| 服务端 `fetchBuffer` standard / living | **PASS**（188158 / 162035 B） |
| 未登录 `qingyan.ca` `/api/files/visualizer/templates/...` | **401**（拒绝） |
| 登录用户 fetch 同上 | **200** image/jpeg |
| 假 catalog 路径未登录 | **401** |
| 前端暴露私有 Blob host | **未发现**（proxy `/api/files/...`） |

### 10.4 真实模板生成

测试产品：`PROD SMOKE - Visualizer AI Template`（组织：TEST1的工作区；非真实客户业务）  
`templateType`：`standard_floor_to_ceiling_day`（仅一次）

| 检查 | 结果 |
|---|---|
| Job | **succeeded**（审计保留） |
| Asset | `style_reference` + `ai_generated` + `ai_reference` |
| fileUrl | `/api/files/...` proxy；非空（~1.9MB）；非底图拷贝 |
| readiness | `ai_template_ready` |
| 徽章 | 「AI 生成参考」 |
| 原始 texture | 保留 |

脚本汇总：`SMOKE_SUMMARY pass=29 fail=0`（本地证据：`.data/e2e-evidence/prod-smoke/`，gitignore）

### 10.5 AI-only HD

| 检查 | 结果 |
|---|---|
| `referenceQuality` | **ai_only** |
| warning | 「本次生成未使用真实安装案例，实际效果可能存在差异。」 |
| 排序 | texture 先于 AI 模板 |
| 一次 image edit | **PASS**（~1.7MB 输出） |

### 10.6 权限

| 检查 | 结果 |
|---|---|
| 平台预置不可改 | **PLATFORM_IMMUTABLE** |
| archived 不可生成 | **ARCHIVED** |
| AI 不可序列化为 installed | **PASS**（sanitize） |
| 跨组织 | 冒烟组织无外来产品时跳过；平台/归档门禁已覆盖关键隔离 |

### 10.7 移动端 390×844（Production 登录态）

| 检查 | 结果 |
|---|---|
| Viewport | 390×844 |
| 「更多」触屏可见并可点出「编辑」 | **PASS** |
| 产品弹窗 / 可滚动 / 无横向溢出 | **PASS**（`scrollWidth=390`） |
| 状态「AI 模板可用」 | **PASS** |
| 「AI 生成参考」+ 免责声明 | **PASS** |
| 保存/取消可见 | **PASS** |

### 10.8 测试数据清理

| 项 | 处理 |
|---|---|
| 测试产品 | **已归档**（Job 审计保留） |
| 冒烟客户 / session | 已归档（明确 PROD SMOKE 标记） |
| 临时登录用户 `visualizer-prod-smoke@test.qingyan.ai` | **status=disabled** |
| 标准底图 Blob | **未删** |
| Job 行 | **未删** |

### 10.9 Preview / Neon 清理

| Key | Value |
|---|---|
| Preview `DATABASE_URL` branch override | **REMOVED** |
| Preview `DIRECT_URL` branch override | **REMOVED** |
| Production `DATABASE_URL` / `DIRECT_URL` | **未修改** |
| Neon branch `visualizer-ai-template-e2e` | **DELETED**（非 primary；parent=`br-green-boat-ann7k5yf`） |

### 10.10 最终门禁

| 项 | 结果 |
|---|---|
| `npx prisma generate` | PASS |
| `npx next build` | PASS |
| Visualizer 单测 | **61/61 PASS** |

### 10.11 Phase 3 摘要

| Key | Value |
|---|---|
| `PRODUCTION_MIGRATION_STATUS` | **UP_TO_DATE** |
| `MIGRATION_DEPLOY_STATUS` | **SKIPPED_ALREADY_APPLIED** |
| `PRODUCTION_ROOM_READ_STATUS` | **PASS** |
| `PRODUCTION_TEMPLATE_GENERATION_STATUS` | **PASS** |
| `PRODUCTION_HD_RENDER_STATUS` | **PASS** |
| `PRODUCTION_PERMISSION_STATUS` | **PASS** |
| `PRODUCTION_MOBILE_STATUS` | **PASS** |
| `PREVIEW_DB_OVERRIDE_STATUS` | **REMOVED** |
| `TEMP_NEON_BRANCH_STATUS` | **DELETED** |
| `FINAL_BUILD_STATUS` | **PASS** |
| `FINAL_TEST_STATUS` | **61/61 PASS** |
| `FINAL_DEPLOYMENT_STATUS` | **PRODUCTION_DEPLOYMENT_PASS** |

### 10.12 已知风险与技术债

- Migration history：Production 仍有 main 目录缺失的历史 `_prisma_migrations` 行（与本功能无关；勿自动 resolve）。
- Preview 仍可能保留分支级 `VISUALIZER_TEMPLATE_*`（非隔离 DB；可择机清理）。
- 冒烟使用临时用户/客户已禁用或归档；勿用于真实业务。

**Phase 3 完成。最终状态：`PRODUCTION_DEPLOYMENT_PASS`。**
