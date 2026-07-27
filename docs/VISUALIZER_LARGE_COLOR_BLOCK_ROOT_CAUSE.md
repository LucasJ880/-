# Visualizer「大色块」根因诊断报告

**状态：** DIAGNOSIS COMPLETE（本轮仅诊断，未改代码、未上线）  
**代码基线：** `main`（与 Production 已合入的 Visualizer / HD Render 逻辑一致）  
**日期：** 2026-07-27  
**仓库：** `青砚-visualizer-templates`

---

## 1. 现象复述

用户路径：上传客户真实房间照片 → 确认窗户区域 → 选择产品/颜色 → 等待约 2 分钟 → 最终仍看到「一整块平面色块」。

用户常见误解：以为缺产品细节图导致「渲染失败成色块」。  
本诊断结论：**不要把「缺产品细节图」当主因**；编辑态本身就是色块预览，且 Web HD 管线会把色块画布截图当作 AI 主输入、且不传 mask。

---

## 2. 测试路径

本轮为**代码级端到端链路审计**（对照 Production 同源 `main`），未绑定某一个客户私有 Session ID（私有 Blob / 生产会话数据不可在本机直接枚举）。

覆盖的关键实现路径：

| 环节 | 位置 |
|---|---|
| 编辑舞台色块 | `src/app/(main)/sales/visualizer/[sessionId]/visualizer-stage.tsx` |
| 捕获 / 触发 HD | `src/app/(main)/sales/visualizer/[sessionId]/session-editor.tsx` |
| HD API | `src/app/api/visualizer/variants/[variantId]/render-hd/route.ts` |
| 普通封面导出 | `src/app/api/visualizer/variants/[variantId]/export/route.ts` |
| 参考图挑选 | `src/lib/visualizer/catalog-reference.ts` |
| 图像编辑 | `src/lib/visualizer/image-ai.ts` |
| Mask（Web HD 未用） | `src/lib/visualizer/png-mask.ts` |
| 微信对比实现（有 mask） | `src/lib/visualizer/wechat-visualizer.ts` |
| 演示/对比/分享回退 | `presentation-mode.tsx` / `comparison-mode.tsx` / `share-viewer.tsx` |

若需下一轮对「具体客户会话」做 Blob/DB 实锤，需提供 `sessionId` + `variantId`（或授权只读查询）。

---

## 3. 关键调用链

```text
客户原始房间图 (VisualizerImage.fileUrl)
  → Session / Variant / Regions（窗户区域 points）
  → 挂产品 → VisualizerProductOption.colorHex + opacity
  → 编辑器 VisualizerStage：Konva Rect 半透明纯色叠在底图上  ← 用户日常所见「大色块」
  → [可选] 用户点击「高清渲染」
       → captureDataUrl() = stage.toPngDataURL()（底图+色块已烘焙）
       → POST /api/visualizer/variants/:id/render-hd { dataUrl }
       → runImageEdit({ imageBuffer: composite, referenceImages?, 无 maskBuffer })
       → putVisualizerHdRender → VisualizerVariant.exportImageUrl
       → toast 成功 + load()
       → 但 SessionEditor 舞台仍始终渲染 Konva 色块，不切换到 exportImageUrl
  → 演示 / 对比 / 分享：优先 exportImageUrl，缺失则静默回退色块/canvas
```

---

## 4. 当前真实显示逻辑

### 4.1 编辑器（SessionEditor）— 用户主操作面

**始终显示编辑态 Konva 预览（房间图 + 纯色 Rect），从不根据 `exportImageUrl` 切换最终 AI 图。**

证据：`session-editor.tsx` 在选中图片后固定挂载 `<VisualizerStage />`；`handleRenderHdCover` 成功后仅 `load()` + toast，confirm 文案也写明「原始照片和产品叠加不会被修改」。

色块绘制（`visualizer-stage.tsx`）：

- 类型：react-konva `<Rect />`
- 填充：`po.colorHex ?? "#888888"`
- 透明度：`po.opacity`
- 裁剪：`clipFunc={clipForRegion(region)}`（按窗户区域）

→ **用户在编辑页等待后仍看到色块，很大概率是 EXPECTED_EDITOR_PREVIEW_ONLY，而非「HD 把结果画成色块」。**

### 4.2 演示 / 对比 / 分享

优先级：

1. `variant.exportImageUrl`（若有）→ `<img>`
2. 否则 → `VisualizerStage` 色块 或 canvas 填 `colorHex`（**静默回退，无 toast**）

### 4.3 Variant 图像字段

`VisualizerVariant` **仅有** `exportImageUrl`（无独立 `previewImageUrl` / `hdUrl`）。  
`previewImageUrl` 属于目录产品 `VisualizerCatalogProduct`，只影响产品列表缩略图。

「保存为方案封面」`/export` 会把**含色块的画布截图**直接写入 `exportImageUrl`（无 AI）——若用户走了这条路径，演示/分享会把烘焙色块当成「最终封面」。

---

## 5. render-hd 调用结果

| 项 | 结论 |
|---|---|
| 是否自动触发 | **否**。仅顶栏「高清渲染」手动触发（`handleRenderHdCover`） |
| 请求 | `POST /api/visualizer/variants/:variantId/render-hd` body: `{ dataUrl }`（前端未传 `instruction`） |
| dataUrl | `captureDataUrl()` → 含色块的 PNG |
| 成功 | 200 + 写入 `exportImageUrl` + `referenceQuality` / `warning` |
| 失败 | 502「高清渲染失败」等 → toast.error，**不改** `exportImageUrl`，界面继续色块 |
| 超时 / 约 2 分钟 | 与 `quality: "high"` 图像编辑耗时相符；等待结束≠编辑器会显示 AI 图 |

**本轮无法在无 sessionId 时断言「某次 Production 调用一定 200」**；但代码行为已明确：即使 HD 成功，编辑器仍显示色块。

---

## 6. AI 输入内容分析

### 实际是方案 C（高风险），并带方案 B 特征

| 输入 | Web render-hd |
|---|---|
| Image 1（主场景） | **Konva 画布截图**（原房间图 + 实心/半透明色块已烘焙） |
| Mask | **无**（`runImageEdit` 不传 `maskBuffer`） |
| 产品参考图 | catalog assets，最多 8 张（installed/texture/detail/…）；可为空仍继续渲染 |
| 区域几何 | **不**作为结构化输入；仅 prompt 文字「Replace only the indicated window-covering areas」 |

对比：

- **微信链路**（`wechat-visualizer.ts`）：原图 + `createMultiRectEditMaskPng` → `maskBuffer`  
- **clean-region**：有透明编辑 mask  
- **Web HD：独缺 mask，且主图已是 composite**

Prompt 还要求「Keep every other pixel visually consistent with input image 1」——在 Image 1 已含大色块时，模型更倾向于保留/轻度改造色块区域，而不是从干净原图重绘真实窗帘。

→ 归类 **F SOLID_OVERLAY_BAKED_INTO_AI_SOURCE** + **G MASK_OR_PROMPT_INSUFFICIENT**。

---

## 7. 产品素材情况

- HD 通过 `productCatalogId` 拉 `VisualizerCatalogProduct` + `assets`
- `pickCatalogReferencesForRender` 排序：真实 installed → texture → detail → swatch → AI style_reference
- 无素材 / 拉图失败：仍调用模型；`referenceQuality` 可为 `none` / `ai_only`（后者 toast warning）
- **缺细节图会降低真实感（褶皱/材质）**，但：
  - **不能解释编辑器默认就是色块**（那是 Konva 预览）
  - **不是「整块平面色块」的主因**；主因是预览语义 +（若走 HD）composite 输入 / 无 mask

→ **E PRODUCT_REFERENCE_MISSING_BUT_NOT_PRIMARY_CAUSE**（次要）

---

## 8. 根因分类

| 代码 | 是否成立 | 角色 |
|---|---|---|
| **A EXPECTED_EDITOR_PREVIEW_ONLY** | 是 | **Primary（编辑页观感）** |
| **F SOLID_OVERLAY_BAKED_INTO_AI_SOURCE** | 是 | **Primary（若已点 HD 仍像色块 / 封面仍块状）** |
| **G MASK_OR_PROMPT_INSUFFICIENT** | 是 | Secondary（加重 F） |
| **C HD_RENDER_FAILED_WITH_PREVIEW_FALLBACK** | 条件成立 | Secondary（失败或未生成封面时演示/分享静默色块） |
| **B HD_RENDER_NOT_TRIGGERED** | 条件成立 | Secondary（用户未点「高清渲染」却以为已渲染） |
| **D FRONTEND_SHOWING_WRONG_IMAGE** | UX 层面成立 | Secondary（HD 成功后编辑器仍不显示 `exportImageUrl`，易误判失败） |
| **E PRODUCT_REFERENCE_MISSING…** | 可能 | Secondary（非主因） |
| **H STATUS_SYNC_OR_CACHE_ISSUE** | 低 | 成功路径有 `load()`；未见独立 HD 状态机；非主因 |
| **I OTHER** | — | — |

### Primary cause

**双主因（按用户场景拆开）：**

1. **编辑主界面：** A — 大色块是预期编辑预览，不是 AI 最终效果图。  
2. **高清链路设计缺陷：** F（+G）— Web HD 把「含色块的画布截图」当唯一场景输入且不传 mask；即便模型跑完，也容易保留块状外观；且编辑器成功后仍不切换展示 `exportImageUrl`。

### Secondary contributing factors

- B：HD 非自动，用户可能把「等待」当成已渲染  
- C：无 `exportImageUrl` 时演示/分享静默色块  
- D：成功后编辑器不切最终图  
- E：参考图缺失降质，但非色块主因  
- 「保存封面」可把色块截图写成 `exportImageUrl`

---

## 9. 最小修复方案（建议，本轮不实施）

**目标：** 编辑态保留色块；HD 不再把色块当最终主输入；用原图 + mask + 产品参考。

### Phase 1 — 快速止损（推荐最小改动）

1. **Web `render-hd` 改输入（对齐微信）：**  
   - Image 1 = **干净客户房间原图**（从 `VisualizerImage` 拉 buffer，而不是前端 composite `dataUrl`）  
   - `maskBuffer` = 由 variant 上 regions（+ productOption transform）生成的编辑区 mask（复用 `createMultiRectEditMaskPng` / 等价）  
   - 保留 catalog referenceImages  
2. **Prompt 增补：** 明确「输入中的 flat color overlay 必须完全替换为真实窗饰，输出不得残留平面色块」。  
3. **前端：** HD 成功后在编辑器提供「查看高清封面」或短暂预览 `exportImageUrl`，避免「成功但仍是色块」的误判；失败保持现有 toast，演示页可对「仍无 export」给轻提示。

**不强制：** 改 Prisma、大改 Product Catalog、动私有 Blob 权限模型。

### 可选极小 UX（同 Phase 1）

- confirm / 按钮旁文案：「编辑区色块仅为预览；高清结果在方案封面 / 演示模式查看」。

---

## 10. 风险点

| 项 | 说明 |
|---|---|
| 模型成本 | HD 仍是 high quality 图像编辑；输入改干净后可能略增成功率，调用次数不变（仍手动） |
| 触发频率 | 当前手动；Phase 2 若自动渲染需限流 / 防抖 |
| 状态同步 | 建议成功后显式展示 `exportImageUrl`，避免误以为未生成 |
| 新字段 | Phase 1 可不新增；可选 `hdRenderStatus` / `hdRenderedAt` 留 Phase 3 |
| Production 影响 | 改变 HD 输入语义；需回归：有/无参考图、多窗、polygon region、权限与私有 Blob |
| 兼容 | 前端可暂仍传 `dataUrl` 作 fallback，服务端优先原图+mask |

---

## 11. 分阶段修复建议

### Phase 1：快速止损（本诊断推荐下一步）

- 原图 + mask + refs 作为 Web HD 输入  
- Prompt 禁止残留 flat overlay  
- 成功后可查看高清封面（编辑器或演示）

### Phase 2：交互优化

- 场景锁定 / 产品确认后可选「自动排队 HD」  
- 明确 loading 文案：「正在生成写实效果，编辑预览仍为色块」  
- 失败与「仅预览」状态可视化区分

### Phase 3：Render pipeline 完善

- Variant 级 HD 状态字段与历史版本  
- 与微信链路统一抽象 `buildHdEditPayload(session, variant)`  
- 质量门禁（参考图不足时引导补素材，而非静默劣质输出）

---

## 附录：直接回答诊断问题清单

| # | 问题 | 答案 |
|---|---|---|
| 1 | 是否本来就是编辑态大色块？ | **是（A）** |
| 2 | HD 是否真正触发？ | **仅手动**；尚未点则未触发（B） |
| 3 | 是否生成最终图？ | 成功则写入 `exportImageUrl`；失败则无 |
| 4 | 前端最终显示哪张？ | **编辑器=Konva 色块**；演示等优先 `exportImageUrl` |
| 5 | AI 输入是什么？ | **方案 C：含色块的画布截图** + 可选参考图；**无 mask** |
| 6 | 是否有 mask？ | Web HD **无**；微信有 |
| 7 | 产品绑定/素材？ | 走 `productCatalogId`；缺素材非色块主因（E） |
| 8 | 失败回退？ | toast 失败；编辑器/无封面时静默色块（C） |
| 9 | 状态同步？ | 成功有 load；编辑器不切图造成「像没渲染」（D） |

---

**报告路径：** `docs/VISUALIZER_LARGE_COLOR_BLOCK_ROOT_CAUSE.md`
