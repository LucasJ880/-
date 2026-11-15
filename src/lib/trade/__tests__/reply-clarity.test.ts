/**
 * NAV-6：询盘收件箱里「谁回复了谁」说清楚（openspec change nav-6-inbox-reply-clarity；
 * spec trade/prospect-stage-labels、trade/inquiry-reply-entry）
 *
 *   1. 阶段 replied 的显示名是「买家已来信」，四处原先写死的地方与阶段表同源；阶段取值、顺序、漏斗定义不变
 *   2. 收件箱卡片上的两种说法：阶段标签（买家）与状态文字（我方）
 *   3. 回复能力标记：两个收件箱接口都返回 capabilities.reply，判定用处理外贸的键；回复接口的校验不变
 *   4. 不能回复的成员看不到回复操作：卡片按钮、只读的草稿窗口、深链提示
 *
 * 纯函数 + 源码断言，无 DB。两类成员的真实请求见 reply-entry-db.isolated.test.ts 第 4 组。
 * 运行：npx tsx src/lib/trade/__tests__/reply-clarity.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getTradeProspectStageLabel,
  TRADE_COCKPIT_FUNNEL_STAGES,
  TRADE_PROSPECT_STAGE_LABELS,
  TRADE_PROSPECT_STAGE_OPTIONS,
  TRADE_PROSPECT_STAGES,
} from "../stage";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 600)}`}`);
  }
}
const ROOT = join(__dirname, "../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** 去掉注释后的源码：断言只看真正执行的代码 */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const same = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);

const NAME = "买家已来信";
const INBOX_PAGE = "src/app/(main)/trade/inbox/page.tsx";

// ───────────────────────── 1. 阶段显示名 ─────────────────────────
console.log("\n1. 阶段 replied 的显示名与同源");
{
  ok(TRADE_PROSPECT_STAGE_LABELS.replied === NAME && getTradeProspectStageLabel("replied") === NAME, "阶段 replied 的显示名是「买家已来信」");
  ok(getTradeProspectStageLabel("reply_received") === NAME, "历史取值 reply_received 也显示为同一个名字");
  ok(TRADE_PROSPECT_STAGE_OPTIONS.find((o) => o.value === "replied")?.label === NAME, "阶段下拉选项里是同一个名字");
  ok(!Object.values(TRADE_PROSPECT_STAGE_LABELS).includes("已回复"), "阶段表里不再有「已回复」");

  // 原先各自写死「已回复」的四处：现在读阶段表
  const sources: Array<[string, RegExp, string]> = [
    ["src/app/api/trade/dashboard/route.ts", /stage: "replied",\s*label: TRADE_PROSPECT_STAGE_LABELS\.replied,/, "外贸看板接口的漏斗"],
    ["src/app/api/trade/campaigns/[id]/stats/route.ts", /key: "replied",\s*label: TRADE_PROSPECT_STAGE_LABELS\.replied,/, "活动统计接口的漏斗"],
    ["src/app/(main)/trade/page.tsx", /label=\{getTradeProspectStageLabel\("replied"\)\} value=\{d\?\.overview\.replied/, "外贸获客首页概览卡"],
    ["src/lib/trade/chat-assistant.ts", /`\$\{getTradeProspectStageLabel\("replied"\)\} \$\{merged\.replied\}`/, "外贸助手的阶段分布"],
  ];
  for (const [file, re, label] of sources) {
    const src = code(file);
    ok(re.test(src) && !src.includes("已回复"), `${label}：读阶段表，源码里没有写死的「已回复」`);
  }
}

console.log("\n   改名不改阶段本身");
{
  ok(
    same(TRADE_PROSPECT_STAGES, ["new", "discovered", "researched", "qualified", "contacted", "replied", "quoted", "follow_up", "converted", "lost", "archived"]),
    "阶段取值与先后顺序不变",
    TRADE_PROSPECT_STAGES,
  );
  ok(
    same(TRADE_COCKPIT_FUNNEL_STAGES, ["new", "discovered", "researched", "qualified", "contacted", "replied", "quoted", "follow_up", "converted"]),
    "驾驶舱漏斗的展示顺序不变",
    TRADE_COCKPIT_FUNNEL_STAGES,
  );
  const { replied: _replied, ...others } = TRADE_PROSPECT_STAGE_LABELS;
  void _replied;
  ok(
    JSON.stringify(others) ===
      JSON.stringify({ new: "新线索", discovered: "已发现", researched: "已研究", qualified: "合格", contacted: "已触达", quoted: "已报价", follow_up: "待跟进", converted: "已转化", lost: "已失效", archived: "已归档" }),
    "其他十个阶段的显示名不变",
    others,
  );
  const dashboard = code("src/app/api/trade/dashboard/route.ts");
  ok(/stage: "replied",\s*label: [^,]+,\s*count: sumStages\(\["replied", "quoted", "follow_up", "converted"\]\),/.test(dashboard), "外贸看板接口：这一档仍是 stage=replied，包含的阶段集合不变");
  ok(/label: "已联系"/.test(dashboard) && /label: "成交"/.test(dashboard), "外贸看板接口：其余各档的文字没有动");
  const stats = code("src/app/api/trade/campaigns/[id]/stats/route.ts");
  ok(/key: "replied",\s*label: [^,]+,\s*includes: \["replied", "quoted", "follow_up", "converted"\],/.test(stats), "活动统计接口：这一档仍是 key=replied，包含的阶段集合不变");
}

// ───────────────────────── 2. 卡片上的两种说法 ─────────────────────────
console.log("\n2. 询盘收件箱卡片：买家与我方不用同一个词");
{
  const page = code(INBOX_PAGE);
  ok(/<CheckCircle2 size=\{11\} \/> 我方已回复<\/span>/.test(page), "会话已回复时，卡片下方的状态文字是「我方已回复」");
  ok(!/\/> 已回复<\/span>/.test(page), "卡片上不再有单独的「已回复」状态文字");
  ok(/\{getTradeProspectStageLabel\(t\.stage\)\}/.test(page), "买家名字旁的阶段标签取自线索阶段的显示名");
  ok(page.includes('"已回复，标记"') && read("src/lib/navigation/help-tasks.ts").includes("点「已回复，标记」"), "按钮「已回复，标记」与使用说明里引用它的那一行都没有改名");
}

// ───────────────────────── 3. 回复能力标记 ─────────────────────────
console.log("\n3. 回复能力标记");
{
  for (const [file, label] of [
    ["src/app/api/trade/inbox/route.ts", "列表接口"],
    ["src/app/api/trade/inbox/focus/route.ts", "单会话接口"],
  ] as const) {
    const src = code(file);
    ok(/reply: await holdsTradePermission\(auth\.user, orgRes\.orgId, TRADE_MANAGE_KEYS\),/.test(src) && /emailSend: Boolean\(process\.env\.RESEND_API_KEY\),/.test(src), `${label}：capabilities 带 reply（按处理外贸的键判定），原有的 emailSend 仍在`);
    const handlers = [...src.matchAll(/^export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((m) => m[1]);
    ok(same(handlers, ["GET"]) && /requireTradePermission\(request, TRADE_READ_KEYS\)/.test(src) && !/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src), `${label}：仍只有 GET、仍按读权限放行、不写库`);
  }
  const reply = code("src/app/api/trade/inbox/[prospectId]/reply/route.ts");
  ok(/requireTradePermission\(request, TRADE_MANAGE_KEYS\)/.test(reply) && !/capabilities/.test(reply), "回复接口：仍自己校验处理外贸的键，不看这个标记");
}

// ───────────────────────── 4. 不能回复的成员 ─────────────────────────
console.log("\n4. 不能回复的成员看不到回复操作");
{
  const page = code(INBOX_PAGE);
  ok(/const READ_ONLY_NOTICE = "你的岗位只能查看询盘，不能回复";/.test(page), "说明文字：你的岗位只能查看询盘，不能回复");
  ok(/const \[canReply, setCanReply\] = useState\(false\);/.test(page) && /setCanReply\(Boolean\(data\.capabilities\?\.reply\)\);/.test(page), "能不能回复取自列表接口的 capabilities.reply；返回之前按不能处理");

  // 卡片：三个回复操作
  ok(/\{canReply && replyButton\.kind !== "draft" && \(/.test(page) && /\{replyButton\.label\}/.test(page), "卡片：「写回复」「再写一封」以能回复为出现条件");
  const markAt = page.indexOf('"已回复，标记"');
  const markOpen = page.lastIndexOf("{canReply && !t.replied && (", markAt);
  ok(markAt > 0 && markOpen > 0 && markAt - markOpen < 700 && !page.slice(markOpen + 10, markAt).includes("</button>"), "卡片：「已回复，标记」以能回复为出现条件");

  // 「查看回复草稿」不受限：只读成员仍可打开窗口看草稿
  const designBlock = page.slice(page.indexOf("function DesignBlock("), page.indexOf("function ReplyModal("));
  ok(designBlock.includes("查看回复草稿") && !designBlock.includes("canReply"), "「查看回复草稿」不以能回复为条件");

  // 回复窗口：只读
  const modal = page.slice(page.indexOf("function ReplyModal("));
  ok(/canReply: boolean;/.test(modal) && /canReply=\{canReply\}/.test(page), "回复窗口：收到能不能回复");
  const gateAt = modal.indexOf("{canReply && (");
  const gateEnd = modal.indexOf(")}", modal.indexOf("发送邮件", gateAt));
  const gated = modal.slice(gateAt, gateEnd);
  ok(gateAt > 0 && gated.includes("已在别处发送，标记") && gated.includes("发送邮件") && gated.includes('submit("mark_sent")') && gated.includes('submit("send")'), "回复窗口：「已在别处发送，标记」「发送邮件」以能回复为出现条件");
  ok(!gated.includes("void copy()") && modal.indexOf("void copy()") > 0 && modal.indexOf("void copy()") < gateAt, "回复窗口：复制不受限");
  ok((modal.match(/readOnly=\{!canReply\}/g) ?? []).length === 2 && /<input value=\{subject\} readOnly=\{!canReply\}/.test(modal) && /<textarea value=\{body\} readOnly=\{!canReply\}/.test(modal), "回复窗口：不能回复时主题与正文只读");
  ok(/\{!canReply\s*\?\s*READ_ONLY_NOTICE/.test(modal), "回复窗口：不能回复时显示说明文字");
  ok([...modal.matchAll(/submit\("(?:send|mark_sent)"\)/g)].length === 2, "回复窗口：请求回复接口的入口只有这两个按钮");

  // 深链
  const effect = page.slice(page.indexOf('params.get("prospect")'), page.indexOf('router.replace("/trade/inbox")'));
  ok(/const mayReply = Boolean\(data\.capabilities\?\.reply\);/.test(effect) && /if \(mayReply\) \{\s*setReplyFor\(/.test(effect) && /\} else \{\s*setFocusNotice\(READ_ONLY_NOTICE\);/.test(effect), "深链：能回复才打开回复窗口，否则只提示");
  ok((effect.match(/setReplyFor\(/g) ?? []).length === 1 && page.indexOf('router.replace("/trade/inbox")') > 0, "深链：打开窗口只有这一处；地址参数照常去掉");
}

console.log(`\nreply-clarity: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
