# Phase Mobile-2：移动交互统一、Overlay 治理与 Safari 稳定性 — 交付报告

**状态**：合入前安全修复 + Preview/本地验收完成；**未自动合入**  
**分支**：`feature/mobile-2-interaction-hardening`  
**Head**：见最新 push（含凭据清理历史重写）  
**基线**：Mobile-1 COMPLETE `aa81c08` / `main` @ `daddade`  
**自检**：`docs/MOBILE2_UI_AUDIT.md`  
**审计结果**：`docs/mobile2-audit-results.json`  
**PR 标题**：`feat(mobile): Phase Mobile-2 interaction and overlay hardening`

---

## 1. 审计结果

见 `docs/MOBILE2_UI_AUDIT.md`。核心发现：

- `lockAppScroll` 原为保存/恢复式 → 已升引用计数  
- Radix Dialog 未锁 AppShell `main` → 已接入  
- 大量手写 Modal 无锁 → 高流量路径已接入  
- Safari 真机仍 **PENDING**；WebKit 自动化见审计脚本  

---

## 2. 引用计数 Scroll Lock

文件：`src/lib/mobile/scroll-lock.ts`

```text
acquireAppScrollLock(reason) → token
releaseAppScrollLock(token)
lockAppScroll(reason) → unlock()   // 兼容 Mobile-1
getActiveScrollLocks()             // 调试
```

- 首个锁保存 body/html/main 原始 overflow  
- 中间锁不覆盖原始值  
- 最后一把释放才恢复  
- 重复 release / 未知 token / SSR / Strict Mode 双 cleanup 安全  

单测：`src/lib/mobile/__tests__/scroll-lock.test.ts`

---

## 3. Overlay 架构

| 能力 | 实现 |
|---|---|
| Dialog | Content 挂载时 `lockAppScroll("ui-dialog")`；`max-h` 用 `dvh`；关闭按钮 44×44 |
| Drawer | ref-count 锁；`role=dialog`；Escape；safe-area 内容区 |
| Nav | Escape；aria-modal；44×44 关闭 |
| Schedule Drawer | Escape；aria；层级 Token |
| 手写高流量 | `useAppScrollLock`：inventory / supplier / quote send / assistant threads / customer email overlay |
| Visualizer | body 直写 → `lockAppScroll` |

Hook：`src/lib/mobile/use-app-scroll-lock.ts`

---

## 4. z-index 规范

`src/lib/ui/layers.ts` + `globals.css` CSS 变量：

```text
sticky 20 | tabbar 30 | popover 40
drawer-overlay 50 | drawer-panel 60
dialog-overlay 70 | dialog-panel 80
toast 90 | critical 100
```

Toast 已从 `z-[9999]` 迁到 `--ui-z-toast`，并避让 TabBar。

---

## 5. 焦点治理

- Radix Dialog：原有焦点陷阱保留  
- Drawer / Nav：补 `role` / `aria-modal` / `aria-label` / Escape  
- 关闭按钮统一 `aria-label="关闭"`  

完整焦点恢复（关闭后回到触发器）在手写层仍依赖调用方；Radix 路径已覆盖。

---

## 6. Safari / WebKit / 真机

| 项 | 状态 |
|---|---|
| WebKit automated | 脚本 `scripts/mobile2-ui-audit.ts`（需本机 WebKit 浏览器包） |
| iPhone Safari real device | **PENDING** |
| `useVisualViewport` | quote-sheet 底栏键盘避让（窄屏） |
| Dialog max-height | `90dvh` |

禁止将 WebKit 与真机混为一谈。

---

## 7. 软键盘与固定底栏

- quote-sheet：键盘打开时底栏贴 visualViewport  
- measure：sticky 抬升至 TabBar + safe-area 之上  
- chat-panel：`pb` 含 `--mobile-action-padding` + safe-area  
- Token：`--mobile-safe-bottom`、`--mobile-action-padding`、`--mobile-tabbar-height`

---

## 8. PageHeader 迁移（本阶段）

已迁：`operations`、`dashboard`、`growth`、`review`、`calendar`、`matrix`、`assets`。

延后：projects 子页实体 h1、部分 growth 子页、blinds-orders 等（Mobile-3 候选）。

---

## 9. 性能

未做无证据的大规模优化。本阶段改动以锁 / Overlay / 布局为主，未引入全局 scroll setState。

---

## 10. 测试结果

| 项 | 结果 |
|---|---|
| scroll-lock 单测 | PASS |
| `tsc --noEmit` | PASS |
| Chromium automated | PASS（40/40 + nav lock，`activeLocksAfterClose=0`） |
| WebKit automated | PASS（40/40 + nav lock，`activeLocksAfterClose=0`） |
| Security-1 Smoke | PASS：sales 客户 200；trade 销售 403 `NO_BINDING`；FIXED `canSelfSwitchOrg=false` |
| iPhone 真机 | **PENDING** |
| Vercel Preview | SUCCESS；Deployment Protection（SSO）阻断无 bypass 的自动化直连 |

### 验收宿主说明

- Preview URL：`https://git-feature-mobile-2-interaction-hardening-lucas-9039s-projects.vercel.app`
- 自动化实际宿主：本地 `next start`（同 Head 生产构建），因 Preview SSO 需 `VERCEL_AUTOMATION_BYPASS_SECRET`
- 结果文件：`docs/mobile2-audit-results.json`（**不含密码**）
- QA 凭据：仅环境变量；仓库与 PR 分支历史已清除旧明文默认密码；账号密码已轮换

### 人工 Preview 清单（本轮）

| 项 | 状态 |
|---|---|
| 导航连续开关 / 锁与恢复（自动化等价） | PASS（Chromium+WebKit navLock） |
| 嵌套 Overlay（截图 + activeLocks=0） | PASS（emulation；真机 PENDING） |
| 报价键盘 | PASS（visualViewport 模拟截图；真机软键盘 PENDING） |
| 运营长标题 320px | PASS（截图） |
| Security-1 Smoke | PASS |
| iPhone Safari real device | **PENDING** |

---

## 11. 截图

目录：`docs/mobile2-screenshots/`（QA 数据，无真实客户敏感信息 / 密码 / Token）

```text
nested-overlay-mobile.png
drawer-dialog-mobile.png
keyboard-quote-form.png
keyboard-assistant.png
safe-area-actionbar.png
long-operations-title.png
mobile-dropdown-viewport.png
scroll-restored-after-overlays.png
```

---

## 12. 技术债 / 回滚

**债**

- 其余 trade/admin 手写 Modal 未全量迁 Dialog  
- 完整焦点返回触发器（手写层）  
- growth 子页 / projects 子页 PageHeader  
- iPhone 真机 Smoke  

**回滚**

- 还原 `scroll-lock.ts` 到 Mobile-1 保存/恢复版（会失去嵌套安全）  
- DialogScrollLock 可单独回退  

---

## 13. Mobile-3 是否需要

建议需要，但**不自动启动**。候选：

1. 全量手写 Modal → 统一 Dialog / Bottom Sheet  
2. 剩余 PageHeader  
3. iPhone 矩阵验收闭合  
4. 大型选择器移动策略  

---

## 14. Security-1 / Mobile-1 回归约束

- FIXED 无组织切换；MULTI_ORG 仅 settings/account  
- 左上角企业身份只读  
- Sunny / 梦馨不串；trade 销售 403；sales 可读授权客户  
- Mobile-1 导航锁 / dvh / 客户卡片不回退  

**禁止**：自动合入；自动启动 Mobile-3 / Security-2 / Phase 3B。
