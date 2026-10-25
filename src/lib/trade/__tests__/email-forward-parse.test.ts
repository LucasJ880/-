/**
 * 邮件转发询盘解析（PRD F1.2）— 纯函数，无 DB / 网络
 *   Gmail / Outlook / Apple / QQ 转发头拆解、转发套转发、回复链、平台询盘通知（Alibaba.com / Made-in-China 一类）、
 *   官网内部询盘通知（Inquiry ID / eventId）、无转发头的业务员手写、HTML 正文、签名与引用剥离、置信度；
 *   不变量：转发人（及白名单、同企业域名、系统 / 平台地址）永远不会被当成买家；业务员手写内容里转发人自己的签名
 *   电话（没有 "--" / 结束语也一样）不会被当成买家电话；病态输入（无 @ 长串、未闭合标签）线性时间。
 * 运行：npx tsx src/lib/trade/__tests__/email-forward-parse.test.ts
 *
 * 公开仓库：只用虚构企业与保留域名（.example）。
 */
import assert from "node:assert/strict";
import {
  bareAddress,
  displayName,
  htmlToText,
  parseForwardedEmail,
  senderAddress,
  stripSubjectPrefixes,
  type ForwardedEmailInput,
} from "../email-forward-parse";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const FACTORY = "exampletextiles.example";
const parse = (input: ForwardedEmailInput) => parseForwardedEmail({ excludeDomains: ["in.qingyan.example"], ...input });

console.log("email-forward-parse");

const GMAIL_FWD = `Hi team, please follow up with this buyer.

Lily

---------- Forwarded message ---------
From: Jane Doe <jane.doe@maplehomegoods.example>
Date: Mon, Oct 20, 2026 at 9:15 AM
Subject: RFQ: 550gsm cotton bath towels
To: <lily@${FACTORY}>


Hello Lily,

We are looking for 550gsm 100% cotton bath towels, 70x140cm, 3 colors.
Estimated quantity 5,000 pcs for the first order, delivery to Toronto.
Please send your best FOB price and lead time.

Best regards,
Jane Doe
Purchasing Manager
Maple Home Goods Inc.
Tel: +1 416 555 0134
www.maplehomegoods.example

On Fri, Oct 17, 2026 at 3:02 PM Lily Chen <lily@${FACTORY}> wrote:
> Dear Jane, thanks for visiting our booth at the fair.
> Attached is our catalog.
`;

ok("Gmail 转发：买家取原发件人，签名里的公司 / 电话取出后从正文去掉，引用的历史回复去掉", () => {
  const p = parse({ from: `Lily Chen <lily@${FACTORY}>`, subject: "Fwd: RFQ: 550gsm cotton bath towels", text: GMAIL_FWD });
  assert.equal(p.format, "gmail_forward");
  assert.equal(p.forwardFormat, "gmail_forward");
  assert.equal(p.platform, null);
  assert.equal(p.buyer.email, "jane.doe@maplehomegoods.example");
  assert.equal(p.buyer.name, "Jane Doe");
  assert.equal(p.buyer.company, "Maple Home Goods Inc.");
  assert.equal(p.buyer.phone, "+1 416 555 0134");
  assert.equal(p.originalSubject, "RFQ: 550gsm cotton bath towels");
  assert.equal(p.originalFrom, "jane.doe@maplehomegoods.example");
  assert.match(p.originalDate, /Oct 20, 2026/);
  assert.match(p.message, /550gsm 100% cotton bath towels/);
  assert.match(p.message, /best FOB price and lead time/);
  assert.doesNotMatch(p.message, /Best regards|Purchasing Manager|Tel:|thanks for visiting|please follow up/);
  assert.ok(p.confidence >= 0.8, String(p.confidence));
});

const OUTLOOK_FWD = `FYI - new customer, please quote.

Kevin Wu
Example Textiles Co., Ltd.
Tel: +86 574 0000 1111

________________________________
From: Lucas Martin <lucas@nordichotelsupply.example>
Sent: Tuesday, October 21, 2026 10:42 PM
To: Kevin Wu <kevin@${FACTORY}>
Subject: Hotel bathrobe inquiry

Dear Kevin,

Our hotel group needs 1200 waffle bathrobes (white, L/XL) with embroidered logo.
Can you share MOQ and sample cost?

Thanks,
Lucas Martin
Nordic Hotel Supply Ltd
+46 8 555 010 20
`;

ok("Outlook 转发：From/Sent/To/Subject 块；转发人自己的签名（工厂电话）不进买家信息", () => {
  const p = parse({ from: `Kevin Wu <kevin@${FACTORY}>`, subject: "FW: Hotel bathrobe inquiry", text: OUTLOOK_FWD });
  assert.equal(p.format, "outlook_forward");
  assert.equal(p.buyer.email, "lucas@nordichotelsupply.example");
  assert.equal(p.buyer.name, "Lucas Martin");
  assert.equal(p.buyer.company, "Nordic Hotel Supply Ltd");
  assert.equal(p.buyer.phone, "+46 8 555 010 20");
  assert.notEqual(p.buyer.phone, "+86 574 0000 1111");
  assert.equal(p.originalSubject, "Hotel bathrobe inquiry");
  assert.match(p.message, /1200 waffle bathrobes/);
  assert.doesNotMatch(p.message, /FYI|Nordic Hotel Supply Ltd|\+46/);
});

ok("老式 Outlook：-----Original Message----- + From: Name [mailto:addr]", () => {
  const text = `Please handle.

-----Original Message-----
From: Sara Example [mailto:sara@examplebedding.example]
Sent: Monday, October 20, 2026 8:00 AM
To: sales@${FACTORY}
Subject: Duvet cover RFQ

Hi, please quote 600 sateen duvet covers, queen size.
Sara`;
  const p = parse({ from: `sales@${FACTORY}`, text });
  assert.equal(p.format, "outlook_forward");
  assert.equal(p.buyer.email, "sara@examplebedding.example");
  assert.equal(p.buyer.name, "Sara Example");
  assert.match(p.message, /600 sateen duvet covers/);
});

ok("Apple Mail 转发（Begin forwarded message:，标记与头之间有空行）", () => {
  const text = `Begin forwarded message:

From: Jane Doe <jane.doe@maplehomegoods.example>
Subject: Sample request
Date: October 20, 2026 at 9:15:00 AM EDT
To: Lily Chen <lily@${FACTORY}>

Could you send 3 towel samples in navy and grey?
Jane`;
  const p = parse({ from: `lily@${FACTORY}`, text });
  assert.equal(p.format, "apple_forward");
  assert.equal(p.buyer.email, "jane.doe@maplehomegoods.example");
  assert.match(p.message, /3 towel samples/);
});

ok("QQ / Foxmail 中文转发头（原始邮件 / 发件人 / 发送时间 / 收件人 / 主题）", () => {
  const text = `请跟进

------------------ 原始邮件 ------------------
发件人: "Jane Doe" <jane.doe@maplehomegoods.example>
发送时间: 2026年10月20日(星期一) 上午9:15
收件人: "销售" <sales@${FACTORY}>
主题: 询价 毛巾

Hello, we need 2000 hand towels, please quote.`;
  const p = parse({ from: `sales@${FACTORY}`, text });
  assert.equal(p.format, "outlook_forward");
  assert.equal(p.buyer.email, "jane.doe@maplehomegoods.example");
  assert.equal(p.originalSubject, "询价 毛巾");
  assert.match(p.message, /2000 hand towels/);
  assert.doesNotMatch(p.message, /请跟进/);
});

ok("回复链：转发的最上面一封是本厂业务员的回复 → 往下找到买家那封；不含业务员的回复", () => {
  const text = `---------- Forwarded message ---------
From: Kevin Wu <kevin@${FACTORY}>
Date: Thu, Oct 23, 2026 at 11:00 AM
Subject: RE: Quote request - kitchen towels
To: Olivia Example <olivia@examplekitchen.example>

Hi Olivia, noted, we will send the quote tomorrow.

Kevin

From: Olivia Example <olivia@examplekitchen.example>
Sent: Wednesday, October 22, 2026 6:30 PM
To: Kevin Wu <kevin@${FACTORY}>
Subject: Quote request - kitchen towels

Hi Kevin,
Please quote 10,000 cotton kitchen towels 50x70cm, striped.
Regards,
Olivia
Example Kitchen Supplies Ltd`;
  const p = parse({ from: `Kevin Wu <kevin@${FACTORY}>`, subject: "Fwd: RE: Quote request - kitchen towels", text });
  assert.equal(p.format, "gmail_forward");
  assert.equal(p.buyer.email, "olivia@examplekitchen.example");
  assert.equal(p.buyer.name, "Olivia Example");
  assert.equal(p.buyer.company, "Example Kitchen Supplies Ltd");
  assert.equal(p.originalSubject, "Quote request - kitchen towels");
  assert.match(p.message, /10,000 cotton kitchen towels/);
  assert.doesNotMatch(p.message, /we will send the quote tomorrow/);
});

ok("转发套转发：同事转给业务员、业务员再转进来 → 跳过两层同事，取买家", () => {
  const text = `---------- Forwarded message ---------
From: Anna Li <anna@${FACTORY}>
Date: Tue, Oct 21, 2026 at 2:00 PM
Subject: Fwd: Blanket order
To: <lily@${FACTORY}>

Lily, this one is for you.

---------- Forwarded message ---------
From: Ben Example <ben@examplefurnishings.example>
Date: Tue, Oct 21, 2026 at 1:00 PM
Subject: Blanket order
To: <anna@${FACTORY}>

We would like 3000 flannel fleece blankets 150x200cm.`;
  const p = parse({ from: `lily@${FACTORY}`, text });
  assert.equal(p.buyer.email, "ben@examplefurnishings.example");
  assert.equal(p.originalSubject, "Blanket order");
  assert.match(p.message, /3000 flannel fleece blankets/);
  assert.doesNotMatch(p.message, /this one is for you/);
});

const ALIBABA_FWD = `---------- Forwarded message ---------
From: Alibaba.com <notice@service.alibaba.com>
Date: Wed, Oct 22, 2026 at 8:01 AM
Subject: You have a new inquiry about Microfiber Bed Sheet Set
To: <sales@${FACTORY}>

Dear Supplier,

You have received a new inquiry from a buyer.

Buyer Name: Ahmed Example
Company: Example Trading LLC
Country/Region: United Arab Emirates
Product: Microfiber Bed Sheet Set
Quantity: 3000 Sets
Inquiry ID: 20261022-778899

Message:
Hi, we need microfiber bed sheet sets in queen and king sizes, 90gsm, printed. Please quote CIF Jebel Ali.

Reply to this inquiry on Alibaba.com.
Alibaba.com Singapore E-Commerce Private Limited
`;

ok("平台询盘通知（Alibaba.com 一类）：买家名 / 公司 / 国家 / 产品 / 数量 / 平台编号；平台地址不当买家；平台隐藏邮箱时买家邮箱为空", () => {
  const p = parse({ from: `sales@${FACTORY}`, subject: "Fwd: You have a new inquiry about Microfiber Bed Sheet Set", text: ALIBABA_FWD });
  assert.equal(p.format, "platform_notification");
  assert.equal(p.forwardFormat, "gmail_forward");
  assert.equal(p.platform, "alibaba");
  assert.equal(p.buyer.name, "Ahmed Example");
  assert.equal(p.buyer.company, "Example Trading LLC");
  assert.equal(p.buyer.country, "United Arab Emirates");
  assert.equal(p.buyer.email, "");
  assert.equal(p.buyer.phone, "");
  assert.equal(p.product, "Microfiber Bed Sheet Set");
  assert.equal(p.quantity, "3000 Sets");
  assert.equal(p.platformInquiryId, "20261022-778899");
  assert.equal(p.websiteInquiryId, "");
  assert.match(p.message, /microfiber bed sheet sets in queen and king sizes/);
  assert.match(p.message, /Quantity: 3000 Sets/);
  assert.doesNotMatch(p.message, /Reply to this inquiry|Private Limited/);
  assert.ok(p.signals.includes("platform:alibaba:sender"));
  assert.ok(p.confidence < 0.8, `no contact → lower confidence (${p.confidence})`);
});

ok("平台通知直接自动转发（无转发头，发件人是平台地址）：Made-in-China 一类，带买家邮箱 / 电话 / 编号", () => {
  const text = `New Inquiry from Made-in-China.com

From: Maria Example
Company Name: Example Hospitality S.A.
Country: Spain
E-mail: maria@examplehospitality.example
Tel: +34 600 000 111
Product Name: Hotel Towels
Purchase Quantity: 2,000 Pieces
Inquiry No.: MIC-55667788
Content: We need white hotel towels 600gsm with dobby border. Please send your catalog.

Please reply within 24 hours. This email was sent by Made-in-China.com.`;
  const p = parse({ from: "Made-in-China.com <inquiry@made-in-china.com>", subject: "Inquiry from Maria Example: Hotel Towels", text });
  assert.equal(p.format, "platform_notification");
  assert.equal(p.platform, "made_in_china");
  assert.equal(p.buyer.email, "maria@examplehospitality.example");
  assert.equal(p.buyer.name, "Maria Example");
  assert.equal(p.buyer.company, "Example Hospitality S.A.");
  assert.equal(p.buyer.phone, "+34 600 000 111");
  assert.equal(p.product, "Hotel Towels");
  assert.equal(p.quantity, "2,000 Pieces");
  assert.equal(p.platformInquiryId, "MIC-55667788");
  assert.match(p.message, /600gsm with dobby border/);
  assert.ok(p.confidence >= 0.8, String(p.confidence));
});

const WEBSITE_NOTICE = `---------- Forwarded message ---------
From: Example Textiles Website <website@${FACTORY}>
Date: Mon, Oct 20, 2026 at 9:16 AM
Subject: New Website Inquiry - Bath Towels - Maple Home Goods
To: <sales@${FACTORY}>

New inquiry submitted from Example Textiles website.

Name: Jane Doe
Company: Maple Home Goods
Email: jane.doe@maplehomegoods.example
WhatsApp / Phone: +1 416 555 0134
Country / Region: Canada

Product Interest: Bath Towels
Order Type: OEM
Estimated Quantity: 5000 pcs
Target Market: Canada

Message:
We need 550gsm bath towels in 3 colors, please quote FOB Ningbo.

Inquiry Source: Contact page
Source Page: https://www.exampletextiles.example/contact
UTM: utm_source=google
Inquiry ID / eventId: inq_2026_10_20_0001

Submitted At:
2026-10-20T09:15:00Z`;

ok("官网内部询盘通知被转发：识别官网询盘编号（双重入站判定用），买家取正文字段，不取网站发件地址", () => {
  const p = parse({ from: `sales@${FACTORY}`, subject: "Fwd: New Website Inquiry - Bath Towels - Maple Home Goods", text: WEBSITE_NOTICE });
  assert.equal(p.format, "website_notification");
  assert.equal(p.websiteInquiryId, "inq_2026_10_20_0001");
  assert.equal(p.platformInquiryId, "");
  assert.equal(p.buyer.email, "jane.doe@maplehomegoods.example");
  assert.equal(p.buyer.name, "Jane Doe");
  assert.equal(p.buyer.phone, "+1 416 555 0134");
  assert.equal(p.buyer.country, "Canada");
  assert.equal(p.product, "Bath Towels");
  assert.equal(p.quantity, "5000 pcs");
  assert.match(p.message, /^We need 550gsm bath towels in 3 colors, please quote FOB Ningbo\./);
  assert.doesNotMatch(p.message, /Inquiry Source|Source Page|UTM|eventId/);
});

ok("官网通知只有 HTML（表格 + 单独成行的 Message 标题）也能取出字段与留言", () => {
  const html = `<div><p>New inquiry submitted from <strong>Example Textiles</strong> website.</p>
<table><tr><td><strong>Name</strong></td><td>Jane Doe</td></tr>
<tr><td><strong>Email</strong></td><td>jane.doe@maplehomegoods.example</td></tr>
<tr><td><strong>Country / Region</strong></td><td>Canada</td></tr>
<tr><td><strong>Inquiry ID / eventId</strong></td><td>inq_2026_10_20_0002</td></tr></table>
<p><strong>Message</strong></p><div>Please quote 800 bath sheets &amp; 800 hand towels.</div>
<p>Inquiry Source: Contact page<br/>Submitted At: 2026-10-20</p></div>`;
  const p = parse({ from: "Example Textiles Website <noreply@exampletextiles-site.example>", subject: "New Website Inquiry", html });
  assert.equal(p.format, "website_notification");
  assert.equal(p.websiteInquiryId, "inq_2026_10_20_0002");
  assert.equal(p.buyer.email, "jane.doe@maplehomegoods.example");
  assert.equal(p.buyer.country, "Canada");
  assert.equal(p.message, "Please quote 800 bath sheets & 800 hand towels.");
  assert.ok(p.signals.includes("body:html"));
});

ok("Gmail 转发只有 HTML（&lt;addr&gt; 实体）", () => {
  const html = `<div dir="ltr">see below<br><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <strong class="gmail_sendername">Jane Doe</strong> <span>&lt;jane.doe@maplehomegoods.example&gt;</span><br>Date: Mon, Oct 20, 2026 at 9:15 AM<br>Subject: Towel samples<br>To: &lt;lily@${FACTORY}&gt;<br></div><br><br><div dir="ltr">Hello, please send 2 samples of the 600gsm towel.<br></div></div></div>`;
  const p = parse({ from: `lily@${FACTORY}`, html });
  assert.equal(p.format, "gmail_forward");
  assert.equal(p.buyer.email, "jane.doe@maplehomegoods.example");
  assert.equal(p.buyer.name, "Jane Doe");
  assert.match(p.message, /2 samples of the 600gsm towel/);
});

ok("无转发头（业务员手写客户信息）：买家取正文标签；业务员签名里的公司 / 电话不当买家信息", () => {
  const text = `Customer called us, please follow up:
Name: Tom Example
Email: tom@examplebuyer.example
Phone: +61 2 5550 1234
He wants 800 linen duvet covers, king size.

Thanks
Lily Chen
Example Textiles Co., Ltd.
Tel: +86 574 0000 2222`;
  const p = parse({ from: `Lily Chen <lily@${FACTORY}>`, subject: "New lead", text });
  assert.equal(p.format, "plain");
  assert.equal(p.buyer.email, "tom@examplebuyer.example");
  assert.equal(p.buyer.name, "Tom Example");
  assert.equal(p.buyer.phone, "+61 2 5550 1234");
  assert.equal(p.buyer.company, "");
  assert.match(p.message, /800 linen duvet covers/);
  assert.doesNotMatch(p.message, /\+86 574|Example Textiles Co/);
});

ok("无转发头且没有买家联系方式：买家为空，转发人永不入选；签名里没有分隔符时按转发人显示名截断", () => {
  const text = `Please check this customer, he wants towels for his hotels.

Lily Chen
Sales Manager
Tel: +86 574 0000 2222
lily@${FACTORY}`;
  const p = parse({ from: `Lily Chen <lily@${FACTORY}>`, subject: "towels", text });
  assert.equal(p.format, "plain");
  assert.equal(p.buyer.email, "");
  assert.equal(p.buyer.phone, "");
  assert.equal(p.buyer.name, "");
  assert.doesNotMatch(p.message, /\+86|Sales Manager/);
  assert.ok(p.confidence <= 0.3, String(p.confidence));
});

ok("不变量：转发人 / 白名单同事 / 询盘收信域 / no-reply 永远不是买家（免费邮箱转发人的同域地址不算同事）", () => {
  // 转发人用免费邮箱，被转发的是白名单里另一个免费邮箱同事发出的邮件 → 不选同事；正文里的买家邮箱入选
  const text = `---------- Forwarded message ---------
From: Assistant Example <assistant.example@gmail.com>
Date: Mon, Oct 20, 2026 at 9:15 AM
Subject: buyer details
To: <boss.example@gmail.com>

Buyer: buyer.contact@gmail.com wants 500 pillows. Reply to noreply@examplecrm.example is useless.
Also cc inq-abcdefghij@in.qingyan.example`;
  const p = parse({ from: "boss.example@gmail.com", text, excludeAddresses: ["assistant.example@gmail.com"] });
  assert.equal(p.buyer.email, "buyer.contact@gmail.com");
  for (const bad of ["boss.example@gmail.com", "assistant.example@gmail.com", "noreply@examplecrm.example", "inq-abcdefghij@in.qingyan.example"]) {
    assert.notEqual(p.buyer.email, bad);
  }
  // 业务员转发自己发给买家的邮件（链里全是本厂地址）：To 头里的买家不猜，正文没有就为空
  const own = `---------- Forwarded message ---------
From: Lily Chen <lily@${FACTORY}>
Date: Mon, Oct 20, 2026 at 9:15 AM
Subject: Our catalog
To: Jane Doe <jane.doe@maplehomegoods.example>

Dear Jane, attached is our catalog.`;
  const q = parse({ from: `lily@${FACTORY}`, text: own });
  assert.notEqual(q.buyer.email, `lily@${FACTORY}`);
  assert.equal(q.buyer.email, "");
});

ok("转发头与正文之间没有空行：正文不会被当成折行的收件人吞掉；地址折行仍能接上", () => {
  const text = `________________________________
From: Lucas Martin <lucas@nordichotelsupply.example>
Sent: Tuesday, October 21, 2026 10:42 PM
To: Kevin Wu <kevin@${FACTORY}>,
 Anna Li <anna@${FACTORY}>
Subject: Bathrobes
Hi Kevin,
We need 1200 waffle bathrobes.`;
  const p = parse({ from: `kevin@${FACTORY}`, text });
  assert.equal(p.buyer.email, "lucas@nordichotelsupply.example");
  assert.match(p.message, /^Hi Kevin,\nWe need 1200 waffle bathrobes\.$/);
});

ok("被转发邮件整体带 > 引用前缀时先去掉一层再解析", () => {
  const text = `fyi

---------- Forwarded message ---------
From: Jane Doe <jane.doe@maplehomegoods.example>
Date: Mon, Oct 20, 2026 at 9:15 AM
Subject: Beach towels
To: <lily@${FACTORY}>

> Hi Lily,
> We need 4000 printed beach towels.
> Jane`;
  const p = parse({ from: `lily@${FACTORY}`, text });
  assert.equal(p.buyer.email, "jane.doe@maplehomegoods.example");
  assert.match(p.message, /4000 printed beach towels/);
});

ok("工具函数：地址 / 显示名 / 主题前缀 / HTML 转文本", () => {
  assert.equal(bareAddress('"Smith, Jane" <Jane.Smith@Example.COM>'), "jane.smith@example.com");
  assert.equal(bareAddress("Jane [mailto:jane@example.com]"), "jane@example.com");
  assert.equal(bareAddress("not an address"), "");
  assert.equal(displayName('"Smith, Jane" <jane@example.com>'), "Smith, Jane");
  assert.equal(stripSubjectPrefixes("Fwd: FW: Re: 转发: Hello"), "Hello");
  assert.equal(stripSubjectPrefixes("[Fwd] RFQ"), "RFQ");
  const t = htmlToText("<style>p{}</style><p>A &amp; B</p><table><tr><td>Name</td><td>Jane</td></tr></table><script>x()</script>");
  assert.equal(t.replace(/\n+/g, "\n"), "A & B\nName\tJane");
  assert.doesNotMatch(t, /p\{\}|x\(\)/);
});

ok("业务员手写 + 没有 \"--\" / 结束语的签名：转发人的手机号永不当买家电话（英文 / 中文 / 不空行 / 地址 / 口号行）", () => {
  const from = `Lily Chen <lily@${FACTORY}>`;
  const notes = [
    `New buyer: John Smith, john@exampleretail.example, needs 500 towels\nLily | Sales Manager\nExample Textiles Co., Ltd.\nMobile: +86 138 0000 0000`,
    `New buyer: John Smith, john@exampleretail.example, needs 500 towels\n\nLily | Sales Manager\nExample Textiles Co., Ltd.\nMobile: +86 138 0000 0000`,
    `新客户：John Smith，john@exampleretail.example，要 500 条毛巾\n\n李丽\n销售经理\n示例纺织有限公司\n手机：138 0000 0000`,
    `New buyer: John Smith, john@exampleretail.example\n\nLily Chen\nSales Manager\nExample Textiles Co., Ltd.\nNo. 88 Example Road, Ningbo 315000, China\nMobile: +86 138 0000 0000\nwww.exampletextiles.example`,
    `New buyer: John Smith, john@exampleretail.example, needs 500 towels\n\nLily\nQuality first and on time delivery always\nMobile: +86 138 0000 0000`,
  ];
  for (const text of notes) {
    const p = parse({ from, subject: "New lead", text });
    assert.equal(p.buyer.email, "john@exampleretail.example", text);
    assert.equal(p.buyer.phone, "", `staff mobile must not become buyer phone: ${text}`);
    assert.equal(p.senderKind, "staff");
  }
  const first = parse({ from, text: notes[0] });
  assert.equal(first.message, "New buyer: John Smith, john@exampleretail.example, needs 500 towels");
  assert.ok(first.signals.includes("staff_signature"));
  // 另一个买家（新域名、没有公司）也不会拿到同一个员工号码 → Revenue Spine 不会按电话把两个买家并到一起
  const maria = parse({ from, text: `New buyer Maria, maria@examplecasa.example, wants 300 bath sheets\nLily | Sales Manager\nExample Textiles Co., Ltd.\nMobile: +86 138 0000 0000` });
  assert.equal(maria.buyer.email, "maria@examplecasa.example");
  assert.equal(maria.buyer.phone, "");
  // 只有买家名 / 公司 + 员工签名电话：没有买家联系方式（上游按 no_buyer_contact 隔离）
  const nameOnly = parse({ from, text: `Buyer: Maria Example\nCompany: Example Casa\n\nLily Chen | Sales Manager\nExample Textiles Co., Ltd.\n\nMobile: +86 138 0000 0000\nWeChat: lily_example` });
  assert.equal(nameOnly.buyer.name, "Maria Example");
  assert.equal(nameOnly.buyer.email, "");
  assert.equal(nameOnly.buyer.phone, "");
});

ok("业务员手写：买家标签块里的电话照常取（紧挨买家姓名 / 邮箱标签，或标签点明是客户电话）；签名紧跟其后也不误伤", () => {
  const from = `Lily Chen <lily@${FACTORY}>`;
  const block = parse({ from, text: `Customer called:\nName: Tom Example\nEmail: tom@examplebuyer.example\nPhone: +61 2 5550 1234\nLily\nExample Textiles Co., Ltd.\nTel: +86 574 0000 2222` });
  assert.equal(block.buyer.email, "tom@examplebuyer.example");
  assert.equal(block.buyer.phone, "+61 2 5550 1234");
  assert.doesNotMatch(block.message, /\+86|Example Textiles Co/);
  const whatsapp = parse({ from, text: `Buyer: Omar Example\nWhatsApp: +971 50 000 1234\nwants 2000 towels\n\nLily\nExample Textiles Co., Ltd.\nMobile: +86 138 0000 0000` });
  assert.equal(whatsapp.buyer.phone, "+971 50 000 1234");
  assert.equal(whatsapp.buyer.name, "Omar Example");
  const labeled = parse({ from, text: `Met at the fair, wants 800 duvet covers.\nCustomer phone: +49 30 5550 1234\n\nLily | Sales Manager\nMobile: +86 138 0000 0000` });
  assert.equal(labeled.buyer.phone, "+49 30 5550 1234");
  // 买家标签块里写的号码恰好等于签名里的号码（业务员误填自己的）：不取
  const same = parse({ from, text: `Name: Tom Example\nPhone: +86 138 0000 0000\n\nLily\nExample Textiles Co., Ltd.\nMobile: +86 138 0000 0000` });
  assert.equal(same.buyer.phone, "");
});

ok("发件人类别 senderKind：买家 / 本厂（含无转发头）/ 平台 / 系统；买家来信里的「RFQ No.」不当官网询盘编号", () => {
  assert.equal(parse({ from: `Lily Chen <lily@${FACTORY}>`, text: GMAIL_FWD }).senderKind, "buyer");
  assert.equal(parse({ from: `sales@${FACTORY}`, text: ALIBABA_FWD }).senderKind, "platform");
  assert.equal(parse({ from: `sales@${FACTORY}`, text: WEBSITE_NOTICE }).senderKind, "staff");
  assert.equal(parse({ from: `lily@${FACTORY}`, text: "Name: Tom\nEmail: tom@examplebuyer.example" }).senderKind, "staff");
  const sys = parse({ from: `lily@${FACTORY}`, text: `---------- Forwarded message ---------\nFrom: Site <noreply@sitebuilder.example>\nDate: Mon\nSubject: New inquiry\nTo: <lily@${FACTORY}>\n\nEmail: jane@maple.example` });
  assert.equal(sys.senderKind, "system");
  const rfq = parse({ from: `lily@${FACTORY}`, text: `---------- Forwarded message ---------\nFrom: Bob <bob@examplebuyer.example>\nDate: Mon\nSubject: RFQ\nTo: <lily@${FACTORY}>\n\nRFQ No.: 1523\nInquiry No.: 1524\nPlease quote 5000 bath towels.` });
  assert.equal(rfq.websiteInquiryId, "");
  assert.equal(rfq.format, "gmail_forward");
});

ok("地址：引号里的显示名藏着别的地址时取显示名之后的真实地址；严格版对多地址 / 未闭合引号返回空", () => {
  assert.equal(bareAddress('"<lily@exampletextiles.example>" <mallory@evil.example>'), "mallory@evil.example");
  assert.equal(bareAddress('"lily@exampletextiles.example" <mallory@evil.example>'), "mallory@evil.example");
  assert.equal(bareAddress("Jane (Sales <jane@x.example>) <real@maple.example>"), "real@maple.example");
  assert.equal(bareAddress('"Jane <jane@maple.example>'), "jane@maple.example");
  assert.equal(senderAddress('"Jane <jane@maple.example>'), "");
  assert.equal(senderAddress("a@x.example, b@y.example"), "");
  assert.equal(senderAddress("Jane Doe <Jane@Maple.example>"), "jane@maple.example");
  assert.equal(senderAddress("jane@maple.example"), "jane@maple.example");
  assert.equal(senderAddress("Jane [mailto:jane@maple.example]"), "jane@maple.example");
});

ok("HTML：任意长度的标签（内联 data: URI 图片）整段去掉，不把 base64 填进留言", () => {
  const html = `<div>We need 500 towels.</div><img src="data:image/png;base64,${"iVBORw0KGgo".repeat(500)}" alt="logo"><div>Thanks</div>`;
  assert.equal(htmlToText(html).replace(/\n+/g, "\n"), "We need 500 towels.\nThanks");
  const p = parse({ from: `lily@${FACTORY}`, html: `---------- Forwarded message ---------<br>From: Jane Doe &lt;jane.doe@maplehomegoods.example&gt;<br>Date: Mon<br>Subject: RFQ<br>To: &lt;lily@${FACTORY}&gt;<br><br><div>We need 500 towels.</div>${html}` });
  assert.doesNotMatch(p.message, /base64|iVBOR/);
  assert.equal(htmlToText("a < b and c > d"), "a < b and c > d");
  assert.equal(htmlToText("x <!-- unterminated comment"), "x");
});

ok("病态输入不会回溯成平方级：20 万个无 @ 的字符、未闭合注释 / 标签 / style、长点号串都在 1 s 内", () => {
  const cases: ForwardedEmailInput[] = [
    { from: `lily@${FACTORY}`, text: "a".repeat(199_000) },
    { from: `lily@${FACTORY}`, html: "a".repeat(199_000) },
    { from: `lily@${FACTORY}`, html: "<!--".repeat(49_000) },
    { from: `lily@${FACTORY}`, html: "<p".repeat(99_000) },
    { from: `lily@${FACTORY}`, html: "<style>".repeat(28_000) },
    { from: `lily@${FACTORY}`, html: `<a href="${"x".repeat(199_000)}` },
    { from: `lily@${FACTORY}`, text: `${"a.".repeat(99_000)}@` },
    { from: `lily@${FACTORY}`, text: `x@${"b".repeat(70)} `.repeat(2_700) },
    { from: `lily@${FACTORY}`, text: `${"于".repeat(300)}\n`.repeat(600) },
  ];
  for (const input of cases) {
    const started = Date.now();
    parse(input);
    const ms = Date.now() - started;
    assert.ok(ms < 1000, `${(input.text ?? input.html ?? "").slice(0, 12)}… took ${ms} ms`);
  }
});

ok("超长输入不会拖垮解析（截断到上限）", () => {
  const big = `From: x\n${"lorem ipsum dolor sit amet ".repeat(20000)}`;
  const started = Date.now();
  const p = parse({ from: `lily@${FACTORY}`, text: big });
  assert.ok(Date.now() - started < 2000, "parse under 2 s");
  assert.ok(p.message.length <= 4000);
});

ok("短邮件开头的结束语（Thanks! / Thank you / 谢谢）后面还有正文时不是签名起点：正文与买家联系方式不丢", () => {
  const fwd = parse({
    from: `Lily Chen <lily@${FACTORY}>`,
    subject: "Fwd: towels",
    text: `FYI\n\n---------- Forwarded message ---------\nFrom: Jane Doe <jane.doe@maplehomegoods.example>\nDate: Mon, Oct 20, 2026 at 9:15 AM\nSubject: towels\nTo: <lily@${FACTORY}>\n\nHello Lily,\nThanks!\nWe would like to order 500 pcs bath towels, 70x140cm.\nPlease send price and lead time.\nPhone: +1 416 555 0134\nJane`,
  });
  assert.match(fwd.message, /500 pcs bath towels/);
  assert.match(fwd.message, /price and lead time/);
  const notice = parse({
    from: `Lily Chen <lily@${FACTORY}>`,
    subject: "Fwd: New inquiry from Alibaba.com",
    text: `---------- Forwarded message ---------\nFrom: Alibaba.com <notice@service.alibaba.com>\nDate: Mon, Oct 20, 2026\nSubject: New inquiry from Alibaba.com\nTo: <lily@${FACTORY}>\n\nYou have a new inquiry on Alibaba.com\nBuyer: Jane Doe\nProduct: Bath towel\nMessage:\nHello,\nThank you\nWe need 500 pcs bath towels, please quote FOB.\nReply to this inquiry`,
  });
  assert.equal(notice.format, "platform_notification");
  assert.match(notice.message, /please quote FOB/);
  const note = parse({
    from: `Lily Chen <lily@${FACTORY}>`,
    subject: "lead",
    text: `Hi team,\nThanks\nBuyer Jane (jane.doe@maplehomegoods.example) needs 300 duvet covers, queen size.\nLily`,
  });
  assert.equal(note.buyer.email, "jane.doe@maplehomegoods.example");
  assert.match(note.message, /300 duvet covers/);
  // 真正的落款（其后只剩签名 / 手机落款）照旧切掉
  const signed = parse({
    from: `Lily Chen <lily@${FACTORY}>`,
    subject: "Fwd: towels",
    text: `---------- Forwarded message ---------\nFrom: Jane Doe <jane.doe@maplehomegoods.example>\nDate: Mon, Oct 20, 2026\nSubject: towels\nTo: <lily@${FACTORY}>\n\nWe need 500 pcs bath towels, please quote.\n\nBest regards,\nJane Doe\nMaple Home Goods Inc.\nSent from my iPhone`,
  });
  assert.equal(signed.message, "We need 500 pcs bath towels, please quote.");
  assert.equal(signed.buyer.company, "Maple Home Goods Inc.");
});

console.log(`\nemail-forward-parse: ${pass} 通过`);
