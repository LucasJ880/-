/**
 * 邮件 HTML 模板 — 支持多语言
 */

type Lang = "en" | "cn" | "fr";

const T: Record<Lang, Record<string, string>> = {
  en: {
    quoteSubject: "Your Quote from SUNNY BLINDS",
    quoteGreeting: "Hi",
    quoteBody: "Thank you for choosing SUNNY BLINDS! Please find your customized quote below.",
    viewQuote: "View Quote",
    quoteFooter: "This quote is valid for 30 days. Click the button above to view details and confirm.",
    signedSubject: "Quote Accepted — SUNNY BLINDS",
    signedBody: "Great news! Your customer has accepted and signed the quote.",
    signedCustomer: "Customer",
    signedTotal: "Total",
    signedTime: "Signed at",
    viewDetails: "View Details",
    regards: "Best regards",
    team: "SUNNY BLINDS Team",
    poweredBy: "Powered by Qingyan AI",
  },
  cn: {
    quoteSubject: "SUNNY BLINDS 报价单",
    quoteGreeting: "您好",
    quoteBody: "感谢您选择 SUNNY BLINDS！以下是为您定制的报价单。",
    viewQuote: "查看报价",
    quoteFooter: "本报价有效期 30 天，点击上方按钮查看详情并确认。",
    signedSubject: "报价已签约 — SUNNY BLINDS",
    signedBody: "好消息！您的客户已接受并签署了报价单。",
    signedCustomer: "客户",
    signedTotal: "总额",
    signedTime: "签约时间",
    viewDetails: "查看详情",
    regards: "此致",
    team: "SUNNY BLINDS 团队",
    poweredBy: "由青砚 AI 驱动",
  },
  fr: {
    quoteSubject: "Votre devis de SUNNY BLINDS",
    quoteGreeting: "Bonjour",
    quoteBody: "Merci d'avoir choisi SUNNY BLINDS ! Veuillez trouver votre devis personnalisé ci-dessous.",
    viewQuote: "Voir le devis",
    quoteFooter: "Ce devis est valable 30 jours. Cliquez sur le bouton ci-dessus pour voir les détails et confirmer.",
    signedSubject: "Devis accepté — SUNNY BLINDS",
    signedBody: "Bonne nouvelle ! Votre client a accepté et signé le devis.",
    signedCustomer: "Client",
    signedTotal: "Total",
    signedTime: "Signé le",
    viewDetails: "Voir les détails",
    regards: "Cordialement",
    team: "L'équipe SUNNY BLINDS",
    poweredBy: "Propulsé par Qingyan AI",
  },
};

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
${content}
</table>
</td></tr>
</table>
</body></html>`;
}

/**
 * 报价邮件 — 发给客户
 */
export function quoteEmailHtml(opts: {
  customerName: string;
  quoteUrl: string;
  grandTotal: number;
  lang?: Lang;
  senderName?: string;
}): string {
  const lang = opts.lang || "en";
  const t = T[lang];

  return baseLayout(`
<tr><td style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:28px 32px;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">SUNNY BLINDS</h1>
  <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Custom Window Covering</p>
</td></tr>
<tr><td style="padding:32px;">
  <p style="margin:0 0 12px;color:#334155;font-size:15px;">${t.quoteGreeting} ${opts.customerName},</p>
  <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">${t.quoteBody}</p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
  <tr><td style="background:#2563eb;border-radius:8px;padding:12px 28px;">
    <a href="${opts.quoteUrl}" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">${t.viewQuote} — $${opts.grandTotal.toFixed(2)}</a>
  </td></tr>
  </table>
  <p style="margin:0 0 20px;color:#94a3b8;font-size:12px;line-height:1.5;">${t.quoteFooter}</p>
  <p style="margin:0;color:#64748b;font-size:13px;">${t.regards},<br><strong>${opts.senderName || t.team}</strong></p>
</td></tr>
<tr><td style="background:#f8fafc;padding:16px 32px;text-align:center;">
  <p style="margin:0;color:#94a3b8;font-size:11px;">${t.poweredBy}</p>
</td></tr>`);
}

/**
 * 签约通知邮件 — 发给销售
 */
export function signedNotifyHtml(opts: {
  salesName: string;
  customerName: string;
  grandTotal: number;
  signedAt: string;
  quoteUrl: string;
  lang?: Lang;
}): string {
  const lang = opts.lang || "cn";
  const t = T[lang];

  return baseLayout(`
<tr><td style="background:linear-gradient(135deg,#059669,#0d9488);padding:28px 32px;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">✅ ${t.signedSubject}</h1>
</td></tr>
<tr><td style="padding:32px;">
  <p style="margin:0 0 12px;color:#334155;font-size:15px;">${opts.salesName},</p>
  <p style="margin:0 0 20px;color:#64748b;font-size:14px;line-height:1.6;">${t.signedBody}</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px;margin:0 0 24px;">
  <tr><td style="padding:8px 16px;color:#64748b;font-size:13px;">${t.signedCustomer}</td><td style="padding:8px 16px;color:#334155;font-size:14px;font-weight:600;">${opts.customerName}</td></tr>
  <tr><td style="padding:8px 16px;color:#64748b;font-size:13px;">${t.signedTotal}</td><td style="padding:8px 16px;color:#059669;font-size:16px;font-weight:700;">$${opts.grandTotal.toFixed(2)}</td></tr>
  <tr><td style="padding:8px 16px;color:#64748b;font-size:13px;">${t.signedTime}</td><td style="padding:8px 16px;color:#334155;font-size:13px;">${opts.signedAt}</td></tr>
  </table>
  <table cellpadding="0" cellspacing="0">
  <tr><td style="background:#059669;border-radius:8px;padding:12px 28px;">
    <a href="${opts.quoteUrl}" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">${t.viewDetails}</a>
  </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f8fafc;padding:16px 32px;text-align:center;">
  <p style="margin:0;color:#94a3b8;font-size:11px;">${t.poweredBy}</p>
</td></tr>`);
}
