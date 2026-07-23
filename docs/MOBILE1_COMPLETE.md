# Phase Mobile-1：移动端滚动稳定性与响应式修复 — COMPLETE

**状态**：COMPLETE（**Safari / iPhone verification pending**）  
**合入时间**：2026-07-23  
**Merge SHA**：`aa81c08abddfb4277272eb50afde7753b881bf91`  
**PR**：[\#15](https://github.com/LucasJ880/-/pull/15)（merge commit，未 squash）  
**基线**：含 Security-1 的 `main`（PR #14）

## 范围回顾

1. 移动端系统性自检（`docs/MOBILE1_UI_AUDIT.md`）  
2. `lockAppScroll()`：同时锁 body / html / AppShell `main`，保存并恢复 previous  
3. 移动导航与 Drawer：打开锁滚动；关闭 / 卸载 / 路由变化释放；关闭态 `pointer-events-none`  
4. `h-screen-safe`：`100vh` fallback → `100dvh` 覆盖  
5. `PageHeader` 长标题换行与操作按钮换行  
6. 客户列表移动卡片；宽表仅表格区横滚；quote-sheet 单列与底栏 safe-area  

## 验收状态

| 项 | 结果 |
|---|---|
| Chromium 320–768 自检 / 滚动锁 / 长标题 / 表格 / Security-1 回归 | 通过（合入前已勾选） |
| Vercel Preview | SUCCESS |
| 人工 Preview（产品核对代码方向 + 合入决策） | 按清单收口后合入 |
| **Safari / iPhone 真机** | **pending** — 上线后第一时间补 Smoke |

### Safari / iPhone 待验证事项（上线后补）

至少 5 分钟：

1. 打开 / 关闭导航（背景不可滚，关闭后恢复）  
2. 打开 Drawer  
3. 滚动长页面  
4. 报价表单输入  
5. 弹出并收起软键盘（提交按钮仍可达；底栏不被遮挡）  

相关差异点：滚动锁、`100dvh`、移动 Safari 地址栏、软键盘、固定底栏。

## 非阻断技术债（Mobile-2）

`lockAppScroll()` 为保存/恢复式，非 `scrollLockCount` 引用计数。双 Overlay 嵌套外层先关时理论上可能提前解锁；常规单导航 / 单 Drawer 无问题。Mobile-2 统一 Modal 时再改。

## 合入后动作

| 项 | 结果 |
|---|---|
| 拉取最新 `main` | ✅ @ `aa81c08` |
| scroll-lock / org-access 专项 | ✅ |
| `tsc --noEmit` | ✅ |
| Production Smoke（`https://qingyan.ca`） | ✅ sales FIXED + 客户可读；trade 销售 API 403 `NO_BINDING` |
| **Mobile-2** | **未启动** |

## 文档索引

- 自检：`docs/MOBILE1_UI_AUDIT.md`  
- 交付：`docs/MOBILE1_UI_DELIVERY.md`  
- 截图：`docs/mobile1-screenshots/`  
