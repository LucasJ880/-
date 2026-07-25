# Visualizer AI 安装模板 — Final Validation Gate

**日期：** 2026-07-25  
**分支：** `feature/visualizer-ai-install-templates`  
**工作树：** `/Users/user/Desktop/青砚-visualizer-templates`  
**Draft PR：** [#21](https://github.com/LucasJ880/-/pull/21)  
**约束遵守：** 未改 main、未合并；未对 production Neon 执行 migration；未提交 `.env.local` / 密钥；未伪造 AI 生成结果

---

## 1. 分支与 commit 状态

| 项 | 状态 |
|---|---|
| 分支 | `feature/visualizer-ai-install-templates` |
| Draft PR | #21 OPEN + Draft |
| main | 未触碰 |

---

## 2. 修改文件清单（功能 + E2E）

见 PR diff；本轮 E2E 新增：

- `scripts/e2e-visualizer-ai-templates.ts` — 隔离库真实生成门禁
- `scripts/upload-visualizer-template-rooms.ts` — 底图上传
- `/api/files` 允许登录读 `visualizer/templates/...`
- 本报告更新

证据图仅存于 `.data/e2e-evidence/`（gitignore，不进 Git）。

---

## 3. 隔离数据库与 Prisma migration

| 项 | 值 |
|---|---|
| 提供商 | Neon |
| Project | 青砚-AI工作助手 |
| Branch 名称 | **`visualizer-ai-template-e2e`** |
| Branch ID | `br-autumn-morning-anjqq420`（非 primary） |
| Parent | `production`（copy-on-write；写入不回落 production） |
| Endpoint host（脱敏） | `ep-curly-moon-an3uwdeg…`（**非** production `ep-super-field-antfibsl…`） |
| 连接串位置 | **仅**工作树 `.env.local`（gitignore） |

### 命令与结果

```
npx prisma migrate status   → Database schema is up to date!（71 migrations）
npx prisma migrate deploy   → No pending migrations to apply.  PASS
npx prisma generate         → PASS
```

说明：父库已含 `20260725120000_visualizer_catalog_template`（finished_at 已存在）；本隔离分支 deploy 为 no-op，表/列已确认存在。  
**未**对 production / 分叉共享库执行 deploy；**未** `migrate reset` / `db push`。

---

## 4. 模板底图读取

| 变量 | 值 | 读取 |
|---|---|---|
| `VISUALIZER_TEMPLATE_STANDARD_ROOM_URL` | `/api/files/visualizer/templates/standard-floor-to-ceiling.jpg` | **readable** 188158 B |
| `VISUALIZER_TEMPLATE_LIVING_ROOM_URL` | `/api/files/visualizer/templates/modern-living-room.jpg` | **readable** 162035 B |

额外确认：

- 路径为私有 Blob pathname + `/api/files` 代理；服务端 `fetchBuffer`→`readBlobBuffer`（不依赖浏览器 Cookie）
- 资产 `fileUrl` 不包含 `*.blob.vercel-storage.com`
- `/api/files`：`visualizer/templates` = 登录即可；`catalog`/`sessions` 仍 org/session 鉴权；未知前缀 404
- 未登录访问：`withAuth` 拒绝（未开放匿名）

---

## 5. 真实生成 E2E（服务层 = generate-template API 同一实现）

脚本：`npx tsx scripts/e2e-visualizer-ai-templates.ts`  
产品：`E2E Ripple Fold Drapery` / drapery / Warm White / ceiling  
初始素材：texture + swatch + detail（real）；无 installed / 无 AI  
初始状态：`source_ready`  
模型：`gpt-image-2`

### 5.1 `standard_floor_to_ceiling_day` — **PASS**

| 检查 | 结果 |
|---|---|
| Job lifecycle → succeeded | PASS |
| outputAssetId / completedAt / 无 error | PASS |
| role/sourceType/verificationStatus | `style_reference` / `ai_generated` / `ai_reference` |
| 私有 Blob 可读写 | PASS（~1.7MB） |
| 非底图原样复制 | PASS（hash 不同） |
| 产品 → `ai_template_ready` | PASS |
| 标签「AI 生成参考」 | PASS |
| Job id（匿名） | `cms0vnd9…` |

### 5.2 `modern_living_room_day` — **PASS**

| 检查 | 结果 |
|---|---|
| Job succeeded + 独立 outputAssetId | PASS |
| 资产字段 | PASS |
| Blob ~1.9MB 可读 | PASS |
| 与标准模板 Job/资产互不覆盖 | PASS（aiCount=2） |
| Job id（匿名） | `cms0vpv6…` |

### 5.3 重复点击 / 失败路径

| 检查 | 结果 |
|---|---|
| 插入 running Job → `JOB_IN_PROGRESS` | PASS |
| incomplete 产品 → `SOURCE_INCOMPLETE`，无伪成功资产 | PASS |
| 成功后资产不被后续失败删除 | PASS（AI 模板保留） |

> 模型超时类 failed Job 未故意破坏生产模型配置制造；失败分支以既有错误码路径覆盖。

### 5.4 生成质量观察（人工看证据图）

| 观察 | standard | living |
|---|---|---|
| 窗帘在主窗区域 | 是（落地 ripple + 纱） | 是 |
| 房间结构大体保留 | 是 | 是 |
| 明显 Logo/水印/大段文字 | 未见 | 未见 |
| 空文件 / 底图原样 | 否 | 否 |

证据仅本地 `.data/e2e-evidence/`，**未提交 Git**。

---

## 6. 客户高清渲染参考质量

| 步骤 | 结果 |
|---|---|
| 仅 AI 模板 → `referenceQuality=ai_only` | **PASS** |
| warning 含「未使用真实安装案例」 | **PASS** |
| 排序 texture/detail/swatch 先于 AI 模板 | **PASS** |
| 补 `installed+real+real_unverified` → `real_install_ready` | **PASS** |
| 不再 `ai_only`（变为 `mixed`） | **PASS** |
| 真实安装图排序第一；AI 模板仍保留 | **PASS** |

---

## 7. 移动端产品弹窗（390×844）

| 项 | 结果 |
|---|---|
| 代码走查：底部取消/保存、`generating` 禁用、状态卡、免责声明、loading 文案 | **PASS（静态）** |
| Playwright 登录态实机截图 | **BLOCKED**（无已认证浏览器会话；未起本地登录流） |

建议合并前人工在手机或 DevTools 390×844 点一次。

---

## 8. Vercel Preview

| 项 | 结果 |
|---|---|
| Preview 环境变量配置 | **NOT RUN**（本机无 `vercel` CLI / 未改 Production） |
| Preview 底图读取 / 真实生成 | **BLOCKED_BY_PREVIEW_ACCESS** |

本地服务端私有 Blob 读取已 PASS。Preview 需在 Vercel 项目 Preview env 写入两行 `VISUALIZER_TEMPLATE_*` 后补验。

---

## 9. 门禁重跑

| 命令 | 结果 |
|---|---|
| `npx prisma generate` | PASS |
| `npx next build` | PASS |
| Visualizer 单测 | **61/61 PASS**（8+19+15+19） |
| 真实 E2E 脚本 | **36/36 PASS** |

全量 `npm test` 既有无关失败未在本轮重跑；未改无关模块。

---

## 10. 解除 Draft 检查清单

| 项 | 状态 |
|---|---|
| [x] isolated DB migration PASS | PASS |
| [x] standard_floor_to_ceiling_day E2E PASS | PASS |
| [x] modern_living_room_day E2E PASS | PASS |
| [x] AI-only render warning PASS | PASS |
| [x] real image priority upgrade PASS | PASS |
| [ ] mobile dialog PASS | **部分**（代码 PASS / 浏览器截图 BLOCKED） |
| [ ] Vercel Preview room read PASS | **BLOCKED** |

---

## 11. 剩余风险

1. Preview/Production 环境变量尚未同步  
2. 移动端未做登录态实机截图  
3. Neon e2e branch 自 production 分叉，含生产数据副本——测完可删除 branch  
4. `outputAssetId` 仍无 FK  
5. 同步 Job 长请求超时风险仍在  
6. 生成质量依赖模型；本轮目视合格，但非像素级验收

---

## 12. 是否建议 Draft → Ready for Review

**建议：暂保持 Draft。**

理由：核心真实生成 / Job / AI-only / 真实图优先级均已在隔离库通过，但 **mobile 实机** 与 **Vercel Preview** 两项未勾选。  
勾选该两项后即可转 Ready；**不要合并 main，直到 Preview 与 migrate baseline 对目标环境确认完毕。**

---

## 13. 合并后部署步骤（提醒）

1. 确认目标 DB baseline（勿对错误库 deploy）  
2. `npx prisma migrate deploy`（若目标尚未含本迁移）  
3. 配置 Preview/Production：`VISUALIZER_TEMPLATE_*`  
4. 冒烟两种模板 + AI-only warning  
5. 删除临时 Neon branch `visualizer-ai-template-e2e`（可选清理）

---

## 门禁总评（本轮）

| 维度 | 状态 |
|---|---|
| 隔离库 migrate | PASS |
| 底图私有读取 | PASS |
| 双模板真实生成 | PASS |
| Job / 资产字段 | PASS |
| AI-only + 真实图升级 | PASS |
| 重复点击 / incomplete 失败 | PASS |
| next build + Visualizer 61 | PASS |
| Mobile 实机 | BLOCKED |
| Vercel Preview | BLOCKED |
| 建议 Ready | **否（先补 Preview + 移动端）** |

**暂停。** 未合并 main；未触碰 production 数据库写入路径（E2E 仅写隔离 branch）。
