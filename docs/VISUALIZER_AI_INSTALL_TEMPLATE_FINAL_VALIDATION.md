# Visualizer AI 安装模板 — Final Validation Gate

**日期：** 2026-07-25  
**分支：** `feature/visualizer-ai-install-templates`  
**工作树：** `/Users/user/Desktop/青砚-visualizer-templates`  
**Draft → Ready PR：** [#21](https://github.com/LucasJ880/-/pull/21)  
**约束遵守：** 未改 main、未合并；未对 production Neon 执行 migration；未提交 `.env.local` / 密钥；未伪造结果

---

## 1. 隔离数据库

| 项 | 值 |
|---|---|
| Neon Project | 青砚-AI工作助手 |
| Branch | **`visualizer-ai-template-e2e`**（非 primary） |
| Branch ID | `br-autumn-morning-anjqq420` |
| Endpoint（脱敏） | `ep-curly-moon-an3uwdeg…` |
| 连接串 | 仅工作树 `.env.local`（gitignore） |
| migrate status/deploy | PASS（schema up to date；本迁移已存在） |

临时测试组织：`visualizer-ai-template-e2e-org`（active）。  
测试账号：`visualizer-e2e@test.qingyan.ai`（非生产管理员；密码不入报告/Git）。

---

## 2. Vercel Preview 环境

| 项 | 结果 |
|---|---|
| Deployment | Ready |
| Preview URL（脱敏） | `https://1fjstwfyh-ijmpbfbs7-lucas-9039s-projects.vercel.app` |
| 稳定别名 | `git-feature-visualizer-ai-install-815f3e-…vercel.app`（Vercel SSO 保护；验证用 deployment URL） |
| Inspect | `vercel.com/lucas-9039s-projects/-/Gjcbi4BEfN8Wp1SQZX4nR2ir81CC` |

### Preview 环境变量（仅记录名称）

对 **Preview + git branch `feature/visualizer-ai-install-templates`** 单独配置（未写入 Production）：

- `DATABASE_URL` → 隔离 Neon branch  
- `DIRECT_URL` → 隔离 Neon branch  
- `VISUALIZER_TEMPLATE_STANDARD_ROOM_URL`  
- `VISUALIZER_TEMPLATE_LIVING_ROOM_URL`  

沿用既有 Preview/共享配置（未改 Production）：

- `BLOB_PRIVATE_READ_WRITE_TOKEN`  
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` 等  

配置后执行 `vercel redeploy` → Ready。

---

## 3. Preview 底图读取

| 检查 | 结果 |
|---|---|
| 登录用户读 standard 底图 | **PASS** HTTP 200 / image/jpeg / 188158 B |
| 登录用户读 living 底图 | **PASS** HTTP 200 / image/jpeg / 162035 B |
| 未登录访问 `/api/files/visualizer/templates/...` | **PASS** HTTP 302（跳转登录，拒绝） |
| 登录用户访问假 catalog 路径 | **PASS** HTTP 403「无权访问该文件」 |
| 服务端生成读取（不依赖浏览器 Cookie 代替 Blob SDK） | **PASS**（Preview 真实生成成功） |
| 前端暴露 `*.blob.vercel-storage.com` | **未发现**（资产为 `/api/files/...`） |

---

## 4. Preview 真实生成

对测试产品 `E2E Ripple Fold Drapery` 调用：

`POST /api/visualizer/catalog/[id]/generate-template`  
`{ "templateType": "standard_floor_to_ceiling_day" }`

| 检查 | 结果 |
|---|---|
| HTTP | **200**（约 103s） |
| Job | `cms0wswk…` **succeeded**（gpt-image-2） |
| Asset | `style_reference` + `ai_generated` + `ai_reference` |
| fileUrl | `/api/files/...` proxy；无公开 Blob host |
| 产品就绪 | 页面显示 **真实安装**（此前已有 installed；AI 仍新增保留） |
| AI 数量 | Preview 生成后 aiCount≥3（未覆盖既有模板） |

> 说明：因产品已含真实安装图，Preview 生成后 readiness 为 `real_install_ready`（符合优先级规则）。本地脚本另有纯 AI-only 路径 36/36 PASS。

---

## 5. 移动端 390×844（登录态）

Viewport：`390 × 844`（CDP mobile metrics）  
Preview 登录态进入 Sales Visualizer → 编辑产品弹窗。

| 检查项 | 结果 |
|---|---|
| 弹窗适配视口、可滚动、无横向溢出 | **PASS**（dialog ≈ 390×844；`scrollWidth` 未超宽） |
| 标题/关闭/底部取消·保存可见可点 | **PASS** |
| 素材区（安装/纹理/细节/色卡/AI） | **PASS** |
| 状态卡「已有真实安装案例」 | **PASS** |
| 模板选择：标准落地窗 + 现代客厅均可见 | **PASS** |
| AI 标签「AI 生成参考」 | **PASS** |
| 免责声明完整可见 | **PASS** |
| Loading / 重复提交保护（代码+前置 E2E） | **PASS**（JOB_IN_PROGRESS 已在脚本验证） |

### 代码修复（本轮）

`product-panel.tsx`：产品行「更多」按钮在移动端默认可见（原 `opacity-0` + hover，触屏无法编辑）。  
桌面仍保持 hover 显现。

### 截图证据

提交至：

- `docs/evidence/visualizer-ai-template/mobile-390-product-dialog.png`
- `docs/evidence/visualizer-ai-template/mobile-390-template-picker.png`
- `docs/evidence/visualizer-ai-template/mobile-390-ai-disclaimer-and-templates.png`

（测试数据；无密钥/无客户隐私）

---

## 6. 最终回归

| 命令 | 结果 |
|---|---|
| `npx prisma generate` | PASS |
| `npx next build` | PASS（本轮修复后执行） |
| Visualizer 单测 | **61/61 PASS** |
| `scripts/e2e-visualizer-ai-templates.ts` | **36/36 PASS**（回归） |

未改无关模块；仓库既有 lint 全量问题不在本轮范围。

---

## 7. Ready 检查清单

| 项 | 状态 |
|---|---|
| [x] Preview 使用隔离数据库 | PASS |
| [x] Preview 两张底图服务端可读 | PASS |
| [x] Preview 未登录访问被拒绝 | PASS |
| [x] Preview 至少一次真实模板生成成功 | PASS |
| [x] 移动端 390×844 登录态弹窗 PASS | PASS |
| [x] 模板选择、Loading、错误提示 PASS | PASS |
| [x] AI 标签和免责声明 PASS | PASS |
| [x] next build PASS | PASS |
| [x] Visualizer 单测 PASS | PASS |
| [x] 真实 E2E 回归 PASS | PASS |

---

## 8. Production 仍需执行（本轮未做）

1. **不要**把 Preview 的隔离 `DATABASE_URL` 配到 Production  
2. Production 配置：  
   - `VISUALIZER_TEMPLATE_STANDARD_ROOM_URL`  
   - `VISUALIZER_TEMPLATE_LIVING_ROOM_URL`  
3. 确认 Production DB baseline 后执行 `npx prisma migrate deploy`（若尚未含本迁移）  
4. Production 冒烟两种模板 + AI-only warning  
5. Preview 分支级 DB 覆盖在合并后可移除（避免其他 Preview 误连 e2e 库）

---

## 9. Neon 临时 branch

**保留** `visualizer-ai-template-e2e`，直至：

- PR 审查不再需要重跑 Preview；  
- 证据已保存；  
- 无其他开发者依赖。

清理前再删 branch。

---

## 10. 结论

**建议并将 PR #21 转为 Ready for Review。**  
仍 **不合并 main**；**不配置 Production 环境变量**；**不操作 Production migration**。
