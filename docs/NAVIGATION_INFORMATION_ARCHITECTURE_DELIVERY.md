# 导航与信息架构重构 — 交付说明

分支：`feature/navigation-information-architecture-redesign`  
PR：https://github.com/LucasJ880/-/pull/12  
基线：main @ `898d9f0`（PR #11 合入后）

## 旧 → 新

| 旧 | 新 |
|---|---|
| 经营中心在「品牌增长」组 | **企业经营** 一级 |
| runs/approvals 在「智能助手」底部 | **企业能力中台** 一级（可折叠） |
| product-content 在外贸 | **品牌增长** |
| `/admin/*` 叫组织治理 | **平台运营**（与企业管理分离） |
| 桌面侧栏塞进移动抽屉 | 移动端 **一级分类 → 二级** |

## 一级顺序（桌面）

```text
工作台 → 经营中心 → 企业能力中台 → 业务运营 → 品牌增长 → 企业管理
```

分组弱标题：日常工作 / 企业经营 / AI 能力 / 业务运营 / 品牌增长 / 企业管理

## Navigation Registry

`src/lib/navigation/`：`types` / `registry` / `filter` / `active`  
统一：权限、modulesJson、membership、active、排序、折叠。

## 权限要点

- 无 membership：不显示中台 / 经营 / 业务 / 增长 / 企业管理
- 普通成员：中台可见，**无治理中心**
- Org Admin：完整中台含治理
- Platform Admin 无 membership：不得进企业导航
- **modules 未就绪时 fail-closed**：不展示受 `moduleKey` 约束的入口，避免 Sunny/梦馨串菜单

## 交互要点

- `/capabilities/*`：中台自动展开；子级强高亮、父级轻度高亮
- 离开 `/capabilities/*`：中台可折叠回默认
- 长侧栏：`nav` 可滚动；active 项 `scrollIntoView`
- 移动端 L1：工作台 / 经营 / 能力中台 / 业务 / 增长 / 管理
- 首页 eyebrow 随当前企业名更新（不再写死 SUNNY SHUTTER）

## 路由

- `/capabilities` 中台总览
- `/capabilities/catalog`、`/capabilities/config-health`
- `/capabilities/health` → redirect `config-health`
- 治理页沿用 PR #11 完整实现

## 测试与点验

| 项 | 结果 |
|---|---|
| Navigation IA | **33/33**（含折叠/modules fail-closed） |
| `npx tsc --noEmit` | 通过 |
| 视觉 smoke | `node scripts/nav-visual-smoke.mjs` |
| 权限 smoke | `node scripts/nav-permission-smoke.mjs` |

### 截图留档

目录：`docs/nav-ia-screenshots/`（不含密钥/客户敏感凭证）

1. `01-desktop-1440-home-sidebar.png` — 1440 桌面侧栏  
2. `02-desktop-1280-home-sidebar.png` — 1280 桌面侧栏  
3. `03-capabilities-overview.png` — 中台总览  
4. `04-capabilities-governance.png` — 治理中心  
5. `06-growth-no-capabilities-under-growth.png` — 品牌增长（中台不在增长组）  
6. `08-sunny-nav.png` — Sunny 导航  
7. `09-mengxin-nav.png` — 梦馨导航  
8. `10-mobile-390-l1.png` — 390 移动端一级  
9. `11-mobile-390-capabilities-l2.png` — 移动端中台二级  

辅助脚本：

- `scripts/nav-qa-prepare-user.ts` — 验收账号（双租户 org_admin）
- `scripts/nav-visual-smoke.mjs` — Playwright 截图
- `scripts/nav-permission-smoke.mjs` — 权限与 query active 冒烟

## 已知限制

- Workspace 切换器 UI 仍以企业为主（Workspace 列表后续）
- 配置健康 / 能力目录为导航归位页，完整能力在 Phase 3A-5
- 部分业务二级入口仍偏平（未做业务模块二级折叠）
- 业务列表较长时需滚动才能看到品牌增长/企业管理（已支持滚动 + active 滚入视口）

## Phase 3A-5（合入后新开分支）

`feature/phase3a-5-capabilities-v1-finish`  
只做中台内容收口，**不再重做一级导航**。
