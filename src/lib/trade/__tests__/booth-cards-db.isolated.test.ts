/**
 * 展会速记卡录入 — 真实 DB 端到端（隔离库）
 *
 *   速记卡表格 → parseBoothCardSheet → boothCardToInquiry → ingestWebsiteInquiry(origin=trade_show)
 *   → Trade 线索（展会速记卡活动）→ Revenue Spine（trade_show 商机 / in_person 互动）→ FDE → 回复草稿进审批
 *
 * 重点：同一张卡重复录入不新增任何对象；只留 WhatsApp 的卡建商机但不出邮件草稿；
 * 同公司两位买家各自留痕（旧的名片导入按公司名去重会丢第二位）；网站询盘的标签与通知不受影响。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/trade/__tests__/booth-cards-db.isolated.test.ts
 * 无隔离库时自动跳过。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过展会速记卡 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Booth cards DB e2e" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : "");
  }
}

const EVENT = "the 140th Canton Fair (Booth 14.3E07)";

async function main() {
  const { db } = await import("@/lib/db");
  const { parseBoothCardSheet, boothCardToInquiry, boothCardOrigin } = await import("@/lib/trade/booth-cards");
  const { loadStyleReferences, resolveStyles, saveStyleReferences } = await import("@/lib/trade/style-references");
  const { ingestWebsiteInquiry, normalizeInquiry, BOOTH_CARD_CAMPAIGN_NAME } = await import("@/lib/trade/website-inquiry");
  const { INQUIRY_REPLY_ACTION_TYPE } = await import("@/lib/revenue-spine/fde/inbound-sales");
  const { __setToolPolicyLoaderForTest } = await import("@/lib/pending-actions/executor");
  const { approveApprovalItem } = await import("@/lib/approval/port");
  const { __setInquiryReplySenderForTest } = await import("@/lib/pending-actions/exec-sales-inquiry-reply");
  const { saveOrgEmailSender, sendAsOrg, sendTradeEmailForOrg } = await import("@/lib/trade/email-sender");
  const { boothDayOf, collectBoothSummary, formatBoothSummary, sendBoothSummary } = await import("@/lib/trade/booth-summary");
  const { draftNoReplyFollowUps } = await import("@/lib/revenue-spine/fde/no-reply-followup");
  __setToolPolicyLoaderForTest(async () => ({ value: {} }));

  const stamp = Date.now().toString(36);
  const ORG = `bcorg_${stamp}`;
  const OWNER = `bcowner_${stamp}`;
  const TRADE = `bctrade_${stamp}`;
  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Lucas Owner", role: "boss" } });
  await db.user.create({ data: { id: TRADE, email: `${TRADE}@fixture.test`, name: "Mengxin Trade Rep", role: "trade" } });
  await db.organization.create({ data: { id: ORG, name: "Mengxin Home Textile", code: `bc-${stamp}`, ownerId: OWNER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_owner", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: TRADE, role: "org_member", status: "active" } });

  const csv = [
    "卡号,日期,业务员,公司,联系人,职位,邮箱,WhatsApp,国家,买家类型,感兴趣款号,规格/认证,采购规模,时间,下一步,等级,备注,备注原文,语音备注",
    `CF140-0001,10/31,Cathy,Maple Home Goods ${stamp},Emma Brown,Purchasing Manager,emma.${stamp}@maplehome-${stamp}.ca,,Canada,零售/自有品牌,"MX-BL-001, MX-BR-001",OEKO-TEX; 280gsm,1-5柜,3个月内,"报价, 寄样",A,Wants own-brand gift box packaging,要自有品牌礼盒包装，圣诞季,`,
    `CF140-0002,10/31,Leo,Gulf Trading ${stamp},Omar,,,+971 50 123 4567,UAE,进口/批发,MX-BL-002,,>5柜,有具体项目,报价,A,,,`,
    `CF140-0003,10/31,Cathy,Maple Home Goods ${stamp},Liam Chen,Product Developer,liam.${stamp}@maplehome-${stamp}.ca,,Canada,零售/自有品牌,MX-CP-001,,<1柜,先了解,只发目录,C,,,`,
  ].join("\n");

  try {
    const parsed = parseBoothCardSheet(csv);
    ok(parsed.cards.length === 3 && parsed.cards.every((c) => c.errors.length === 0), "表格解析：3 张卡、无错误", parsed.cards.map((c) => c.errors));

    // 参考表：卡 1 的两个款号都在表里；卡 3 的 MX-CP-001 不在（只写款号）
    await saveStyleReferences(ORG, [{ code: "MX-BL-001", name: "Flannel / Coral Fleece Blanket" }, { code: "MX-BR-001", name: "Solid / Hotel / Spa Bathrobes" }], OWNER);
    const v2 = await saveStyleReferences(ORG, [
      { code: "MX-BL-001", name: "Flannel / Coral Fleece Blanket" },
      { code: "MX-BR-001", name: "Solid / Hotel / Spa Bathrobes" },
      { code: "MX-BL-002", name: "Sherpa Double-Layer Blanket" },
    ], OWNER);
    const refs = await loadStyleReferences(ORG);
    ok(v2.version === 2 && refs.length === 3, "参考表按版本发布，读到最新一版", { version: v2.version, refs });

    // 与录入接口一致：参考表对照款号，卡上等级随来源一起传
    const ingest = async (i: number) => {
      const card = parsed.cards[i].card;
      const styles = resolveStyles(card.styles, refs);
      const n = boothCardToInquiry(card, EVENT, styles);
      if (!n.ok) throw new Error(n.error);
      return ingestWebsiteInquiry(ORG, n.value, { origin: boothCardOrigin(card, EVENT, styles) });
    };

    // ── 卡 1：有邮箱 → 线索 + 商机 + 草稿待审批 ──
    const a = await ingest(0);
    ok(a.spine.ok && !!a.prospectId && !a.replay, "卡 1 建链：线索 + 商机", a.spine);
    const prospectA = await db.tradeProspect.findUnique({ where: { id: a.prospectId }, include: { campaign: { select: { name: true } } } });
    ok(prospectA?.source === "exhibition" && prospectA.campaign.name === BOOTH_CARD_CAMPAIGN_NAME, "线索来源 exhibition，归到「展会速记卡」活动", { source: prospectA?.source, campaign: prospectA?.campaign.name });
    const msgA = await db.tradeMessage.findUnique({ where: { id: a.messageId } });
    ok(
      msgA?.channel === "exhibition" && /^【展会速记卡】/.test(msgA.content) && /展会：the 140th Canton Fair \(Booth 14\.3E07\) · 卡号 CF140-0001 · 10\/31 · 业务员 Cathy · 等级 A · 职位 Purchasing Manager/.test(msgA.content),
      "时间线消息：展会速记卡标签；展会 / 卡号 / 日期 / 业务员 / 卡上等级 / 职位",
      msgA?.content,
    );
    const oppA = a.spine.ok ? await db.salesOpportunity.findUnique({ where: { id: a.spine.opportunityId } }) : null;
    ok(oppA?.source === "trade_show", "商机来源 trade_show", oppA?.source);
    const interactionA = a.spine.ok ? await db.customerInteraction.findUnique({ where: { id: a.spine.interactionId } }) : null;
    const extraA = (interactionA?.analysisResult ?? {}) as Record<string, unknown>;
    ok(interactionA?.channel === "trade_show" && interactionA.type === "in_person" && extraA.event === EVENT, "互动：trade_show / 面谈，记下展会名", { channel: interactionA?.channel, type: interactionA?.type, event: extraA.event });
    ok(interactionA?.language !== "zh", "正文英文标签，回复语言不是中文", interactionA?.language);
    const draftA = await db.pendingAction.findFirst({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", payload: { path: ["opportunityId"], equals: oppA?.id ?? "" } } });
    const payloadA = (draftA?.payload ?? {}) as Record<string, unknown>;
    const bodyA = String(payloadA.body ?? "");
    const subjectA = String(payloadA.subject ?? "");
    ok(!!draftA, "回复草稿已进审批（未发送）", a.fdeState);
    ok(draftA?.title === `跟进邮件（展会 · A 级）：Maple Home Goods ${stamp}`, "审批标题带展会和卡上等级", draftA?.title);
    ok(a.fdeState?.pendingActionId === draftA?.id, "录入结果里的 pendingActionId 就是这封草稿（页面据此显示「草稿待审批」）", { result: a.fdeState?.pendingActionId, draft: draftA?.id });
    ok(oppA?.priority === "hot", "卡上 A 级 → 商机优先级 hot（AI 评分照常记录）", { priority: oppA?.priority });
    const oppA2 = a.spine.ok ? await db.salesOpportunity.findUnique({ where: { id: a.spine.opportunityId }, select: { priority: true, scoreGrade: true } }) : null;
    ok(oppA2?.priority === "hot" && !!oppA2.scoreGrade, "FDE 评分后优先级仍按卡上等级", oppA2);
    const gradeEvent = await db.agentRunEvent.findFirst({ where: { orgId: ORG, title: { startsWith: "展会卡上等级 A" } } });
    ok(!!gradeEvent, "运行记录里写明按卡上等级定优先级", gradeEvent?.title);
    ok(/Thank you for visiting the Mengxin Home Textile booth at the 140th Canton Fair \(Booth 14\.3E07\)/.test(bodyA) && !/received your inquiry/i.test(bodyA), "草稿开头是展位来访，不是“收到询盘”", bodyA.slice(0, 240));
    ok(/^Great meeting you at the 140th Canton Fair/.test(subjectA), "草稿主题：Great meeting you at …", subjectA);
    ok(
      /- Certification: OEKO-TEX/.test(bodyA) && /- Packaging: Wants own-brand gift box packaging/.test(bodyA) && !/- (Quantity|Customization|Required delivery)/i.test(bodyA) && !/- Material/.test(bodyA) && !/CF140|grade/i.test(bodyA),
      "草稿里的需求要点只有卡上的真实信息：认证、包装；没有从编号里读出的数量 / 从参考款名读出的材质 / 虚构交期 / 内部信息",
      bodyA.split("\n"),
    );
    ok(
      /You looked at these reference styles from our past production:\n- Flannel \/ Coral Fleece Blanket \(ref\. MX-BL-001\)\n- Solid \/ Hotel \/ Spa Bathrobes \(ref\. MX-BR-001\)\nEach of them can be made to your own specification/.test(bodyA) &&
        !/Which specific product/.test(bodyA),
      "草稿逐一点名参考款（OEM：做过的款式、按买家规格定做），不再问“要哪个产品”",
      bodyA.split("\n"),
    );
    ok(/Best regards,\nCathy\nMengxin Home Textile\s*$/.test(bodyA), "落款是卡上接待的业务员（买家在展位见到的人）", bodyA.slice(-80));
    ok(
      /——— 中文对照（仅供审核，不会发送/.test(draftA?.preview ?? "") && /感谢您在 the 140th Canton Fair \(Booth 14\.3E07\) 莅临/.test(draftA?.preview ?? "") && !/中文对照/.test(bodyA),
      "审批预览附中文对照给审核人看；发送正文里没有",
      (draftA?.preview ?? "").slice(-400),
    );
    ok(/备注原文 要自有品牌礼盒包装，圣诞季/.test(msgA?.content ?? ""), "时间线记下中文备注原文", msgA?.content);
    const tradeNotes = await db.notification.count({ where: { userId: TRADE, title: { startsWith: "展会速记卡：" } } });
    ok(tradeNotes === 0, "夜间批量录入不逐张通知外贸成员", tradeNotes);

    // ── 同一张卡再录一次：不新增任何对象 ──
    const counts = async () => ({
      prospects: await db.tradeProspect.count({ where: { orgId: ORG } }),
      messages: await db.tradeMessage.count({ where: { prospect: { orgId: ORG } } }),
      opportunities: await db.salesOpportunity.count({ where: { orgId: ORG } }),
      interactions: await db.customerInteraction.count({ where: { orgId: ORG } }),
      drafts: await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE } }),
    });
    const before = await counts();
    const a2 = await ingest(0);
    const after = await counts();
    ok(a2.replay && a2.spine.ok && a.spine.ok && a2.spine.opportunityId === a.spine.opportunityId, "重复录入：同一商机，replay=true", { replay: a2.replay });
    ok(JSON.stringify(before) === JSON.stringify(after), "重复录入：线索 / 消息 / 商机 / 互动 / 草稿数都不变", { before, after });
    const receipt = await db.websiteInquiryReceipt.findFirst({ where: { orgId: ORG, eventId: "card:CF140-0001" } });
    ok(receipt?.source === "trade_show" && receipt.attempts >= 2, "事件身份：card:CF140-0001，来源 trade_show", { source: receipt?.source, attempts: receipt?.attempts });

    // ── 卡 2：只留 WhatsApp → 商机建好，没有邮件草稿 ──
    const b = await ingest(1);
    ok(b.spine.ok, "卡 2（只留 WhatsApp）建商机", b.spine);
    const draftsB = b.spine.ok ? await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: b.spine.opportunityId } } }) : -1;
    ok(draftsB === 0, "卡 2 无邮箱：不生成邮件草稿（业务用 WhatsApp 跟进）", draftsB);
    const custB = b.spine.ok ? await db.salesCustomer.findUnique({ where: { id: b.spine.customerId } }) : null;
    ok(custB?.phone === "+971 50 123 4567", "卡 2 客户电话 = WhatsApp", custB?.phone);

    // ── 卡 3：同公司另一位买家 → 自己的线索与来信，不被当成重复丢掉 ──
    const c = await ingest(2);
    ok(c.spine.ok && c.prospectId !== a.prospectId && !c.replay, "卡 3（同公司另一人）单独留痕", { a: a.prospectId, c: c.prospectId });
    const msgC = await db.tradeMessage.findUnique({ where: { id: c.messageId } });
    ok(!!msgC && /卡号 CF140-0003/.test(msgC.content), "卡 3 的消息带自己的卡号", msgC?.content);
    const oppC = c.spine.ok ? await db.salesOpportunity.findUnique({ where: { id: c.spine.opportunityId }, select: { priority: true } }) : null;
    const interactionC = c.spine.ok ? await db.customerInteraction.findUnique({ where: { id: c.spine.interactionId }, select: { content: true } }) : null;
    ok(/Interested in reference styles: MX-CP-001\./.test(interactionC?.content ?? ""), "不在参考表的款号原样写款号", interactionC?.content);
    if (c.spine.ok && a.spine.ok && c.spine.opportunityId !== a.spine.opportunityId) {
      ok(oppC?.priority === "cold", "卡上 C 级 → 优先级 cold", oppC);
    } else {
      // 同公司卡 3（C 级）并进了卡 1（A 级）的商机：取最高等级，仍按 A 跟进
      ok(oppC?.priority === "hot", "同一商机多张卡取最高等级：A + C → hot", oppC);
    }

    // ── 网站询盘不受影响：标签、来源、通知照旧 ──
    const web = normalizeInquiry({ name: "Web Buyer", email: `web.${stamp}@buyer-${stamp}.com`, company: `Web Buyer ${stamp}`, message: "Need 500 coral fleece bathrobes.", eventId: `inq_${stamp}` });
    if (!web.ok) throw new Error(web.error);
    const w = await ingestWebsiteInquiry(ORG, web.value, { runFde: false });
    const msgW = await db.tradeMessage.findUnique({ where: { id: w.messageId } });
    const prospectW = await db.tradeProspect.findUnique({ where: { id: w.prospectId }, include: { campaign: { select: { name: true } } } });
    const oppW = w.spine.ok ? await db.salesOpportunity.findUnique({ where: { id: w.spine.opportunityId } }) : null;
    const webReceipt = await db.websiteInquiryReceipt.findFirst({ where: { orgId: ORG, eventId: `inq_${stamp}` } });
    ok(
      msgW?.channel === "website" && /^【网站询盘】/.test(msgW.content) && prospectW?.source === "website" && prospectW.campaign.name === "网站询盘" && oppW?.source === "website_inquiry" && webReceipt?.source === "website",
      "网站询盘：渠道 / 标签 / 活动 / 商机来源 / 收据来源不变",
      { channel: msgW?.channel, source: prospectW?.source, campaign: prospectW?.campaign.name, opp: oppW?.source, receipt: webReceipt?.source },
    );
    ok(w.notified > 0, "网站询盘照常通知外贸成员", w.notified);

    // ── 刁钻询盘走完整链路：给目标价的照样有草稿（不复述价格）；侵权图案的审批标题带 ⚠、预览最上面是中文提醒 ──
    const { TRICKY_INQUIRIES } = await import("@/lib/revenue-spine/__tests__/fixtures/tricky-inquiries");
    const trickyDraft = async (id: string) => {
      const t = TRICKY_INQUIRIES.find((x) => x.id === id)!;
      const n = normalizeInquiry({ name: t.name, email: `${id.toLowerCase()}.${stamp}@${t.email.split("@")[1]}`, company: `${t.company} ${stamp}`, country: t.country, message: t.message, eventId: `tricky_${id}_${stamp}` });
      if (!n.ok) throw new Error(n.error);
      const r = await ingestWebsiteInquiry(ORG, n.value);
      return r.spine.ok
        ? db.pendingAction.findFirst({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: r.spine.opportunityId } } })
        : null;
    };
    const t02 = await trickyDraft("T02");
    const t02Body = String((t02?.payload as Record<string, unknown> | undefined)?.body ?? "");
    ok(!!t02 && !/2\.5|USD/i.test(t02Body) && !t02?.title.startsWith("⚠"), "买家给了目标价：照样生成草稿，邮件里不复述价格", { title: t02?.title, body: t02Body.slice(0, 400) });
    const t10 = await trickyDraft("T10");
    const t10Body = String((t10?.payload as Record<string, unknown> | undefined)?.body ?? "");
    ok(
      !!t10 && t10.title.startsWith("⚠ 发送询盘回复：") && (t10.preview ?? "").startsWith("⚠ 审核提醒（不会发送）：\n- 买家要用品牌 / 卡通图案") && !/disney|pok[eé]mon/i.test(t10Body),
      "侵权图案：审批标题带 ⚠，预览最上面是中文提醒，邮件里不提品牌",
      { title: t10?.title, preview: (t10?.preview ?? "").slice(0, 200) },
    );
    const riskEvent = await db.agentRunEvent.findFirst({ where: { orgId: ORG, title: { startsWith: "来信风险提醒：ip_license" } } });
    ok(!!riskEvent, "运行记录里写明来信风险", riskEvent?.title);

    // ── 展会小结：当天录入的 3 张卡（网站询盘不算），发给管理层（老板），不发给外贸；同样张数不重复发 ──
    const TZ = "Asia/Shanghai";
    const today = boothDayOf(new Date(), TZ);
    const summary = await collectBoothSummary(ORG, today, TZ);
    const cardNos = summary.cards.map((c) => c.cardNo);
    ok(cardNos.join(",") === "CF140-0001,CF140-0002,CF140-0003" && summary.event === EVENT, "小结只收当天的速记卡，按卡号排", { cardNos, event: summary.event });
    const c1 = summary.cards[0];
    ok(c1.grade === "A" && c1.sales === "Cathy" && c1.nextStep === "报价, 寄样" && c1.noteOriginal === "要自有品牌礼盒包装，圣诞季" && c1.hasEmail, "卡上等级、业务员、下一步、备注原文读回", c1);
    ok(summary.cards[1].hasEmail === false && summary.cards[1].draftStatus === null, "只有 WhatsApp 的卡：没有草稿", summary.cards[1]);
    const { text: summaryText } = formatBoothSummary(summary);
    ok(/录入 3 张：A 2 · B 0 · C 1/.test(summaryText) && /只有 WhatsApp 1 张/.test(summaryText) && /A 级 2 张/.test(summaryText), "小结正文", summaryText);
    const pushed: string[] = [];
    const push = async (userId: string) => {
      pushed.push(userId);
    };
    const firstSend = await sendBoothSummary(ORG, today, TZ, { push });
    ok(firstSend.total === 3 && firstSend.recipients === 1 && firstSend.sent === 1 && pushed.join() === OWNER, "发给管理层（老板），并推送微信", { firstSend, pushed });
    const ownerNote = await db.notification.findFirst({ where: { userId: OWNER, type: "trade_booth_summary" } });
    ok(ownerNote?.entityType === "trade_booth_summary" && ownerNote.entityId === today && /^展会小结 .*录入 3 张，A 级 2 张$/.test(ownerNote.title), "青砚通知：点开回到当天小结", ownerNote);
    const tradeNote = await db.notification.count({ where: { userId: TRADE, type: "trade_booth_summary" } });
    ok(tradeNote === 0, "外贸成员不收小结", tradeNote);
    const again = await sendBoothSummary(ORG, today, TZ, { push });
    ok(again.sent === 0 && pushed.length === 1, "同一天同样张数不重复发", again);

    // ── 公司发件身份：批准后以梦馨身份发出；域名未验证时平台地址代发，回复地址和密送不变 ──
    const CATHY = "cathy@hlmbedding.com";
    const ORG_FROM = '"Cathy | Mengxin Home Textile" <cathy@hlmbedding.com>';
    const PLATFORM_FROM = '"Cathy | Mengxin Home Textile" <noreply@qingyan.ai>';
    await saveOrgEmailSender(ORG, { fromName: "Cathy | Mengxin Home Textile", fromEmail: CATHY, replyTo: CATHY, bcc: [CATHY] }, OWNER);
    const sends: Array<{ to: string; from?: string; replyTo?: string; bcc?: string[] }> = [];
    const unverifiedResend = async (m: { to: string; from?: string; replyTo?: string; bcc?: string[] }) => {
      sends.push({ to: m.to, from: m.from, replyTo: m.replyTo, bcc: m.bcc });
      return m.from?.includes("@hlmbedding.com")
        ? { success: false, error: "The hlmbedding.com domain is not verified. Please, add and verify your domain on https://resend.com/domains", errorName: "validation_error" }
        : { success: true, messageId: `re_${sends.length}` };
    };
    let seenSender: { fromEmail?: string | null } | null | undefined;
    __setInquiryReplySenderForTest(async (input) => {
      seenSender = input.orgSender;
      if (!input.orgSender) throw new Error("组织发件身份没有传给发送通道");
      const r = await sendAsOrg(input.orgSender, input, unverifiedResend, "noreply@qingyan.ai");
      return { channel: "resend", messageId: r.messageId, from: r.from, fallback: r.fallback };
    });
    try {
      const latestA = await db.pendingAction.findFirst({
        where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", payload: { path: ["opportunityId"], equals: oppA?.id ?? "" } },
        orderBy: { createdAt: "desc" },
      });
      const approved = latestA ? await approveApprovalItem("pending_action", latestA.id, { userId: OWNER, role: "boss", orgId: ORG }) : null;
      ok(approved?.ok === true, "管理层批准跟进邮件", approved);
      ok(seenSender?.fromEmail === CATHY, "发送通道拿到梦馨的发件身份（不用审批人的个人 Gmail）", seenSender);
      ok(
        sends.length === 2 && sends[0].from === ORG_FROM && sends[1].from === PLATFORM_FROM &&
          sends.every((x) => x.replyTo === CATHY && x.bcc?.[0] === CATHY),
        "域名未验证：先试 cathy@hlmbedding.com，被拒后平台地址代发；显示名、回复地址、密送不变",
        sends,
      );
      const outA = await db.customerInteraction.findFirst({ where: { orgId: ORG, opportunityId: oppA?.id ?? "", direction: "outbound" }, orderBy: { createdAt: "desc" } });
      const outExtra = (outA?.analysisResult ?? {}) as Record<string, unknown>;
      ok(outExtra.sentFrom === PLATFORM_FROM && outExtra.senderFallback === true, "时间线记下实际发件人、是否代发", outExtra);

      // 外贸收件箱回复 / 开发信走同一出口
      sends.length = 0;
      const inboxReply = await sendTradeEmailForOrg(ORG, { to: "buyer@example.com", subject: "Re: your inquiry", body: "Thanks" }, unverifiedResend);
      ok(inboxReply.success && inboxReply.from === PLATFORM_FROM && sends[1]?.replyTo === CATHY, "收件箱回复同样以梦馨身份发出", { inboxReply, sends });
      sends.length = 0;
      const noConfig = await sendTradeEmailForOrg(`${ORG}_none`, { to: "buyer@example.com", subject: "Hi", body: "Hi" }, unverifiedResend);
      ok(noConfig.success && sends.length === 1 && sends[0].from === undefined, "没设发件身份的组织：沿用平台默认发件人", sends);
    } finally {
      __setInquiryReplySenderForTest(null);
    }

    // ── 展后跟进：首封发出后买家没回信 → 第 3 天起草第 1 次跟进（展会口吻、Cathy 落款、沿用主题），不重复；
    //    批准发出后第 7 天起草第 2 次；买家回信后不再起草 ──
    const DAY = 86_400_000;
    const oppAState = await db.salesOpportunity.findUnique({ where: { id: oppA?.id ?? "" }, select: { lastOutboundAt: true, followUpCount: true } });
    const sentAt = oppAState?.lastOutboundAt ?? new Date();
    ok(oppAState?.followUpCount === 1, "首封已发出（followUpCount = 1）", oppAState);
    const early = await draftNoReplyFollowUps(ORG, { now: new Date(sentAt.getTime() + 2 * DAY) });
    ok(early.drafted === 0, "第 2 天：还不到跟进时间", early);
    const day3 = await draftNoReplyFollowUps(ORG, { now: new Date(sentAt.getTime() + 3 * DAY + 60_000) });
    const fu1 = day3.pendingActionIds.length
      ? await db.pendingAction.findFirst({ where: { id: { in: day3.pendingActionIds }, payload: { path: ["opportunityId"], equals: oppA?.id ?? "" } } })
      : null;
    const fu1Payload = (fu1?.payload ?? {}) as Record<string, unknown>;
    ok(
      !!fu1 && /^跟进第 1\/3 次（展会 · A 级 · 3 天未回复）：Maple Home Goods/.test(fu1.title) && fu1Payload.followUpStep === 1,
      "第 3 天：起草第 1 次跟进，标题写明第几次、卡上等级、几天未回复",
      { title: fu1?.title, step: fu1Payload.followUpStep },
    );
    const fu1Body = String(fu1Payload.body ?? "");
    ok(
      /^Re: Great meeting you at the 140th Canton Fair/.test(String(fu1Payload.subject)) &&
        /I hope you had a good trip back from the 140th Canton Fair/.test(fu1Body) &&
        /Best regards,\nCathy\nMengxin Home Textile$/.test(fu1Body) &&
        /——— 中文对照（仅供审核，不会发送）———\n回复：Great meeting you/.test(fu1?.preview ?? ""),
      "跟进草稿：沿用首封主题、展会口吻、Cathy 落款，预览附中文对照",
      { subject: fu1Payload.subject, body: fu1Body },
    );
    const again3 = await draftNoReplyFollowUps(ORG, { now: new Date(sentAt.getTime() + 3 * DAY + 120_000) });
    ok(!again3.pendingActionIds.some((id) => id === fu1?.id) && again3.skipped.some((x) => x.opportunityId === oppA?.id), "再跑一次不重复起草", again3);

    __setInquiryReplySenderForTest(async () => ({ channel: "test", messageId: `fu_${Date.now()}` }));
    try {
      const sentFu1 = fu1 ? await approveApprovalItem("pending_action", fu1.id, { userId: OWNER, role: "boss", orgId: ORG }) : null;
      ok(sentFu1?.ok === true, "批准第 1 次跟进并发出", sentFu1);
    } finally {
      __setInquiryReplySenderForTest(null);
    }
    const afterFu1 = await db.salesOpportunity.findUnique({ where: { id: oppA?.id ?? "" }, select: { lastOutboundAt: true, followUpCount: true } });
    const fu1SentAt = afterFu1?.lastOutboundAt ?? new Date();
    const day6 = await draftNoReplyFollowUps(ORG, { now: new Date(fu1SentAt.getTime() + 3 * DAY) });
    ok(afterFu1?.followUpCount === 2 && !day6.skipped.some((x) => x.opportunityId === oppA?.id) && day6.drafted === 0, "第 1 次跟进发出后 3 天：还不到第 2 次（间隔 4 天）", { afterFu1, day6 });
    const day7 = await draftNoReplyFollowUps(ORG, { now: new Date(fu1SentAt.getTime() + 4 * DAY + 60_000) });
    const fu2 = await db.pendingAction.findFirst({ where: { id: { in: day7.pendingActionIds }, payload: { path: ["opportunityId"], equals: oppA?.id ?? "" } } });
    ok(!!fu2 && /^跟进第 2\/3 次.*7 天未回复/.test(fu2.title) && /still active/.test(String((fu2.payload as Record<string, unknown>).body)), "第 7 天：起草第 2 次跟进（问项目是否还在进行）", fu2?.title);

    // 买家回信：之后不再起草；已起草的第 2 次因来信更新而过时（executor 发送前拒发）
    await db.salesOpportunity.update({ where: { id: oppA?.id ?? "" }, data: { lastCustomerReplyAt: new Date(fu1SentAt.getTime() + 5 * DAY) } });
    const afterReply = await draftNoReplyFollowUps(ORG, { now: new Date(fu1SentAt.getTime() + 30 * DAY) });
    ok(!afterReply.pendingActionIds.length || !(await db.pendingAction.count({ where: { id: { in: afterReply.pendingActionIds }, payload: { path: ["opportunityId"], equals: oppA?.id ?? "" } } })), "买家回信后不再起草跟进", afterReply);
  } finally {
    try {
      const oppIds = (await db.salesOpportunity.findMany({ where: { orgId: ORG }, select: { id: true } })).map((o) => o.id);
      await db.pendingAction.deleteMany({ where: { orgId: ORG } });
      await db.websiteInquiryReceipt.deleteMany({ where: { orgId: ORG } });
      await db.tradeInquiryAnalysis.deleteMany({ where: { prospect: { orgId: ORG } } }).catch(() => undefined);
      await db.tradeOutreachStep.deleteMany({ where: { prospect: { orgId: ORG } } }).catch(() => undefined);
      await db.tradeMessage.deleteMany({ where: { prospect: { orgId: ORG } } });
      await db.tradeProspect.deleteMany({ where: { orgId: ORG } });
      await db.tradeCampaign.deleteMany({ where: { orgId: ORG } });
      await db.customerInteraction.deleteMany({ where: { orgId: ORG } });
      await db.salesAction.deleteMany({ where: { orgId: ORG } });
      await db.salesRfqEvidence.deleteMany({ where: { orgId: ORG } });
      await db.salesRfq.deleteMany({ where: { orgId: ORG } });
      await db.salesOpportunityAssessment.deleteMany({ where: { orgId: ORG } });
      await db.salesOpportunity.deleteMany({ where: { id: { in: oppIds } } });
      await db.salesCustomer.deleteMany({ where: { orgId: ORG } });
      await db.agentRunEvent.deleteMany({ where: { orgId: ORG } });
      await db.agentRun.deleteMany({ where: { orgId: ORG } });
      await db.agentSession.deleteMany({ where: { orgId: ORG } });
      await db.capabilityQuotaReservation.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
      await db.auditLog.deleteMany({ where: { orgId: ORG } });
      await db.organizationMember.deleteMany({ where: { orgId: ORG } });
      await db.organization.deleteMany({ where: { id: ORG } });
      await db.auditLog.deleteMany({ where: { userId: { in: [OWNER, TRADE] } } });
      await db.notification.deleteMany({ where: { userId: { in: [OWNER, TRADE] } } });
      await db.user.deleteMany({ where: { id: { in: [OWNER, TRADE] } } });
    } catch (cleanupErr) {
      console.warn("[cleanup] 清理未完成：", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  });
