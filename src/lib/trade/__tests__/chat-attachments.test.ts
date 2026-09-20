/**
 * 外贸 AI 对话附件 — 纯函数单测（ATT-01..13）
 * 运行：npx tsx src/lib/trade/__tests__/chat-attachments.test.ts
 */

import {
  ATTACHMENT_ONLY_PROMPT,
  ATTACHMENT_STUB_PREVIEW_CHARS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_TEXT_CHARS,
  attachmentsTitleSource,
  composeUserContent,
  parseAttachmentsInput,
  readStoredAttachments,
  renderTurnsForModel,
  summarizeAttachments,
} from "../chat-attachments";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("parseAttachmentsInput");
{
  const r = parseAttachmentsInput(undefined);
  ok(r.ok && r.attachments.length === 0, "ATT-01 未传 → 空数组（兼容老客户端）");
  ok(!parseAttachmentsInput("x").ok, "ATT-02 非数组 → 拒绝");
  const tooMany = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, (_, i) => ({
    name: `f${i}.txt`,
    size: 1,
    text: "hello",
  }));
  const r3 = parseAttachmentsInput(tooMany);
  ok(!r3.ok && r3.error.includes(String(MAX_ATTACHMENTS_PER_MESSAGE)), "ATT-03 超过条数上限 → 拒绝并点名上限");
  ok(!parseAttachmentsInput([{ size: 1, text: "x" }]).ok, "ATT-04a 缺文件名 → 拒绝");
  const r4b = parseAttachmentsInput([{ name: "empty.pdf", size: 1, text: "   " }]);
  ok(!r4b.ok && r4b.error.includes("empty.pdf"), "ATT-04b 空正文 → 拒绝并点名文件");
  ok(
    !parseAttachmentsInput([{ name: "big.txt", size: 1, text: "a".repeat(MAX_ATTACHMENT_TEXT_CHARS + 1) }]).ok,
    "ATT-04c 正文超长 → 拒绝",
  );
  const r5 = parseAttachmentsInput([{ name: "  报价单.xlsx ", size: 1234.7, text: "A,B\n1,2" }]);
  ok(
    r5.ok &&
      r5.attachments[0].name === "报价单.xlsx" &&
      r5.attachments[0].size === 1234 &&
      r5.attachments[0].text === "A,B\n1,2",
    "ATT-05 合法输入 → 文件名去空白、size 取整、正文原样",
  );
}

console.log("readStoredAttachments / summarizeAttachments");
{
  ok(readStoredAttachments(null).length === 0, "ATT-06a null → []");
  ok(readStoredAttachments({ name: "x" }).length === 0, "ATT-06b 非数组 → []");
  const rs = readStoredAttachments([{ name: "a.pdf", text: "abc" }, { bogus: true }, "x"]);
  ok(rs.length === 1 && rs[0].size === 0 && rs[0].text === "abc", "ATT-06c 只保留形状正确的项，缺 size 补 0");
  const sum = summarizeAttachments([{ name: "a.pdf", size: 10, text: "abcdef" }]);
  ok(
    sum.length === 1 && sum[0].textLength === 6 && !("text" in sum[0]),
    "ATT-07 摘要不带正文，只带 textLength",
  );
}

console.log("composeUserContent");
{
  ok(composeUserContent("", []) === ATTACHMENT_ONLY_PROMPT, "ATT-08a 无文字无块 → 仅附件指令");
  ok(composeUserContent("看看", []) === "看看", "ATT-08b 有文字无块 → 原文");
  const c = composeUserContent("  ", ["<attachment>x</attachment>"]);
  ok(
    c.startsWith(ATTACHMENT_ONLY_PROMPT) && c.includes("以下是用户上传的附件内容") && c.endsWith("</attachment>"),
    "ATT-08c 只传附件 → 指令 + 附件块",
  );
}

console.log("renderTurnsForModel");
{
  const plain = renderTurnsForModel([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
  ok(
    plain.length === 2 && plain[0].content === "hi" && plain[1].content === "hello",
    "ATT-09 无附件轮次原样透传",
  );

  const doc = "第一行\n第二行 " + "内容".repeat(200);
  const one = renderTurnsForModel([
    { role: "user", content: "帮我分析", attachments: [{ name: "询盘.pdf", size: 9, text: doc }] },
  ]);
  ok(
    one[0].content.startsWith("帮我分析") &&
      one[0].content.includes('<attachment name="询盘.pdf" chars="' + doc.length + '">') &&
      one[0].content.includes(doc) &&
      !one[0].content.includes("truncated"),
    "ATT-10 预算内附件完整展开，带文件名与字符数",
  );

  const mk = (tag: string) => tag.repeat(1000); // 1000 chars
  const turns = [
    { role: "user" as const, content: "第一份", attachments: [{ name: "old.txt", size: 1, text: mk("旧") }] },
    { role: "assistant" as const, content: "好的" },
    { role: "user" as const, content: "第二份", attachments: [{ name: "new.txt", size: 1, text: mk("新") }] },
  ];
  const r1500 = renderTurnsForModel(turns, 1500);
  ok(
    r1500[2].content.includes(mk("新")) && !r1500[2].content.includes("truncated"),
    "ATT-11a 预算 1500：最新附件（1000）完整",
  );
  ok(
    r1500[0].content.includes('shown="500" truncated="true"') &&
      r1500[0].content.includes("旧".repeat(500)) &&
      !r1500[0].content.includes("旧".repeat(501)),
    "ATT-11b 预算 1500：旧附件只拿到剩余 500 并标 truncated",
  );
  ok(r1500[1].content === "好的", "ATT-11c assistant 轮不受影响");

  const r1200 = renderTurnsForModel(turns, 1200);
  ok(
    r1200[2].content.includes(mk("新")) &&
      r1200[0].content.includes('omitted="true"') &&
      r1200[0].content.includes("旧".repeat(ATTACHMENT_STUB_PREVIEW_CHARS)) &&
      !r1200[0].content.includes("旧".repeat(ATTACHMENT_STUB_PREVIEW_CHARS + 1)),
    `ATT-11d 预算 1200：剩余 200 < ${ATTACHMENT_STUB_PREVIEW_CHARS} → 旧附件降为桩（只留开头预览）`,
  );

  const r0 = renderTurnsForModel(turns, 0);
  ok(
    r0[2].content.includes('omitted="true"') && r0[0].content.includes('omitted="true"'),
    "ATT-11e 预算 0：全部只留桩，仍能看到文件名",
  );

  const quoted = renderTurnsForModel([
    { role: "user", content: "x", attachments: [{ name: 'a"b<c>.pdf', size: 1, text: "t".repeat(400) }] },
  ]);
  ok(
    quoted[0].content.includes('<attachment name="a b c .pdf"') && !quoted[0].content.includes('a"b'),
    "ATT-12 文件名里的引号/尖括号不会破坏 attachment 标签",
  );
}

console.log("image kind");
{
  const r = parseAttachmentsInput([
    { name: "a.pdf", size: 1, text: "doc" },
    { name: "shot.png", size: 1, text: "【文字内容】RFQ 200 pcs", kind: "image" },
    { name: "weird.txt", size: 1, text: "x", kind: "video" },
  ]);
  ok(
    r.ok && r.attachments[0].kind === "document" && r.attachments[1].kind === "image" && r.attachments[2].kind === "document",
    "ATT-14a 缺省/未知 kind → document，image 原样保留",
  );
  const stored = readStoredAttachments([{ name: "old.pdf", text: "legacy" }, { name: "s.png", text: "t", kind: "image" }]);
  ok(stored[0].kind === "document" && stored[1].kind === "image", "ATT-14b 读回旧数据缺 kind 视为 document");
  const sum = summarizeAttachments(stored);
  ok(sum[0].kind === "document" && sum[1].kind === "image", "ATT-14c 摘要携带 kind 供前端选图标");
  const rendered = renderTurnsForModel([
    { role: "user", content: "看图", attachments: [{ name: "shot.png", kind: "image", size: 1, text: "t".repeat(400) }] },
  ]);
  ok(
    rendered[0].content.includes('<attachment name="shot.png" kind="image" chars="400">') &&
      rendered[0].content.includes("图片附件：以下是从图片识别出的文字与画面描述"),
    "ATT-14d 图片附件带 kind=\"image\" 标签与识别结果说明",
  );
  const stub = renderTurnsForModel(
    [{ role: "user", content: "看图", attachments: [{ name: "shot.png", kind: "image", size: 1, text: "t".repeat(400) }] }],
    0,
  );
  ok(stub[0].content.includes('kind="image" chars="400" omitted="true"'), "ATT-14e 图片桩同样标 kind");
  const doc = renderTurnsForModel([
    { role: "user", content: "看文档", attachments: [{ name: "a.pdf", size: 1, text: "d".repeat(400) }] },
  ]);
  ok(!doc[0].content.includes('kind="image"') && !doc[0].content.includes("图片附件"), "ATT-14f 文档附件不带图片说明");
}

console.log("attachmentsTitleSource");
{
  const a = { name: "报价单.xlsx", size: 1, text: "x" };
  ok(attachmentsTitleSource("  看一下 ", [a]) === "看一下", "ATT-13a 有文字用文字");
  ok(attachmentsTitleSource("", [a]) === "附件：报价单.xlsx", "ATT-13b 单附件 → 附件：名");
  ok(attachmentsTitleSource("", [a, { ...a, name: "b.pdf" }]) === "附件：报价单.xlsx 等 2 个", "ATT-13c 多附件 → 等 N 个");
  ok(attachmentsTitleSource("", []) === "", "ATT-13d 都没有 → 空串");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
