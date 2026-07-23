# Phase Mobile-1：移动端 UI 稳定性 — 交付报告

**状态**：实现完成，等待人工 Preview / Safari 验收（**未自动合入**）  
**PR**：[\#15](https://github.com/LucasJ880/-/pull/15)（Open · MERGEABLE · 非 Draft · Vercel Preview SUCCESS）  
**分支**：`feature/mobile-1-ui-stability`（5 commits / 32 files）  
**基线**：`main`（含 Security-1 PR #14）  
**自检**：`docs/MOBILE1_UI_AUDIT.md`  
**截图**：`docs/mobile1-screenshots/`

### 合入门槛（产品核对 2026-07-23）

| 项 | 状态 |
|---|---|
| 代码方向 / 关键修复合理性 | ✅ 已核对通过 |
| Chromium 320–768、自检、滚动锁、长标题、表格、Security-1 回归 | ✅ 已勾选 |
| Vercel Preview SUCCESS | ✅ |
| 人工 Preview（导航/长标题/客户表/报价/Security-1） | ⏳ 待完成 |
| Safari / iPhone 真机（建议合入门槛） | ⏳ **Safari / iPhone verification pending** |
| 无 iPhone 时 | 可合入，但必须保留上表 pending 标记，上线后第一时间真机 Smoke |

合入方式（验收通过后）：**merge commit，不要 squash**。合入后标记 COMPLETE，拉最新 main，最小 Production Smoke；**不自动启动 Mobile-2**。

---

## 1. 自检结果摘要

- Chromium 自动化：6 宽度 × 14 代表路由（见 `docs/mobile1-audit-results.json`）
- Safari / iPhone 真机：**Safari / iPhone verification pending**（滚动锁 / `100dvh` / 地址栏 / 软键盘 / 固定底栏差异最大）
- 核心根因：AppShell 主滚动在 `main`；导航未锁 `main`；`h-screen-safe` 被 `100vh` 覆盖；宽表缺横滚策略

---

## 2. 问题清单与处理

| ID | 级别 | 处理 |
|---|---|---|
| MOBILE-P0-001 | P0 | ✅ 移动导航 `lockAppScroll()` 锁 body/html/main，关闭恢复 previous |
| MOBILE-P0-002 | P0 | ✅ `h-screen-safe` / `min-h-screen-safe` 改为 vh→dvh |
| MOBILE-P0-003 | P0 | ✅ 库存/供应商/百叶订单/邀请码/组织成员表 → `overflow-x-auto` + `min-w-*` |
| MOBILE-P1-001 | P1 | ✅ `ui/drawer` 使用 previous 恢复 + 关闭 `pointer-events-none` |
| MOBILE-P1-002 | P1 | 部分完成：Drawer / 日程抽屉 / 导航；其余手写 overlay 留 Mobile-2 |
| MOBILE-P1-003 | P1 | ✅ quote-sheet 单列表单 + 底栏避让 tabbar/safe-area |
| MOBILE-P1-004 | P1 | ✅ 定义 `--header-height` |
| MOBILE-P1-005 | P1 | ✅ 扩展 PageHeader；组织/客户/首页长标题 |
| MOBILE-P1-006 | P1 | ✅ schedule-event-drawer lock + pointer-events |
| MOBILE-P2-* | P2 | 部分完成；运营硬编码 h1 等未全量替换 |

---

## 3. 根因与滚动架构

```text
html/body.h-full
└─ AppShell.h-screen-safe.overflow-hidden
   └─ main.overflow-y-auto          ← 普通页唯一纵向滚动
      （打开 Drawer/导航时 main.style.overflow=hidden，cleanup 恢复）
   └─ 表格：仅容器 overflow-x-auto
   └─ Modal/Drawer：面板内 overflow-y-auto
```

工具：`src/lib/mobile/scroll-lock.ts`

---

## 4. PageHeader 规则

文件：`src/components/page-header.tsx`

- 标题：`break-words` + `overflow-wrap:anywhere`，允许换行
- 容器：`min-w-0`；actions 窄屏整行换行
- 可选 `breadcrumbs`（可横向微滚）
- **禁止**默认 `truncate` / `whitespace-nowrap` 用于主标题

---

## 5. 表格策略

| 策略 | 应用 |
|---|---|
| A 移动卡片 | `CustomerList`（`md:hidden` 卡片 / `md:block` 表） |
| B 横向滚动 | inventory、supplier-table、blinds-orders、invite-codes、org members、桌面客户表 |

---

## 6. 表单策略

- quote-sheet：`grid-cols-1 sm:grid-cols-2 md:grid-cols-4`
- 底栏：`bottom: tabbar + safe-area`；内容 `pb` 同步加高
- measure：sticky 底栏加 safe-area；按钮可换行

---

## 7. 测试结果

| 项 | 结果 |
|---|---|
| `lockAppScroll` 单测 | 通过 |
| 导航打开后 main/body overflow | `hidden`（3016 验证） |
| 导航关闭卸载遮罩 | 通过（`return null`） |
| `tsc --noEmit` | 通过（交付前复跑） |
| Security-1 回归（设置页 FIXED 无切换） | 截图确认 |
| Safari | **未验证** |

---

## 8. 截图路径

```text
docs/mobile1-screenshots/
  long-title-320.png
  long-title-actions-375.png
  mobile-nav-open.png
  mobile-nav-closed-scroll-restored.png
  customer-list-mobile.png
  quote-form-mobile.png
  settings-account-mobile.png
  modal-mobile-scroll.png
```

不含真实客户敏感信息（QA / 空态数据）。

---

## 9. 已知限制

1. **Safari / iPhone verification pending**（建议至少 5 分钟：开/关导航、Drawer、长页滚动、报价输入、键盘弹收）  
2. 仍有手写 `fixed inset-0` 弹层未统一接入 `lockAppScroll`  
3. 运营/增长大量硬编码 h1 未全部迁到 PageHeader  
4. 销售 segmented control 竖排文字体验（P2，可 Mobile-2）  
5. 禁止用全局 `body { overflow-x: hidden }` 掩盖溢出（本阶段未加）  

### 非阻断技术债：`lockAppScroll` 非引用计数

当前为「保存 previous → 锁定 → cleanup 恢复」实现，**不是** `scrollLockCount`。

- 常规单导航 / 单 Drawer：**无问题**（本 PR 不阻塞）  
- 理论风险：两层 Overlay 同时打开，外层先关、内层仍开时，可能提前恢复滚动  
- Mobile-2 建议改为：`lock()` / `unlock()` + 计数，**最后一个锁释放后才恢复**

---

## 10. Security-1 回归

- 左上角企业身份只读（导航内 OrgIdentityBadge）  
- `/settings/account` FIXED 无「切换工作企业」  
- 移动导航不暴露无 membership 组织  
- Sunny / 梦馨数据与草稿不串（依赖既有 orgId key；本 PR 未改授权语义）  
- 未启动 Security-2 / 数字员工 / Phase 3B  

---

## 11. 人工 Preview 必过清单

### 导航滚动
- [ ] 打开后背景不可滚；关闭立即恢复  
- [ ] 菜单跳转后新页可滚；连续开关 5 次不卡死  
- [ ] 浏览器返回无透明遮罩  

### 320px 长标题
- [ ] 标题换行；无整页横滚；操作按钮落到下一行  
- [ ] 企业/客户/项目名不撑破容器  

### 客户与宽表
- [ ] 客户列表移动卡片可点  
- [ ] 宽表仅表格区横滑；竖滑不被抢走  

### 报价表单
- [ ] 单列；输入不超屏；键盘后仍可达提交；底栏不被遮挡  

### Security-1
- [ ] 企业身份只读；FIXED 无切换；导航无其他组织；租户不串  

---

## 12. 后续 Mobile-2 建议

1. `scrollLockCount` 引用计数式锁  
2. 统一手写 Modal 的 scroll lock  
3. 运营页 PageHeader 迁移  
4. Safari 真机矩阵 + 软键盘验收（若合入时仍 pending，上线后第一时间补）  
5. 销售看板 segmented control 移动布局  
6. 更多列表策略 A（商机/审批卡片化）  

**不要自动开始 Mobile-2**；等 PR #15 人工验收合入并标记 COMPLETE 后再议。
