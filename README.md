# 青砚 - AI 工作助理

> 智能中文 AI 工作助理 MVP，第一阶段服务个人，后续扩展成面向中国出口厂家的平台。

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript |
| 样式 | Tailwind CSS 4 |
| 数据库 | PostgreSQL + Prisma 6（本地/线上均为 Postgres；部署见 `docs/DEPLOY_VERCEL.md`） |
| AI | OpenAI SDK（兼容 DeepSeek / Qwen） |
| 图标 | Lucide React |
| 运行时 | Node.js 20 |

## 快速开始

```bash
# 安装依赖
npm install

# 复制环境变量模板，填写 DATABASE_URL / DIRECT_URL（可相同）、JWT_SECRET 等
cp .env.example .env

# 应用数据库迁移（需已创建空的 Postgres 库）
npx prisma migrate deploy

# 填充示例数据（可选）
npx prisma db seed

# 启动开发服务器
npm run dev
```

线上部署（Vercel + Neon + GoDaddy 域名）见 **[docs/DEPLOY_VERCEL.md](./docs/DEPLOY_VERCEL.md)**。  
登录会话默认 **24 小时** 过期；可在环境变量中设置 `SESSION_MAX_AGE_SECONDS`（秒，300～604800）。需要立刻全员下线时可轮换 `JWT_SECRET`。

打开浏览器访问 [http://localhost:3000](http://localhost:3000)

## AI 配置

在 `.env` 文件中配置大模型 API。支持任何兼容 OpenAI 协议的服务：

```bash
# OpenAI
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
OPENAI_MODEL="gpt-5.4"

# DeepSeek
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.deepseek.com/v1"
OPENAI_MODEL="deepseek-chat"

# 通义千问 Qwen
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
OPENAI_MODEL="qwen-plus"
```

未配置 API Key 时，AI 助手页面会显示配置引导。

## 项目结构

```
src/
├── app/                  # Next.js App Router 页面
│   ├── api/
│   │   ├── ai/chat/      # AI 流式聊天 API (SSE)
│   │   ├── tasks/        # 任务 CRUD API
│   │   ├── projects/     # 项目 CRUD API
│   │   └── stats/        # 统计数据 API
│   ├── assistant/        # AI 助手页面
│   ├── tasks/            # 任务管理页面
│   ├── projects/         # 项目管理页面
│   ├── layout.tsx        # 全局布局（侧边栏 + 顶栏）
│   └── page.tsx          # 工作台仪表盘
├── components/
│   ├── sidebar.tsx       # 侧边栏导航
│   ├── header.tsx        # 顶栏
│   └── task-suggestion-card.tsx  # AI 任务建议卡片
└── lib/
    ├── ai.ts             # 统一 AI 客户端 + 任务解析
    ├── prompts.ts        # 系统提示词
    ├── db.ts             # Prisma 客户端
    └── utils.ts          # 工具函数与常量
```

## 数据模型

- **User** - 用户
- **Project** - 项目
- **Task** - 任务（支持状态、优先级、截止日期）
- **Tag / TagOnTask** - 标签系统

## 已实现功能

### Day 1 — 项目骨架
- [x] 数据模型设计（User / Project / Task / Tag）
- [x] 中文后台 UI（侧边栏 + 顶栏 + 主区域）
- [x] 工作台仪表盘
- [x] 任务管理（CRUD + 状态切换 + 筛选）

### Day 2 — 功能增强
- [x] 项目管理（CRUD + 卡片式展示）
- [x] 任务编辑 + 关联项目 + 截止日期
- [x] AI 助手页面（占位 UI）

### Day 3 — AI 能力
- [x] 接入真实大模型 API（流式 SSE 响应）
- [x] 自然语言 → 结构化任务建议解析
- [x] 任务建议卡片（展示 + 编辑 + 确认创建）
- [x] 无 API Key 友好降级（配置引导页）
- [x] 流式显示中实时隐藏 JSON 标记

## 协作与接手文档

- **[docs/AI_TEAM.md](./docs/AI_TEAM.md)**：虚拟角色（PM / 架构 / 设计 / 全栈 / QA）分工与在 Cursor 中的用法，适合大型重构与 UI/UX 升级前对齐流程。  
- **[docs/PROJECT_AUDIT.md](./docs/PROJECT_AUDIT.md)**：基于代码通读的项目功能地图与 README 差距说明（二手项目接手建议先看）。  
- **[docs/QA_P0_CHECKLIST.md](./docs/QA_P0_CHECKLIST.md)**：发布前 P0 手工回归清单；自动化门禁可运行 `npm run qa`（lint + Prisma generate + `next build`，不含 migrate）。  
- **[docs/PM_PHASE1_DELIVERY.md](./docs/PM_PHASE1_DELIVERY.md)**：第一期优化交付清单（PM 输出，供 ARCH 拆分设计与排期）。  
- **[docs/ARCH_PHASE1_BREAKDOWN.md](./docs/ARCH_PHASE1_BREAKDOWN.md)**：第一期技术拆分（Epic/Story、依赖、开发波次、DESIGN 接口）。  
- **[docs/DESIGN_SPEC_PHASE1.md](./docs/DESIGN_SPEC_PHASE1.md)**：第一期 UI/UX 与 Token、字阶、五类组件规格（现代 / 智能感方向）。

登录后侧栏 **使用说明** 打开站内 **[功能地图页](/help)**（与 `PROJECT_AUDIT` 路由表一致）。

## 后续规划

- [ ] AI 感知现有任务/项目上下文
- [ ] MCP 工具调用雏形
- [x] 顶栏搜索与提醒（一期已具备）
- [x] 多用户与权限管理（组织/项目成员等，持续演进）
- [ ] 面向出口厂家的平台化功能

## 许可证

私有项目
