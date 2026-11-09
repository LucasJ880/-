# Spec Delta

## Purpose

已登录页面在浏览器里拿到"当前用户"的时机：首屏水合这一帧按服务端 HTML 的样子渲染，水合完成后与客户端路由切换时再用已经取得的当前用户，避免水合不一致导致整页在客户端重建。

## ADDED Requirements

### Requirement: 首屏水合时当前用户状态与服务端 HTML 一致
整页加载（直接打开或刷新）已登录区页面时，服务端渲染与浏览器首屏水合这一帧 SHALL 把当前用户视为"尚未取得、加载中"：没有当前用户、加载标志为真、不是平台管理员。即使浏览器在该页面区块水合之前已经取得当前用户（例如外壳先水合并取回了当前用户，而页面内容在 `<Suspense>` 里稍后才水合），这一帧 SHALL 仍按"加载中"渲染。页面 SHALL NOT 因当前用户状态在浏览器里报水合不一致错误（"Hydration failed because the server rendered HTML didn't match the client"）。

#### Scenario: 服务端渲染不读已取得的当前用户
- **WHEN** 浏览器侧缓存里已有一名 super_admin 当前用户，服务端渲染一个只读当前用户状态的组件
- **THEN** 输出为加载中、没有当前用户、不是平台管理员（`npx tsx src/lib/hooks/__tests__/use-current-user-hydration.test.tsx` 通过）

#### Scenario: super_admin 直接打开用户管理页不报水合错误
- **WHEN** super_admin 登录后，直接打开 `/admin/users`（连续 3 次）、`/admin/audit-logs`、`/settings`、`/sales`、`/admin/invite-codes`、`/organizations`、`/tasks`
- **THEN** 每个页面加载后浏览器均没有水合不一致错误，`/admin/users` 显示"用户管理"与用户表（`node scripts/current-user-hydration-smoke.mjs` 退出码 0）

#### Scenario: 非平台管理员直接打开用户管理页
- **WHEN** 平台角色为 boss 的用户登录后直接打开 `/admin/users`
- **THEN** 浏览器没有水合不一致错误，页面显示"无权限访问"（同上命令）

### Requirement: 水合后与客户端路由切换时复用已取得的当前用户
首屏水合完成后，若当前用户已经取得，页面 SHALL 立即按该用户重新渲染，不等待新的网络请求。客户端路由切换（站内跳转，不经水合）进入页面时，若当前用户已经取得，页面首帧 SHALL 直接按该用户渲染，SHALL NOT 显示当前用户的加载态，SHALL NOT 再请求 `/api/auth/me`。

#### Scenario: 水合后显示用户表
- **WHEN** super_admin 直接打开 `/admin/users`
- **THEN** 加载完成后页面显示用户表而不是停留在加载态（`node scripts/current-user-hydration-smoke.mjs` 退出码 0）

#### Scenario: 站内跳转到用户管理页
- **WHEN** super_admin 在 `/admin/invite-codes` 加载完成后，经客户端路由跳到 `/admin/users`
- **THEN** 跳转期间没有 `/api/auth/me` 请求，用户管理页没有出现当前用户加载态，用户表正常出现，浏览器没有水合不一致错误（`node scripts/current-user-hydration-smoke.mjs` 退出码 0）
