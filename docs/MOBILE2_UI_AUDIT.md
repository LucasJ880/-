# Phase Mobile-2：移动交互统一、Overlay 治理与 Safari 稳定性 — 自检报告

**阶段**：Phase Mobile-2  
**分支**：`feature/mobile-2-interaction-hardening`  
**基线**：`main` @ `daddade`（Mobile-1 COMPLETE merge `aa81c08`；Security-1 COMPLETE）  
**自检日期**：2026-07-23  
**状态**：自检完成；本 Commit 不做大面积组件改造  

---

## 1. Mobile-1 遗留问题

| 遗留 | 状态 |
|---|---|
| `lockAppScroll()` 保存/恢复，非引用计数 | 未修 → **本阶段 P0** |
| 手写 Modal 多数未接入滚动治理 | 未修 → **本阶段 P0/P1** |
| Radix Dialog 只锁 body，AppShell 滚 `main` | 未修 → **本阶段 P0** |
| 运营 / 项目子页手写 `<h1>` | 部分未迁 → **本阶段 P1** |
| Safari / iPhone 真机 | **PENDING**（交付须分别标记 WebKit vs 真机） |
| 固定底栏与 TabBar / safe-area 叠压 | measure / visualizer / toast → **P1** |
| 触摸目标 / z-index 随意值 | toast `z-[9999]` 等 → **P1** |

Mobile-1 已解决：导航锁、`100dvh`、PageHeader 基础、客户卡片、宽表横滚、quote-sheet 基础。

---

## 2. Overlay 组件清单

### 2.1 统一原语

| 组件 | 路径 | 引擎 | Scroll Lock | Escape | 遮罩关闭 | 关闭 pointer-events | z-index | a11y |
|---|---|---|---|---|---|---|---|---|
| Dialog | `src/components/ui/dialog.tsx` | Radix | body only（Radix）**未锁 main** | ✅ | ✅ | Portal 卸载 | overlay/content `z-50` | Radix aria-modal / focus |
| Drawer | `src/components/ui/drawer.tsx` | 自定义 | `lockAppScroll` | ✅ | ✅ | ✅ `pointer-events-none` | 40 / 50 | **无** role/aria-modal |
| Select | `src/components/ui/select.tsx` | Radix Portal | 无（非全屏） | ✅ | ✅ | 卸载 | `z-50` | listbox |
| MultiSelectCombobox | `src/components/ui/multi-select-combobox.tsx` | 自定义 | 无 | ✅ | outside | 条件渲染 | 相对 | 无 modal |

**无**独立 Sheet / Modal / Popover / DropdownMenu 原语。

### 2.2 已接入 `lockAppScroll`（仅 3 处生产）

1. `src/components/mobile-nav-drawer.tsx` — 无 Escape；关闭 `return null`  
2. `src/components/ui/drawer.tsx`  
3. `src/components/dashboard/schedule-event-drawer.tsx` — 无 Escape  

### 2.3 Radix Dialog 消费者（约 25 文件）

经 `@/components/ui/dialog`：销售新建客户/商机、日历、CSV、供应商、任务、项目、知识库、Agent 等。  
共性：a11y 较好；**背景 `main` 仍可能滚动**。

### 2.4 手写 `fixed inset-0`（高流量优先）

| 簇 | 代表文件 | Lock | Escape | role=dialog |
|---|---|---|---|---|
| 库存 | `inventory/page.tsx`（3 套） | ❌ | ❌ | ❌ |
| 供应商 | `supplier-form-dialog.tsx` | ❌ | ❌ | ❌ |
| 报价 | `quote-sheet/page.tsx` send modal `z-[60]` | ❌ | 部分 | ❌ |
| 客户详情 | `sales/customers/[id]/page.tsx` | ❌ | ❌ | ❌ |
| 助手 | `assistant/thread-list.tsx` | ❌ | 遮罩 | ❌ |
| Trade | 多页 + `convert-trade-quote-to-sales-dialog.tsx` | ❌ | 部分 | 2 处有 role |
| Visualizer | share/catalog/reuse + presentation/comparison | body 自锁 3 处 | 部分 Escape | 部分 |
| Admin | users / audit-logs 侧滑 | ❌ | ❌ | ❌ |
| Memory / WeChat / feedback | 多处 | ❌ | 部分 | ❌ |
| MI | `monitoring-workspace.tsx` 直接用 Radix Overlay | body | ✅ | Radix |

---

## 3. Scroll Lock 使用点

| 路径 | 模式 |
|---|---|
| `src/lib/mobile/scroll-lock.ts` | 保存 previous → hidden → unlock 恢复（**非 ref-count**） |
| drawer / mobile-nav / schedule-event-drawer | `lockAppScroll()` |
| visualizer session/presentation/comparison | **直接** `document.body.style.overflow`（不锁 main） |

风险：双 Overlay 外层先关 → 可能提前恢复；Dialog 与手写层未参与统一锁。

---

## 4. 手写 Modal 清单（本阶段优先接入）

**P0 接入统一锁 / 迁 Dialog：**

- `inventory/page.tsx`  
- `components/supplier/supplier-form-dialog.tsx`  
- `sales/quote-sheet/page.tsx`（发送弹层）  
- `assistant/thread-list.tsx`  
- `sales/customers/[id]/page.tsx`  

**P1：** trade 手写层、admin 侧滑、memory、visualizer body lock 迁入 `lockAppScroll`、agent-feedback。

**延后（Mobile-3）：** 全量视觉统一 Bottom Sheet、非关键 dismiss 层。

---

## 5. 嵌套 Overlay 风险

| 场景 | 风险 |
|---|---|
| Nav + Dialog | Nav 用 lockAppScroll；Dialog 不参与 → 关 Dialog 无影响；关 Nav 可能与 Dialog 并存时提前解锁（若 Dialog 后改用同一锁则需 ref-count） |
| Drawer + Date/Select | Select Portal z-50 与 Drawer panel z-50 冲突 |
| Dialog + 手写层 | z-50 vs z-[60]/z-[9999] 无规范 |
| Toast | `z-[9999]` 可盖一切；无 safe-area |

---

## 6. z-index 问题

当前随意值：`z-10`（dismiss）、`z-30`、`z-40`（TabBar/Drawer backdrop）、`z-50`（多数）、`z-[60]`、`z-[9999]`（Toast）。

**拟规范**（`src/lib/ui/layers.ts`，Commit 3）：

```text
content 0 | sticky 20 | tabbar 30 | popover 40
drawer-overlay 50 | drawer-panel 60
dialog-overlay 70 | dialog-panel 80
toast 90 | critical 100
```

---

## 7. 焦点与无障碍

| 组件 | 问题 |
|---|---|
| Radix Dialog | 基本合格 |
| UI Drawer / Nav / Schedule | 缺 `role="dialog"` / `aria-modal` / 焦点陷阱 / 关闭后焦点恢复 |
| 手写 Modal | 多数仅视觉遮罩；关闭按钮 aria 不完整 |
| Nav | 有 `aria-label="关闭"`，缺导航 landmark label |

---

## 8. Safari / 软键盘问题

| 项 | 状态 |
|---|---|
| WebKit automated | 本 Commit 建底座；结果待跑 |
| iPhone Safari real device | **PENDING** |
| `visualViewport` | **未使用** |
| quote-sheet 底栏 | 已避让 TabBar+safe（Mobile-1） |
| measure sticky | safe-area 有；**未**抬升避让 TabBar |
| chat-panel | 底栏 safe；非 fixed；Assistant `overflow-hidden` |
| Dialog `max-h-[min(90vh,880px)]` | 应用 `dvh` / visualViewport 更稳 |

---

## 9. 固定底栏问题

| 栏 | 问题 |
|---|---|
| MobileTabBar | 已含 safe；`--mobile-tabbar-height` |
| Quote action | 已避让 TabBar |
| Measure | 可能被 TabBar 挡 |
| Visualizer 底抽屉 | z-40 与 TabBar 同层 |
| Toast | 无 safe / TabBar 避让 |
| DialogFooter | 面板内滚动，依赖 max-h |

建议 Token：`--mobile-safe-bottom`、`--mobile-actionbar-height`。

---

## 10. 剩余 PageHeader 页面

**优先迁移（运营 / growth）：**  
`operations/page.tsx`、`dashboard`、`review`、`calendar`、`matrix`、`assets`、`brand`、`growth/*`（metrics/mmm/audit/automations/campaigns/experiments/brand）。

**其次：** projects 子页实体 h1、`blinds-orders*`、`inbox`、`service-inbox`、`reports`、`ai-activity`、`trade/cockpit`。

**可保留独立标题：** 登录、营销落地、全屏 Assistant、打印/展示屏。

---

## 11. 性能问题（初筛，无 Profiler 数据）

| 页面 | 嫌疑 | 级别 |
|---|---|---|
| 库存 / 宽表 | 大 DOM；横滚容器已加 | P2 |
| quote-sheet | 多状态；底栏 fixed + blur | P2 |
| Assistant | 消息列表；输入区 | P2 观察 |
| Schedule / calendar | Drawer + 网格 | P2 |
| AppShell backdrop-blur | 低端机 | P3 |

本阶段仅在有证据时优化；禁止无数据「性能优化」。

---

## 12. P0 / P1 / P2 清单

### P0

#### MOBILE2-P0-001
- **页面**：全局  
- **组件**：`src/lib/mobile/scroll-lock.ts`  
- **设备**：全部  
- **复现**：两层 Overlay，外层先关  
- **根因**：非引用计数，cleanup 恢复 previous  
- **修复文件**：`scroll-lock.ts` + 单测  
- **验收**：双锁时外层关闭仍锁定；最后释放才恢复；重复 release 安全  

#### MOBILE2-P0-002
- **页面**：使用 Radix Dialog 的页面  
- **组件**：`ui/dialog.tsx`  
- **复现**：打开 Dialog 后滑动背景  
- **根因**：只锁 body，主滚在 `main`  
- **修复**：Dialog open 时 `lockAppScroll`（ref-count）  
- **验收**：打开不可滚背景；关闭恢复  

#### MOBILE2-P0-003
- **页面**：库存 / 供应商表单 / quote 发送 / 助手线程列表 / 客户详情弹层  
- **根因**：手写 `fixed inset-0` 无统一锁  
- **修复**：接入统一锁或迁 Dialog/Drawer  
- **验收**：打开锁、关闭恢复、无幽灵遮罩  

#### MOBILE2-P0-004
- **设备**：Safari / iPhone  
- **根因**：Mobile-1 真机 pending；dvh/键盘/底栏差异  
- **修复**：WebKit 自动 + 真机 Smoke 文档  
- **验收**：WebKit / 真机分项记录  

### P1

| ID | 摘要 |
|---|---|
| MOBILE2-P1-001 | z-index Token；消除随意 `z-[9999]`（Toast 纳入规范） |
| MOBILE2-P1-002 | Drawer/Nav/Schedule：aria-modal、Escape（Nav）、焦点恢复 |
| MOBILE2-P1-003 | Visualizer body lock → `lockAppScroll` |
| MOBILE2-P1-004 | measure / visualizer / toast 避让 TabBar + safe-area |
| MOBILE2-P1-005 | 运营/growth PageHeader 迁移 |
| MOBILE2-P1-006 | Dialog max-height 用 dvh；评估 visualViewport Hook |
| MOBILE2-P1-007 | 主要图标按钮触摸区 ≥44px（移动端） |

### P2

| ID | 摘要 |
|---|---|
| MOBILE2-P2-001 | 全量 trade/admin 手写层迁统一 Dialog |
| MOBILE2-P2-002 | 大型选择器改 Bottom Sheet |
| MOBILE2-P2-003 | 性能长任务有数据后再动 |
| MOBILE2-P2-004 | projects 子页 PageHeader |

---

## 13. 本阶段修复范围

```text
✅ 引用计数 Scroll Lock + 调试 API + 单测
✅ Dialog / Drawer / 高流量手写层接入
✅ z-index 规范
✅ Safari WebKit 自动 + 真机状态据实
✅ safe-area / 固定底栏 Token 与关键页修复
✅ 运营等 PageHeader 迁移（优先批）
✅ 触摸目标关键修复
❌ 一级导航重做 / 品牌 / Security-2 / Group / 数字员工 / 3B
```

---

## 14. 延后项目（Mobile-3 候选）

- 全量手写 Modal 视觉统一为 Bottom Sheet  
- 全站 Popover 移动策略  
- 深度性能虚拟列表  
- 完整无障碍审计（除 Dialog/Drawer 基线外）  

---

## 15. 建议 Commit 顺序（执行）

1. 本文件 + `scripts/mobile2-ui-audit.ts`（Chromium + WebKit）  
2. 引用计数 Scroll Lock  
3. 统一 Overlay 行为 + layers  
4. Safari / 软键盘 / safe-area  
5. PageHeader + 触摸目标  
6. 交付文档 + PR（不自动合入；不启动 Mobile-3）  
