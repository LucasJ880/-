/**
 * 工作台深链纯逻辑测试
 * 运行：npx tsx src/lib/agent-runtime/__tests__/workbench-link.test.ts
 */

import {
  resolveAppOrigin,
  buildAgentWorkbenchUrl,
  shouldAttachWorkbenchLink,
  appendWorkbenchLink,
} from "../workbench-link";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("▶ Agent Workbench link");

ok(
  resolveAppOrigin({ NEXT_PUBLIC_APP_URL: "https://app.example.com/" }) ===
    "https://app.example.com",
  "NEXT_PUBLIC_APP_URL 去尾斜杠",
);
ok(
  resolveAppOrigin({ VERCEL_URL: "my-app.vercel.app" }) ===
    "https://my-app.vercel.app",
  "VERCEL_URL 补 https",
);
ok(
  resolveAppOrigin({}) === "https://qingyan.ai",
  "缺省生产域",
);

{
  const url = buildAgentWorkbenchUrl({
    runId: "run_abc",
    env: { NEXT_PUBLIC_APP_URL: "https://app.example.com" },
  });
  ok(
    url === "https://app.example.com/agent-trace?runId=run_abc",
    "runId 深链",
  );
}

{
  const url = buildAgentWorkbenchUrl({
    sessionId: "sess_1",
    env: { NEXT_PUBLIC_APP_URL: "https://app.example.com" },
  });
  ok(
    url === "https://app.example.com/agent-trace?sessionId=sess_1",
    "sessionId 深链",
  );
}

ok(
  shouldAttachWorkbenchLink("你好") === false,
  "闲聊不加链接",
);
ok(
  shouldAttachWorkbenchLink("可执行动作：\n1 = 发邮件") === true,
  "编号确认文案加链接",
);
ok(
  shouldAttachWorkbenchLink("请稍等", { runStatus: "awaiting_approval" }) ===
    true,
  "awaiting_approval 加链接",
);
ok(
  shouldAttachWorkbenchLink("后台完成", { force: true }) === true,
  "force 加链接",
);

{
  const out = appendWorkbenchLink(
    "可执行动作：\n1 = 测试",
    "run_xyz",
    { NEXT_PUBLIC_APP_URL: "https://app.example.com" },
  );
  ok(out.includes("详情与确认："), "附带详情标题");
  ok(
    out.includes("https://app.example.com/agent-trace?runId=run_xyz"),
    "附带 URL",
  );
  const again = appendWorkbenchLink(out, "run_xyz", {
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
  });
  ok(
    again.split("agent-trace?runId=run_xyz").length === 2,
    "重复追加不复制链接",
  );
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
