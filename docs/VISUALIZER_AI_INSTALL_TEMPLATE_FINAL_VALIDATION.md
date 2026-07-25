# Visualizer AI 安装模板 — Final Validation Gate

**日期：** 2026-07-25  
**分支：** `feature/visualizer-ai-install-templates`  
**工作树：** `/Users/user/Desktop/青砚-visualizer-templates`  
**相对基准：** `origin/main` @ `0dd25e3`（本地尚未 commit；工作区含实现 + 本门禁改动）  
**约束遵守：** 未改 main、未合并、未推送；未对不确定生产库执行 `migrate deploy`

---

## 1. 分支与 commit 状态

| 项 | 状态 |
|---|---|
| 分支 | `feature/visualizer-ai-install-templates`（跟踪 `origin/main`） |
| HEAD | `0dd25e3` Merge pull request #19 … |
| 本功能提交 | **尚未 commit**（全部为工作区修改 + 未跟踪文件） |
| main | 未触碰 |

核对实现报告 `docs/VISUALIZER_AI_INSTALL_TEMPLATE_REPORT.md`：文件列表、迁移名、环境变量、产品规则与当前代码一致；门禁期间补充：

- `catalog-template-gate.test.ts` + `test-all.sh` 接入
- `assetBadgeLabel` 文案改为「AI 生成参考」
- 去掉 `catalog-readiness.ts` 未使用类型导入

---

## 2. 修改文件清单

### Prisma
- `prisma/schema.prisma`
- `prisma/migrations/20260725120000_visualizer_catalog_template/migration.sql`

### 核心库
- `src/lib/visualizer/catalog-readiness.ts`（新）
- `src/lib/visualizer/catalog-reference.ts`（新）
- `src/lib/visualizer/catalog-template.ts`（新）
- `src/lib/visualizer/catalog.ts`
- `src/lib/visualizer/types.ts`

### API
- `src/app/api/visualizer/catalog/[id]/generate-template/route.ts`（新）
- `src/app/api/visualizer/catalog/route.ts`
- `src/app/api/visualizer/catalog/[id]/route.ts`
- `src/app/api/visualizer/variants/[variantId]/render-hd/route.ts`

### UI
- `src/app/(main)/sales/visualizer/[sessionId]/catalog-product-dialog.tsx`
- `src/app/(main)/sales/visualizer/[sessionId]/product-panel.tsx`
- `src/app/(main)/sales/visualizer/[sessionId]/session-editor.tsx`

### 测试 / 配置 / 文档
- `src/lib/visualizer/__tests__/catalog-assets.test.ts`
- `src/lib/visualizer/__tests__/catalog-readiness.test.ts`（新）
- `src/lib/visualizer/__tests__/catalog-template.test.ts`（新）
- `src/lib/visualizer/__tests__/catalog-template-gate.test.ts`（新）
- `scripts/test-all.sh`
- `.env.example`
- `docs/VISUALIZER_AI_INSTALL_TEMPLATE_REPORT.md`
- `docs/VISUALIZER_AI_INSTALL_TEMPLATE_FINAL_VALIDATION.md`（本文件）

---

## 3. Prisma migration 检查

迁移：`20260725120000_visualizer_catalog_template`

| 检查项 | 结论 |
|---|---|
| SQL 可重复安全部署 | **通过（静态）**：`ADD COLUMN … NOT NULL DEFAULT 'draft'`；`CREATE TABLE` + 索引 + 产品 FK。无破坏性 DROP/数据改写 |
| `verificationStatus` 旧记录默认值 | **通过**：`DEFAULT 'draft'`，旧行回填 draft |
| TemplateJob 索引 | **通过**：`(productId, templateType, createdAt)`、`(status, createdAt)` |
| TemplateJob 外键 / 删除策略 | **通过**：`productId → VisualizerCatalogProduct` **ON DELETE CASCADE**；不删历史 Visualizer 业务数据，仅产品删除时级联清 Job |
| `outputAssetId` 悬空引用 | **接受的技术债**：字段为普通 `TEXT`，**无 FK**。删除超额 AI 资产后，旧 Job 可能残留无效 `outputAssetId`；不影响产品资产完整性 |
| 不修改/删除既有 Visualizer 数据 | **通过**：仅加列 + 新表，无 UPDATE/DELETE 存量数据 |

### `migrate status`（使用主工作区 `.env` 连接 Neon）

```
71 migrations found
last common: 20260724180000_pending_action_idempotency_key
pending locally: 20260725120000_visualizer_catalog_template
DB-only (不在本分支): 若干 agent/bid-data 迁移（含 20260725 phase4* 等）
```

### `migrate deploy`

**未执行。** 原因：

1. 当前 Neon 历史与本分支分叉（DB 含其他 WIP 迁移，本分支基于 `origin/main`）；
2. 无法确认该连接为独立测试库而非生产/共享库；
3. 门禁禁止在不确定环境操作生产库。

**结论：** 迁移静态审查 PASS；目标库部署 **PENDING_SAFE_TARGET_DB**。

---

## 4. 所有执行命令

```bash
# 工作树
cd /Users/user/Desktop/青砚-visualizer-templates
set -a; . /Users/user/Desktop/青砚/.env; . /Users/user/Desktop/青砚/.env.local; set +a

npx prisma generate
npx prisma migrate status
npm run qa                    # lint && prisma generate && next build
npx next build                # 单独构建（绕过 lint 门）
npm test                      # scripts/test-all.sh

# Visualizer 子集
npx tsx src/lib/visualizer/__tests__/catalog-assets.test.ts
npx tsx src/lib/visualizer/__tests__/catalog-readiness.test.ts
npx tsx src/lib/visualizer/__tests__/catalog-template.test.ts
npx tsx src/lib/visualizer/__tests__/catalog-template-gate.test.ts
```

未执行：`npx prisma migrate deploy`、真实图片模型 E2E、Playwright UI。

---

## 5. qa / build / test 结果

| 命令 | 结果 | 说明 |
|---|---|---|
| `npx prisma generate` | **PASS** | Client v6.19.3 |
| `npx prisma migrate status` | **WARN** | 见 §3 分叉；本迁移未应用 |
| `npm run qa` | **FAIL @ lint** | 158 problems（51 errors / 107 warnings）；**未进入 build** |
| `npx next build` | **PASS** | Compiled successfully；路由含 `/sales/visualizer/[sessionId]` |
| `npm test` | **126/130 PASS，4 FAIL** | 失败均非本分支 Visualizer 逻辑 |

### Lint 归因

- 51 个 error 分布在 trade/email/blob-access/assistant 等**既有模块**；
- 本分支 Visualizer 新增文件无 lint error；曾有 `catalog-readiness` unused import warning，门禁中已清除；
- **未为变绿而修改无关模块**。

### 全量测试 4 个失败（本分支无关）

| # | 用例 | 原因 | 归因 |
|---|---|---|---|
| 1 | Agent Runtime Phase-1 | `CapabilityQuotaReservation_orgId_fkey` P2003 | 既有 DB 夹具 / 共享库 |
| 2 | 记忆 org 隔离与 Session 摘要 | `UserMemory_userId_fkey` P2003 | 同上 |
| 3 | Agent Trace 只读查询 | 同 #1 | 同上 |
| 4 | Image Engine FormData 传图证明 | `metadata 不含 URL` 断言失败 | 既有 image-engine，非 visualizer catalog |

TypeScript 类型检查在 `npm test` 末段已跑通（无 TS 报错）。

---

## 6. Visualizer 测试数量和结果

| 文件 | 数量 | 结果 |
|---|---|---|
| `catalog-assets.test.ts` | 8 | PASS |
| `catalog-readiness.test.ts` | 19 | PASS |
| `catalog-template.test.ts` | 15 | PASS |
| `catalog-template-gate.test.ts` | 19 | PASS |
| **合计** | **61** | **61/61 PASS** |

已接入 `scripts/test-all.sh`（门禁中可见「销售可视化*」四组均绿）。

### 业务规则覆盖（§五）

| # | 规则 | 验证 |
|---|---|---|
| 1 | installed + real → real_install_ready | 单测 |
| 2 | texture/detail/swatch → source_ready | 单测 |
| 3 | style_reference + ai_generated → ai_template_ready | 单测 |
| 4 | 无素材 → incomplete | 单测 |
| 5 | 真实安装优先于纹理/细节/色卡/AI | 单测（readiness + reference 排序） |
| 6 | AI 不可序列化为真实安装图 | sanitize + gate 单测 |
| 7 | 普通组织不可改平台预置 | 代码 `PLATFORM_IMMUTABLE` 403 + gate |
| 8 | 跨组织不可生成 | 代码 `FORBIDDEN` 403 + gate |
| 9 | archived 不可生成 | 代码 `ARCHIVED` 400 + gate |
| 10 | AI-only → referenceQuality + warning | 单测 + render-hd / session toast |

---

## 7. 人工 / Playwright 前端验证

**Playwright：未跑**（无本地 dev + 无模板底图配置，无法完成真实交互）。  
**代码走查：PASS（静态）**

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 无真实安装图可保存 | PASS — 草稿保存不再强制 installed |
| 2 | 无基础素材显示「素材不完整」 | PASS — `readinessLabel(incomplete)` |
| 3 | 有纹理/色卡/细节显示「可以生成 AI 模板」 | PASS — `source_ready` |
| 4 | 模板按钮 loading / 防重复点击 | PASS — `generating` 禁用按钮与保存 |
| 5 | AI 模板「AI 生成参考」标签 | PASS — `assetBadgeLabel`（门禁对齐文案） |
| 6 | 真实图「真实安装图」标签 | PASS |
| 7 | 免责声明可见 | PASS — dialog 固定文案 |
| 8 | 老产品 / mock_xxx 可打开 | PASS（单测：无资产仍可序列化；未跑浏览器） |
| 9 | 移动端弹窗可保存、不因新增溢出 | **静态审查部分通过** — 未做真机/Playwright；建议合并前人工点一次 |

---

## 8. TemplateJob 生命周期验证

代码路径：`generateCatalogInstallTemplate`（同步）

| 步骤 | 行为 | 结论 |
|---|---|---|
| 开始前创建 Job | `status=queued` | PASS |
| 调模型前 | `running` + `startedAt` | PASS |
| 成功 | `succeeded` + `outputAssetId` + `resolvedModel` + `completedAt` | PASS |
| 失败 | `failed` + `errorCode` + `errorMessage`；catch 在写资产之后才成功 | PASS — 模型失败不创建伪成功资产 |
| 防连点 | 同产品同类型 `queued/running` → 409 `JOB_IN_PROGRESS` | PASS |
| 重复生成上限 | 每类型最多 2；总量 `2 × 模板数`；超额删最旧 AI style_reference | PASS |

异步队列未实现（已知债）。

---

## 9. 组织权限验证

| 场景 | 期望 | 验证 |
|---|---|---|
| `orgId === null` 平台预置 | 403 PLATFORM_IMMUTABLE | 代码 + gate |
| `product.orgId !== request.orgId` | 403 FORBIDDEN | 代码 + gate |
| `archived` | 400 ARCHIVED | 代码 + gate |
| 资产跨组织引用 | sanitize 拒绝 | catalog-assets 单测 |

未做带真实 Cookie 的 API 集成调用（需运行中服务）。

---

## 10. 模板底图配置状态

| 变量 | 当前值 |
|---|---|
| `VISUALIZER_TEMPLATE_STANDARD_ROOM_URL` | **UNSET**（主仓 `.env` / `.env.local` 均无） |
| `VISUALIZER_TEMPLATE_LIVING_ROOM_URL` | **UNSET** |

`.env.example` 已给出私有路径示例（注释）。

读取路径约定（代码确认）：

1. 支持私有 Blob pathname（`visualizer/...`）
2. 支持 `/api/files/...` 代理 URL
3. 经 `fetchBuffer` → `readBlobBuffer` / blob SDK（不依赖浏览器 Cookie）
4. `resolveTemplateRoomUrl` 拒绝任意第三方公开 URL
5. 前端仅见 `/api/files` 代理类 URL（上传走 `putVisualizerCatalogPreview`）
6. 未配置 → API **503** + 可读文案，非堆栈

---

## 11. 真实 E2E

**状态：`BLOCKED_BY_TEMPLATE_SCENE_CONFIG`**

未配置两张标准场景底图，按门禁要求**不得伪造生成结果**。以下未实测：

- 私有 Blob 写入 AI 模板资产
- DB：`style_reference + ai_generated + ai_reference`
- Job `succeeded`
- 产品 `ai_template_ready`
- 客户 HD 渲染使用该模板并返回 `ai_only` warning

配置底图并指向与 `origin/main` 对齐的目标库后，应重跑：

1. `standard_floor_to_ceiling_day`
2. `modern_living_room_day`

---

## 12. 已知风险与技术债

1. **模板底图未配置** → 生成 API 503；真实 E2E 阻塞  
2. **`outputAssetId` 无 FK** → Job 可能悬空引用  
3. **同步 Job** → 长请求超时风险；后续应异步队列  
4. **`bedroom_blackout` 预留未实现**  
5. **`real_verified` 无管理员 UI**（字段已支持）  
6. **共享 Neon 迁移历史分叉** → 不可在本工作树对该库盲 `migrate deploy`  
7. **仓库级 lint 债务** → `npm run qa` 在 lint 阶段失败（main 既有）  
8. **3 个 DB 集成测试 + Image Engine FormData** 在本环境失败（与本功能无关）  
9. **前端缺 Playwright/真机** 移动端溢出未实机确认  

---

## 13. 是否建议提交 PR

**建议：可以开 PR（带合并前条件），暂不合并。**

合并前建议：

1. 在本分支 **commit** 当前改动  
2. 目标环境配置两张私有底图 URL  
3. 在**与 main 历史一致**的数据库执行 `npx prisma migrate deploy`  
4. 完成一次真实 E2E（或明确接受上线后配置底图）  
5. 人工点一次产品弹窗（含移动端）  
6. 勿用当前分叉 Neon 作为 deploy 目标

**不建议**在底图未配置且未做 migrate 的情况下宣称功能「生产就绪」。

---

## 14. 合并后部署步骤

1. 合并 PR 到目标分支（勿从本门禁自动合并）  
2. 部署环境设置：
   - `VISUALIZER_TEMPLATE_STANDARD_ROOM_URL`（私有 pathname 或 `/api/files/...`）
   - `VISUALIZER_TEMPLATE_LIVING_ROOM_URL`  
3. 将两张中性房间图上传至私有 Blob（路径与 env 一致）  
4. `npx prisma migrate deploy`（确认目标库无分叉冲突）  
5. 冒烟：
   - 创建仅含 texture 的产品 → `source_ready` → 生成两种模板  
   - 确认资产角色/来源/verification  
   - Job succeeded  
   - HD 渲染 `referenceQuality=ai_only` + warning toast  
6. 回归：带真实 installed 的产品仍优先真实图  

---

## 门禁总评

| 维度 | 状态 |
|---|---|
| 实现完整性（代码） | PASS |
| 静态迁移审查 | PASS |
| 目标库 migrate deploy | SKIPPED / PENDING_SAFE_TARGET_DB |
| `next build` | PASS |
| `npm run qa`（含 lint） | FAIL（既有 lint，非本功能） |
| Visualizer 单测 61 | PASS |
| 全量 npm test | 4 个无关失败 |
| 前端代码走查 | PASS（Playwright 未跑） |
| 真实生成 E2E | **BLOCKED_BY_TEMPLATE_SCENE_CONFIG** |
| 合并建议 | **可开 PR，暂缓合并至配置+ migrate + E2E** |

**暂停。** 未自动合并 main。
