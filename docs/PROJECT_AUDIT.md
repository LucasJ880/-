# 青砚项目审计报告（基于代码通读）

> 用途：接手「二手项目」时对齐认知；供 PM / ARCH / DESIGN / DEV / QA 共用事实基线。  
> 说明：README 仍偏早期 MVP 描述，**实际代码面远大于 README 列举**。

---

## 1. 产品一句话

**青砚**：面向中文场景的 **AI 工作助理 + 后台工作台**，整合 **任务/项目/日历/提醒/收件箱**，并包含 **百叶窗工艺单（Blinds）**、**组织与成员**、**按项目分环境的 Prompt 与知识库** 等偏 B 端/行业化的模块；支持 **邮箱密码注册登录（JWT Cookie）**、**OpenAI 兼容 API 的对话与任务建议**、**Google 日历 OAuth 同步**。

---

## 2. 技术栈（与仓库一致）

| 项 | 现状 |
|----|------|
| 框架 | Next.js 16 App Router，React 19 |
| 语言 | TypeScript |
| 样式 | Tailwind CSS 4，`src/app/globals.css` |
| 数据 | PostgreSQL + Prisma 6（`prisma/schema.prisma` 模型很多） |
| 认证 | 自研 JWT Session Cookie，`middleware.ts` 保护主站与多数 API |
| AI | `openai` SDK，`src/lib/ai.ts`、`src/app/api/ai/chat` SSE |
| 外部 | Google Calendar OAuth（`src/lib/google-calendar.ts`） |

---

## 3. 信息架构（用户可见导航）

侧栏 `src/components/sidebar.tsx` 当前入口：

| 路径 | 含义 |
|------|------|
| `/` | 工作台（仪表盘：统计、任务片段、日历等，体量较大） |
| `/inbox` | 收件箱 |
| `/tasks`、`/tasks/[id]` | 任务列表与详情 |
| `/organizations`、`/organizations/[orgId]` | 组织 |
| `/projects`、`/projects/[id]` | 项目及子能力（成员、环境、Prompt、知识库等） |
| `/assistant` | AI 助手 |
| `/blinds-orders` 及子路由 | 工艺单（百叶窗订单） |
| `/settings` | 设置（含 Google 日历连接说明与状态） |

登录/注册：`(auth)/login`、`(auth)/register`。  
根布局 `lang="zh-CN"`，产品为**全中文语境**。

---

## 4. API 面（粗略分类）

以下为 `src/app/api` 下**实际存在**的路由族（README 未全部列出）：

- **认证**：`register` `login` `logout` `me`；**Google**：`auth/google` `callback` `status`
- **任务**：`tasks`、`tasks/[id]`、评论与活动
- **项目**：`projects`、成员、**environments**、**prompts**（含版本与发布）、**knowledge-bases**（含文档、版本、发布）
- **组织**：`organizations`、成员
- **日历**：`calendar`、`calendar/[id]`、`calendar/google`
- **提醒**：`reminders`、`reminders/read`
- **统计**：`stats`
- **搜索**：`search`
- **工艺单**：`blinds-orders`、计算、导出等
- **AI**：`ai/chat`

**含义**：后端已按「多租户/多环境/可发布配置与知识库」方向扩展；**前端暴露程度**与 **README 产品故事** 不完全一致——适合由 PM 决策「哪些算一期产品面」。

---

## 5. 数据模型（与 README 的差距）

README 仅强调 User / Project / Task / Tag。  
`schema.prisma` 另有（包括但不限于）：`Organization`、`ProjectMember`、`Environment`、`Prompt`/`PromptVersion`、**知识库全套**、`CalendarEvent`、`Reminder`、`BlindsOrder` 及明细、`AuditLog` 等。

**风险**：文档读者会**低估复杂度**；新同学易在「改一处任务」时碰到未了解的域。

---

## 6. 已观察到的「接手友好度」问题（供 ARCH / PM 消化）

1. **文档与代码不同步**：README 项目结构仍偏早期，未反映大量路由与域。  
2. **域过大**：单仓内混合「个人效率工具」与「行业订单/多环境配置」；需产品决策是否分模块发布或隐藏入口。  
3. **中间件策略**：未登录访问受保护 API 返回 JSON 401；前端需统一错误与跳转体验（DESIGN + DEV）。  
4. **环境变量多**：数据库双 URL、JWT、OpenAI、Google OAuth 等——QA 与部署文档需保持同步（已有 `DEPLOY_VERCEL.md`、`.env.example`）。  
5. **UI 一致性**：工作台等页面体量大，适合按设计系统**分波**重构而非一次重写。

---

## 7. 建议的「第二期优化」切入点（不执行，仅建议）

| 方向 | 建议 |
|------|------|
| PM | 明确「个人版 MVP」vs「厂家/组织版」边界；侧栏是否隐藏未就绪模块 |
| ARCH | 画出模块依赖图；评估 Prompt/知识库与核心工作台的耦合点 |
| DESIGN | 先定 tokens + 布局密度 + 表格/表单规范，再改各业务页 |
| DEV | 按波次改 UI；大域功能「只整理不扩张」直到 PM 定案 |
| QA | 以 P0 路径为主：注册登录 → 任务 CRUD → 工作台加载 → AI → 设置/Google |

---

## 8. 文档维护约定

- 任意 **大功能合并** 或 **产品范围变更** 后，由负责人更新本文件「§3–§5」与 README 中对应段落。  
- **AI 团队协作方式** 见 **[AI_TEAM.md](./AI_TEAM.md)**。
