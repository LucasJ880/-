/**
 * 邮件 HTML 模板 — SUNNY HOME & DECO 品牌版
 *
 * 设计约束：
 *   - 主色：橙色 #ea580c（与 Order Form PDF、品牌识别一致）
 *   - 辅色：深橙 #c2410c，暖灰 #78716c
 *   - 文案定位：专业、信赖、稍带克制的温度，避免口语化
 *   - 邮件客户端兼容：仅用 table 布局 + inline style，不依赖 flex/grid
 */

type Lang = "en" | "cn" | "fr";

const BRAND = {
  name: "SUNNY HOME & DECO",
  tagline: {
    en: "Custom Window Coverings & Interior Decor",
    cn: "定制窗饰与家居软装",
    fr: "Habillages de fenêtres et décor intérieur sur mesure",
  },
  colorPrimary: "#ea580c",
  colorPrimaryDark: "#c2410c",
  colorPrimarySoft: "#fff7ed",
  colorInk: "#1c1917",
  colorMuted: "#78716c",
  colorBg: "#faf7f2",
};

const T: Record<Lang, Record<string, string>> = {
  en: {
    greeting: "Dear",
    quoteIntro:
      "Thank you for considering SUNNY HOME & DECO. Please find below the personalized quote our team has prepared for your home.",
    quoteHighlight:
      "Every product has been tailored to your space, materials and measurements. You may review the full breakdown, and when you are satisfied, sign electronically — directly through the secure link below — to confirm the order.",
    viewQuote: "View & Sign Quote",
    totalLabel: "Quote Total",
    validity:
      "This quote remains valid for 30 days from the date of issue. Pricing includes applicable HST.",
    nextSteps: "What happens after you sign",
    step1: "A member of our team will reach out within one business day to confirm deposit and schedule installation.",
    step2: "Deposit may be paid by cash, cheque or e-transfer.",
    step3: "Production begins once deposit is received; typical lead time is 3–5 weeks.",
    regards: "With appreciation,",
    teamSuffix: "Team",
    help: "Questions? Simply reply to this email — we will respond the same business day.",
    footerLegal:
      "SUNNY HOME & DECO · Custom Window Coverings & Interior Decor · www.sunnyshutter.ca",
    poweredBy: "Delivered securely by Qingyan AI",
    signedSubject: "Order Confirmed",
    signedIntro:
      "Your client has electronically signed the quote — the order is now confirmed on our side.",
    signedCustomer: "Client",
    signedTotal: "Order Total",
    signedTime: "Signed at",
    signedNextStep:
      "Next step: please register the deposit collection in Qingyan so production can be scheduled.",
    viewDetails: "Open Customer Record",
    subjectQuote: "Your Personalized Quote — SUNNY HOME & DECO",
    subjectSigned: "Quote Signed — Order Confirmed",
  },
  cn: {
    greeting: "尊敬的",
    quoteIntro:
      "感谢您选择 SUNNY HOME & DECO。以下是我们为您家量身准备的定制报价。",
    quoteHighlight:
      "每一个产品都依据您的空间、材质与尺寸量身配置。您可以通过下方安全链接完整查看明细，如确认无误，直接在线签字即可完成下单。",
    viewQuote: "查看并签字确认",
    totalLabel: "报价总额",
    validity: "本报价自签发之日起 30 日内有效，价格已包含适用 HST。",
    nextSteps: "签字之后的流程",
    step1: "我们的顾问将在一个工作日内与您联系，确认定金与安装档期。",
    step2: "定金可通过现金、支票或 Email Transfer（E-transfer）支付。",
    step3: "收到定金后进入生产阶段，常规交期为 3–5 周。",
    regards: "诚挚致意，",
    teamSuffix: "团队",
    help: "如有任何问题，直接回复此邮件即可，我们会在当日工作时间回复。",
    footerLegal:
      "SUNNY HOME & DECO · 定制窗饰与家居软装 · www.sunnyshutter.ca",
    poweredBy: "由青砚 AI 安全传送",
    signedSubject: "订单已确认",
    signedIntro: "您的客户已在线签署报价单，订单已在系统内确认。",
    signedCustomer: "客户",
    signedTotal: "订单金额",
    signedTime: "签约时间",
    signedNextStep:
      "下一步：请在青砚中登记定金收款情况，以便安排生产排程。",
    viewDetails: "打开客户档案",
    subjectQuote: "您的定制报价 — SUNNY HOME & DECO",
    subjectSigned: "报价已签字 — 订单已确认",
  },
  fr: {
    greeting: "Cher(e)",
    quoteIntro:
      "Merci de considérer SUNNY HOME & DECO. Veuillez trouver ci-dessous le devis personnalisé préparé pour votre intérieur.",
    quoteHighlight:
      "Chaque produit a été configuré selon vos espaces, matériaux et dimensions. Consultez le détail complet, puis signez électroniquement via le lien sécurisé ci-dessous pour confirmer la commande.",
    viewQuote: "Consulter et signer le devis",
    totalLabel: "Total du devis",
    validity:
      "Ce devis est valable 30 jours à compter de sa date d’émission. Les prix incluent la TVH applicable.",
    nextSteps: "Après la signature",
    step1:
      "Un membre de notre équipe vous contactera dans un jour ouvrable pour confirmer le dépôt et planifier l’installation.",
    step2: "Le dépôt peut être réglé par espèces, chèque ou virement Interac.",
    step3:
      "La production commence dès réception du dépôt ; le délai typique est de 3 à 5 semaines.",
    regards: "Cordialement,",
    teamSuffix: "Équipe",
    help: "Pour toute question, répondez simplement à ce courriel — nous répondons le jour ouvrable même.",
    footerLegal:
      "SUNNY HOME & DECO · Habillages de fenêtres et décor intérieur sur mesure · www.sunnyshutter.ca",
    poweredBy: "Livré en toute sécurité par Qingyan AI",
    signedSubject: "Commande confirmée",
    signedIntro:
      "Votre client vient de signer électroniquement le devis — la commande est confirmée de notre côté.",
    signedCustomer: "Client",
    signedTotal: "Total de la commande",
    signedTime: "Signé le",
    signedNextStep:
      "Prochaine étape : veuillez enregistrer l’acompte dans Qingyan afin de planifier la production.",
    viewDetails: "Ouvrir la fiche client",
    subjectQuote: "Votre devis personnalisé — SUNNY HOME & DECO",
    subjectSigned: "Devis signé — Commande confirmée",
  },
};

/** 邮件主题（用于外部调用）*/
export function quoteSubject(lang: Lang, grandTotal: number): string {
  const total = `CA$${grandTotal.toFixed(2)}`;
  return `${T[lang].subjectQuote} — ${total}`;
}

export function signedSubject(lang: Lang, customerName: string, grandTotal: number): string {
  const total = `CA$${grandTotal.toFixed(2)}`;
  return `${T[lang].subjectSigned} — ${customerName} · ${total}`;
}

function formatCurrency(amount: number): string {
  // Canada 风格：$1,234.56
  return `$${amount.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function baseLayout(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>SUNNY HOME & DECO</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.colorBg};font-family:'Helvetica Neue',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.colorInk};">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.colorBg};padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:4px;overflow:hidden;border:1px solid #f0ebe3;">
          ${bodyHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function brandHeader(lang: Lang): string {
  return `
<tr>
  <td style="background:linear-gradient(135deg,${BRAND.colorPrimary},${BRAND.colorPrimaryDark});padding:32px 40px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td>
          <p style="margin:0;color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:3px;text-transform:uppercase;">Est. Sunny Shutter Inc.</p>
          <h1 style="margin:6px 0 4px;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:1px;">${BRAND.name}</h1>
          <p style="margin:0;color:rgba(255,255,255,0.88);font-size:13px;font-style:italic;">${BRAND.tagline[lang]}</p>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function brandFooter(lang: Lang): string {
  const t = T[lang];
  return `
<tr>
  <td style="background:${BRAND.colorPrimarySoft};padding:20px 40px 24px;border-top:1px solid #f0ebe3;">
    <p style="margin:0;color:${BRAND.colorPrimaryDark};font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">${BRAND.name}</p>
    <p style="margin:4px 0 0;color:${BRAND.colorMuted};font-size:11px;line-height:1.6;">${t.footerLegal}</p>
    <p style="margin:8px 0 0;color:#a8a29e;font-size:10px;">${t.poweredBy}</p>
  </td>
</tr>`;
}

/**
 * 发给客户的报价邮件 —— 引导客户到公开页查看并签字
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
  const total = formatCurrency(opts.grandTotal);
  const signer = opts.senderName || `${BRAND.name} ${t.teamSuffix}`;

  const body = `
${brandHeader(lang)}
<tr>
  <td style="padding:36px 40px 8px;">
    <p style="margin:0 0 12px;color:${BRAND.colorInk};font-size:15px;">${t.greeting} ${opts.customerName},</p>
    <p style="margin:0 0 16px;color:${BRAND.colorInk};font-size:14px;line-height:1.7;">${t.quoteIntro}</p>
    <p style="margin:0 0 24px;color:${BRAND.colorMuted};font-size:13px;line-height:1.7;">${t.quoteHighlight}</p>

    <!-- Total card -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;background:${BRAND.colorPrimarySoft};border:1px solid #fed7aa;border-radius:4px;">
      <tr>
        <td style="padding:18px 24px;">
          <p style="margin:0;color:${BRAND.colorPrimaryDark};font-size:11px;letter-spacing:2px;text-transform:uppercase;">${t.totalLabel}</p>
          <p style="margin:4px 0 0;color:${BRAND.colorInk};font-size:26px;font-weight:700;letter-spacing:0.5px;">${total}</p>
        </td>
      </tr>
    </table>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
      <tr>
        <td style="background:${BRAND.colorPrimary};border-radius:4px;">
          <a href="${opts.quoteUrl}" style="display:inline-block;padding:14px 36px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.5px;">${t.viewQuote} →</a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 28px;color:${BRAND.colorMuted};font-size:12px;line-height:1.6;">${t.validity}</p>

    <!-- Next steps -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;border-top:1px solid #f0ebe3;">
      <tr>
        <td style="padding:20px 0 0;">
          <p style="margin:0 0 10px;color:${BRAND.colorInk};font-size:13px;font-weight:600;">${t.nextSteps}</p>
          <ul style="margin:0;padding:0 0 0 18px;color:${BRAND.colorMuted};font-size:12px;line-height:1.8;">
            <li>${t.step1}</li>
            <li>${t.step2}</li>
            <li>${t.step3}</li>
          </ul>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 24px;color:${BRAND.colorMuted};font-size:12px;line-height:1.6;font-style:italic;">${t.help}</p>

    <p style="margin:0;color:${BRAND.colorInk};font-size:13px;line-height:1.6;">${t.regards}<br/><strong>${signer}</strong></p>
  </td>
</tr>
<tr><td style="padding:0 40px 32px;"></td></tr>
${brandFooter(lang)}`;

  return baseLayout(body);
}

/**
 * 发给销售的签约通知邮件 —— 客户在公开页签字后触发
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
  const total = formatCurrency(opts.grandTotal);

  const body = `
${brandHeader(lang)}
<tr>
  <td style="padding:36px 40px 8px;">
    <p style="margin:0 0 4px;color:${BRAND.colorPrimaryDark};font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:700;">${t.signedSubject}</p>
    <p style="margin:0 0 20px;color:${BRAND.colorInk};font-size:20px;font-weight:600;">${opts.customerName}</p>

    <p style="margin:0 0 24px;color:${BRAND.colorInk};font-size:14px;line-height:1.7;">${opts.salesName}，${t.signedIntro}</p>

    <!-- Summary table -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background:${BRAND.colorPrimarySoft};border-radius:4px;">
      <tr>
        <td style="padding:14px 20px;border-bottom:1px solid #fed7aa;">
          <p style="margin:0;color:${BRAND.colorMuted};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">${t.signedCustomer}</p>
          <p style="margin:4px 0 0;color:${BRAND.colorInk};font-size:14px;font-weight:600;">${opts.customerName}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 20px;border-bottom:1px solid #fed7aa;">
          <p style="margin:0;color:${BRAND.colorMuted};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">${t.signedTotal}</p>
          <p style="margin:4px 0 0;color:${BRAND.colorPrimaryDark};font-size:20px;font-weight:700;">${total}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 20px;">
          <p style="margin:0;color:${BRAND.colorMuted};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">${t.signedTime}</p>
          <p style="margin:4px 0 0;color:${BRAND.colorInk};font-size:13px;">${opts.signedAt}</p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 24px;color:${BRAND.colorInk};font-size:13px;line-height:1.7;background:#fff7ed;border-left:3px solid ${BRAND.colorPrimary};padding:12px 16px;">${t.signedNextStep}</p>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background:${BRAND.colorPrimary};border-radius:4px;">
          <a href="${opts.quoteUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:0.5px;">${t.viewDetails} →</a>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr><td style="padding:0 40px 32px;"></td></tr>
${brandFooter(lang)}`;

  return baseLayout(body);
}
