/**
 * FLOW-H3 询价发出之后招标分析更新过——在那一轮上标出来（纯函数 + 开关）
 *
 * 只按时间判断：这一轮的发送卡创建（邮件正文定下）之后，项目有没有一份可用的分析完成。
 * 只提示，不说具体哪条要求变了（轮次不记它用了哪些要求，要求编号跨分析也不稳定），不做任何对外动作。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED：未设 / 为假 = 关。
 * TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时询价入口接口不返回 analysisUpdateNotes，页面与原来相同。
 */
export function isRfqAnalysisUpdateNoteEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isRfqAnalysisUpdateNoteEnabledForOrg(orgId: string | null | undefined): boolean {
  return isRfqAnalysisUpdateNoteEnabledForOrgWithEnv(orgId, process.env);
}

/** 一份分析「可用」的时刻：完成时间；缺失时按创建时间（有一条路径直接写成等待审核而不写完成时间） */
export function analysisAvailableAt(run: { completedAt: Date | null; createdAt: Date }): Date {
  return run.completedAt ?? run.createdAt;
}

function dayInZone(d: Date, timeZone: string): string {
  return d.toLocaleDateString("zh-CN", { timeZone, year: "numeric", month: "long", day: "numeric" });
}

export function analysisUpdateNoteZh(draftedAt: Date, analysisAt: Date, timeZone: string): string {
  return `这一轮是 ${dayInZone(draftedAt, timeZone)}起草的；之后招标分析在 ${dayInZone(analysisAt, timeZone)}更新过，这一轮引用的要求可能已经变了，请对照最新的要求核对，需要时另发一轮`;
}

/**
 * 按轮次给出提示。rounds：询价引擎发出的轮次（inquiryId + 发送卡的创建时间）；latestAnalysisAt：项目最新一份可用分析的可用时刻。
 * 分析可用的时刻严格晚于发送卡创建时才提示。
 */
export function analysisUpdateNotes(input: {
  rounds: ReadonlyArray<{ inquiryId: string; draftedAt: Date }>;
  latestAnalysisAt: Date | null;
  timeZone: string;
}): Record<string, { noteZh: string }> {
  const out: Record<string, { noteZh: string }> = {};
  if (!input.latestAnalysisAt) return out;
  for (const r of input.rounds) {
    if (input.latestAnalysisAt.getTime() > r.draftedAt.getTime()) out[r.inquiryId] = { noteZh: analysisUpdateNoteZh(r.draftedAt, input.latestAnalysisAt, input.timeZone) };
  }
  return out;
}
