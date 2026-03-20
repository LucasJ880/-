import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "admin@qingyan.ai" },
    update: {},
    create: {
      name: "管理员",
      email: "admin@qingyan.ai",
      role: "admin",
    },
  });

  const project = await prisma.project.upsert({
    where: { id: "default-project" },
    update: {},
    create: {
      id: "default-project",
      name: "青砚 MVP 开发",
      description: "青砚 AI 工作助理第一阶段开发任务",
      color: "#3B82F6",
      ownerId: user.id,
    },
  });

  await Promise.all(
    [
      { name: "紧急", color: "#EF4444" },
      { name: "开发", color: "#3B82F6" },
      { name: "设计", color: "#8B5CF6" },
      { name: "文档", color: "#10B981" },
      { name: "Bug", color: "#F59E0B" },
    ].map((tag) =>
      prisma.tag.upsert({
        where: { name: tag.name },
        update: {},
        create: tag,
      })
    )
  );

  const tasks = [
    {
      title: "搭建项目基础架构",
      description: "初始化 Next.js 项目，配置 TypeScript、Tailwind CSS、Prisma",
      status: "done",
      priority: "high",
    },
    {
      title: "设计数据模型",
      description: "设计用户、项目、任务等核心数据模型",
      status: "done",
      priority: "high",
    },
    {
      title: "实现中文后台 UI",
      description: "搭建侧边栏导航、顶栏、主内容区域的基础布局",
      status: "in_progress",
      priority: "high",
    },
    {
      title: "完成任务管理功能",
      description: "实现任务的创建、编辑、删除、状态切换功能",
      status: "todo",
      priority: "medium",
    },
    {
      title: "集成 AI 对话功能",
      description: "接入大语言模型 API，实现基础的 AI 对话能力",
      status: "todo",
      priority: "medium",
    },
    {
      title: "编写项目文档",
      description: "编写 README、API 文档和部署指南",
      status: "todo",
      priority: "low",
    },
  ];

  for (const task of tasks) {
    await prisma.task.create({
      data: {
        ...task,
        creatorId: user.id,
        assigneeId: user.id,
        projectId: project.id,
      },
    });
  }

  console.log("种子数据已创建完成！");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
