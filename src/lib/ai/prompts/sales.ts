/**
 * 青砚 AI 提示词 — 销售沟通类（询价邮件、催促邮件、项目问题邮件）
 */

import type {
  EmailDraftContext,
  FollowupEmailContext,
  ProjectQuestionEmailContext,
} from "./types";

// ── 邮件草稿生成提示词 ──────────────────────────────────────

export function getEmailDraftPrompt(ctx: EmailDraftContext): string {
  const lines: string[] = [
    `你是"青砚"邮件草稿助手。根据以下项目和供应商信息，生成一封专业的中文商务询价邮件草稿。`,
    "",
    "## 项目信息",
    `- 项目名称: ${ctx.project.name}`,
  ];

  if (ctx.project.clientOrganization) {
    lines.push(`- 客户/发标方: ${ctx.project.clientOrganization}`);
  }
  if (ctx.project.solicitationNumber) {
    lines.push(`- 招标编号: ${ctx.project.solicitationNumber}`);
  }
  if (ctx.project.closeDate) {
    lines.push(`- 截标时间: ${ctx.project.closeDate}`);
  }
  if (ctx.project.description) {
    lines.push(`- 项目描述: ${ctx.project.description.slice(0, 500)}`);
  }

  lines.push("", "## 询价信息");
  lines.push(`- 第 ${ctx.inquiry.roundNumber} 轮询价`);
  if (ctx.inquiry.title) lines.push(`- 询价标题: ${ctx.inquiry.title}`);
  if (ctx.inquiry.scope) lines.push(`- 询价范围: ${ctx.inquiry.scope}`);
  if (ctx.inquiry.dueDate) lines.push(`- 报价截止: ${ctx.inquiry.dueDate}`);

  lines.push("", "## 供应商信息");
  lines.push(`- 供应商名称: ${ctx.supplier.name}`);
  if (ctx.supplier.contactName) lines.push(`- 联系人: ${ctx.supplier.contactName}`);
  lines.push(`- 邮箱: ${ctx.supplier.contactEmail}`);
  if (ctx.supplier.category) lines.push(`- 品类: ${ctx.supplier.category}`);
  if (ctx.supplier.region) lines.push(`- 地区: ${ctx.supplier.region}`);

  if (ctx.inquiryItem.contactNotes) {
    lines.push("", `## 沟通备注`);
    lines.push(ctx.inquiryItem.contactNotes);
  }

  lines.push("", "## 输出要求");
  lines.push("严格按以下 JSON 格式输出，不要输出其他内容：");
  lines.push("```json");
  lines.push(`{`);
  lines.push(`  "subject": "邮件主题",`);
  lines.push(`  "body": "邮件正文（HTML 格式，可用 <p><br><ul><li> 等基础标签）"`);
  lines.push(`}`);
  lines.push("```");
  lines.push("");
  lines.push("## 邮件撰写规则");
  lines.push("1. 称呼：使用供应商联系人姓名（如有），否则用「贵司」");
  lines.push(`2. 落款：${ctx.senderName}${ctx.senderOrg ? `，${ctx.senderOrg}` : ""}`);
  lines.push("3. 语气：专业、简洁、有礼貌，符合中国商务邮件习惯");
  lines.push("4. 内容：说明项目背景、询价需求、报价截止时间（如有），请对方报价");
  lines.push("5. 不要编造不存在的信息，信息不足时用通用表达");
  lines.push("6. 主题格式：「询价」+ 项目关键信息 + 供应商名");

  return lines.join("\n");
}

// ── 批量催促邮件提示词 ─────────────────────────────────────────

export function getFollowupEmailPrompt(ctx: FollowupEmailContext): string {
  const lines: string[] = [
    `你是"青砚"邮件草稿助手。生成一封礼貌的催促/跟进邮件，提醒供应商回复报价。`,
    "",
    "## 项目信息",
    `- 项目名称: ${ctx.project.name}`,
  ];

  if (ctx.project.clientOrganization) lines.push(`- 客户: ${ctx.project.clientOrganization}`);
  if (ctx.project.solicitationNumber) lines.push(`- 招标编号: ${ctx.project.solicitationNumber}`);
  if (ctx.project.closeDate) lines.push(`- 截标时间: ${ctx.project.closeDate}`);

  lines.push("", "## 供应商信息");
  lines.push(`- 名称: ${ctx.supplier.name}`);
  if (ctx.supplier.contactName) lines.push(`- 联系人: ${ctx.supplier.contactName}`);
  lines.push(`- 邮箱: ${ctx.supplier.contactEmail}`);
  if (ctx.supplier.category) lines.push(`- 品类: ${ctx.supplier.category}`);

  lines.push("", "## 催促背景");
  lines.push(`- 第 ${ctx.inquiry.roundNumber} 轮询价`);
  if (ctx.inquiry.title) lines.push(`- 询价标题: ${ctx.inquiry.title}`);
  if (ctx.inquiry.dueDate) lines.push(`- 报价截止: ${ctx.inquiry.dueDate}`);
  lines.push(`- 已等待 ${ctx.daysSinceContact} 天未回复`);

  lines.push("", "## 输出要求");
  lines.push("严格按以下 JSON 格式输出：");
  lines.push("```json");
  lines.push(`{ "subject": "邮件主题", "body": "邮件正文（HTML 格式）" }`);
  lines.push("```");

  lines.push("", "## 邮件撰写规则");
  lines.push("1. 语气友善但有紧迫感，不要让对方觉得被催逼");
  lines.push("2. 先表示理解对方可能繁忙，再说明我方时间紧迫");
  lines.push("3. 如有截标时间，强调时间节点");
  lines.push(`4. 落款：${ctx.senderName}${ctx.senderOrg ? `，${ctx.senderOrg}` : ""}`);
  lines.push("5. 主题格式：「跟进」+ 项目名 + 报价请求");
  lines.push("6. 称呼用供应商联系人姓名（如有），否则用「贵司」");

  return lines.join("\n");
}

// ── 项目问题澄清邮件 ────────────────────────────────────────

export function getProjectQuestionEmailPrompt(ctx: ProjectQuestionEmailContext): string {
  const lines: string[] = [
    `You are a professional project communication assistant for "Qingyan".`,
    `Generate a formal English business email to the project Owner / GC / Consultant requesting clarification or confirmation on a project issue.`,
    "",
    "## Project Information",
    `- Project: ${ctx.project.name}`,
  ];

  if (ctx.project.solicitationNumber) {
    lines.push(`- Solicitation / Contract #: ${ctx.project.solicitationNumber}`);
  }
  if (ctx.project.clientOrganization) {
    lines.push(`- Client / Owner: ${ctx.project.clientOrganization}`);
  }
  if (ctx.project.description) {
    lines.push(`- Description: ${ctx.project.description.slice(0, 400)}`);
  }

  lines.push("", "## Issue Details");
  lines.push(`- Subject: ${ctx.question.title}`);
  lines.push(`- Description: ${ctx.question.description}`);

  if (ctx.question.locationOrReference) {
    lines.push(`- Location / Drawing / Reference: ${ctx.question.locationOrReference}`);
  }
  if (ctx.question.clarificationNeeded) {
    lines.push(`- Clarification Needed: ${ctx.question.clarificationNeeded}`);
  }
  if (ctx.question.impactNote) {
    lines.push(`- Potential Impact: ${ctx.question.impactNote}`);
  }

  lines.push("", "## Output Requirements");
  lines.push("Return ONLY valid JSON with no other text:");
  lines.push("```json");
  lines.push(`{`);
  lines.push(`  "subject": "Email subject line",`);
  lines.push(`  "body": "Full email body in HTML format (use <p>, <br>, <ul>, <li>, <strong>)"`);
  lines.push(`}`);
  lines.push("```");

  lines.push("", "## Email Structure Rules");
  lines.push("The email body MUST follow this structure:");
  lines.push("1. Brief opening: State purpose of the email (request for clarification/confirmation)");
  lines.push("2. Background: Reference what documents/drawings/site conditions were reviewed");
  lines.push("3. Issue description: Clearly describe what was found");
  lines.push("4. Items requiring confirmation: Use a numbered or bulleted list of specific questions");
  lines.push("5. Potential impact (if provided): Briefly note how this may affect pricing/schedule/scope");
  lines.push("6. Closing: Request timely response, professional sign-off");

  lines.push("", "## Writing Rules");
  lines.push("1. Tone: Formal, clear, concise, professional — suitable for Owner/GC/Consultant communication");
  lines.push("2. Do NOT make assumptions or draw conclusions without basis");
  lines.push("3. Do NOT be emotional or accusatory — stay objective and solution-oriented");
  lines.push("4. Each question/item for confirmation must be specific and actionable");
  lines.push("5. Do NOT just write 'Please advise' — be explicit about what needs to be confirmed");
  lines.push("6. This is a project record — write with documentation/audit awareness");
  lines.push(`7. Sign off as: ${ctx.senderName}${ctx.senderOrg ? `, ${ctx.senderOrg}` : ""}`);
  lines.push("8. Subject format: RE: [Project Name] — [Brief Issue Description]");
  lines.push("9. Keep the email under 400 words unless the issue requires more detail");

  return lines.join("\n");
}
