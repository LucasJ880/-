# Visualizer Phase 1：真实房间图 + Mask HD 修复报告

**分支：** `feature/visualizer-real-room-hd-mask-fix`
**日期：** 2026-07-27
**状态：** PHASE 1 IMPLEMENTATION COMPLETE；Final Validation **BLOCKED**（Preview DB = Production-like，见 Final Validation 报告）
**PR：** [#27](https://github.com/LucasJ880/-/pull/27) Draft — **未**转 Ready
**Schema：** 无 Prisma migration / 无新字段

Final Validation：`docs/VISUALIZER_REAL_ROOM_HD_MASK_FINAL_VALIDATION.md`


---

## 1. 修改文件列表

### 新增
| 文件 | 作用 |
|---|---|
| `src/lib/visualizer/hd-source-image.ts` | HD 主输入房间图解析（cleaned > original） |
| `src/lib/visualizer/mask-padding.ts` | 品类级 mask padding（shade / vertical / drapery） |
| `src/lib/visualizer/hd-window-mask.ts` | 确认区域 → 同尺寸 PNG mask |
| `src/lib/visualizer/hd-render-prompt.ts` | HD Prompt 组装 |
| `src/lib/visualizer/hd-render-core.ts` | 可单测 Image Edit 入参组装 + 失败契约 |
| `src/lib/visualizer/hd-view-mode.ts` | 前端显示模式纯函数 |
| `src/lib/visualizer/__tests__/hd-source-image.test.ts` | 主输入选择测试 |
| `src/lib/visualizer/__tests__/mask-padding.test.ts` | padding 策略测试 |
| `src/lib/visualizer/__tests__/hd-window-mask.test.ts` | mask 语义与尺寸测试 |
| `src/lib/visualizer/__tests__/hd-render-core.test.ts` | render 核心 / UI 模式测试 |
| `src/lib/visualizer/__tests__/png-decode.ts` | 简易 PNG 解码（测 alpha） |
| `scripts/e2e-visualizer-real-room-hd.ts` | 脱敏合成图真实 E2E |
| `docs/VISUALIZER_LARGE_COLOR_BLOCK_ROOT_CAUSE.md` | 诊断报告（本轮一并纳入） |
| `docs/VISUALIZER_REAL_ROOM_HD_MASK_FIX_REPORT.md` | 本报告 |

### 修改
| 文件 | 作用 |
|---|---|
| `src/app/api/visualizer/variants/[variantId]/render-hd/route.ts` | 原图/cleaned + mask + refs；失败不覆盖旧 export |
| `src/app/(main)/sales/visualizer/[sessionId]/session-editor.tsx` | HD 成功切图 / loading / 错误 / 返回编辑 |
| `src/lib/visualizer/png-mask.ts` | `createMultiRegionEditMaskPng` |
| `src/lib/visualizer/catalog-reference.ts` | `PRODUCT_REFERENCE_LIMITED` warningCode |
| `scripts/test-all.sh` | 挂载新单测 |
| `.gitignore` | 忽略 `tmp/`（E2E 产出） |

---

## 2. 原因和修复逻辑

**PRIMARY（已修）：**
- **A** Konva 实心色块本是编辑预览 → 保留，但不再当作 HD 成功结果展示
- **F** Web HD 把「原图+色块」canvas 当 AI 主输入且无 mask → 改为原图/cleaned + 真实 mask

**SECONDARY（已修）：**
- **G** 无 mask → 由确认区域生成 mask
- **D** 成功后仍停在色块预览 → 自动切到 `exportImageUrl`
- 失败静默/伪成功 → 明确错误，不覆盖旧 export，不提示「生成完成」

**E（产品参考缺失）：** 非大色块主因；允许继续生成，返回 `PRODUCT_REFERENCE_LIMITED` 质量警告。

---

## 3. 主输入图片优先级

1. 与 Variant 产品区域同血缘、用户明确生成的 **cleaned** 图（`note` 含 `AI cleaned from source image …`）
2. 客户 **original** 上传图（产品区域所在 `VisualizerSourceImage`）
3. **禁止**将 composed canvas / `dataUrl` 作为 AI 主输入（旧客户端若仍传 `dataUrl`，仅打日志忽略）

缺失时返回：`SOURCE_ROOM_IMAGE_MISSING`
无确认产品区域：`SCENE_REGION_NOT_CONFIRMED`

cleaned 与区域图尺寸不一致时，回退到区域所在原图，避免坐标错位。

---

## 4. Mask 生成方式

- 复用 OpenAI Image Edit 语义：**透明 = 可编辑，不透明 = 保留**（与 `createTransparentEditMaskPng` / 微信链路一致）
- 新 helper：`createMultiRegionEditMaskPng` + `buildHdWindowMask`
- 输入：Variant 上全部 `productOptions` 对应的 `VisualizerWindowRegion`（原图像素坐标）
- 多窗合并为一张 mask；支持 rect / polygon
- 坐标 clamp 到图片边界
- 可编辑面积占比 > 72% 拒绝：`WINDOW_MASK_TOO_LARGE`（防整房编辑）
- 无区域：`SCENE_REGION_NOT_CONFIRMED` / `WINDOW_MASK_EMPTY`

---

## 5. 各产品类别 padding 策略

| 组 | 品类 | 策略（相对区域，并受整图比例硬顶） |
|---|---|---|
| shade | roller / zebra / honeycomb / solar / dual… | 小范围顶/侧/底 padding |
| vertical | vertical | 顶部轨道 + 左右少量堆叠 |
| drapery | drapery / sheer / motorized | 更大顶/侧/底；近地面时底部可再略增（仍 ≤ 图高 45%） |
| default | 其他 | 中等保守扩展 |

统一入口：`expandRegionPointsForMask` / `computeMaskPaddingInsets`。
**限制：** 无深度/地面语义，落地窗到底仅用「区域底边距图底 <15%」启发式；宁可偏保守。

---

## 6. Prompt 修改

`buildHdRenderPrompt` 明确：
- 房间图权威；mask 为唯一可安装区
- 禁止保留/重建 flat colored placement rectangle
- 要求真实结构、纹理、硬件、褶皱/叶片、阴影
- 按品类补充 drapery / roller / zebra / honeycomb / blinds 细则

主修复仍是原图 + mask，Prompt 为辅。

---

## 7. 前端显示切换

前端状态（无 DB 字段）：`editing | rendering | rendered | error`

| 状态 | 主区域 |
|---|---|
| editing / error | Konva 窗户+色块辅助 |
| rendering | Loading「正在生成 AI 实景效果图…」 |
| rendered | `<img src=exportImageUrl>` |

提供「查看 AI 效果图」/「返回编辑窗户区域」。
按钮文案改为「生成高清效果图」；仍为**手动触发**（无自动渲染）。

---

## 8. 错误处理

| 场景 | 行为 |
|---|---|
| 模型失败 / 抛错 | 502 + 明确文案；返回旧 `exportImageUrl`；不写库覆盖 |
| Blob 保存失败 | 同上，`HD_BLOB_SAVE_FAILED` |
| 原图缺失 / mask 失败 | 400/502 + code；结束 loading；可重试 |
| 参考不足 | 仍可生成；`warningCode=PRODUCT_REFERENCE_LIMITED` + UI toast |

失败文案示例：
「AI 渲染失败，当前画面仍为编辑预览，并非最终效果图。请重试。」

---

## 9. 新增测试和结果

| 测试 | 结果 |
|---|---|
| `hd-source-image.test.ts` | 9 passed |
| `mask-padding.test.ts` | 16 passed |
| `hd-window-mask.test.ts` | 17 passed |
| `hd-render-core.test.ts` | 23 passed |
| 既有 catalog-readiness / template-gate | 通过 |

已挂入 `scripts/test-all.sh`。

---

## 10. 真实 E2E 结果

脚本：`scripts/e2e-visualizer-real-room-hd.ts`
素材：本地合成房间图（无客户隐私）
产出：`tmp/visualizer-hd-e2e/`（已 gitignore，不提交）

| 场景 | 参考 | 结果 |
|---|---|---|
| scene1 | texture + detail | OK，约 1.8MB PNG；有褶皱/轨道，非平面色块 |
| scene2 | 仅 swatch | OK，约 1.85MB PNG；仍有布帘形态，非平面色块 |

两端均确认：主输入非 composed、mask 非空、成功写出 `result.png`。
**注意：** 合成底图极简时，模型可能较强重绘室内景；真实客户照片 + mask 的「保留窗外区域」表现需上线前再抽检 1–2 张真实样张。

---

## 11. Schema 变化

**无。** 未新增 Prisma 字段，未执行 migration。

---

## 12. 已知限制

1. 无自动「选布料即渲染」（Phase 2）
2. padding 无真实地面/轨道检测，布帘扩展保守
3. 多照片多区域挂同一 Variant 会 `SOURCE_IMAGE_AMBIGUOUS`
4. cleaned 与原图尺寸不一致时退回原图
5. E2E 使用合成图，室内保留度不能完全代表真实客户照
6. Konva 色块预览仍在编辑模式保留（预期行为）

---

## 13. Phase 2 自动渲染建议

- 选产品后 debounce 自动 HD
- latest-change-wins / Render Job 队列
- A/B/C 方案并行
- 可选：把 `sourceKind` / `warningCode` 写入轻量审计日志（仍可不改 Schema）

---

## 14. 是否建议开 PR

**建议开 Draft PR**（标题建议：`fix(visualizer): HD render uses room image + window mask`），
**不要合并 main / 不要部署 Production**，待产品在预览环境目视验收 scene 样张后再转 Ready。

---

## 验收对照（Phase 1）

| # | 标准 | 状态 |
|---|---|---|
| 1 | Konva 色块仅编辑模式 | ✅ |
| 2 | HD 主输入不含实心色块截图 | ✅ |
| 3 | 使用 original/cleaned | ✅ |
| 4 | 使用确认区域 mask | ✅ |
| 5 | 产品素材作 reference | ✅ |
| 6 | 成功后展示 exportImageUrl | ✅ |
| 7 | 可返回区域编辑 | ✅ |
| 8 | 失败明确提示 | ✅ |
| 9 | 失败不伪造成功 | ✅ |
| 10 | 无 detail 仍可生成 + 质量警告 | ✅ |
| 11 | 无 Prisma migration | ✅ |
| 12 | 模板/分享/演示未改主流程 | ✅（未动模板生成与分享路由） |
