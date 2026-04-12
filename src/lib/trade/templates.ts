/**
 * Trade 外贸获客 — 邮件模板服务
 *
 * 内置外贸常用邮件模板 + 自定义模板 CRUD
 */

import { db } from "@/lib/db";

export const TEMPLATE_CATEGORIES = {
  first_touch: "首次开发",
  follow_up: "跟进",
  after_quote: "报价后",
  after_sample: "样品后",
  re_engage: "重新激活",
  exhibition: "展会后",
} as const;

export type TemplateCategory = keyof typeof TEMPLATE_CATEGORIES;

export const BUILTIN_TEMPLATES: {
  name: string;
  category: TemplateCategory;
  language: string;
  subject: string;
  body: string;
  variables: string[];
}[] = [
  {
    name: "首次开发 — 通用英文",
    category: "first_touch",
    language: "en",
    subject: "{{companyName}} x {{senderCompany}} — Potential Collaboration",
    body: `Dear {{contactName}},

I came across {{companyName}} while researching leading companies in the {{industry}} sector, and I was impressed by your product range and market presence.

We are {{senderCompany}}, a manufacturer based in China specializing in {{productDesc}}. With over {{experience}} years of experience, we serve clients across {{markets}} with competitive pricing and reliable quality.

I believe there could be a great synergy between our companies. Would you be open to a brief call or email exchange to explore potential collaboration?

Looking forward to hearing from you.

Best regards,
{{senderName}}
{{senderCompany}}`,
    variables: ["companyName", "contactName", "industry", "senderCompany", "productDesc", "experience", "markets", "senderName"],
  },
  {
    name: "首次开发 — 通用中文",
    category: "first_touch",
    language: "zh",
    subject: "{{companyName}} x {{senderCompany}} — 合作探讨",
    body: `{{contactName}}，您好！

我们是{{senderCompany}}，专业从事{{productDesc}}的生产制造，工厂位于中国，拥有{{experience}}年行业经验。

在了解贵公司的业务后，我们认为双方在{{industry}}领域有很好的合作机会。我们的产品在{{markets}}市场有成熟的供应经验，价格有竞争力，质量可靠。

方便的话，是否可以安排一次简短的沟通？我们可以根据您的需求提供针对性的产品方案和报价。

期待您的回复！

{{senderName}}
{{senderCompany}}`,
    variables: ["companyName", "contactName", "senderCompany", "productDesc", "experience", "industry", "markets", "senderName"],
  },
  {
    name: "展会后跟进",
    category: "exhibition",
    language: "en",
    subject: "Great meeting you at {{exhibition}} — {{senderCompany}}",
    body: `Dear {{contactName}},

It was a pleasure meeting you at {{exhibition}}. Thank you for taking the time to visit our booth and learn about our {{productDesc}}.

As discussed, I'd like to follow up on the products you showed interest in. I've attached our latest catalog and price list for your reference.

Please let me know if you have any questions or if you'd like to receive samples. We'd be happy to arrange that for you.

Looking forward to working together!

Best regards,
{{senderName}}
{{senderCompany}}`,
    variables: ["contactName", "exhibition", "senderCompany", "productDesc", "senderName"],
  },
  {
    name: "报价后跟进",
    category: "after_quote",
    language: "en",
    subject: "Following up on our quotation — {{senderCompany}}",
    body: `Dear {{contactName}},

I hope this email finds you well. I wanted to follow up on the quotation we sent on {{quoteDate}} for {{productDesc}}.

Have you had a chance to review it? I'd be happy to discuss any questions you might have or adjust the proposal based on your specific requirements.

If the pricing or terms need any modification, please don't hesitate to let me know. We're flexible and committed to finding a solution that works for both of us.

Looking forward to your feedback.

Best regards,
{{senderName}}
{{senderCompany}}`,
    variables: ["contactName", "senderCompany", "quoteDate", "productDesc", "senderName"],
  },
  {
    name: "样品后跟进",
    category: "after_sample",
    language: "en",
    subject: "How are the samples? — {{senderCompany}}",
    body: `Dear {{contactName}},

I hope you've received the samples we sent. I wanted to check in and see if you've had a chance to review them.

We'd love to hear your feedback — whether it's about the quality, colors, specifications, or anything else. If any adjustments are needed, we can arrange new samples quickly.

Once you're satisfied, we can move forward with pricing for bulk orders and discuss delivery timelines.

Looking forward to hearing from you!

Best regards,
{{senderName}}
{{senderCompany}}`,
    variables: ["contactName", "senderCompany", "senderName"],
  },
  {
    name: "重新激活 — 长期未联系",
    category: "re_engage",
    language: "en",
    subject: "It's been a while — any new projects? — {{senderCompany}}",
    body: `Dear {{contactName}},

It's been a while since we last connected, and I wanted to reach out to see how things are going at {{companyName}}.

We've recently expanded our product line and improved our production capabilities. I thought you might be interested in our latest offerings, especially our new {{newProduct}}.

If you have any upcoming projects or sourcing needs, I'd be happy to provide updated pricing and samples.

Hope to reconnect soon!

Best regards,
{{senderName}}
{{senderCompany}}`,
    variables: ["contactName", "companyName", "senderCompany", "newProduct", "senderName"],
  },
];

// ── CRUD ────────────────────────────────────────────────────

export async function listTemplates(orgId: string, category?: string) {
  return db.tradeEmailTemplate.findMany({
    where: {
      orgId,
      ...(category ? { category } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { usageCount: "desc" }, { createdAt: "desc" }],
  });
}

export async function getTemplate(id: string) {
  return db.tradeEmailTemplate.findUnique({ where: { id } });
}

export async function createTemplate(data: {
  orgId: string;
  name: string;
  category: string;
  language?: string;
  subject: string;
  body: string;
  variables?: string[];
  createdById?: string;
}) {
  return db.tradeEmailTemplate.create({
    data: {
      ...data,
      variables: data.variables ?? [],
    },
  });
}

export async function updateTemplate(
  id: string,
  data: { name?: string; subject?: string; body?: string; language?: string; variables?: string[] },
) {
  return db.tradeEmailTemplate.update({ where: { id }, data });
}

export async function deleteTemplate(id: string) {
  return db.tradeEmailTemplate.delete({ where: { id } });
}

export async function incrementUsage(id: string) {
  return db.tradeEmailTemplate.update({
    where: { id },
    data: { usageCount: { increment: 1 } },
  });
}

export async function seedDefaultTemplates(orgId: string) {
  const existing = await db.tradeEmailTemplate.count({ where: { orgId, isDefault: true } });
  if (existing > 0) return { seeded: 0 };

  let count = 0;
  for (const t of BUILTIN_TEMPLATES) {
    await db.tradeEmailTemplate.create({
      data: {
        orgId,
        name: t.name,
        category: t.category,
        language: t.language,
        subject: t.subject,
        body: t.body,
        variables: t.variables,
        isDefault: true,
      },
    });
    count++;
  }
  return { seeded: count };
}
