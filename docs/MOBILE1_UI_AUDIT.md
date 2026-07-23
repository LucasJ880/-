# Phase Mobile-1：移动端 UI 自检报告

**阶段**：Phase Mobile-1：移动端自检、滚动稳定性与响应式修复  
**分支**：`feature/mobile-1-ui-stability`（基于已合入 Security-1 的 `main` @ `2801304`，含 PR #14 merge `55f109a`）  
**自检日期**：2026-07-23  
**状态**：自检完成；**本 Commit 不做大面积 UI 修复**  
**自动化结果**：`docs/mobile1-audit-results.json`  
**脚本**：`scripts/mobile-ui-audit.ts`

---

## 1. 扫描范围

### 1.1 代码静态扫描（全库）

已检索风险模式：

| 模式 | 结论摘要 |
|---|---|
| `overflow-hidden` / `h-screen` / `100vh` / `100dvh` | AppShell 用 `h-screen-safe overflow-hidden`；auth 布局独立 `min-h-screen overflow-hidden` |
| `document.body.style.overflow` | 4 处：`ui/drawer.tsx`（恢复为 `""`）；visualizer 三处（恢复 previous） |
| `document.documentElement.style.overflow` | **无** |
| `scroll-lock` | **无** |
| `fixed inset-0` | 导航抽屉、Drawer、大量手写弹层 |
| `touch-none` / `overscroll-none` | 非主路径；pull-to-refresh 使用 `{ passive: true }` |
| `touchmove` 非 passive | `comparison-mode.tsx` 分割拖拽（有 cleanup） |
| `w-screen` | 审计相关 page 未作为页头使用；表格多用 `min-w-[920px]` 等 |
| `whitespace-nowrap` / `truncate` | 企业身份、表格头、Tab 等；`PageHeader` 标题本身未 truncate |

### 1.2 运行时扫描（Playwright / Chromium）

| 项 | 值 |
|---|---|
| Base | `http://127.0.0.1:3000` |
| 账号 | `security1-sales-b@test.qingyan.ai`（FIXED 单企业 QA） |
| 宽度 | 320 / 360 / 375 / 390 / 430 / 768 |
| 代表路由 | `/` `/settings` `/settings/account` `/sales` `/sales/quotes` `/sales/quote-sheet` `/sales/analytics` `/organizations` `/capabilities` `/capabilities/runs` `/capabilities/approvals` `/operations/center` `/projects` `/tasks` |
| 页次 | 84（14 路由 × 6 宽度） |
| 引擎 | Chromium mobile emulation |
| Safari / iPhone 真机 | **未验证**（本环境无 Safari；不得声称已验证） |

### 1.3 路由映射说明（审计清单 → 实际路径）

| 审计项 | 实际路径 |
|---|---|
| 销售客户列表 | `/sales?view=customers`（无独立 `/sales/customers`） |
| 商机列表 | `/sales` pipeline |
| 预约 | `/sales/calendar` |
| 测量单 | `/sales/measure` |
| 销售邮件 | `/settings/email`（近似） |
| 审批 / 运行 | `/capabilities/approvals`、`/capabilities/runs` |

---

## 2. 测试设备宽度

| 宽度 | 用途 | Chromium | Safari |
|---|---|---|---|
| 320 | 极窄 Android | ✅ | ❌ 未验证 |
| 360 | 常见 Android | ✅ | ❌ |
| 375 | iPhone SE / 旧机 | ✅ | ❌ |
| 390 | iPhone 14/15 | ✅ | ❌ |
| 430 | iPhone Pro Max | ✅ | ❌ |
| 768 | 平板 / 断点边界 | ✅ | ❌ |

---

## 3. 滚动架构（当前事实）

```text
html.h-full / body.h-full
└─ AppShell: .flex.h-screen-safe.overflow-hidden     ← 壳锁死，body 通常不滚
   ├─ Sidebar (md+)
   ├─ MobileNavDrawer (open 时挂载 fixed inset-0)
   ├─ column: overflow-hidden
   │  ├─ Header
   │  └─ main.flex-1.pb-tabbar
   │       ├─ 普通页: overflow-y-auto                 ← 唯一主纵向滚动
   │       └─ /assistant: overflow-hidden             ← 页面自管
   └─ MobileTabBar (fixed bottom, z-40)
```

**目标架构（本阶段修复应对齐）**：

```text
body / root：不作为业务纵向滚动
→ 普通页面：仅 main 纵向滚动
→ 表格：仅表格容器横向滚动
→ Modal / Drawer：内容区独立纵向滚动；打开时锁住 main（不只是 body）
→ 聊天：允许独立消息区滚动
```

**关键实现文件**：

- `src/components/app-shell.tsx`
- `src/app/globals.css`（`h-screen-safe` / `pb-tabbar`）
- `src/components/mobile-nav-drawer.tsx`
- `src/components/ui/drawer.tsx`
- `src/components/ui/dialog.tsx`（Radix，自带 RemoveScroll）

---

## 4. 长标题问题

### 4.1 已有组件

| 组件 | 路径 | 评估 |
|---|---|---|
| `PageHeader` | `src/components/page-header.tsx` | 已有 `min-w-0` + 纵向堆叠 actions；**缺** `break-words` / `overflow-wrap`；无 breadcrumbs API |
| `PageTitle` / `SectionHeader` | 不存在 | — |
| `OrgIdentityBadge` | `src/components/org-identity-badge.tsx` | 企业名 `truncate`（可接受，但超长中文仅单行省略） |

### 4.2 风险页面

| 页面 | 问题 | 级别 |
|---|---|---|
| `/capabilities/*` | description 很长，挤占首屏 | P2 |
| `/organizations` | description 很长 | P2 |
| `/sales/measure` | 标题「现场量房 & 即时报价」偏长 | P2 |
| `/sales/quote-sheet` | 「Quote Sheet」/「编辑报价单 · vN」 | P2 |
| `/operations/*` 大量子页 | 硬编码 `<h1>`，未统一 PageHeader | P2 |
| `/organizations/[orgId]` | `org.name` 硬编码 h1，超长企业名可能挤布局 | P1 |
| 客户/项目详情 | 业务名称未统一断行策略 | P1（随数据） |

### 4.3 运行时观察（375px）

代表页 h1 均为短标题时布局正常；**未注入超长 QA 标题字符串**。长标题问题需在修复阶段用 fixture / 截图验收（320px）。

---

## 5. 横向溢出问题

### 5.1 自动化（代表路由）

- 页面级 `main.scrollWidth > clientWidth`：**0/84** 命中（代表路由在当前 QA 数据下）
- **元素级**候选仍存在：`/sales/quote-sheet` 在 320–390 下内容区 `scrollWidth > clientWidth`（约 +16px），输入控件亦有轻微内容溢出

### 5.2 静态高风险表格（未全部纳入自动化路由）

| 页面 | 文件 | 问题 |
|---|---|---|
| 库存 | `src/app/(main)/inventory/page.tsx` | 9 列表 + `overflow-hidden`，易裁切而非横滚 |
| 供应商 | `src/app/(main)/suppliers/supplier-table.tsx` | 多列 + `overflow-hidden` |
| 百叶订单列表 | `src/app/(main)/blinds-orders/page.tsx` | 无 `overflow-x-auto` |
| 邀请码 | `src/app/(main)/admin/invite-codes/page.tsx` | 无 `overflow-x-auto` |
| 经营矩阵 | `src/app/(main)/operations/matrix/page.tsx` | 多列无横滚包装 |
| 组织成员表 | `src/app/(main)/organizations/[orgId]/page.tsx` | 无 wrapper |
| 项目成员表 | `src/app/(main)/projects/[id]/page.tsx` | 无 wrapper |

已有较好包装的示例：`sales/quotes`、`capabilities/runs|approvals|catalog`、部分 trade 列表（`overflow-x-auto` + `min-w-*`）。

**几乎无**「桌面 table / 移动 card」双布局。

---

## 6. Drawer / Modal 问题

| ID 线索 | 组件 | 发现 |
|---|---|---|
| 移动导航 | `mobile-nav-drawer.tsx` | 关闭时 `return null`（无幽灵遮罩）✅；**打开时无任何 scroll lock** ❌；`main` 仍为 `overflow-y: auto`（自动化证实） |
| UI Drawer | `ui/drawer.tsx` | backdrop 关闭带 `pointer-events-none` ✅；panel 关闭仅 `translate-x-full`，缺 `pointer-events-none`；body lock 恢复为 `""` 而非 previous |
| 日程抽屉 | `schedule-event-drawer.tsx` | 无 body/main lock；关闭态 panel 常驻 |
| Visualizer | session/presentation/comparison | body lock 恢复 previous ✅；关闭态底部面板可能仍挂 DOM |
| 手写 `fixed inset-0` | trade/sales/admin/memory 等 | 多数不锁 main 滚动 → 遮罩下背景可滑 |
| Header 搜索 | `header.tsx` | 使用未定义 CSS 变量 `--header-height`（仅有 `--mobile-header-height`） |

### 6.1 导航抽屉自动化结果（320–430）

| 指标 | 打开时 | 关闭后 |
|---|---|---|
| `body.style.overflow` | `(empty)` | `(empty)` |
| `main overflow-y` | `auto` | `auto` |
| 关闭后中心点可点 | — | `true`（无残留遮罩） |

**结论**：关闭生命周期（卸载）正确；**打开时背景滚动未锁**是明确缺陷。因主滚动在 `main`，仅改 `body.overflow` **不够**，必须同时锁定 `main`（或等价 touch 隔离）。

---

## 7. 表格问题

策略建议（修复阶段执行，本 Commit 不改）：

| 列表类型 | 建议策略 |
|---|---|
| 客户 / 商机 / 项目 / 成员 / 审批 | **A：移动卡片** |
| 报价明细 / 交叉表 / 宽报表 / 库存 SKU | **B：仅表格区 `overflow-x-auto overscroll-x-contain`** |

禁止给 `body` 加 `overflow-x: hidden` 掩盖。主布局仅在组件修正后可作最终保护：`overflow-x-clip`。

---

## 8. 表单问题

| 区域 | 发现 | 级别 |
|---|---|---|
| `/sales/quote-sheet` | 固定底栏 + `pb-44`；320 下表单网格/`grid-cols-2` 易挤；元素级宽度溢出 | P1 |
| `/sales/measure` | sticky 底栏；需查 safe-area | P2 |
| 通用 Input | 多数 `w-full`；Label 横排不统一 | P2 |
| 软键盘 | **未在真机/Safari 验证** | 待验收 |

---

## 9. 性能问题（初筛）

| 项 | 状态 |
|---|---|
| `use-pull-to-refresh` touch | `{ passive: true }` ✅ |
| `comparison-mode` touchmove | 非 passive（拖拽需要）；有 cleanup |
| 滚动时 setState | 未发现全局 scroll listener 刷屏；个别面板 resize 监听需在修复期复核 |
| 复杂 blur / 固定底栏 | AppShell `backdrop-blur` + TabBar blur：可能加重低端机，属 P3 |
| 大表一次渲染 | inventory / analytics 等风险，属 P2 性能 |

本阶段不引入新动画系统；仅清理明确卡顿源。

---

## 10. P0 / P1 / P2 问题清单

### P0

#### MOBILE-P0-001

- **页面**：全局（移动导航）
- **宽度**：≤768
- **问题**：打开移动导航后，背景 `main` 仍可纵向滚动
- **复现**：375px → 底栏「更多」→ 手指在遮罩后区域滑动（或程序化检查 `main` overflow）
- **根因**：`MobileNavDrawer` 无 scroll lock；AppShell 滚动容器是 `main` 不是 `body`
- **拟修改**：`src/components/mobile-nav-drawer.tsx`（及可选 AppShell 协作）
- **验收**：打开时 `main` 不可滚；关闭/路由跳转/卸载后恢复 previous

#### MOBILE-P0-002

- **页面**：全局壳
- **宽度**：iPhone Safari（待真机）/ 任意移动
- **问题**：`h-screen-safe` 实际落到 `100vh`，dvh 被覆盖 → 地址栏伸缩时壳高错误、底栏遮挡风险
- **复现**：读 `globals.css` `@utility h-screen-safe`；Safari 地址栏展开/收起
- **根因**：

```css
height: 100dvh;
height: 100vh; /* 覆盖 */
```

- **拟修改**：`src/app/globals.css`
- **验收**：工具类最终生效 `100dvh`（带合理 fallback 顺序）；底栏不被错误裁切

#### MOBILE-P0-003

- **页面**：库存 / 供应商表 / 百叶订单等宽表
- **宽度**：320–430
- **问题**：多列表格无横向滚动或被 `overflow-hidden` 裁切，关键列不可达
- **复现**：打开 `/inventory`、供应商列表等
- **根因**：缺策略 A/B；`overflow-hidden` 掩盖溢出
- **拟修改**：各列表页 + 统一表格包装约定
- **验收**：页面无横向滚动；表格区可横滑或改为卡片

### P1

#### MOBILE-P1-001

- **页面**：使用 `Drawer` 的任务/项目快览等
- **问题**：body lock 恢复为 `""`；关闭态 panel 无 `pointer-events-none`
- **根因**：`src/components/ui/drawer.tsx`
- **验收**：恢复 previous；关闭不可点穿

#### MOBILE-P1-002

- **页面**：大量手写 Modal
- **问题**：遮罩下 `main` 仍可滚动
- **根因**：未锁主滚动容器
- **验收**：打开锁、关闭恢复、路由切换 cleanup

#### MOBILE-P1-003

- **页面**：`/sales/quote-sheet`
- **宽度**：320–390
- **问题**：元素级横向溢出；底栏 + 双列表单在极窄屏难用
- **拟修改**：quote-sheet 布局 / 表单单列 / 表格策略 B
- **验收**：320 无页面横溢；提交按钮可见且含 safe-area

#### MOBILE-P1-004

- **页面**：Header 移动搜索面板
- **问题**：`--header-height` 未定义
- **拟修改**：`src/components/header.tsx` 或 `globals.css`
- **验收**：面板 top/max-height 计算正确

#### MOBILE-P1-005

- **页面**：组织详情 / 客户详情等动态标题
- **问题**：超长名称可能挤掉操作按钮（硬编码 h1 未统一）
- **拟修改**：扩展 `PageHeader` + 替换关键页
- **验收**：320 标题可换行；actions 仍可见

#### MOBILE-P1-006

- **页面**：`schedule-event-drawer` / visualizer 底部面板
- **问题**：关闭态仍挂载或无 pointer-events 隔离；部分无 lock
- **验收**：关闭不拦截；打开锁滚动

### P2

| ID | 摘要 |
|---|---|
| MOBILE-P2-001 | Capabilities/组织等超长 description 占首屏 |
| MOBILE-P2-002 | 运营子页硬编码 h1，未统一 PageHeader |
| MOBILE-P2-003 | OrgIdentityBadge 仅 truncate，抽屉内超长企业名体验一般 |
| MOBILE-P2-004 | AppShell 不在 `pathname` 变化时强制 `mobileOpen=false`（非 Link 导航边缘） |
| MOBILE-P2-005 | `trade/chat` 使用 `100vh` 高度与壳滚动叠加 |
| MOBILE-P2-006 | 低端机 blur 性能 |

### P3

| ID | 摘要 |
|---|---|
| MOBILE-P3-001 | 视觉间距/字号微调 |
| MOBILE-P3-002 | 表格斑马纹等细节 |

---

## 11. 根因汇总

1. **滚动容器错位认知**：业务滚动在 `main`，多数 lock 只改 `body` → 无效或半有效。  
2. **移动导航未实现 lock**：打开抽屉不禁用 `main` 滚动。  
3. **`h-screen-safe` 声明顺序错误**：`100vh` 覆盖 `100dvh`。  
4. **表格策略缺失**：宽表既不卡片也不横滚，或用 `overflow-hidden` 裁切。  
5. **PageHeader 未完全统一**：多页硬编码 h1；缺 break-words / breadcrumbs。  
6. **Overlay 生命周期不统一**：Radix Dialog 较好；自研 Drawer/手写层参差。  

---

## 12. 修复方案（按约定 Commit 顺序）

> 本 Commit（Commit 1）仅交付自检与工具。下列为后续计划。

### Commit 2：`fix(mobile): restore scrolling and overlay lifecycle`

- 修正 `h-screen-safe` / `min-h-screen-safe`
- `MobileNavDrawer`：锁 `main`（+ 可选 body）并恢复 previous；路由/卸载 cleanup
- 统一 `ui/drawer` previous 恢复 + 关闭 `pointer-events-none`
- 盘点高频手写 overlay，补 lock / pointer-events
- 修复 `--header-height`

### Commit 3：`fix(mobile): make page headers resilient to long content`

- 扩展 `PageHeader`（`break-words`、actions 换行、可选 breadcrumbs）
- 关键关键硬编码 h1 / 组织名 / 客户名页
- OrgIdentityBadge 移动端断行策略微调（不改 Security-1 只读语义）

### Commit 4：`fix(mobile): improve tables forms and action layouts`

- 列表策略 A/B
- quote-sheet / measure 表单与底栏 safe-area
- 禁止 body 级 overflow-x 掩盖

### Commit 5：`docs(mobile): complete Mobile-1 stability delivery`

- `MOBILE1_UI_DELIVERY.md` + 截图 + 回归

---

## 13. 不在本阶段范围

- 一级导航 IA 重构  
- 桌面端全面改版 / 新品牌视觉 / 新动画系统  
- Group / 数字员工 / Security-2 / Phase 3B  
- 业务流程重构  
- 自动合入；不自动开始 Mobile-2  

---

## 14. Security-1 回归约束（修复期必须保持）

- 左上角企业身份只读（无下拉切换）  
- `/settings/account` 组织切换逻辑不变  
- FIXED 无切换入口；MULTI_ORG 仅设置页  
- 移动导航不暴露无 membership 的组织  

---

## 15. 自动化工具说明

```bash
# 需本地已登录可访问的 Next 服务
npx tsx scripts/mobile-ui-audit.ts http://127.0.0.1:3000
```

环境变量：`MOBILE_AUDIT_EMAIL` / `MOBILE_AUDIT_PASSWORD`  
输出：`docs/mobile1-audit-results.json`

检查项：

- 页面可加载  
- 内容超出时是否 scroll-locked  
- 页面级横向溢出  
- 元素级溢出候选  
- 导航开关后 body/main overflow 与点击穿透  

---

## 16. 自检结论

| 结论 | 说明 |
|---|---|
| 可以进入修复阶段 | 自检报告与工具已就绪 |
| 最高优先级 | P0-001 导航锁 main；P0-002 h-screen-safe；P0-003 宽表 |
| 运行时代表页 | 当前 QA 数据下多数页「内容适配视口」；quote-sheet 已暴露元素溢出 |
| Safari | **明确未验证**，交付前需真机或 Safari 补验 |

**下一步**：按 §12 Commit 2 开始修复滚动与 Overlay（仍禁止全局 overflow 补丁掩盖问题）。
