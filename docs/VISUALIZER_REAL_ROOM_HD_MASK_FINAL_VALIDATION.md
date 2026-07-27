# Visualizer Real-Room HD Mask — Final Validation Gate

**日期：** 2026-07-27  
**分支：** `feature/visualizer-real-room-hd-mask-fix`  
**PR：** [#27](https://github.com/LucasJ880/-/pull/27)  
**约束遵守：** 未合并 main；未部署 Production；未执行任何 migration / db push / reset / resolve；未修改 Production DATABASE_URL；未提交连接串 / Cookie / Token / 房间原图  

---

## 1. 隔离 Neon branch

| 项 | 值 |
|---|---|
| BRANCH_NAME | `visualizer-real-room-hd-mask-preview` |
| Branch ID | `br-lingering-term-anla4k5s` |
| IS_PRIMARY | **false** |
| PARENT | `production` (`br-green-boat-ann7k5yf`) |
| Endpoint host（脱敏） | `ep-raspy-credit-anx2k4wx…` |
| SCHEMA_READY | **true** |
| `npx prisma migrate status`（只读） | **Database schema is up to date**（71 migrations） |
| TEMP_NEON_BRANCH_STATUS | **RETAINED**（合并与 Production 冒烟前不删除） |

---

## 2. Preview DB 与 Production 分离

| 检查 | 结果 |
|---|---|
| Preview 分支级 `DATABASE_URL` / `DIRECT_URL` | 已覆盖到 `feature/visualizer-real-room-hd-mask-fix` → `ep-raspy-credit…` |
| Preview host ≠ `ep-super-field-antfibsl…` | **PASS** |
| Production host 仍为 `ep-super-field-antfibsl…` | **PASS**（未改 Production 变量） |
| Preview / Production host 不同 | **PASS** |
| 运行时证明 | 仅存在于隔离库的 QA 账号 `hd-mask-preview-qa@test.qingyan.ai` 可登录 Preview URL |

Preview deployment（验收时）：

- `https://1fjstwfyh-bja2sulg3-lucas-9039s-projects.vercel.app`
- Git alias：`https://git-feature-visualizer-real-room-h-f1fcc0-lucas-9039s-projects.vercel.app`

说明：Vercel Authentication SSO 使无浏览器会话的纯 HTTP bypass 不稳定；因此 **render-hd 完整 API 路径**在指向同一隔离 Neon 的本地 `next start :3010` 上执行，**Preview 登录态 UI** 用于 export 切换与 390×844 验收（同源隔离库）。

---

## 3. 测试数据（仅隔离库）

| 项 | 值 |
|---|---|
| Org | `PREVIEW TEST - Visualizer HD Mask Org` |
| Customer | `PREVIEW TEST - Visualizer HD Mask sample{1,2}` |
| Session | `PREVIEW TEST - Real Room HD sample{1,2}` |
| Product 1 | `PREVIEW TEST - Ripple Fold Drapery`（texture + detail） |
| Product 2 | `PREVIEW TEST - Limited Reference Drapery`（swatch-only） |
| 房间图 | 合成隐私安全房间图（无人脸/无地址/无证件；未提交 Git） |

---

## 4. 样张一（texture + detail）

| 项 | 结果 |
|---|---|
| SAMPLE_1_STATUS | **PASS** |
| RENDER_DURATION | ~111s |
| sourceKind | original |
| exportImageUrl | 已写入 |
| EXPORT_IMAGE_SWITCH | Preview UI 显示「查看 AI 效果图」并可切换 |
| FLAT_COLOR_BLOCK | **消失** — ripple folds / 杆 / 纹理 / 阴影 |
| OUTSIDE_MASK_STABILITY | **基本稳定** — 墙面、深色柜、左侧黑色装饰块保持 |
| PRODUCT_STRUCTURE_QUALITY | 布帘褶皱与顶部结构清晰 |

匿名 sessionId：`cms2qmf4z0005n1p5mvzzkrfh`

---

## 5. 样张二（swatch-only）

| 项 | 结果 |
|---|---|
| SAMPLE_2_STATUS | **PASS** |
| RENDER_DURATION | ~96s |
| REFERENCE_WARNING_STATUS | **PRODUCT_REFERENCE_LIMITED** + 中文 warning |
| FLAT_BLOCK_STATUS | **非色块** — 仍有褶皱/轨道结构 |
| OUTSIDE_MASK_STABILITY | 墙面/柜体/装饰块保持 |
| 质量 | 低于样张一可接受，但非平面纯色块 |

---

## 6. 失败路径

注入方式：无产品选项的空 Variant 调用 `render-hd`（不破坏模型密钥/Blob）。

| 检查 | 结果 |
|---|---|
| HTTP | 400 |
| code | `SCENE_REGION_NOT_CONFIRMED` |
| 明确错误 | 是 |
| 旧 exportImageUrl 保留 | **PASS** |
| 无假成功 | **PASS** |

本地证据：`tmp/visualizer-hd-e2e/preview-acceptance/failure-path.json`（不入库）

---

## 7. 移动端 390×844（Preview 登录态）

| 检查 | 结果 |
|---|---|
| viewport | 390×844（CDP mobile metrics） |
| 编辑器打开 | PASS |
| 「生成高清效果图」可见 | PASS |
| 「查看 AI 效果图」 | PASS — 显示真实 drapery 结果 |
| 「返回编辑窗户区域」 | PASS — 回到 Konva/色块编辑辅助 |
| 横向溢出 | **无**（scrollWidth === clientWidth === 390） |
| 底栏/按钮 | 可见 |

提交截图：

- `docs/evidence/visualizer-real-room-hd-mask/mobile-390-ai-result.png`
- `docs/evidence/visualizer-real-room-hd-mask/mobile-390-editing.png`

未提交：房间原图、QA 密码、Cookie、连接串。

---

## 8. Final Gate

| 检查 | 结果 |
|---|---|
| PRISMA_GENERATE | PASS |
| TSC | PASS |
| NEXT_BUILD | PASS |
| VISUALIZER_TESTS | PASS（HD source/mask/padding/render-core + catalog 套件） |
| SCHEMA_CHANGE | **NONE** |
| MIGRATION | **NONE** |

---

## 9. 代码修复

本轮验收 **无功能修复 commit**（仅报告 / 证据 / 验收脚本）。  
验收脚本（可选入库）：

- `scripts/seed-hd-mask-preview-qa.ts`
- `scripts/preview-hd-mask-acceptance.ts`
- `scripts/preview-hd-mask-failure-path.ts`

---

## 10. Ready 门禁核对

| 门禁 | 状态 |
|---|---|
| Preview 使用隔离 Neon branch | PASS |
| 样张一不再是大色块 | PASS |
| 样张二不再是大色块 | PASS |
| mask 外区域基本稳定 | PASS |
| exportImageUrl 自动显示 | PASS |
| 返回编辑模式正常 | PASS |
| 失败路径明确 | PASS |
| 390×844 PASS | PASS |
| next build PASS | PASS |
| Visualizer tests PASS | PASS |
| 无 Schema / migration 变化 | PASS |

**建议：将 PR #27 转为 Ready for Review。**  
**仍禁止：合并 main、部署 Production。**  
**隔离 Neon branch 保留。**

---

## 11. 已知限制

1. Preview Vercel Authentication 对纯自动化 HTTP bypass 不稳定；API 深度路径在同库本地 `next start` 完成。  
2. 验收房间图为隐私安全合成图，非客户实拍。  
3. 合成底图场景中模型仍可能增强室内细节，但柜体/墙饰等关键结构保持。  
4. Phase 2 自动渲染未做。
