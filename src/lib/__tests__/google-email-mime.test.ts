/**
 * CHAIN-4a — 原始邮件：不带附件逐字节不变；带附件 multipart/mixed（RFC 2231 / 2047 文件名）
 * 运行：npx tsx src/lib/__tests__/google-email-mime.test.ts
 */
import { buildRawEmail, type SendEmailParams } from "@/lib/google-email";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 800)); }
}

/** 本功能之前的 buildRawEmail（逐字复制自 main 8f095758），用来证明不带附件时逐字节不变 */
function legacyBuildRawEmail(params: SendEmailParams): string {
  const headerSafe = (v: string | undefined): string | undefined => {
    const t = v?.replace(/[\r\n]+/g, " ").trim();
    return t ? t : undefined;
  };
  const lines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(params.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: ${params.contentType === "text" ? "text/plain" : "text/html"}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
  ];
  if (params.replyTo) lines.push(`Reply-To: ${params.replyTo}`);
  const inReplyTo = headerSafe(params.inReplyTo);
  const references = headerSafe(params.references) ?? inReplyTo;
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("", Buffer.from(params.body).toString("base64"));
  return Buffer.from(lines.join("\r\n")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const decode = (raw: string) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

console.log("google-email MIME");

// ── 不带附件：逐字节不变 ──
{
  const base: SendEmailParams = { to: "a@supplier.test", from: '"Fixture Purchasing" <project@fixture.test>', subject: "询价 RFQ-SUNNY-2026-AB12C（第 1 轮）", body: "供应商 A 您好：\n\n一、规格要求\n1. 【强制】R-001 睡袋" };
  const variants: Array<[string, SendEmailParams]> = [
    ["纯文本", { ...base, contentType: "text" }],
    ["HTML（缺省）", { ...base, body: "<p>你好</p>" }],
    ["带回复地址", { ...base, contentType: "text", replyTo: "project@fixture.test" }],
    ["线程回复头", { ...base, contentType: "text", threadId: "t1", inReplyTo: "<abc@mail.gmail.com>", references: "<abc@mail.gmail.com>" }],
    ["只有 In-Reply-To", { ...base, contentType: "text", inReplyTo: "<x@y>\r\nBcc: evil@x" }],
  ];
  for (const [label, p] of variants) {
    ok(buildRawEmail(p) === legacyBuildRawEmail(p), `不传附件逐字节不变：${label}`);
    ok(buildRawEmail({ ...p, attachments: [] }) === legacyBuildRawEmail(p), `附件为空数组逐字节不变：${label}`);
  }
}

// ── 带附件 ──
{
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(3000, 7), Buffer.from("\n%%EOF")]);
  const body = "供应商 A 您好：\n\n附件《询价单-RFQ-SUNNY-2026-AB12C.pdf》是本邮件询价清单的 PDF 版。\n" + "长句".repeat(200);
  const p: SendEmailParams = {
    to: "a@supplier.test",
    from: '"Fixture Purchasing" <project@fixture.test>',
    subject: "询价 RFQ-SUNNY-2026-AB12C（第 1 轮）",
    body,
    replyTo: "project@fixture.test",
    contentType: "text",
    attachments: [{ filename: "询价单-RFQ-SUNNY-2026-AB12C.pdf", mimeType: "application/pdf", data: pdf }],
  };
  const raw = buildRawEmail(p);
  const text = decode(raw);
  const m = text.match(/Content-Type: multipart\/mixed; boundary="([^"]+)"/);
  ok(!!m && m[1].startsWith("=_qy_"), "顶层为 multipart/mixed，分隔线以 =_qy_ 开头", text.slice(0, 400));
  const boundary = m?.[1] ?? "";
  const [head] = text.split("\r\n\r\n");
  ok(head.includes("Reply-To: project@fixture.test") && head.includes("MIME-Version: 1.0") && head.includes(`Subject: =?UTF-8?B?${Buffer.from(p.subject).toString("base64")}?=`), "头部保留回复地址与 RFC 2047 标题");
  ok(!/^Content-Transfer-Encoding/m.test(head), "顶层头部不写 Content-Transfer-Encoding");
  const parts = text.split(`--${boundary}`);
  ok(parts.length === 4 && parts[3].startsWith("--"), "正文一段 + 附件一段 + 结束分隔线", parts.length);
  const [bodyHead, bodyB64] = parts[1].replace(/^\r\n/, "").split("\r\n\r\n");
  ok(bodyHead.includes('Content-Type: text/plain; charset="UTF-8"') && bodyHead.includes("Content-Transfer-Encoding: base64"), "正文段为 text/plain UTF-8 base64");
  ok(Buffer.from(bodyB64.replace(/\r\n/g, ""), "base64").toString("utf8") === body, "正文段解码后与原正文相同");
  const [attHead, attB64] = parts[2].replace(/^\r\n/, "").split("\r\n\r\n");
  ok(attHead.includes("Content-Disposition: attachment;") && attHead.includes("filename*=UTF-8''%E8%AF%A2%E4%BB%B7%E5%8D%95-RFQ-SUNNY-2026-AB12C.pdf"), "附件 RFC 2231 文件名", attHead);
  const enc = `=?UTF-8?B?${Buffer.from("询价单-RFQ-SUNNY-2026-AB12C.pdf").toString("base64")}?=`;
  ok(attHead.includes(`filename="${enc}"`) && attHead.includes(`Content-Type: application/pdf; name="${enc}"`), "附件同时带 RFC 2047 编码的 filename 与 name", attHead);
  ok(Buffer.from(attB64.replace(/\r\n/g, ""), "base64").equals(pdf), "附件段解码后与原字节相同");
  const longest = Math.max(...text.split("\r\n").map((l) => l.length));
  ok(longest <= 998 && [bodyB64, attB64].every((b) => b.split("\r\n").every((l) => l.length <= 76)), "base64 每行不超过 76 个字符", longest);
  ok(parts.slice(1, 3).every((x) => !x.includes(boundary)), "分隔线不出现在任何一段内容里");
  ok(buildRawEmail(p) === raw, "同样的输入得到同样的原始邮件");
  ok(buildRawEmail({ ...p, attachments: [{ ...p.attachments![0], data: Buffer.concat([pdf, Buffer.from("x")]) }] }) !== raw, "附件字节不同则原始邮件不同");

  const ascii = decode(buildRawEmail({ ...p, attachments: [{ filename: "RFQ.pdf", mimeType: "application/pdf", data: pdf }] }));
  ok(ascii.includes('Content-Disposition: attachment; filename="RFQ.pdf"') && !ascii.includes("filename*="), "纯 ASCII 文件名直接写，不加 RFC 2231");
  const evil = decode(buildRawEmail({ ...p, attachments: [{ filename: 'a"\r\nBcc: x@evil.test\r\n.pdf', mimeType: "application/pdf\r\nX: y", data: pdf }] }));
  ok(!/^Bcc:/m.test(evil) && !/^X: y/m.test(evil), "文件名与类型里的换行与引号被去掉（不能注入头）");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
