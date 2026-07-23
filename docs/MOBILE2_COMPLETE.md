# Phase Mobile-2：移动交互统一、Overlay 治理与 Safari 稳定性 — COMPLETE

**状态**：COMPLETE（**iPhone Safari real-device verification = PENDING**）  
**合入时间**：2026-07-23  
**Merge SHA**：`84553eca8e4137f20e36fea14b91bbb9b3648382`  
**PR**：[\#16](https://github.com/LucasJ880/-/pull/16)（merge commit，未 squash）  
**基线**：Mobile-1 COMPLETE `aa81c08` / `main` @ `daddade` 之后

## 范围回顾

1. Overlay / Scroll Lock / Safari 自检（`docs/MOBILE2_UI_AUDIT.md`）  
2. `scroll-lock.ts`：Token + 引用计数；嵌套 Overlay 安全；兼容 `lockAppScroll()`  
3. Dialog / Drawer / Nav / Schedule：统一锁 `main`、a11y、Escape、z-index Token（`layers.ts`）  
4. 高流量手写 Overlay + Visualizer 接入 `useAppScrollLock` / `lockAppScroll`  
5. Safari 软键盘与 safe-area：`useVisualViewport`（quote 底栏）；measure / chat 避让  
6. PageHeader 迁移：operations / dashboard / growth / review / calendar / matrix / assets  
7. 合入前：清除 QA 明文凭据默认值；审计脚本仅读环境变量；导航选择器改为语义 `dialog`

## 验收状态

| 项 | 结果 |
|---|---|
| Chromium automated（溢出 + navLock + activeLocks=0） | PASS |
| WebKit automated | PASS |
| Security-1 Smoke（sales 客户 200；trade 销售 403 `NO_BINDING`；FIXED 无切换） | PASS |
| Vercel Preview | SUCCESS（合入前） |
| 截图 `docs/mobile2-screenshots/` | 已补齐 |
| **iPhone Safari real-device verification** | **PENDING** |

### iPhone Safari 待验证事项（有真机时补约 5 分钟 Smoke）

1. 导航连续开关（背景不可滚，关闭后恢复；最终 `activeLocks=0`）  
2. Drawer / Dialog 嵌套（关内层外层仍开，最终恢复滚动）  
3. 长页面滚动  
4. 报价软键盘（输入框可见；操作栏不挡；关闭后 bottom class 正确）  
5. Assistant 输入栏  
6. safe-area 底栏  

相关差异点：引用计数锁、`dvh`、visualViewport、固定底栏、Safari 地址栏。

WebKit automated ≠ iPhone Safari real device。

## 合入后动作

| 项 | 结果 |
|---|---|
| 拉取最新 `main` | ✅ @ `84553ec` |
| scroll-lock 专项 | ✅ passed |
| `tsc --noEmit` | ✅ |
| `next build` | ✅ |
| Mobile-2 audit（Chromium + WebKit，本地 production build） | ✅ PASS 40/40 × 2；navLock + activeLocks=0 |
| Security-1 / Production Smoke（`https://qingyan.ca`） | ✅ sales 客户 200；trade 销售 403 `NO_BINDING`；FIXED `canSelfSwitchOrg=false` |
| **Mobile-3 / Security-2 / Phase 3B** | **未启动** |

## 文档索引

- 自检：`docs/MOBILE2_UI_AUDIT.md`  
- 交付：`docs/MOBILE2_UI_DELIVERY.md`  
- 审计结果：`docs/mobile2-audit-results.json`  
- 截图：`docs/mobile2-screenshots/`  
