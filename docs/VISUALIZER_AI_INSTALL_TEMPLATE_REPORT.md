# 青砚 Visualizer：AI 标准安装模板与真实安装图体系升级

**分支：** `feature/visualizer-ai-install-templates`（基于 `origin/main`）  
**日期：** 2026-07-25  
**工作树：** `/Users/user/Desktop/青砚-visualizer-templates`（与原 WIP 分支隔离）

---

## 1. 新增和修改的文件

### Prisma
- `prisma/schema.prisma` — `verificationStatus`、`VisualizerCatalogTemplateJob`
- `prisma/migrations/20260725120000_visualizer_catalog_template/migration.sql`

### 核心库（新增）
- `src/lib/visualizer/catalog-readiness.ts`
- `src/lib/visualizer/catalog-reference.ts`
- `src/lib/visualizer/catalog-template.ts`

### 核心库（修改）
- `src/lib/visualizer/types.ts`
- `src/lib/visualizer/catalog.ts`

### API
- `src/app/api/visualizer/catalog/[id]/generate-template/route.ts`（新增）
- `src/app/api/visualizer/catalog/route.ts`
- `src/app/api/visualizer/catalog/[id]/route.ts`
- `src/app/api/visualizer/variants/[variantId]/render-hd/route.ts`

### UI
- `src/app/(main)/sales/visualizer/[sessionId]/catalog-product-dialog.tsx`
- `src/app/(main)/sales/visualizer/[sessionId]/product-panel.tsx`
- `src/app/(main)/sales/visualizer/[sessionId]/session-editor.tsx`

### 测试 / 配置
- `src/lib/visualizer/__tests__/catalog-readiness.test.ts`
- `src/lib/visualizer/__tests__/catalog-template.test.ts`
- `src/lib/visualizer/__tests__/catalog-template-gate.test.ts`
- `src/lib/visualizer/__tests__/catalog-assets.test.ts`
- `scripts/test-all.sh`
- `.env.example`

---

## 2. Prisma 是否增加迁移

**是。** `20260725120000_visualizer_catalog_template`

- `VisualizerCatalogAsset.verificationStatus` 默认 `draft`
- 新表 `VisualizerCatalogTemplateJob`（queued/running/succeeded/failed）

部署：`npx prisma migrate deploy`

---

## 3. 产品保存规则变化

| 情况 | 原规则 | 新规则 |
|---|---|---|
| 无 installed | **前端禁止保存** | **可保存草稿** |
| 有 texture/detail/swatch | — | `source_ready`，可生成 AI 模板 |
| 有 AI 模板 | — | `ai_template_ready`，可用于客户生成 |
| 有真实 installed | 可保存 | `real_install_ready`，最高优先级 |

---

## 4. AI 模板底图

环境变量（须为本系统私有路径，禁止第三方公开 URL）：

- `VISUALIZER_TEMPLATE_STANDARD_ROOM_URL` — 标准落地窗
- `VISUALIZER_TEMPLATE_LIVING_ROOM_URL` — 现代客厅

未配置时 API 返回 **503** + 文案：`AI 标准场景底图尚未配置，请联系管理员。`（不静默失败）

Image Edit：**底图 = image 1**；产品 texture/detail/swatch = 后续参考图。

---

## 5. AI 模板如何标识

```
role = style_reference
sourceType = ai_generated
verificationStatus = ai_reference
isPrimary = false
```

禁止伪装为 `installed + real`（sanitize 会强制降级）。

---

## 6. 真实安装图最高优先级

HD 渲染排序（`catalog-reference.ts`）：

1. `installed + real + real_verified`
2. `installed + real + real_unverified`
3. `texture + real`
4. `detail + real`
5. `swatch + real`
6. `style_reference + ai_generated`

同 role：`isPrimary` → `sortOrder`。

Prompt 明确：`Real installed references are authoritative. AI-generated style references are secondary guidance only.`

仅 AI 时返回：`referenceQuality: "ai_only"` + warning，前端 toast 提示。

---

## 7. 是否增加 TemplateJob

**是。** 同步执行亦写入 Job 生命周期，便于后续异步队列升级。

---

## 8. 新增测试

- `catalog-readiness.test.ts` — 19 cases
- `catalog-template.test.ts` — 15 cases
- `catalog-template-gate.test.ts` — 19 cases（权限/底图/Job 策略门禁）
- `catalog-assets.test.ts` — 扩展 verificationStatus / 上限 16

已接入 `scripts/test-all.sh`。完整门禁见 `docs/VISUALIZER_AI_INSTALL_TEMPLATE_FINAL_VALIDATION.md`。

---

## 9. 执行的命令与结果

见 Final Validation 报告（`npx next build` PASS；Visualizer 61/61；真实 E2E 因底图未配置 BLOCKED）。  
未对不确定生产库执行 `migrate deploy`。

---

## 10. 尚未完成 / 需配置

1. **必须配置**两个模板底图环境变量，并上传中性房间图到私有 Blob  
2. 管理员「真实安装图已验证」操作 UI（字段已支持 `real_verified`，本轮上传默认为 `real_unverified`）  
3. `bedroom_blackout` 仅预留，未实现  
4. 真正异步队列（当前同步 + Job 记录）

---

## 11. 最终生成优先顺序（摘要）

**真实安装图 > 面料纹理 / 结构细节 / 色卡 > AI 标准安装模板**

AI 模板仅辅助预览，不代表真实项目或交付承诺。
