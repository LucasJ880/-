# Visualizer Real-Room HD Mask — Final Validation Gate

**日期：** 2026-07-27
**分支：** `feature/visualizer-real-room-hd-mask-fix`
**PR：** [#27](https://github.com/LucasJ880/-/pull/27)（**仍为 Draft**）
**HEAD：** `a2a451817685b2d752572bcc4874505bce3dfdaf`
**约束遵守：** 未合并 main；未部署 Production；未执行 migration；未改 Prisma schema；未向 Production 库写入测试会话/上传；未提交密钥 / `.env` / `tmp/` 产物

---

## 1. PR 和 commit 状态

| 项 | 值 |
|---|---|
| PR | #27 Draft |
| Commits | `2608be0` fix；`a2a4518` test |
| 本轮新修复 commit | **无**（未发现需本 PR 内热修的代码问题；验收被环境安全门禁阻断） |
| Schema / migration | **NONE** |

---

## 2. Preview deployment

| 项 | 结果 |
|---|---|
| Deployment | Ready |
| Preview URL | `https://git-feature-visualizer-real-room-h-f1fcc0-lucas-9039s-projects.vercel.app` |
| Inspector | `https://vercel.com/lucas-9039s-projects/-/nhQKVgj9gf2piTyvgXBtRhpDY7p9` |
| Vercel check | pass |

### Preview 数据库安全检查（阻断项）

对 Preview 环境变量拉取后仅核对 host（不记录连接串）：

| 项 | 结果 |
|---|---|
| `DATABASE_URL` host | `ep-super-field-antfibsl-…`（**Production 同款**） |
| `DIRECT_URL` host | `ep-super-field-antfibsl-…`（**Production 同款**） |
| 本 feature 分支专属 Preview DB 覆盖 | **缺失** |
| 历史安全隔离库 | `visualizer-ai-template-e2e` / `ep-curly-moon-an3uwdeg…`（仅存在于 #21 时期报告；当前工作树未挂载） |

**结论：** 当前 Preview **不能**安全执行「上传房间图 / 创建 session / 真实 render-hd」等写库操作。
按任务安全边界：**已暂停 Preview 真实样张写入验收**，不得自行把 Production 当测试库，也不得在本轮擅自 migration。

**解锁条件（需你确认后执行）：**

1. 为 `feature/visualizer-real-room-hd-mask-fix` 的 Preview 单独覆盖 `DATABASE_URL` / `DIRECT_URL` → 既有非 primary 隔离 Neon（推荐复用 `visualizer-ai-template-e2e`，若仍存在）；
2. 确认 schema 已与当前代码兼容（**不**在本 PR 执行新 migration）；
3. `vercel redeploy` 该 Preview；
4. 使用测试组织账号完成两张真实房间样张路径。

---

## 3. 两张测试场景说明

### 可完成部分：本地隔离合成 E2E（非 Preview UI）

脚本：`scripts/e2e-visualizer-real-room-hd.ts`
证据目录（gitignore，**未提交**）：`tmp/visualizer-hd-e2e/`

| 场景 | 输入 | 产品 | 参考 | AI 调用 |
|---|---|---|---|---|
| Sample 1 | 合成房间 PNG + 窗户 mask | Drapery | texture + detail | `runImageEditDetailed` 真实模型 |
| Sample 2 | 同上房间 + mask | Drapery | **仅 swatch** | 同上 |

### Preview 真实房间样张

| 场景 | 状态 |
|---|---|
| 样张一：客厅落地窗 + drapery + texture/detail | **BLOCKED**（Preview DB = Production-like） |
| 样张二：第二场景 + 有限参考 | **BLOCKED**（同上） |

---

## 4. 产品参考素材情况

| 场景 | 参考 | 观察 |
|---|---|---|
| Sample 1 | texture + detail（合成） | 生成 ripple-fold 布帘，有褶皱/轨道/阴影 |
| Sample 2 | 仅 swatch | 仍生成布帘形态，非平面色块；质量可接受偏低 |

Preview 上的 `PRODUCT_REFERENCE_LIMITED` toast：**未验证**（写库阻断）。

---

## 5. render-hd 请求结果

### 本地合成链路（PASS）

- 主输入：original room buffer（非 composed）
- mask：非空 PNG
- 两场景均返回图像 buffer 并写入 `result.png`
- summary：`tmp/visualizer-hd-e2e/summary.json`

### Preview `/api/visualizer/variants/:id/render-hd`

**未执行**（避免写入 Production 库）。

---

## 6. exportImageUrl 切换结果

| 检查 | 状态 | 依据 |
|---|---|---|
| 成功后切到 exportImageUrl | **CODE + UNIT PASS** | `hd-view-mode` / `session-editor` |
| 可返回编辑窗户区域 | **CODE + UNIT PASS** | 同上 |
| Preview UI 实测切换 | **BLOCKED** | 无安全写库 Preview |

---

## 7. 大色块是否消失

| 场景 | 判定 |
|---|---|
| Sample 1 本地结果 | **PASS** — 有 ripple folds、轨道、透光，非纯色矩形 |
| Sample 2 本地结果 | **PASS** — 仍有褶皱/结构，非平面大色块 |
| Preview 真实房间 | **BLOCKED** |

---

## 8. mask 外区域稳定性

| 场景 | 观察 |
|---|---|
| 本地合成图 | 墙/地/踢脚线整体干净；**但**合成底图像素极简，模型常整景重绘为更真实房间，**不能**等价替代真实客户照的 outside-mask 稳定性验收 |
| Preview 真实房间 | **BLOCKED** — 此项必须用真实照片在隔离 Preview 重验 |

---

## 9. 产品位置和结构观察（本地）

- 布帘覆盖中央窗区，顶部有杆，垂至近地面
- 有明确褶皱与阴影，可与 Konva 色块预览区分
- Preview 多窗/家具场景定位：**未验**

---

## 10. 参考素材有限时的表现

Sample 2（仅 swatch）：**PASS（本地）** — 仍为窗饰形态，非色块回退。
Preview 警告文案与 UI：**未验**。

---

## 11. 失败路径结果

| 检查 | 状态 |
|---|---|
| 单元：失败不伪造成功 / 保留旧 export | **PASS**（`hd-render-core.test.ts`） |
| 路由：模型失败返回明确错误且不覆盖 | **CODE REVIEW PASS**（`render-hd/route.ts`） |
| Preview UI 注入失败 | **BLOCKED**（未在 Preview 故意破坏配置） |

---

## 12. 移动端 390×844 结果

| 检查 | 状态 |
|---|---|
| 登录态编辑 / rendering / AI 结果 / 返回编辑 | **BLOCKED**（安全 Preview 写库未就绪） |
| 截图 | 未提交；待隔离 Preview 后放入 `docs/evidence/visualizer-real-room-hd-mask/` |

---

## 13. 截图或证据路径

| 路径 | 说明 | 是否提交 |
|---|---|---|
| `tmp/visualizer-hd-e2e/scene1_drapery_texture/result.png` | 本地 Sample 1 | 否（gitignore） |
| `tmp/visualizer-hd-e2e/scene2_drapery_swatch_only/result.png` | 本地 Sample 2 | 否 |
| `docs/evidence/visualizer-real-room-hd-mask/` | Preview/移动端截图占位 | 待补 |

---

## 14. build 和测试结果

| 检查 | 结果 |
|---|---|
| `npx prisma generate` | **PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npx next build` | **PASS** |
| HD source tests | 9 PASS |
| mask padding tests | 16 PASS |
| window mask tests | 17 PASS |
| hd-render-core / view-mode | 23 PASS |
| catalog assets/readiness/template/gate | 8+19+15+19 PASS |
| Schema change | **NONE** |
| Migration | **NONE** |

---

## 15. 是否产生代码修复

**无。** 本轮未推送新功能修复 commit。

---

## 16. 新 commit SHA

`N/A`（无新修复）
当前 PR HEAD：`a2a4518`

---

## 17. 已知限制

1. Preview 默认 DB 与 Production 同 host → 真实 UI 验收被安全门禁阻断
2. 本地合成底图不能充分证明 outside-mask 家具稳定性
3. 移动端 390×844 需隔离 Preview 登录态补做
4. Phase 2 自动渲染仍未做

---

## 18. Phase 2 建议

- 选产品后 debounce 自动 HD
- Render Job / latest-change-wins
- 真实房间 outside-mask 回归集（隐私安全样张库）
- Preview 默认使用独立 Neon branch（避免再误连 Production）

---

## 19. 是否建议 PR 转为 Ready

**否。当前不得转为 Ready for Review。**

### Ready 门禁核对

| 门禁 | 状态 |
|---|---|
| 样张一最终不是大色块 | 本地合成 **PASS** / Preview **BLOCKED** |
| 样张二最终不是大色块 | 本地合成 **PASS** / Preview **BLOCKED** |
| exportImageUrl 自动显示 | 代码+单测 PASS / Preview UI **BLOCKED** |
| 返回编辑模式正常 | 代码+单测 PASS / Preview UI **BLOCKED** |
| mask 外区域基本稳定 | Preview 真实房 **BLOCKED** |
| 产品位置合理 | Preview **BLOCKED** |
| 失败路径不伪造成功 | 单测+代码 PASS / Preview UI **BLOCKED** |
| 移动端 390×844 PASS | **BLOCKED** |
| next build PASS | **PASS** |
| Visualizer tests PASS | **PASS** |
| 无 Schema / migration | **PASS** |

**总评：** `FINAL_VALIDATION_STATUS = BLOCKED_ON_PREVIEW_DB_ISOLATION`
**PR 保持 Draft；不合并；不部署 Production。**

---

## 下一步（需你批准）

请确认是否允许：

1. 将隔离 Neon branch（如仍存在的 `visualizer-ai-template-e2e`）的 `DATABASE_URL` / `DIRECT_URL` **仅**覆盖到本 feature 的 Vercel Preview；
2. Redeploy Preview；
3. 用测试组织 + 隐私安全房间样张完成样张一/二、失败路径与 390×844；
4. 门禁全绿后再将 #27 转为 Ready。

在获得批准前，**停止**任何 Preview 写库操作。
