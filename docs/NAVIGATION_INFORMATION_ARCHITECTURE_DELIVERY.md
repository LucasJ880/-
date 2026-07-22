# 导航与信息架构重构 — 交付说明

分支：`feature/navigation-information-architecture-redesign`  
基线：main @ `898d9f0`（PR #11 合入后）  
Commit：`refactor(navigation): separate operations capabilities growth and management`

## 旧 → 新

| 旧 | 新 |
|---|---|
| 经营中心在「品牌增长」组 | **企业经营** 一级 |
| runs/approvals 在「智能助手」底部 | **企业能力中台** 一级（可折叠） |
| product-content 在外贸 | **品牌增长** |
| `/admin/*` 叫组织治理 | **平台运营**（与企业管理分离） |
| 桌面侧栏塞进移动抽屉 | 移动端 **一级分类 → 二级** |

## Navigation Registry

`src/lib/navigation/`：`types` / `registry` / `filter` / `active`  
统一：权限、modulesJson、membership、active、排序、折叠。

## 权限要点

- 无 membership：不显示中台 / 经营 / 业务 / 增长 / 企业管理
- 普通成员：中台可见，**无治理中心**
- Org Admin：完整中台含治理
- Platform Admin 无 membership：不得进企业导航

## 路由

- `/capabilities` 中台总览（新建）
- `/capabilities/catalog`、`/capabilities/config-health`（轻量页）
- `/capabilities/health` → redirect `config-health`
- 治理页沿用 PR #11 完整实现

## 测试

- Navigation IA：28/28
- tsc / build：合入前复跑

## 已知限制

- Workspace 切换器 UI 仍以企业为主（Workspace 列表后续）
- 配置健康 / 能力目录为导航归位页，完整能力在 Phase 3A-5
- 部分业务二级入口仍偏平（未做业务模块二级折叠）
