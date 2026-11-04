/**
 * 微信入口开关的页面接线（openspec change hide-wechat-entry / COLLAB-1，spec identity/wechat-entry）
 * 服务端静态渲染（无浏览器 / 无 DB / 无网络）+ 源码静态断言。
 * 运行：npx tsx src/components/wechat-entry/__tests__/wechat-entry-render.test.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AuthLayout from "@/app/(auth)/layout";
import SettingsWechatLayout from "@/app/(main)/settings/wechat/layout";
import WechatLayout from "@/app/(main)/wechat/layout";
import { WechatEntryProvider, useWechatEntryEnabled } from "../context";
import { WechatLoginEntry } from "../login-entry";
import { MembersTable } from "@/app/(main)/admin/onboarding/[orgId]/members-table";
import { isStepDone, type OnboardingStepStatus } from "@/lib/organizations/onboarding-rules";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 400)}`}`);
  }
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const FLAG_IMPORT = 'from "@/lib/messaging/wechat-entry"';

/** 在给定的 WECHAT_BINDING_ENABLED 下执行（undefined = 未设置），结束后还原 */
function withFlag<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.WECHAT_BINDING_ENABLED;
  if (value === undefined) delete process.env.WECHAT_BINDING_ENABLED;
  else process.env.WECHAT_BINDING_ENABLED = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.WECHAT_BINDING_ENABLED;
    else process.env.WECHAT_BINDING_ENABLED = prev;
  }
}

function Probe() {
  return <span>{useWechatEntryEnabled() ? "wechat:on" : "wechat:off"}</span>;
}

console.log("上下文");
ok(renderToStaticMarkup(<Probe />) === "<span>wechat:off</span>", "没有上下文时为关");
ok(
  renderToStaticMarkup(
    <WechatEntryProvider enabled>
      <Probe />
    </WechatEntryProvider>,
  ) === "<span>wechat:on</span>",
  "WechatEntryProvider enabled 时为开",
);
ok(
  renderToStaticMarkup(
    <WechatEntryProvider enabled={false}>
      <Probe />
    </WechatEntryProvider>,
  ) === "<span>wechat:off</span>",
  "WechatEntryProvider enabled={false} 时为关",
);

console.log("\n两个微信页面（layout 门禁）");
for (const [route, Layout] of [
  ["/settings/wechat", SettingsWechatLayout],
  ["/wechat", WechatLayout],
] as const) {
  const page = <p>原页面内容</p>;
  for (const value of [undefined, "", "false", "yes"]) {
    const html = withFlag(value, () => renderToStaticMarkup(<Layout>{page}</Layout>));
    ok(
      html.includes("暂未开放") && !html.includes("原页面内容"),
      `${route} 开关为 ${JSON.stringify(value ?? "未设置")}：显示"暂未开放"，不渲染页面组件`,
      html,
    );
    ok(
      !html.includes("/settings/wechat") && !html.includes("/api/auth/wechat") && !html.includes("扫码"),
      `${route} 开关为 ${JSON.stringify(value ?? "未设置")}：占位块里没有绑定 / 扫码入口`,
      html,
    );
  }
  for (const value of ["1", " TRUE ", "on"]) {
    const html = withFlag(value, () => renderToStaticMarkup(<Layout>{page}</Layout>));
    ok(html === "<p>原页面内容</p>", `${route} 开关为 ${JSON.stringify(value)}：原样返回页面`, html);
  }
}

console.log("\n根 layout 下发开关");
{
  const off = withFlag(undefined, () => renderToStaticMarkup(<AuthLayout><Probe /></AuthLayout>));
  const on = withFlag("1", () => renderToStaticMarkup(<AuthLayout><Probe /></AuthLayout>));
  ok(off.includes("wechat:off") && on.includes("wechat:on"), "(auth) layout 按服务端开关值下发上下文", { off, on });
  const auth = strip(read("src/app/(auth)/layout.tsx"));
  ok(
    auth.includes(`import { isWechatBindingEnabled } ${FLAG_IMPORT};`) &&
      /<WechatEntryProvider enabled=\{isWechatBindingEnabled\(\)\}>/.test(auth),
    "(auth) layout 用 isWechatBindingEnabled() 的值包上下文",
  );
  const main = strip(read("src/app/(main)/layout.tsx"));
  ok(
    main.includes(`import { isWechatBindingEnabled } ${FLAG_IMPORT};`) &&
      /<WechatEntryProvider enabled=\{isWechatBindingEnabled\(\)\}>\s*<AppShell>\{children\}<\/AppShell>\s*<\/WechatEntryProvider>/.test(main),
    "(main) layout 用 isWechatBindingEnabled() 的值包住 AppShell（侧边栏、抽屉与各页面都在其内）",
  );
  ok(!/NEXT_PUBLIC_WECHAT_BINDING_ENABLED/.test(auth + main), "不用前端构建变量");
  const ctx = strip(read("src/components/wechat-entry/context.tsx"));
  ok(ctx.startsWith('"use client";') && !ctx.includes(FLAG_IMPORT) && !ctx.includes("process.env"), "客户端上下文不自己读环境变量");
}

console.log("\n登录页微信扫码入口");
{
  const html = renderToStaticMarkup(<WechatLoginEntry onClick={() => {}} />);
  const orAt = html.indexOf(">或<");
  const btnAt = html.indexOf("微信扫码登录");
  ok(orAt > 0 && btnAt > orAt, 'WechatLoginEntry：先"或"分隔线，再"微信扫码登录"按钮', html.slice(0, 300));
  ok(/<button type="button"[^>]*><svg[^>]*text-\[#07C160\]/.test(html), "按钮是 type=button，带绿色微信图标（与改动前相同）", html.slice(0, 300));

  const login = strip(read("src/app/(auth)/login/page.tsx"));
  ok(
    login.includes('import { useWechatEntryEnabled } from "@/components/wechat-entry/context";') &&
      login.includes('import { WechatLoginEntry } from "@/components/wechat-entry/login-entry";') &&
      /const wechatEnabled = useWechatEntryEnabled\(\);/.test(login),
    "登录页从上下文读开关",
  );
  ok(
    /\{wechatEnabled && <WechatLoginEntry onClick=\{handleWeChatLogin\} \/>\}/.test(login) &&
      (login.match(/<WechatLoginEntry\b/g) ?? []).length === 1,
    "登录页只在开关为真时渲染 WechatLoginEntry，点击回调由登录页传入",
  );
  ok(!login.includes("微信扫码登录") && !/>\s*或\s*</.test(login) && !login.includes("function WeChatIcon"), '登录页不再自己画"或"分隔线、微信图标与按钮');
  ok(login.includes("WECHAT_ERROR_MAP") && login.includes("window.location.href = `/api/auth/wechat?${params.toString()}`;"), "微信回调错误提示与跳转地址仍在登录页");
  ok(!login.includes(FLAG_IMPORT), "登录页不 import 服务端开关模块");
}

console.log("\n设置页微信入口");
{
  const settings = strip(read("src/app/(main)/settings/page.tsx"));
  ok(
    settings.includes('import { useWechatEntryEnabled } from "@/components/wechat-entry/context";') &&
      /const wechatEnabled = useWechatEntryEnabled\(\);/.test(settings),
    "设置页从上下文读开关",
  );
  const emailAt = settings.indexOf('href="/settings/email"');
  const guardAt = settings.search(/\{wechatEnabled && \(\s*<Link\s+href="\/settings\/wechat"/);
  ok(emailAt > 0 && guardAt > emailAt, '"微信集成"卡片只在开关为真时渲染，位置仍在"邮箱绑定"之后', { emailAt, guardAt });
  ok((settings.match(/\/settings\/wechat/g) ?? []).length === 1, "设置页没有别的 /settings/wechat 链接");
  ok(!settings.includes(FLAG_IMPORT), "设置页不 import 服务端开关模块");
}

console.log("\n侧边栏与手机抽屉（导航过滤见 wechat-entry-nav.test.ts）");
for (const [file, ctxName] of [
  ["src/components/sidebar.tsx", "filterCtx"],
  ["src/components/mobile-nav-drawer.tsx", "ctx"],
] as const) {
  const src = strip(read(file));
  const start = src.indexOf(`const ${ctxName}: NavigationFilterContext = useMemo(`);
  const block = start >= 0 ? src.slice(start, src.indexOf("\n  );\n", start)) : "";
  const hookAt = src.indexOf("const wechatEntryEnabled = useWechatEntryEnabled();");
  ok(
    src.includes('import { useWechatEntryEnabled } from "@/components/wechat-entry/context";') && hookAt > 0 && hookAt < start,
    `${file} 在算导航上下文之前从上下文读开关`,
  );
  ok((block.match(/\bwechatEntryEnabled,/g) ?? []).length === 2, `${file} 把开关值放进导航过滤上下文（含 useMemo 依赖）`, block.slice(-400));
  ok(!src.includes(FLAG_IMPORT), `${file} 不 import 服务端开关模块`);
}

console.log("\n组织开通页成员表");
{
  const members: React.ComponentProps<typeof MembersTable>["members"] = [
    { userId: "u1", name: "张三", email: "zhang@example.com", platformRole: "trade", orgRole: "org_member", isSalesRole: true, wechatBound: true, wechatChannels: ["ilink"] },
    { userId: "u2", name: "李四", email: "li@example.com", platformRole: "trade", orgRole: "org_member", isSalesRole: true, wechatBound: false, wechatChannels: [] },
  ];
  const headers = (html: string) => [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
  const off = renderToStaticMarkup(<MembersTable members={members} showWechat={false} />);
  ok(JSON.stringify(headers(off)) === JSON.stringify(["成员", "平台角色", "企业角色"]), "showWechat=false：只有成员、平台角色、企业角色三列", headers(off));
  ok(!off.includes("微信") && !off.includes("已绑定") && !off.includes("未绑定"), "showWechat=false：没有微信列与已绑定 / 未绑定", off.slice(0, 300));
  ok((off.match(/<td\b/g) ?? []).length === 6, "showWechat=false：每行三格", (off.match(/<td\b/g) ?? []).length);
  const on = renderToStaticMarkup(<MembersTable members={members} showWechat />);
  ok(JSON.stringify(headers(on)) === JSON.stringify(["成员", "平台角色", "企业角色", "微信"]), "showWechat：企业角色之后有微信列", headers(on));
  ok(on.includes("已绑定") && on.includes("未绑定") && (on.match(/<td\b/g) ?? []).length === 8, "showWechat：已绑定 / 未绑定照常显示，每行四格");
  ok(renderToStaticMarkup(<MembersTable members={[]} showWechat />) === "", "没有成员时不渲染表格（与改动前相同）");
}

console.log("\n组织开通页接线");
{
  const page = strip(read("src/app/(main)/admin/onboarding/[orgId]/page.tsx"));
  ok(page.includes('import { MembersTable } from "./members-table";') && !/function MembersTable\b/.test(page), "成员表从同目录 members-table.tsx 引入，页面里不再自带一份");
  const hookAt = page.indexOf("const wechatEnabled = useWechatEntryEnabled();");
  const firstReturn = page.indexOf("if (loading && !status) {");
  ok(
    page.includes('import { useWechatEntryEnabled } from "@/components/wechat-entry/context";') && hookAt > 0 && hookAt < firstReturn,
    "开通页在提前 return 之前从上下文读开关",
  );
  ok(/<MembersTable members=\{status\.members\} showWechat=\{wechatEnabled\} \/>/.test(page), "邀请业务员步骤的成员表按开关显示微信列");

  const wx = page.slice(page.indexOf('case "wechat":'), page.indexOf('case "test_inquiry":'));
  const at = (s: string, from = 0) => wx.indexOf(s, from);
  const cond = at("{wechatEnabled ? (");
  const hint = at("（/settings/wechat）扫码绑定");
  const table = at("<MembersTable members={salesMembers} showWechat />");
  const orElse = at(") : (", table);
  const notOpen = at("微信绑定暂未开放。", orElse);
  const close = at(")}", notOpen);
  const ack = at("暂不绑定微信（询盘提醒只在站内），视为本步完成");
  ok(
    cond > 0 && cond < hint && hint < table && table < orElse && orElse < notOpen && notOpen < close && close < ack,
    '微信步骤：提示与绑定表只在开关为真时渲染，关时显示"微信绑定暂未开放。"；"暂不绑定微信"确认框两种状态都在',
    { cond, hint, table, orElse, notOpen, close, ack },
  );
  ok(
    wx.includes("checked={!!status.acknowledged.wechat}") && wx.includes("patch({ acknowledge: { wechat: e.target.checked } }"),
    "确认框仍写 acknowledge.wechat（接口与就绪判定不变）",
  );

  ok(page.includes('const WECHAT_NOT_OPEN_DETAIL = "微信绑定暂未开放，勾选「暂不绑定微信」即可完成本步";'), '步骤条替换说明以"微信绑定暂未开放"开头');
  ok(
    /const detail = key === "wechat" && !wechatEnabled && st && !isStepDone\(st\) \? WECHAT_NOT_OPEN_DETAIL : st\?\.detail;/.test(page) &&
      page.includes('{key === "ready" ? (status.ready ? "全部必做步骤已完成" : "查看还差哪些步骤") : detail}'),
    "步骤条：开关关闭且微信步骤未完成时用替换说明，否则照常显示服务端说明",
  );
  const done = (s: OnboardingStepStatus) => isStepDone({ status: s });
  ok(
    !done("todo") && !done("warning") && done("done") && done("acknowledged") && done("skipped"),
    "未完成 = todo / warning：确认暂不绑定（acknowledged）或已有人绑定（done）后照常显示服务端说明",
  );
  ok(!page.includes(FLAG_IMPORT), "开通页不 import 服务端开关模块");
}

console.log(`\nwechat-entry-render: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
